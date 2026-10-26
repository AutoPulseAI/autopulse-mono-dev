"use client";
// The AI paused for the whole platform (no OpenAI credit, provider down): a red bar on every admin and dealer page,
// checked every minute (26 Oct 2026). The dealership's own AI setting is untouched - this is the system switch above it.
import { useEffect, useState } from "react";

export default function AiPausedBanner() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/ai/system-status", { cache: "no-store" })
      .then((r) => r.json()).then((s) => { if (alive) setStatus(s); }).catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  if (!status?.paused) return null;
  const since = status.since ? new Date(status.since).toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  return (
    <div role="alert" style={{ background: "#b42318", color: "#fff", padding: "10px 16px", fontSize: 15,
      lineHeight: 1.4, borderRadius: 6, margin: "8px 0 12px" }}>
      <strong>AI paused for all dealerships{since ? ` since ${since} ET` : ""}.</strong>{" "}
      {status.why} No messages are being sent - not even backup messages.{" "}
      {status.held ? `${status.held} customer message(s) and event(s) are waiting and ` : "Customer messages are held and "}
      will be answered automatically, in order, as soon as it's fixed. The dealership's own AI setting is unchanged.
    </div>
  );
}
