import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { api } from "../api";
import { formatDateTime, formatInZone } from "../time";
import type { CallTask, Dealer, Followup, Lead } from "../types";

interface Props {
  dealerId: string;
  dealer?: Dealer;
  leads: Lead[];
  onError: (m: string) => void;
}

const POLL_MS = 1500;

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "var(--panel)", fg: "var(--text)" },
  claimed: { bg: "var(--accent-soft)", fg: "var(--accent)" },
  sent: { bg: "var(--ok-soft)", fg: "var(--ok)" },
  done: { bg: "var(--ok-soft)", fg: "var(--ok)" },
  cancelled: { bg: "var(--panel-2)", fg: "var(--muted)" },
  superseded: { bg: "var(--panel-2)", fg: "var(--muted)" },
  skipped: { bg: "var(--panel-2)", fg: "var(--muted)" },
  suppressed: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  failed: { bg: "var(--bad-soft)", fg: "var(--bad)" },
  unknown: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  // Dormant fallback (MASTER_PLAN_3 C4): the other channel's version, sent only if the message fails to deliver.
  standby: { bg: "var(--panel-2)", fg: "var(--muted)" },
};
const FADED = new Set<string>(["cancelled", "superseded", "standby", "skipped"]);

// The status in plain words.
const STATUS_WORDS: Record<string, string> = {
  pending: "waiting", claimed: "sending", sent: "sent", done: "done", cancelled: "cancelled",
  superseded: "replaced by a newer one", skipped: "skipped", suppressed: "blocked by the send check",
  failed: "failed", unknown: "unknown", standby: "backup only",
};

// MASTER_PLAN_3 C5: what each appointment step is.
const APPOINTMENT_STEP: Record<string, string> = {
  appointment_details: "Appointment details message (15 minutes after booking)",
  appointment_countdown: "Daily countdown to the visit",
  appointment_confirm: "Day-before confirmation, asks Y or N",
  appointment_no_show_check: "No-show check, 1 hour after the visit time",
  appointment_no_show_followup: "\"How did it go?\" after a no-show",
  appointment_no_show_close: "Back into the follow-up cadence after a no-show",
};

/** One line, in plain English, saying what this scheduled item does when it fires. */
function whatItDoes(f: Followup, leadName: string): string {
  const kind: string = f.kind;
  const first = leadName.split(" ")[0];
  const touch = f.touch as (Followup["touch"] & { week?: number; phase?: string }) | null | undefined;
  const year = (f as Followup & { year?: number }).year;
  if (kind === "cadence_touch") {
    return touch?.touch_number === 2
      ? `Name nudge: "${first}?" by text + email`
      : `Day ${touch?.day} touch: ${touch?.theme_label?.toLowerCase()} (text + email)`;
  }
  if (APPOINTMENT_STEP[kind]) return APPOINTMENT_STEP[kind] + (f.appointment_at ? ` (visit ${formatDateTime(f.appointment_at)})` : "");
  switch (kind) {
    case "call_task": return "60-minute timer: opens a staff call task if the customer hasn't replied";
    case "daily_call_task": return "Days 1-7 staff call task (one in the morning, one in the afternoon)";
    case "handoff_check": return "Staff check: a \"sorry for the wait\" message if no one has taken over";
    case "resume_at_opening": return "Morning message: \"the team is in now\"";
    case "first_reply_held": return "First reply, held until the customer's texting hours";
    case "visit_followup": return "A fresh visit offer (they declined 3 times)";
    case "next_action": return "Checking back, as the customer asked";
    case "next_action_check": return "24h check: no reply means No Contact Made";
    case "sold_pending_touch": return `SOLD PENDING check-in${touch?.week ? `, week ${touch.week}` : ""} (text + email + call)`;
    case "post_delivery_checkin": return "Day-3 check-in after delivery";
    case "ownership_anniversary": return `Ownership anniversary${year ? `, year ${year}` : ""}: "do you still have it?"`;
    case "birthday": return "Birthday message";
    case "service_outreach": return "Service reminder (maintenance or recall)";
    case "channel_switch":
      return `Backup: the ${f.to_channel === "email" ? "email" : "text"} version, only if the ${f.from_channel === "sms" ? "text" : "email"} fails`;
    default: return kind.replace(/_/g, " ");
  }
}

