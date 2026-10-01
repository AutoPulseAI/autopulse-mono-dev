import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { api } from "../api";
import { formatDateTime, formatInZone } from "../time";
import type { Dealer, Followup, FollowupStatus, Lead } from "../types";

interface Props {
  dealerId: string;
  dealer?: Dealer;
  leads: Lead[];
  onError: (m: string) => void;
}

const POLL_MS = 1500;

const STATUS_STYLE: Record<FollowupStatus, { bg: string; fg: string }> = {
  pending: { bg: "var(--panel)", fg: "var(--text)" },
  claimed: { bg: "var(--accent-soft)", fg: "var(--accent)" },
  sent: { bg: "var(--ok-soft)", fg: "var(--ok)" },
  cancelled: { bg: "var(--panel-2)", fg: "var(--muted)" },
  superseded: { bg: "var(--panel-2)", fg: "var(--muted)" },
  suppressed: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  failed: { bg: "var(--bad-soft)", fg: "var(--bad)" },
  unknown: { bg: "var(--warn-soft)", fg: "var(--warn)" },
};
const FADED = new Set<FollowupStatus>(["cancelled", "superseded"]);

function countdown(dueMs: number, nowMs: number): string {
  const s = Math.round((dueMs - nowMs) / 1000);
  if (s <= 0) return "due now";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `in ${h}h ${m}m` : m > 0 ? `in ${m}m ${s % 60}s` : `in ${s}s`;
}

