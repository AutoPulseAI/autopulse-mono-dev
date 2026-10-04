import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import { api } from "../api";
import type { Metrics, RolloutCheck } from "../types";

interface Props {
  dealerId: string;
  onError: (m: string) => void;
}

const POLL_MS = 5000;
const DAY_OPTIONS = [1, 7, 30];

const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const ms = (v: number | null | undefined) => (v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);

type Tone = "ok" | "warn" | "bad" | "muted";
const TONE: Record<Tone, string> = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", muted: "var(--muted)" };

function Card({ title, value, detail, tone = "muted" }: { title: string; value: string; detail?: string; tone?: Tone }) {
  return (
    <motion.div layout className="rounded-xl border border-line bg-panel p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      <div className="mt-1 text-[22px] font-semibold tabular-nums" style={{ color: TONE[tone] }}>
        {value}
      </div>
      {detail && <div className="mt-0.5 text-[11px] text-muted">{detail}</div>}
    </motion.div>
  );
}

function Counts({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  return (
    <div className="rounded-xl border border-line bg-panel p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      {entries.length === 0 ? (
        <div className="text-[12px] text-muted">None yet.</div>
      ) : (
        <div className="space-y-1">
          {entries.map(([name, n]) => (
            <div key={name} className="flex items-center gap-2 text-[12px]">
              <span className="w-24 shrink-0 truncate">{name.replaceAll("_", " ")}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                <motion.div
                  className="h-full rounded-full bg-accent"
                  animate={{ width: `${(n / total) * 100}%` }}
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                />
              </div>
              <span className="w-10 shrink-0 text-right tabular-nums text-muted">{n}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GoLive({ check }: { check: RolloutCheck }) {
  const samples = [
    ...check.platform_auto_messages.map((m) => `n8n / FollowUpJob wrote to lead …${m.lead_id.slice(-6)}: "${m.text}"`),
    ...check.ai_double_sends.map((d) => `AI sent ${d.sends}× for turn ${d.turn_id}`),
    ...check.unanswered_messages.map((m) => `unanswered on lead …${(m.lead_id ?? "").slice(-6)}: "${m.text}"`),
    ...check.events_never_handled.map((e) => `${e.event}: ${e.why}`),
  ].slice(0, 8);
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: check.passed ? "var(--ok)" : "var(--bad)" }}>
      <div className="mb-2 flex items-center gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Go-live checks</div>
        <span className="rounded px-1.5 text-[10px] font-bold" style={{ background: "var(--panel-2)" }}>
          AI mode: {check.ai_mode}
        </span>
        <span className="ml-auto text-[12px] font-semibold" style={{ color: check.passed ? "var(--ok)" : "var(--bad)" }}>
          {check.passed ? "Healthy" : "Not ready"}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
        {Object.entries(check.checks).map(([name, ok]) => (
          <div key={name} className="flex items-center gap-1.5 text-[12px]">
            <span style={{ color: ok ? "var(--ok)" : "var(--bad)" }}>{ok ? "✓" : "✗"}</span>
            <span className={ok ? "" : "font-semibold"}>{name}</span>
          </div>
        ))}
      </div>
      {samples.length > 0 && (
        <div className="mt-2 space-y-0.5 text-[11px] text-muted">
          {samples.map((line) => (
            <div key={line} className="truncate">
              · {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MetricsTab({ dealerId, onError }: Props) {
  const [days, setDays] = useState(7);
  const [m, setM] = useState<Metrics | null>(null);
  const [check, setCheck] = useState<RolloutCheck | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [next, nextCheck] = await Promise.all([api.metrics(dealerId, days), api.rolloutCheck(dealerId, days)]);
        if (alive) {
          setM(next);
          setCheck(nextCheck);
        }
      } catch (e) {
        if (alive) onError(String(e));
      }
    };
    void load();
    const poll = window.setInterval(load, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealerId, days]);

  const fr = m?.first_reply_ms;
  const costDays = Object.entries(m?.cost_usd.by_day ?? {});
  const maxCost = Math.max(0.000001, ...costDays.map(([, c]) => c));

  return (
    <div className="scroll-thin flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <div className="text-[13px] font-semibold">Numbers to watch</div>
        <div className="text-[11px] text-muted">{m ? `${m.turns} turns, ${m.leads.total} leads` : "loading…"}</div>
        <div className="ml-auto flex gap-1">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className="rounded-md px-2.5 py-1 text-[12px] font-semibold"
              style={{ background: d === days ? "var(--accent)" : "var(--panel-2)", color: d === days ? "white" : "var(--muted)" }}
            >
              {d === 1 ? "24h" : `${d} days`}
            </button>
          ))}
        </div>
      </div>

      {check && <GoLive check={check} />}

      {m && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Card
              title="First reply (p95)"
              value={ms(fr?.p95)}
              detail={`p50 ${ms(fr?.p50)} · max ${ms(fr?.max)} · ${pct(fr?.under_8s)} under 8s`}
              tone={fr?.p95 == null ? "muted" : fr.p95 < 8000 ? "ok" : "bad"}
            />
            <Card
              title="Template fallback"
              value={pct(m.template_fallback.rate)}
              detail={`${m.template_fallback.turns} turn(s); +${m.template_fallback.template_first_replies_by_design} template first replies by design`}
              tone={m.template_fallback.rate == null ? "muted" : m.template_fallback.rate < 0.05 ? "ok" : "warn"}
            />
            <Card
              title="Guard failures"
              value={pct(m.guard_failures.rate)}
              detail={`${m.guard_failures.drafts} draft(s) rejected in ${m.guard_failures.turns} turn(s)`}
              tone={m.guard_failures.rate == null ? "muted" : m.guard_failures.rate < 0.1 ? "ok" : "warn"}
            />
            <Card
              title="Rejected extractions"
              value={String(m.rejected_extractions.values)}
              detail={`${m.rejected_extractions.per_turn ?? 0} per turn`}
            />
            <Card
              title="Cost"
              value={`$${m.cost_usd.total.toFixed(4)}`}
              detail={`${m.cost_usd.tokens_in.toLocaleString()} in (${(m.cost_usd.tokens_cached ?? 0).toLocaleString()} cached) / ${m.cost_usd.tokens_out.toLocaleString()} out tokens`}
            />
            <Card
              title="Qualified"
              value={pct(m.leads.qualified_rate)}
              detail={`handed off ${pct(m.leads.handoff_rate)}`}
              tone={m.leads.qualified_rate ? "ok" : "muted"}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Counts title="Lead status" counts={m.leads.by_status} />
            <Counts title="Sends" counts={m.sends} />
            <Counts title="Follow-ups" counts={m.followups} />
          </div>

          <div className="rounded-xl border border-line bg-panel p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Cost per day</div>
            {costDays.length === 0 ? (
              <div className="text-[12px] text-muted">No turns in this window.</div>
            ) : (
              <div className="flex h-24 items-end gap-1.5">
                {costDays.map(([day, cost]) => (
                  <div key={day} className="flex flex-1 flex-col items-center gap-1" title={`${day}: $${cost.toFixed(4)}`}>
                    <motion.div
                      className="w-full rounded-t bg-accent"
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max(4, (cost / maxCost) * 72)}px` }}
                    />
                    <span className="text-[9px] text-muted">{day.slice(5)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
