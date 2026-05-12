"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  PipecatClient,
  type Participant,
  type RTVIEventCallbacks,
} from "@pipecat-ai/client-js"
import {
  ProtobufFrameSerializer,
  WebSocketTransport,
} from "@pipecat-ai/websocket-transport"

export type BotStatus = "idle" | "connecting" | "live" | "error"

export type UsePipecatBot = {
  status: BotStatus
  error: string | null
  isUserSpeaking: boolean
  isBotSpeaking: boolean
  isMuted: boolean
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  setMuted: (muted: boolean) => void
  toggleMuted: () => void
  /** Returns the latest waveform bars (0..1). Empty array when no audio. */
  getAnalyserData: () => number[]
}

const DEFAULT_WS_URL =
  process.env.NEXT_PUBLIC_PIPECAT_WS_URL ?? "ws://localhost:8765/ws"

const BAR_COUNT = 60

/**
 * Owns a single PipecatClient instance. Connects to the FastAPI WebSocket
 * bot, exposes lifecycle state, and produces a normalized amplitude array
 * suitable for driving <Waveform data={...} />.
 *
 * The analyser data is read via a ref-backed getter (not React state) so the
 * waveform can poll at rAF cadence without forcing re-renders.
 */
export function usePipecatBot(): UsePipecatBot {
  const [status, setStatus] = useState<BotStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [isUserSpeaking, setIsUserSpeaking] = useState(false)
  const [isBotSpeaking, setIsBotSpeaking] = useState(false)
  const [isMuted, setIsMuted] = useState(false)

  const clientRef = useRef<PipecatClient | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const localAnalyserRef = useRef<AnalyserNode | null>(null)
  const botAnalyserRef = useRef<AnalyserNode | null>(null)
  const localSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const botSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const freqBufRef = useRef<Uint8Array | null>(null)
  // Refs mirror state so callbacks (closed over the first render) read fresh values.
  const userSpeakingRef = useRef(false)
  const botSpeakingRef = useRef(false)

  const ensureAudioContext = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      audioCtxRef.current = new Ctor()
    }
    if (audioCtxRef.current.state === "suspended") {
      void audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }, [])

  const attachAnalyser = useCallback(
    (track: MediaStreamTrack, side: "local" | "bot") => {
      if (track.kind !== "audio") return
      const ctx = ensureAudioContext()
      const stream = new MediaStream([track])
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 128
      analyser.smoothingTimeConstant = 0.7
      source.connect(analyser)

      if (side === "local") {
        localSourceRef.current?.disconnect()
        localSourceRef.current = source
        localAnalyserRef.current = analyser
      } else {
        botSourceRef.current?.disconnect()
        botSourceRef.current = source
        botAnalyserRef.current = analyser
      }
      if (!freqBufRef.current) {
        freqBufRef.current = new Uint8Array(analyser.frequencyBinCount)
      }
    },
    [ensureAudioContext],
  )

  const detachAnalyser = useCallback((side: "local" | "bot") => {
    const sourceRef = side === "local" ? localSourceRef : botSourceRef
    const analyserRef = side === "local" ? localAnalyserRef : botAnalyserRef
    // We only own the local-side graph. The bot analyser is borrowed from the
    // SDK's WavStreamPlayer (see connect()); disconnecting it would silence
    // bot playback, so just drop our reference.
    if (sourceRef.current) {
      sourceRef.current.disconnect()
      if (side === "local") analyserRef.current?.disconnect()
    }
    sourceRef.current = null
    analyserRef.current = null
  }, [])

  const getAnalyserData = useCallback((): number[] => {
    // Prefer whichever side is currently speaking; fall back to local mic so
    // the waveform stays responsive between turns.
    const analyser =
      (botSpeakingRef.current && botAnalyserRef.current) ||
      (userSpeakingRef.current && localAnalyserRef.current) ||
      localAnalyserRef.current ||
      botAnalyserRef.current
    if (!analyser) return []

    const buf =
      freqBufRef.current && freqBufRef.current.length === analyser.frequencyBinCount
        ? freqBufRef.current
        : (freqBufRef.current = new Uint8Array(analyser.frequencyBinCount))
    analyser.getByteFrequencyData(buf as Uint8Array<ArrayBuffer>)

    // Resample the FFT bins into BAR_COUNT bars and normalize 0..1.
    const out = new Array<number>(BAR_COUNT)
    const step = buf.length / BAR_COUNT
    for (let i = 0; i < BAR_COUNT; i++) {
      const start = Math.floor(i * step)
      const end = Math.max(start + 1, Math.floor((i + 1) * step))
      let sum = 0
      for (let j = start; j < end; j++) sum += buf[j]
      const avg = sum / (end - start) / 255
      // Lift the floor a touch so quiet speech still moves the bars.
      out[i] = Math.min(1, Math.max(0.05, avg * 1.4))
    }
    return out
  }, [])

  const teardown = useCallback(async () => {
    detachAnalyser("local")
    detachAnalyser("bot")
    if (audioCtxRef.current) {
      await audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    freqBufRef.current = null
    userSpeakingRef.current = false
    botSpeakingRef.current = false
    setIsUserSpeaking(false)
    setIsBotSpeaking(false)
  }, [detachAnalyser])

  const connect = useCallback(async () => {
    if (clientRef.current) return
    setError(null)
    setStatus("connecting")

    const callbacks: RTVIEventCallbacks = {
      onTrackStarted: (track: MediaStreamTrack, participant?: Participant) => {
        const isLocal = participant?.local ?? false
        attachAnalyser(track, isLocal ? "local" : "bot")
      },
      onTrackStopped: (_track: MediaStreamTrack, participant?: Participant) => {
        const isLocal = participant?.local ?? false
        detachAnalyser(isLocal ? "local" : "bot")
      },
      onUserStartedSpeaking: () => {
        userSpeakingRef.current = true
        setIsUserSpeaking(true)
      },
      onUserStoppedSpeaking: () => {
        userSpeakingRef.current = false
        setIsUserSpeaking(false)
      },
      onBotStartedSpeaking: () => {
        botSpeakingRef.current = true
        setIsBotSpeaking(true)
      },
      onBotStoppedSpeaking: () => {
        botSpeakingRef.current = false
        setIsBotSpeaking(false)
      },
      onDisconnected: () => {
        setStatus("idle")
      },
      onError: (message) => {
        setError(String((message as { data?: { error?: string } })?.data?.error ?? message))
        setStatus("error")
      },
    }

    const client = new PipecatClient({
      transport: new WebSocketTransport({
        serializer: new ProtobufFrameSerializer(),
      }),
      enableMic: true,
      enableCam: false,
      callbacks,
    })
    clientRef.current = client

    try {
      // Prime the AudioContext on the user-gesture path that triggered connect().
      ensureAudioContext()
      await client.connect({ wsUrl: DEFAULT_WS_URL })

      // WebSocketTransport plays bot audio through a WavStreamPlayer that
      // already owns an AnalyserNode connected to the destination — there's
      // no remote MediaStreamTrack to attach to. Adopt the SDK's analyser so
      // getAnalyserData() can read the bot side when it's speaking.
      try {
        const transport = (client as unknown as {
          transport?: {
            _mediaManager?: {
              _wavStreamPlayer?: {
                connect?: () => Promise<unknown>
                analyser?: AnalyserNode
              }
            }
          }
        }).transport
        const player = transport?._mediaManager?._wavStreamPlayer
        if (player) {
          // connect() is idempotent and builds the graph if it hasn't been
          // primed by the first audio frame yet.
          await player.connect?.()
          if (player.analyser) {
            botAnalyserRef.current = player.analyser
          }
        }
      } catch {
        // Non-fatal: bot-side waveform falls back to local mic.
      }

      setStatus("live")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setStatus("error")
      clientRef.current = null
      await teardown()
    }
  }, [attachAnalyser, detachAnalyser, ensureAudioContext, teardown])

  const disconnect = useCallback(async () => {
    const client = clientRef.current
    clientRef.current = null
    if (client) {
      try {
        await client.disconnect()
      } catch {
        // Ignore — we're tearing down anyway.
      }
    }
    await teardown()
    setStatus("idle")
  }, [teardown])

  const setMuted = useCallback((muted: boolean) => {
    const client = clientRef.current
    if (client) {
      try {
        client.enableMic(!muted)
      } catch {
        // If the client isn't ready yet, swallow — state still reflects intent.
      }
    }
    setIsMuted(muted)
  }, [])

  const toggleMuted = useCallback(() => {
    setMuted(!isMuted)
  }, [isMuted, setMuted])

  // Reset mute state on full disconnect so a fresh session starts unmuted.
  useEffect(() => {
    if (status === "idle") setIsMuted(false)
  }, [status])

  // Best-effort cleanup on unmount.
  useEffect(() => {
    return () => {
      void disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    status,
    error,
    isUserSpeaking,
    isBotSpeaking,
    isMuted,
    connect,
    disconnect,
    setMuted,
    toggleMuted,
    getAnalyserData,
  }
}
