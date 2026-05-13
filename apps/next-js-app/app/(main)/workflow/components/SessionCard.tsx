"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePipecat } from "@/lib/usePipecat";
import { useSelectedRepository } from "@/hooks/useSelectedRepository";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BaseWaveform } from "@/components/ui/waveform";

const BAR_COUNT = 60;
const FLAT_BARS: number[] = Array.from({ length: BAR_COUNT }, () => 0);

type Status = ReturnType<typeof usePipecat>["status"];

function statusLabel(
  status: Status,
  isMuted: boolean,
  isUserSpeaking: boolean,
  isBotSpeaking: boolean,
): string {
  if (status === "error") return "Connection error";
  if (status === "connecting") return "Connecting…";
  if (status === "idle") return "Idle";
  if (isMuted) return "Muted";
  if (isBotSpeaking) return "Speaking";
  if (isUserSpeaking) return "Listening";
  return "Live";
}

export function SessionCard({ className }: { className?: string }) {
  const { selectedRepository } = useSelectedRepository();
  const {
    status,
    error,
    isMuted,
    isUserSpeaking,
    isBotSpeaking,
    connect,
    disconnect,
    getAnalyserData,
  } = usePipecat();

  const [liveBars, setLiveBars] = useState<number[]>(FLAT_BARS);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== "live") return;
    const tick = () => {
      setLiveBars(getAnalyserData());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [status, getAnalyserData]);

  const bars = status === "live" ? liveBars : FLAT_BARS;

  const isLive = status === "live";
  const isConnecting = status === "connecting";
  const canStart = Boolean(selectedRepository) && !isLive && !isConnecting;

  async function handleStart() {
    if (!selectedRepository) return;
    await connect({ repoFullName: selectedRepository.full_name });
  }

  return (
    <Card className={cn("w-full max-w-sm", className)}>
      <CardContent>
        <div className="rounded-md bg-muted/40 px-2 py-3">
          <BaseWaveform
            data={bars}
            height={96}
            barWidth={3}
            barGap={2}
            barRadius={2}
            fadeEdges
          />
        </div>
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      </CardContent>
      <CardFooter className="gap-2">
        <Button className="flex-1" disabled={!canStart} onClick={handleStart}>
          <Play />
          {isConnecting ? "Connecting…" : "Start"}
        </Button>
        <Button
          className="flex-1"
          variant="destructive"
          disabled={!isLive}
          onClick={() => disconnect()}
        >
          <Square />
          Stop
        </Button>
      </CardFooter>
    </Card>
  );
}
