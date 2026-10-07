import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api";
import { formatDateTime, formatInZone } from "../time";
import type { ConversationItem, Dealer, Followup, Lead, Scenario, ScenarioLive, ScenarioLiveStep, StaffStatusName } from "../types";
import { countdown, whatItDoes } from "./SchedulerTab";

const POLL_MS = 700;

interface Props {
  scenario: Scenario;
  startOnOpen: boolean;
  onClose: () => void;
  onError: (m: string) => void;
}

const q = (v: unknown) => (typeof v === "string" ? `"${v}"` : JSON.stringify(v));

/** A step, as a sentence: what the scenario does or checks. */
function describe(step: ScenarioLiveStep, names: Record<string, string>): { icon: string; text: string; check: boolean } {
  const a = (step.args ?? {}) as Record<string, unknown>;
  const who = names[String(a.lead ?? a.as ?? "")] ?? String(a.lead ?? "");
  const extra = (keys: string[]) => keys.filter((k) => a[k] !== undefined).map((k) => `${k.replace(/_/g, " ")} ${q(a[k])}`).join(", ");
  switch (step.step) {
    case "new_lead": return { icon: "＋", text: `New ${a.lead_type ?? "sales"} lead by ${a.channel ?? "sms"}: ${a.name}${a.comments ? ` - "${a.comments}"` : ""}`, check: false };
    case "send_lead_created": return { icon: "↯", text: `CRM sends the new-lead event for ${who}`, check: false };
    case "reply": return { icon: "💬", text: `${who} says: "${a.text}"`, check: false };
    case "chat": return { icon: "💬", text: `${who} chats (${(a.messages as unknown[] | undefined)?.length ?? 0} messages${a.filler ? ` + ${a.filler} long ones` : ""})`, check: false };
    case "advance_clock": return { icon: "⏩", text: a.to ? `Clock to ${a.to} dealer time` : `Clock forward ${a.hours ? `${a.hours} h` : ""}${a.minutes ? ` ${a.minutes} min` : ""}`, check: false };
    case "run_next": return { icon: "▶", text: `Run ${who}'s next ${a.kind && a.kind !== "any" ? String(a.kind).replace(/_/g, " ") : "scheduled item"}`, check: false };
    case "staff_status": return { icon: "👤", text: `Staff set ${who} to "${a.status}"${a.manager_outcome ? ` + ${a.manager_outcome}` : ""}${a.booking_in_days !== undefined ? ` (visit in ${a.booking_in_days} days)` : ""}`, check: false };
    case "set_contact": return { icon: "✎", text: `Customer record for ${who}: ${extra(["source", "zip", "dealervault", "sms_opt_in", "birth_date", "consent_record"])}`, check: false };
    case "set_dealer_mode": return { icon: "⚙", text: `Dealer ${a.dealer} switched to ${a.mode}`, check: false };
    case "add_stock": return { icon: "🚗", text: `Add ${(a.vehicles as unknown[] | undefined)?.length ?? 0} vehicle(s) to dealer ${a.dealer ?? "A"} stock`, check: false };
    case "pause": case "resume": return { icon: "⏸", text: `Staff ${step.step} ${who}`, check: false };
    case "delivery_status": return { icon: "✉", text: `Provider reports ${who}'s ${a.channel ?? ""} message ${a.status}${a.hard ? " (permanent)" : ""}`, check: false };
    case "call_outcome": return { icon: "☎", text: `Staff record the call with ${who}: ${a.lead_outcome}`, check: false };
    case "wait_turns": return { icon: "⏳", text: `Wait for ${who}'s reply #${a.count}`, check: false };
    case "sleep": return { icon: "⏳", text: `Wait ${a.seconds}s`, check: false };
    case "expect_last_sent": return { icon: "✓", text: `Last message to ${who}${a.contains ? ` says "${a.contains}"` : ""}${a.excludes ? ` doesn't say "${a.excludes}"` : ""}${a.question_marks !== undefined ? ` (${a.question_marks} question marks)` : ""}${a.channel ? ` by ${a.channel}` : ""}`, check: true };
    case "expect_lead": return { icon: "✓", text: `${who} is ${extra(["stage", "status", "staff_notice", "after_hours", "visit_attempts", "duplicate", "fields"]) || "as expected"}`, check: true };
    case "expect_followup": return { icon: "✓", text: `${who}: ${String(a.kind ?? "follow-up").replace(/_/g, " ")} is ${a.status}${a.due_local ? ` at ${a.due_local}` : ""}${a.touch ? ` ${q(a.touch)}` : ""}`, check: true };
    case "expect_no_followup": return { icon: "✓", text: `${who}: no ${String(a.kind ?? "").replace(/_/g, " ")} ${a.status ?? ""} scheduled`, check: true };
    case "expect_outbox": return { icon: "✓", text: `${who} got ${a.count} ${a.channel} message(s)${a.contains ? ` mentioning "${a.contains}"` : ""}`, check: true };
    case "expect_booking": return { icon: "✓", text: `${who}'s booking is ${a.status}${a.time ? ` at ${a.time}` : ""}`, check: true };
    case "expect_call_task": return { icon: "✓", text: `${who}'s call task is ${a.status}`, check: true };
    case "expect_customer": return { icon: "✓", text: `${who}'s customer status is ${a.status}`, check: true };
    case "expect_turn": return { icon: "✓", text: `${who}'s reply: ${extra(["outcome", "trigger"]) || "ran as expected"}`, check: true };
    default: return { icon: step.step.startsWith("expect") ? "✓" : "•", text: `${step.step.replace(/_/g, " ")} ${extra(Object.keys(a).filter((k) => k !== "lead"))}`, check: step.step.startsWith("expect") };
  }
}

const STEP_COLOR: Record<string, string> = {
  passed: "var(--ok)", failed: "var(--bad)", running: "var(--accent)", skipped: "var(--muted)", waiting: "var(--muted)",
};

export function ScenarioRunScreen({ scenario, startOnOpen, onClose, onError }: Props) {
  const [live, setLive] = useState<ScenarioLive | null>(null);
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationItem[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  // Keyed by lead id: bucket/source aren't visible in the chat text itself (two leads can open with the same
  // words and land in different buckets purely because of where they came from - see api.leads' "source").
  const [leadInfo, setLeadInfo] = useState<Record<string, Lead>>({});
  const [clockNow, setClockNow] = useState<number>(Date.now());
  const [say, setSay] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const stepsBox = useRef<HTMLDivElement>(null);

  const names = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of live?.steps ?? []) {
      const a = (s.args ?? {}) as Record<string, unknown>;
      if (s.step === "new_lead" && a.as) out[String(a.as)] = String(a.name ?? a.as);
    }
    return out;
  }, [live]);

  const lead = live?.leads.find((l) => l.alias === selected) ?? live?.leads[live.leads.length - 1];
  const dealer = dealers.find((d) => d.id === lead?.dealer_id);
  const when = (iso: string | number) => (dealer?.time_zone ? formatInZone(iso, dealer.time_zone) : formatDateTime(iso));

  const start = async () => {
    try {
      await api.startScenarios([scenario.id]);
      setLive(null);
      setSelected(null);
    } catch (e) {
      onError(String(e));
    }
  };

  useEffect(() => {
    void api.dealers().then(setDealers).catch(() => undefined);
    if (startOnOpen && !started.current) {
      started.current = true;
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the run, and the selected lead's conversation and schedule.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const [l, c] = await Promise.all([api.scenarioLive(scenario.id).catch(() => null), api.clock()]);
        if (stop) return;
        if (l) setLive(l);
        setClockNow(new Date(c.now).getTime());
        const target = l?.leads.find((x) => x.alias === selected) ?? l?.leads[l.leads.length - 1];
        if (target) {
          const [m, f, ls] = await Promise.all([api.conversation(target.dealer_id, target.lead_id),
            api.followups(target.dealer_id), api.leads(target.dealer_id)]);
          if (stop) return;
          setMessages(m);
          setFollowups(f.filter((x) => x.lead_id === target.lead_id));
          setLeadInfo((prev) => ({ ...prev, ...Object.fromEntries(ls.map((x) => [x.id, x])) }));
        }
      } catch (e) {
        if (!stop) onError(String(e));
      }
    };
    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id, selected]);

  // Keep the running step in view.
  useEffect(() => {
    stepsBox.current?.querySelector("[data-running='true']")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [live?.steps.filter((s) => s.status !== "waiting").length]);

  const steps = live?.steps ?? [];
  const done = steps.filter((s) => ["passed", "failed", "skipped"].includes(s.status)).length;
  const failed = steps.find((s) => s.status === "failed");
  const running = live?.running ?? startOnOpen;
  const state = running ? "running" : failed ? "failed" : live ? "passed" : "not run";
  const upcoming = followups.filter((f) => f.status === "pending").sort((a, b) => a.due_at.localeCompare(b.due_at));
  const history = followups.filter((f) => f.status !== "pending" && f.status !== "standby")
    .sort((a, b) => (b.fired_at ?? b.closed_at ?? b.due_at).localeCompare(a.fired_at ?? a.closed_at ?? a.due_at));
  const leadName = lead ? names[lead.alias] ?? lead.alias : "";

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const canAct = !!lead && !running && !busy;
  const STAFF: StaffStatusName[] = ["Appointment Booked", "Visited", "Sold Pending", "Sold Delivered", "DND"];

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)]"
      style={{ background: "var(--bg, var(--panel))" }}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
    >
      {/* Header: what this scenario is and how far it has got. */}
      <header className="border-b border-line bg-panel px-5 py-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onClose} className="rounded-md bg-panel-2 px-3 py-1.5 text-[12px] font-semibold">← All scenarios</button>
          <span className="rounded bg-panel-2 px-1.5 text-[11px] font-bold uppercase text-muted">{scenario.workflow}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold">{scenario.name}</div>
            <div className="truncate font-mono text-[11px] text-muted">{scenario.id}</div>
          </div>
          <motion.span
            key={state}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="rounded-full px-3 py-1 text-[12px] font-bold uppercase"
            style={{ color: STEP_COLOR[state] ?? "var(--muted)", background: "var(--panel-2)" }}
          >
            {state === "running" ? "● running" : state}
          </motion.span>
          <button type="button" disabled={running} onClick={start}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">
            {live ? "Run again" : "Run"}
          </button>
        </div>
        <p className="mt-1.5 text-[12px] text-muted">{scenario.description}</p>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
            <motion.div className="h-full rounded-full"
              style={{ background: failed ? "var(--bad)" : "var(--ok)" }}
              animate={{ width: steps.length ? `${(done / steps.length) * 100}%` : "0%" }}
              transition={{ type: "spring", stiffness: 90, damping: 18 }} />
          </div>
          <span className="text-[11px] tabular-nums text-muted">{done}/{steps.length} steps</span>
          <span className="font-mono text-[12px] font-semibold tabular-nums">{when(clockNow)}</span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,1.1fr)_minmax(300px,1fr)_minmax(320px,1fr)] gap-3 p-3">
        {/* 1. The steps, one sentence each, lighting up as they run. */}
        <section className="flex min-h-0 flex-col rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Steps</div>
          <div ref={stepsBox} className="scroll-thin flex-1 space-y-1 overflow-y-auto p-2">
            {steps.length === 0 && <div className="p-4 text-center text-[12px] text-muted">{running ? "Starting…" : "Press Run to start."}</div>}
            {steps.map((s, i) => {
              const d = describe(s, names);
              return (
                <motion.div
                  key={i}
                  layout
                  data-running={s.status === "running"}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: s.status === "waiting" || s.status === "skipped" ? 0.45 : 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.015, 0.4) }}
                  className="rounded-lg border px-2.5 py-1.5"
                  style={{ borderColor: s.status === "failed" ? "var(--bad)" : s.status === "running" ? "var(--accent)" : "var(--line)",
                    background: s.status === "failed" ? "var(--bad-soft)" : s.status === "running" ? "var(--accent-soft)" : d.check ? "var(--panel)" : "var(--panel-2)" }}
                >
                  <div className="flex items-start gap-2">
                    <motion.span
                      key={s.status}
                      initial={{ scale: 0.3 }}
                      animate={s.status === "running" ? { scale: [1, 1.25, 1] } : { scale: 1 }}
                      transition={s.status === "running" ? { repeat: Infinity, duration: 0.9 } : { type: "spring", stiffness: 500 }}
                      className="mt-0.5 w-4 shrink-0 text-center text-[12px] font-bold"
                      style={{ color: STEP_COLOR[s.status] }}
                    >
                      {s.status === "passed" ? "✓" : s.status === "failed" ? "✗" : s.status === "running" ? "●" : d.icon}
                    </motion.span>
                    <div className="min-w-0 flex-1">
                      <div className={`text-[12px] ${d.check ? "" : "font-semibold"}`}>{d.text}</div>
                      {s.detail && (s.status === "failed" || !d.check) && (
                        <div className="mt-0.5 text-[11px]" style={{ color: s.status === "failed" ? "var(--bad)" : "var(--muted)" }}>{s.detail}</div>
                      )}
                    </div>
                    {s.ms !== undefined && <span className="shrink-0 text-[10px] tabular-nums text-muted">{s.ms} ms</span>}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* 2. What the customer and the AI said. */}
        <section className="flex min-h-0 flex-col rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Conversation</span>
            {live?.leads.map((l) => {
              const info = leadInfo[l.lead_id];
              // Bucket/source never show up in the chat itself, so two leads opening with identical words can
              // land in different buckets for a reason that's otherwise invisible here - surface it on the tab.
              const tag = info?.bucket ? `${info.bucket}${info.source ? ` · ${info.source}` : ""}` : info?.source;
              return (
                <button key={l.alias} type="button" onClick={() => setSelected(l.alias)}
                  title={tag ? `Bucket/source: ${tag}` : undefined}
                  className="rounded-md px-2 py-0.5 text-left text-[11px] font-semibold"
                  style={{ background: l.alias === lead?.alias ? "var(--accent-soft)" : "var(--panel-2)", color: l.alias === lead?.alias ? "var(--accent)" : undefined }}>
                  {names[l.alias] ?? l.alias}
                  {tag && <span className="ml-1.5 font-normal text-muted">{tag}</span>}
                </button>
              );
            })}
          </div>
          <div className="scroll-thin flex-1 space-y-1.5 overflow-y-auto p-3">
            {!lead && <div className="text-center text-[12px] text-muted">No lead yet.</div>}
            <AnimatePresence initial={false}>
              {messages.map((m, i) => (
                <motion.div key={`${i}-${m.at}`}
                  initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={`flex ${m.direction === "inbound" ? "justify-start" : "justify-end"}`}>
                  <div className="max-w-[85%] rounded-2xl px-3 py-1.5 text-[12px]"
                    style={{ background: m.direction === "inbound" ? "var(--panel-2)" : m.status && m.status !== "sent" ? "var(--warn-soft)" : "var(--accent-soft)" }}>
                    <div className="whitespace-pre-wrap">{m.text}</div>
                    <div className="mt-0.5 text-[10px] text-muted">
                      {m.channel}{m.at ? ` · ${when(m.at)}` : ""}{m.status && m.status !== "sent" ? ` · ${m.status}` : ""}{m.outcome ? ` · ${m.outcome}` : ""}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {/* Play the customer yourself, once the scenario has finished. */}
          <form className="flex gap-1.5 border-t border-line p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!lead || !say.trim()) return;
              const text = say;
              setSay("");
              void act(() => api.reply({ dealer_id: lead.dealer_id, lead_id: lead.lead_id, channel: lead.channel ?? "sms", text }));
            }}>
            <input value={say} onChange={(e) => setSay(e.target.value)} disabled={!canAct}
              placeholder={running ? "Wait for the run to finish…" : `Reply as ${leadName || "the customer"}`}
              className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1 text-[12px] disabled:opacity-50" />
            <button type="submit" disabled={!canAct || !say.trim()} className="rounded-md bg-accent px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-40">Send</button>
          </form>
        </section>

        {/* 3. The lead's schedule, and the buttons to move it along. */}
        <section className="flex min-h-0 flex-col rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Schedule {leadName && `· ${leadName}`}</div>
          <div className="space-y-2 border-b border-line p-2">
            <button type="button" disabled={!canAct || upcoming.length === 0}
              onClick={() => lead && act(() => api.runNextDue(lead.dealer_id, lead.lead_id))}
              className="w-full rounded-md bg-accent px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
              ▶ Run next{upcoming[0] ? `: ${whatItDoes(upcoming[0], leadName)}` : ""}
            </button>
            <div className="flex flex-wrap gap-1">
              {([["+1 hour", 3600], ["+1 day", 86400], ["+7 days", 7 * 86400]] as const).map(([label, s]) => (
                <button key={label} type="button" disabled={!canAct} onClick={() => act(() => api.advanceClock(s))}
                  className="rounded-md bg-panel-2 px-2 py-1 text-[11px] font-semibold disabled:opacity-40">{label}</button>
              ))}
              <button type="button" disabled={!canAct} onClick={() => act(api.resetClock)}
                className="rounded-md bg-panel-2 px-2 py-1 text-[11px] font-semibold text-muted disabled:opacity-40">Real time</button>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] font-semibold uppercase text-muted">Staff</span>
              {STAFF.map((st) => (
                <button key={st} type="button" disabled={!canAct}
                  onClick={() => lead && act(() => api.staffStatus(lead.dealer_id, lead.lead_id, st,
                    st === "Appointment Booked" ? { booking_at: new Date(clockNow + 2 * 86400000).toISOString() } : undefined))}
                  className="rounded-md bg-panel-2 px-2 py-1 text-[11px] font-semibold disabled:opacity-40">{st}</button>
              ))}
            </div>
            {running && <div className="text-[11px] text-muted">Buttons unlock when the run finishes.</div>}
          </div>
          <div className="scroll-thin flex-1 overflow-y-auto p-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Coming up ({upcoming.length})</div>
            <div className="space-y-1">
              <AnimatePresence initial={false}>
                {upcoming.map((f) => (
                  <motion.div key={f.id} layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}
                    className="rounded-lg border border-line px-2 py-1.5">
                    <div className="text-[12px] font-semibold">{whatItDoes(f, leadName)}</div>
                    <div className="text-[11px] text-muted">{when(f.due_at)} · {countdown(new Date(f.due_at).getTime(), clockNow)}</div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {upcoming.length === 0 && <div className="text-[11px] text-muted">Nothing waiting.</div>}
            </div>
            <div className="mb-1 mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted">Already happened ({history.length})</div>
            <div className="space-y-1">
              {history.map((f) => (
                <motion.div key={f.id} layout initial={{ opacity: 0 }} animate={{ opacity: f.status === "sent" ? 1 : 0.6 }}
                  className="rounded-lg border border-line px-2 py-1.5"
                  style={{ background: f.status === "sent" ? "var(--ok-soft)" : "var(--panel-2)" }}>
                  <div className="flex justify-between gap-2 text-[12px]">
                    <span className="font-semibold">{whatItDoes(f, leadName)}</span>
                    <span className="shrink-0 text-[11px] font-semibold" style={{ color: f.status === "sent" ? "var(--ok)" : "var(--muted)" }}>{f.status}</span>
                  </div>
                  <div className="text-[11px] text-muted">{when(f.fired_at ?? f.closed_at ?? f.due_at)}{f.reason ? ` · ${f.reason}` : ""}</div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </motion.div>
  );
}
