"use client";
// Live updates between users (gap G-083: "justified polling, reconnect reconciliation"): re-reads a screen's data
// every `everyMs` while the tab is visible, at once when the tab comes back into view or the browser reconnects, and
// never while `paused` (a modal or a selection is open, so nothing moves under the user's hand). `refresh` must keep
// the page, filters and scroll as they are (a silent re-read, no spinner).
import { useEffect, useRef } from "react";

export default function useLiveRefresh(refresh, { everyMs = 30000, paused = false } = {}) {
  const fn = useRef(refresh);
  const stopped = useRef(paused);
  fn.current = refresh;
  stopped.current = paused;
  useEffect(() => {
    let busy = false;
    const run = async () => {
      if (busy || stopped.current || document.visibilityState !== "visible") return;
      busy = true;
      try { await fn.current(); } catch { /* the next tick tries again */ } finally { busy = false; }
    };
    const timer = setInterval(run, everyMs);
    const onVisible = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", run);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", run);
    };
  }, [everyMs]);
}
