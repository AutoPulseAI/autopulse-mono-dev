import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Pipeline, TraceEvent } from "../types";
import { emptyView, reduceAll, type TurnView } from "./reducer";

export type Speed = 0.5 | 1 | 2;

// Real gaps between events are replayed, but clamped so a replay is always
// watchable: never faster than MIN_GAP_MS, never slower than MAX_GAP_MS.
const MIN_GAP_MS = 350;
const MAX_GAP_MS = 1400;

export interface Replay {
  view: TurnView;
  index: number; // number of events applied
  total: number;
  playing: boolean;
  speed: Speed;
  play: () => void;
  pause: () => void;
  stepForward: () => void;
  stepBack: () => void;
  seek: (index: number) => void;
  setSpeed: (speed: Speed) => void;
}

export function useReplay(pipeline: Pipeline | null, events: TraceEvent[] | null): Replay {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const timer = useRef<number | undefined>(undefined);
  const total = events?.length ?? 0;

  // A new turn to replay starts from the beginning and plays automatically.
  useEffect(() => {
    setIndex(0);
    setPlaying(Boolean(events?.length));
  }, [events]);

  const view = useMemo(
    () => (pipeline && events ? reduceAll(pipeline, events.slice(0, index)) : emptyView()),
    [pipeline, events, index],
  );

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!playing || !events) return;
    if (index >= total) {
      setPlaying(false);
      return;
    }
    const prev = events[index - 1];
    const next = events[index];
    const realGap = prev ? new Date(next.ts).getTime() - new Date(prev.ts).getTime() : 0;
    const gap = Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, realGap)) / speed;
    timer.current = window.setTimeout(() => setIndex((i) => i + 1), index === 0 ? 150 : gap);
    return () => window.clearTimeout(timer.current);
  }, [playing, index, total, events, speed]);

  const clamp = useCallback((i: number) => Math.max(0, Math.min(total, i)), [total]);

  return {
    view,
    index,
    total,
    playing,
    speed,
    play: () => {
      if (index >= total) setIndex(0);
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    stepForward: () => {
      setPlaying(false);
      setIndex((i) => clamp(i + 1));
    },
    stepBack: () => {
      setPlaying(false);
      setIndex((i) => clamp(i - 1));
    },
    seek: (i: number) => {
      setPlaying(false);
      setIndex(clamp(i));
    },
    setSpeed,
  };
}