export function SchedulerTab({ dealerId, dealer, leads, onError }: Props) {
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [serverNow, setServerNow] = useState<{ at: number; fetchedAt: number; offset: number } | null>(null);
  const [, setTick] = useState(0);

  const load = async () => {
    try {
      const [f, c] = await Promise.all([api.followups(dealerId), api.clock()]);
      setFollowups(f);
      setServerNow({ at: new Date(c.now).getTime(), fetchedAt: Date.now(), offset: c.offset_s });
    } catch (e) {
      onError(String(e));
    }
  };

  useEffect(() => {
    void load();
    const poll = window.setInterval(load, POLL_MS);
    const tick = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealerId]);

  const now = serverNow ? serverNow.at + (Date.now() - serverNow.fetchedAt) : Date.now();
  const leadName = (id: string) => leads.find((l) => l.id === id)?.name ?? id.slice(-6);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      onError(String(e));
    }
  };

  // A pending channel switch waits in the lane it will leave; once sent it
  // moves to its target lane. A staff check and the after-hours morning
  // message stay on the lead's own channel.
  const laneOf = (f: Followup) =>
    f.kind !== "channel_switch" || f.status === "sent" ? f.to_channel : f.to_channel === "email" ? "sms" : "email";

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel p-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Dev clock</div>
          <div className="font-mono text-[15px] font-semibold tabular-nums">
            {formatDateTime(now, true)}
          </div>
          <div className="text-[11px] text-muted">
            {serverNow && serverNow.offset > 0
              ? `${(serverNow.offset / 3600).toFixed(1)}h ahead of real time`
              : "real time"}
          </div>
        </div>
        {dealer?.time_zone && (
          <div className="border-l border-line pl-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Dealer time</div>
            <div className="font-mono text-[15px] font-semibold tabular-nums">{formatInZone(now, dealer.time_zone)}</div>
            <div
              className="text-[11px] text-muted"
              title={Object.entries(dealer.hours ?? {}).map(([d, h]) => `${d}: ${h}`).join("\n")}
            >
              {dealer.time_zone} · proactive SMS 8:00-20:00 · hover for opening hours
              {dealer.hours_from_record ? "" : " (default)"}
            </div>
          </div>
        )}
        <div className="ml-auto flex gap-1.5">
          <button type="button" onClick={() => act(() => api.advanceClock(3600))} className="rounded-md bg-panel-2 px-3 py-1.5 text-[12px] font-semibold">
            +1 hour
          </button>
          <button type="button" onClick={() => act(() => api.advanceClock(24 * 3600))} className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white">
            +24 hours
          </button>
          <button type="button" onClick={() => act(api.resetClock)} className="rounded-md bg-panel-2 px-3 py-1.5 text-[12px] font-semibold text-muted">
            Reset
          </button>
        </div>
      </div>

      {followups.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line p-8 text-center text-[12px] text-muted">
          <div>
            <div className="text-[14px] font-semibold text-ink">No follow-ups scheduled</div>
            <div className="mt-1 max-w-md">
              Every message the AI sends gets a follow-up here with a 24-hour countdown. "+24 hours" fires it: the card
              moves to the other channel's lane. A customer reply cancels it. A handoff adds a staff check, due 30
              business minutes later.
            </div>
          </div>
        </div>
      ) : (
        <LayoutGroup>
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
            {(["sms", "email"] as const).map((lane) => (
              <div key={lane} className="scroll-thin overflow-y-auto rounded-xl border border-line bg-panel p-2">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{lane} lane</div>
                <div className="space-y-1.5">
                  <AnimatePresence>
                    {followups
                      .filter((f) => laneOf(f) === lane)
                      .map((f) => (
                        <motion.div
                          key={f.id}
                          layoutId={f.id}
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: FADED.has(f.status) ? 0.5 : 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ type: "spring", stiffness: 260, damping: 26 }}
                          className="rounded-lg border border-line p-2"
                          style={{ background: STATUS_STYLE[f.status]?.bg ?? "var(--panel)" }}
                          title={f.text ?? ""}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[12px] font-semibold">
                              {f.kind === "handoff_check" && (
                                <span className="mr-1 rounded bg-warn-soft px-1 text-[10px] text-warn">staff check</span>
                              )}
                              {f.kind === "resume_at_opening" && (
                                <span className="mr-1 rounded bg-accent-soft px-1 text-[10px] text-accent">morning message</span>
                              )}
                              {f.kind === "visit_followup" && (
                                <span className="mr-1 rounded bg-accent-soft px-1 text-[10px] text-accent">visit follow-up</span>
                              )}
                              {f.kind === "next_action" && (
                                <span className="mr-1 rounded px-1 text-[10px]" style={{ background: "var(--ai-soft)", color: "var(--ai)" }}>next step</span>
                              )}
                              {f.kind === "next_action_check" && (
                                <span className="mr-1 rounded bg-panel-2 px-1 text-[10px] text-muted">24h reply check</span>
                              )}
                              {leadName(f.lead_id)}
                            </span>
                            <span
                              className={`shrink-0 text-[11px] font-semibold ${FADED.has(f.status) ? "line-through" : ""}`}
                              style={{ color: STATUS_STYLE[f.status]?.fg }}
                            >
                              {f.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-muted">
                            {f.kind === "handoff_check"
                              ? `holding reply by ${f.to_channel.toUpperCase()} if staff haven't taken over`
                              : f.kind === "resume_at_opening"
                                ? `"the team is in now" by ${f.to_channel.toUpperCase()} when the dealership opens`
                                : f.kind === "visit_followup"
                                  ? `a fresh visit offer by ${f.to_channel.toUpperCase()} (declined 3 times earlier)`
                                : f.kind === "next_action"
                                  ? `checking back by ${f.to_channel.toUpperCase()}, as the customer asked`
                                : f.kind === "next_action_check"
                                  ? "no reply by then → No Contact Made"
                                : `${f.from_channel.toUpperCase()} → ${f.to_channel.toUpperCase()}${f.to ? ` (${f.to})` : ""}`}{" "}
                            ·{" "}
                            {f.status === "pending"
                              ? countdown(new Date(f.due_at).getTime(), now)
                              : formatDateTime(f.fired_at ?? f.closed_at ?? f.due_at)}
                          </div>
                          {f.text && <div className="mt-0.5 line-clamp-2 text-[11px] text-ink/80">{f.text}</div>}
                          {f.reason && <div className="mt-0.5 text-[10px] italic text-muted">{f.reason}</div>}
                          {f.status === "pending" && f.kind === "channel_switch" && (
                            <button
                              type="button"
                              onClick={() => act(() => api.failSms(dealerId, f.id))}
                              className="mt-1 text-[10px] font-semibold text-bad"
                            >
                              Mark {f.from_channel === "sms" ? "SMS undelivered" : "email bounced"} → switch now
                            </button>
                          )}
                        </motion.div>
                      ))}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        </LayoutGroup>
      )}
    </div>
  );
}
