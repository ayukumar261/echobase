"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

import { usePipecat } from "@/lib/usePipecat";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Waveform } from "@/components/ui/waveform";

export default function Home() {
  const bot = usePipecat();
  const [bars, setBars] = useState<number[] | undefined>(undefined);

  const rafRef = useRef<number | null>(null);
  const { status, getAnalyserData } = bot;
  useEffect(() => {
    if (status !== "live") return;
    let lastEmit = 0;
    const tick = (t: number) => {
      if (t - lastEmit > 33) {
        const data = getAnalyserData();
        if (data.length > 0) setBars(data);
        lastEmit = t;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [status, getAnalyserData]);

  const isActive = bot.status === "live" || bot.status === "connecting";

  return (
    <main className="relative flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <Card className="fixed right-6 bottom-6 w-88 shadow-2xl shadow-black/20 dark:shadow-black/60">
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-lg bg-muted/60 px-3 py-6">
            <Waveform
              className="w-full"
              height={120}
              data={bot.status === "live" ? bars : undefined}
              barWidth={4}
              barGap={3}
              barRadius={2}
              barCount={48}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={() => void bot.connect()}
              size="lg"
              disabled={isActive}
              className="w-full"
            >
              {bot.status === "connecting" ? (
                <Spinner className="size-5" />
              ) : (
                <Mic className="size-5" />
              )}
              {bot.status === "connecting" ? "Starting…" : "Start"}
            </Button>
            <Button
              onClick={() => void bot.disconnect()}
              size="lg"
              variant="destructive"
              disabled={!isActive}
              className="w-full"
            >
              <Square className="size-5" />
              Stop
            </Button>
          </div>
          {bot.error ? (
            <p className="text-center text-xs text-red-600 dark:text-red-400">
              {bot.error}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