function countdown(dueMs: number, nowMs: number): string {
  const s = Math.round((dueMs - nowMs) / 1000);
  if (s <= 0) return "due now";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `in ${d}d ${h}h` : h > 0 ? `in ${h}h ${m}m` : m > 0 ? `in ${m}m` : `in ${s}s`;
}

export function SchedulerTab({ dealerId, dealer, leads, onError }: Props) {
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [tasks, setTasks] = useState<CallTask[]>([]);
  const [serverNow, setServerNow] = useState<{ at: number; fetchedAt: number; offset: number } | null>(null);
  const [leadFilter, setLeadFilter] = useState<string>("");
  const [lastRan, setLastRan] = useState<string | null>(null);
  const [showLanes, setShowLanes] = useState(false);
  const [, setTick] = useState(0);

  const load = async () => {
    try {
      const [f, c, t] = await Promise.all([api.followups(dealerId), api.clock(), api.callTasks(dealerId)]);
      setFollowups(f);
      setTasks(t);
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
  const when = (iso: string) => (dealer?.time_zone ? formatInZone(iso, dealer.time_zone) : formatDateTime(iso));

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      onError(String(e));
    }
  };

  const shown = followups.filter((f) => !leadFilter || f.lead_id === leadFilter);
  const upcoming = shown.filter((f) => f.status === "pending").sort((a, b) => a.due_at.localeCompare(b.due_at));
  const history = shown
    .filter((f) => f.status !== "pending" && f.status !== "standby")
    .sort((a, b) => (b.fired_at ?? b.closed_at ?? b.due_at).localeCompare(a.fired_at ?? a.closed_at ?? a.due_at));
  const next = upcoming[0];
  const leadsWithWork = Array.from(new Set(followups.map((f) => f.lead_id)));

  const runNext = () =>
    act(async () => {
      const res = await api.runNextDue(dealerId, leadFilter || undefined);
      const ran = followups.find((f) => f.id === res.ran.id);
      setLastRan(ran ? `${leadName(ran.lead_id)}: ${whatItDoes(ran, leadName(ran.lead_id))}` : res.ran.kind.replace(/_/g, " "));
    });

  // A pending channel switch waits in the lane it will leave; once sent it moves to its target lane.
  const laneOf = (f: Followup) =>
    f.kind === "call_task" ? f.from_channel : f.kind !== "channel_switch" || f.status === "sent" ? f.to_channel : f.to_channel === "email" ? "sms" : "email";

  const Row = ({ f, pending }: { f: Followup; pending: boolean }) => (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: FADED.has(f.status) ? 0.55 : 1, y: 0 }}
      className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg border border-line px-2.5 py-1.5"
      style={{ background: STATUS_STYLE[f.status]?.bg ?? "var(--panel)" }}
      title={f.text ?? ""}
    >
      <span className="w-[150px] shrink-0 font-mono text-[11px] tabular-nums">
        {when(pending ? f.due_at : (f.fired_at ?? f.closed_at ?? f.due_at))}
      </span>
      <span className="w-[110px] shrink-0 truncate text-[12px] font-semibold">{leadName(f.lead_id)}</span>
      <span className="min-w-0 flex-1 text-[12px]">{whatItDoes(f, leadName(f.lead_id))}</span>
      <span className="shrink-0 text-[11px] font-semibold" style={{ color: STATUS_STYLE[f.status]?.fg }}>
        {pending ? countdown(new Date(f.due_at).getTime(), now) : STATUS_WORDS[f.status] ?? f.status}
      </span>
      {f.reason && <div className="w-full pl-[150px] text-[10px] italic text-muted">{f.reason}</div>}
    </motion.div>
  );

  return (
    <div className="scroll-thin flex h-full flex-col gap-3 overflow-y-auto p-4">
      {/* The clock, in the dealer's own time, and the one button that matters: run whatever is next. */}
      <div className="rounded-xl border border-line bg-panel p-3">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Dealer time now</div>
            <div className="font-mono text-[18px] font-semibold tabular-nums">
              {dealer?.time_zone ? formatInZone(now, dealer.time_zone) : formatDateTime(now)}
            </div>
            <div
              className="text-[11px] text-muted"
              title={Object.entries(dealer?.hours ?? {}).map(([d, h]) => `${d}: ${h}`).join("\n")}
            >
              {serverNow && serverNow.offset > 0 ? `${(serverNow.offset / 3600).toFixed(1)}h ahead of real time` : "real time"}
              {" · hover for opening hours"}
            </div>
          </div>
          <div className="min-w-[260px] flex-1 border-l border-line pl-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Next to happen</div>
            {next ? (
              <div className="text-[13px]">
                <span className="font-semibold">{leadName(next.lead_id)}</span> · {whatItDoes(next, leadName(next.lead_id))}
                <span className="text-muted"> · {when(next.due_at)} ({countdown(new Date(next.due_at).getTime(), now)})</span>
              </div>
            ) : (
              <div className="text-[13px] text-muted">Nothing is scheduled{leadFilter ? " for this lead" : ""}.</div>
            )}
            {lastRan && <div className="mt-0.5 text-[11px] text-ok">Just ran: {lastRan}</div>}
          </div>
          <button
            type="button"
            disabled={!next}
            onClick={runNext}
            className="rounded-md bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
            title="Moves the clock to 1 minute after the next item and fires it"
          >
            ▶ Run next
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
          <span className="mr-1 text-[11px] text-muted">Start a test at</span>
          {["10:00", "11:00", "19:30"].map((t) => (
            <button key={t} type="button" onClick={() => act(() => api.clockToDealerTime(dealerId, t))}
              className="rounded-md bg-panel-2 px-2.5 py-1 text-[12px] font-semibold"
              title={`The next weekday ${t} on the dealer's clock${t === "19:30" ? " (after hours)" : ""}`}>
              {t}
            </button>
          ))}
          <span className="ml-3 mr-1 text-[11px] text-muted">Move the clock</span>
          {([["+1 hour", 3600], ["+1 day", 86400], ["+7 days", 7 * 86400], ["+30 days", 30 * 86400]] as const).map(([label, s]) => (
            <button key={label} type="button" onClick={() => act(() => api.advanceClock(s))}
              className="rounded-md bg-panel-2 px-2.5 py-1 text-[12px] font-semibold">
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => act(async () => { for (const days of [30, 30, 30, 1]) await api.advanceClock(days * 24 * 3600); })}
            className="rounded-md bg-warn-soft px-2.5 py-1 text-[12px] font-semibold text-warn"
            title="Moves the clock 91 days: a silent lead closes as Closed - Lost (Day 91)"
          >
            Day 91
          </button>
          <button type="button" onClick={() => act(api.resetClock)} className="rounded-md bg-panel-2 px-2.5 py-1 text-[12px] font-semibold text-muted">
            Back to real time
          </button>
          <select
            value={leadFilter}
            onChange={(e) => setLeadFilter(e.target.value)}
            className="ml-auto rounded-md border border-line bg-panel px-2 py-1 text-[12px]"
          >
            <option value="">All leads</option>
            {leadsWithWork.map((id) => (
              <option key={id} value={id}>{leadName(id)}</option>
            ))}
          </select>
        </div>
      </div>

      {tasks.length > 0 && (
        <div className="rounded-xl border border-line bg-panel p-2">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Staff call tasks ({tasks.filter((t) => t.status === "open").length} open)
          </div>
          <div className="space-y-1">
            {tasks.filter((t) => !leadFilter || t.lead_id === leadFilter).map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-2 py-1 text-[12px]"
                style={{ opacity: t.status === "open" ? 1 : 0.55 }}>
                <span className="font-semibold">{t.customer_name ?? leadName(t.lead_id)}</span>
                <span className="font-mono text-muted">{t.phone}</span>
                <span className="rounded px-1 text-[10px] font-semibold"
                  style={{ background: t.status === "open" ? "var(--warn-soft)" : "var(--panel-2)",
                    color: t.status === "open" ? "var(--warn)" : "var(--muted)" }}>
                  {t.status}{t.outcome ? ` · ${t.outcome}` : ""}
                </span>
                <span className="text-[11px] text-muted">{t.closed_reason ?? t.reason}</span>
                {t.status === "open" && (
                  <span className="ml-auto flex gap-1">
                    <button type="button" className="rounded bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok"
                      onClick={() => act(() => api.resolveCallTask(dealerId, t.id, "complete", "connected"))}>
                      Called - connected
                    </button>
                    <button type="button" className="rounded bg-panel-2 px-2 py-0.5 text-[11px] font-semibold"
                      onClick={() => act(() => api.resolveCallTask(dealerId, t.id, "complete", "no_answer"))}>
                      No answer
                    </button>
                    <button type="button" className="rounded bg-panel-2 px-2 py-0.5 text-[11px] font-semibold text-muted"
                      onClick={() => act(() => api.resolveCallTask(dealerId, t.id, "dismiss"))}>
                      Dismiss
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {followups.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line p-8 text-center text-[12px] text-muted">
          <div>
            <div className="text-[14px] font-semibold text-ink">Nothing scheduled yet</div>
            <div className="mt-1 max-w-md">
              Create a lead in the Simulator. Its follow-ups (the 3-hour name nudge, the daily touches, appointment
              reminders, call timers) show up here in order. Press "Run next" to jump to the next one and fire it,
              and check what the customer got in the conversation.
            </div>
          </div>
        </div>
      ) : (
        <>
          <section>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Coming up ({upcoming.length}), in order
            </div>
            <div className="space-y-1">
              <AnimatePresence>{upcoming.map((f) => <Row key={f.id} f={f} pending />)}</AnimatePresence>
              {upcoming.length === 0 && <div className="text-[12px] text-muted">Nothing waiting.</div>}
            </div>
          </section>

          <section>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Already happened ({history.length}), newest first
            </div>
            <div className="space-y-1">
              {history.slice(0, 40).map((f) => <Row key={f.id} f={f} pending={false} />)}
            </div>
          </section>

          <button type="button" onClick={() => setShowLanes(!showLanes)} className="self-start text-[11px] font-semibold text-muted underline">
            {showLanes ? "Hide" : "Show"} text / email lanes (detail, with the backup copies)
          </button>
          {showLanes && (
            <LayoutGroup>
              <div className="grid grid-cols-2 gap-3">
                {(["sms", "email"] as const).map((lane) => (
                  <div key={lane} className="rounded-xl border border-line bg-panel p-2">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{lane} lane</div>
                    <div className="space-y-1.5">
                      {shown.filter((f) => laneOf(f) === lane).map((f) => (
                        <div key={f.id} className="rounded-lg border border-line p-2"
                          style={{ background: STATUS_STYLE[f.status]?.bg ?? "var(--panel)", opacity: FADED.has(f.status) ? 0.5 : 1 }}>
                          <div className="flex justify-between gap-2 text-[12px] font-semibold">
                            <span className="truncate">{leadName(f.lead_id)} · {whatItDoes(f, leadName(f.lead_id))}</span>
                            <span style={{ color: STATUS_STYLE[f.status]?.fg }}>{STATUS_WORDS[f.status] ?? f.status}</span>
                          </div>
                          {f.text && <div className="mt-0.5 line-clamp-2 text-[11px] text-ink/80">{f.text}</div>}
                          {f.status === "pending" && f.kind === "channel_switch" && (
                            <button type="button" onClick={() => act(() => api.failSms(dealerId, f.id))}
                              className="mt-1 text-[10px] font-semibold text-bad">
                              Mark {f.from_channel === "sms" ? "text undelivered" : "email bounced"} → send backup now
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </LayoutGroup>
          )}
        </>
      )}
    </div>
  );
}

