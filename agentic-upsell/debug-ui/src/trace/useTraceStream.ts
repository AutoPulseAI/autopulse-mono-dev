import { useEffect, useRef, useState } from "react";

import { api } from "../api";
import type { TraceEvent } from "../types";

export type StreamStatus = "connecting" | "open" | "closed";

/** Subscribes to live trace events for one dealer over server-sent events. */
export function useTraceStream(dealerId: string | null, onEvent: (event: TraceEvent) => void): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!dealerId) return;
    setStatus("connecting");
    const source = new EventSource(api.streamUrl(dealerId));
    source.onopen = () => setStatus("open");
    source.onerror = () => setStatus(source.readyState === EventSource.CLOSED ? "closed" : "connecting");
    source.addEventListener("trace", (message) => {
      try {
        handler.current(JSON.parse((message as MessageEvent).data));
      } catch {
        /* ignore a malformed event rather than break the stream */
      }
    });
    return () => source.close();
  }, [dealerId]);

  return status;
}
