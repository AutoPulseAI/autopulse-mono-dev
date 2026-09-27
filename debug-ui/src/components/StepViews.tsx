// Special animated views for the steps where "what happened" is easier to see
// than to read: Validate (values sorted into bins), Decide (rules checked in
// order), Guard (checks) and Compose (the drafted message).

import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

import type { Pipeline } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Value {
  path: string;
  value: unknown;
  quote: string;
  confidence: number;
  checks?: Record<string, boolean>;
  reason?: string;
}

type Bin = "accepted" | "needs_confirming" | "rejected";

const BINS: { id: Bin; label: string; color: string; soft: string }[] = [
  { id: "accepted", label: "Accepted", color: "var(--ok)", soft: "var(--ok-soft)" },
  { id: "needs_confirming", label: "Needs confirming", color: "var(--warn)", soft: "var(--warn-soft)" },
  { id: "rejected", label: "Rejected", color: "var(--bad)", soft: "var(--bad-soft)" },
];

/** Each extracted value starts in "Incoming", then moves into its bin one by one. */
export function ValidateBins({ output, pipeline, runKey }: { output: any; pipeline: Pipeline; runKey: string }) {
  const reduced = useReducedMotion();
  const items: (Value & { bin: Bin; key: string })[] = BINS.flatMap((b) =>
    ((output?.[b.id] ?? []) as Value[]).map((v, i) => ({ ...v, bin: b.id, key: `${b.id}-${i}-${v.path}` })),
  );
  const [placed, setPlaced] = useState(reduced ? items.length : 0);

  useEffect(() => {
    if (reduced) {
      setPlaced(items.length);
      return;
    }
    setPlaced(0);
    const timers = items.map((_, i) => window.setTimeout(() => setPlaced(i + 1), 450 + i * 450));
    return () => timers.forEach(window.clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, items.length, reduced]);

  const incoming = items.slice(placed);
  const checkLabels = Object.fromEntries(pipeline.validate_checks.map((c) => [c.id, c.label]));

  return (
    <LayoutGroup id={`validate-${runKey}`}>
      <div className="space-y-2">
        <div className="min-h-9 rounded-lg border border-dashed border-line p-1.5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Incoming from Extract</div>
          <div className="flex flex-wrap gap-1">
            {incoming.map((v) => (
              <ValueChip key={v.key} v={v} color="var(--muted)" soft="var(--panel-2)" />
            ))}
            {incoming.length === 0 && <span className="text-[11px] text-muted">all sorted</span>}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {BINS.map((b) => (
            <div key={b.id} className="min-h-24 rounded-lg p-1.5" style={{ background: b.soft }}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: b.color }}>
                {b.label}
              </div>
              <div className="flex flex-col gap-1">
                {items
                  .slice(0, placed)
                  .filter((v) => v.bin === b.id)
                  .map((v) => (
                    <div key={v.key}>
                      <ValueChip v={v} color={b.color} soft="var(--panel)" />
                      {v.checks && b.id !== "accepted" && (
                        <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-0.5 space-y-px pl-1">
                          {Object.entries(v.checks).map(([k, ok]) => (
                            <li key={k} className="text-[10px]" style={{ color: ok ? "var(--muted)" : b.color }}>
                              {ok ? "✓" : "✗"} {checkLabels[k] ?? k}
                            </li>
                          ))}
                        </motion.ul>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </LayoutGroup>
  );
}

function ValueChip({ v, color, soft }: { v: Value; color: string; soft: string }) {
  return (
    <motion.div
      layoutId={`${v.path}-${v.quote}`}
      layout
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className="rounded-md border px-1.5 py-1 text-[11px]"
      style={{ borderColor: color, background: soft }}
      title={`"${v.quote}" · confidence ${v.confidence}`}
    >
      <div className="font-mono text-[10px] text-muted">{v.path}</div>
      <div className="font-semibold text-ink">
        {String(v.value)} <span className="font-normal text-muted">· {Math.round(v.confidence * 100)}%</span>
      </div>
    </motion.div>
  );
}

/** Sweeps down the five rules in order; the one that fired lights up with its reason. */
export function DecideRules({ output, pipeline, runKey }: { output: any; pipeline: Pipeline; runKey: string }) {
  const reduced = useReducedMotion();
  const results: { id: string; result: string; why: string }[] = output?.rules ?? [];
  const firedIndex = results.findIndex((r) => r.result === "fired");
  const end = firedIndex === -1 ? results.length - 1 : firedIndex;
  const [cursor, setCursor] = useState(reduced ? end : -1);

  useEffect(() => {
    if (reduced) {
      setCursor(end);
      return;
    }
    setCursor(-1);
    const timers = Array.from({ length: end + 1 }, (_, i) => window.setTimeout(() => setCursor(i), 250 + i * 380));
    return () => timers.forEach(window.clearTimeout);
  }, [runKey, end, reduced]);

  return (
    <ol className="space-y-1">
      {pipeline.decide_rules.map((rule, i) => {
        const r = results.find((x) => x.id === rule.id);
        const checked = i <= cursor;
        const fired = checked && r?.result === "fired";
        const passedOver = checked && !fired;
        const after = firedIndex !== -1 && i > firedIndex && cursor >= firedIndex;
        return (
          <motion.li
            key={rule.id}
            animate={{
              background: fired ? "var(--accent-soft)" : "transparent",
              opacity: after ? 0.35 : checked ? 1 : 0.55,
              x: fired && !reduced ? [0, 4, 0] : 0,
            }}
            transition={{ duration: 0.3 }}
            className="relative rounded-lg border px-2 py-1.5"
            style={{ borderColor: fired ? "var(--accent)" : "var(--border)" }}
          >
            {i === cursor && !fired && !reduced && (
              <motion.span
                layoutId={`sweep-${runKey}`}
                className="absolute inset-0 rounded-lg border-2 border-accent"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            <div className="flex items-center gap-2">
              <span className="w-4 text-[11px] font-bold text-muted">{i + 1}</span>
              <span className={`flex-1 text-[12px] ${passedOver ? "text-muted" : "text-ink"}`}>{rule.label}</span>
              <span className="text-[11px] font-semibold">
                {fired ? <span className="text-accent">FIRED</span> : passedOver ? <span className="text-muted">no</span> : after ? "—" : ""}
              </span>
            </div>
            <AnimatePresence>
              {fired && r?.why && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="ml-6 mt-0.5 text-[11px] text-accent"
                >
                  {r.why}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.li>
        );
      })}
    </ol>
  );
}

export function GuardChecks({ output }: { output: any }) {
  const checks = Object.entries((output?.checks ?? {}) as Record<string, boolean>);
  return (
    <div className="space-y-1">
      {checks.map(([name, ok], i) => (
        <motion.div
          key={name}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.18 }}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5"
          style={{ background: ok ? "var(--ok-soft)" : "var(--bad-soft)" }}
        >
          <span className="font-bold" style={{ color: ok ? "var(--ok)" : "var(--bad)" }}>{ok ? "✓" : "✗"}</span>
          <span className="text-[12px] text-ink">{name.replaceAll("_", " ")}</span>
        </motion.div>
      ))}
      {output?.next && (
        <div className="pt-1 text-[11px] text-muted">
          Next: <span className="font-semibold text-ink">{output.next}</span>
        </div>
      )}
    </div>
  );
}

export function ComposePreview({ output }: { output: any }) {
  if (!output) return null;
  return (
    <div className="space-y-2">
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">SMS</div>
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="ml-auto max-w-[90%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-[12px] text-white"
        >
          {output.sms_text}
        </motion.div>
        <div className="mt-0.5 text-right text-[10px] text-muted">{String(output.sms_text ?? "").length} / 320 chars</div>
      </div>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Email</div>
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-lg border border-line bg-panel p-2 text-[12px]"
        >
          <div className="border-b border-line pb-1 font-semibold">{output.email_subject}</div>
          <div className="whitespace-pre-wrap pt-1 text-ink">{output.email_body}</div>
        </motion.div>
      </div>
      {output.why && (
        <div className="rounded-lg bg-ai-soft px-2 py-1.5 text-[11px] text-ai">
          <span className="font-semibold">Why it wrote this: </span>
          {output.why}
        </div>
      )}
      {Array.isArray(output.promises) && output.promises.length > 0 && (
        <div className="rounded-lg bg-panel-2 px-2 py-1.5 text-[11px]">
          <span className="font-semibold">Promises the team: </span>
          {output.promises.join(" · ")}
        </div>
      )}
    </div>
  );
}

const LAYER_LABELS: Record<string, string> = {
  new_messages: "New messages",
  working_memory: "Working memory",
  profile: "Profile",
  conversation: "Conversation state",
  campaign: "Campaign",
  summary: "Summary",
  inventory: "Stock",
};

// Records given to the AI per turn (tools/inventory_tool.py MAX_LOADED; architecture decision 16).
const MAX_LOADED = 3;

const kv = (o: Record<string, unknown> | undefined) =>
  Object.entries(o ?? {})
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("/") : v}`)
    .join(" · ");

// The stock Search stock loaded for this turn (MASTER_PLAN_3 Phases 1-2):
// why it searched, the criteria, each loosening step, the records with VINs.
export function InventoryView({ inventory }: { inventory: any }) {
  if (!inventory) return null;
  const records: any[] = inventory.records ?? [];
  const excluded: any[] = inventory.excluded ?? [];
  const loosened: any[] = inventory.loosened ?? [];
  const attempts: any[] = inventory.attempts ?? [];
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Stock ·{" "}
        {inventory.searched
          ? `${inventory.matched ?? 0} matched · ${records.length} given to the AI` +
            ((inventory.matched ?? 0) > records.length ? ` (max ${MAX_LOADED} per reply)` : "")
          : "not searched"}
        {inventory.cached ? " · from the cache" : ""}
      </div>
      {!inventory.searched && (
        <div className="text-[11px] text-muted">
          No stock question, and the profile doesn't name a vehicle (or a body type with new/used) yet.
        </div>
      )}
      {inventory.error && <div className="text-[11px] text-bad">Search failed, replying without stock: {inventory.error}</div>}
      {inventory.searched && !inventory.error && (
        <div className="space-y-1.5 text-[11px]">
          {inventory.trigger && <div className="text-muted">Searched because {inventory.trigger}.</div>}
          <div className="text-muted">
            From the profile: {kv(inventory.query) || "—"}
            {inventory.checked_at ? ` · checked ${new Date(inventory.checked_at).toLocaleTimeString()}` : ""}
          </div>
          {inventory.colour && (
            <div className="text-muted">
              Colour “{inventory.colour.asked}” →{" "}
              {inventory.colour.stored ? (
                <>
                  sent as the dealer's own spelling <span className="font-mono">“{inventory.colour.stored}”</span>
                </>
              ) : (
                "not in the dealer's matching stock"
              )}
            </div>
          )}
          {loosened.length > 0 && (
            <div className="rounded-lg bg-warn-soft p-2">
              <div className="mb-0.5 font-semibold">Loosened, in order</div>
              <ol className="list-decimal pl-4">
                {loosened.map((l, i) => (
                  <li key={i}>
                    <span className="font-semibold">{l.step}</span>: {l.detail}
                  </li>
                ))}
              </ol>
              <div className="mt-1">
                <span className="font-semibold">Actually searched: </span>
                {kv(inventory.final_query) || "—"}
              </div>
            </div>
          )}
          {attempts.length > 1 && (
            <div className="text-muted">
              Attempts: {attempts.map((a) => `${a.step} ${a.found}`).join(" → ")}
            </div>
          )}
          <div className="text-muted">
            Sent to /api/car:{" "}
            <span className="font-mono">
              {Object.entries((inventory.params ?? {}) as Record<string, string>)
                .map(([k, v]) => `${k}=${v}`)
                .join("&")}
            </span>
            {" "}· {inventory.matched} matched
            {(inventory.matched ?? 0) > records.length
              ? ` · the newest ${records.length} go to the AI (at most ${MAX_LOADED} per reply)`
              : ""}
          </div>
          {records.length === 0 ? (
            <div className="rounded-lg bg-panel-2 p-2 text-muted">No vehicle matched the search actually sent, even after loosening.</div>
          ) : (
            <div className="space-y-1">
              {records.map((r) => (
                <div key={r.vin} className="rounded-lg border border-line p-2">
                  <div className="font-semibold">
                    {[r.year, r.make, r.model, r.trim].filter(Boolean).join(" ")}
                    <span className="ml-1 rounded bg-panel-2 px-1 text-[10px] font-normal text-muted">{r.condition ?? "?"}</span>
                  </div>
                  <div className="text-muted">
                    {[r.body_type, r.exterior_color, r.miles != null ? `${Number(r.miles).toLocaleString()} miles` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <div className="font-mono text-[10px] text-muted">VIN {r.vin}</div>
                </div>
              ))}
            </div>
          )}
          {excluded.length > 0 && (
            <div className="rounded-lg bg-panel-2 p-2">
              <div className="mb-0.5 font-semibold">Left out</div>
              {excluded.map((e, i) => (
                <div key={`${e.vin}${i}`} className="text-warn">
                  <span className="font-mono text-[10px]">{e.vin || "(no VIN)"}</span>: {e.reason}
                </div>
              ))}
            </div>
          )}
          <div className="text-[10px] text-muted">
            Held back from the models until the grounding check (Plan 3 Phase 4). A budget filters the search, it's never said.
          </div>
        </div>
      )}
    </div>
  );
}

// The context pack a turn's AI steps read (MASTER_PLAN_2 Phase 1).
export function ContextPackView({ output }: { output: any }) {
  const budget = output?.context?.budget;
  const pack = output?.prompt?.context_pack;
  const conversation = pack?.conversation ?? output?.context?.conversation;
  if (!budget) return null;
  const tokens = Object.entries((budget.tokens ?? {}) as Record<string, number>);
  const max = Math.max(1, ...tokens.map(([, n]) => n));
  const asks = Object.entries((conversation?.asks ?? {}) as Record<string, { count: number; last_turn: number }>);
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
          Context pack · about {tokens.reduce((sum, [, n]) => sum + n, 0).toLocaleString()} tokens
        </div>
        <div className="space-y-1">
          {tokens.map(([layer, n], i) => (
            <div key={layer} className="flex items-center gap-2 text-[11px]">
              <span className="w-32 shrink-0 text-muted">{LAYER_LABELS[layer] ?? layer}</span>
              <div className="h-2 flex-1 overflow-hidden rounded bg-panel-2">
                <motion.div
                  className="h-full rounded bg-accent"
                  initial={{ width: 0 }}
                  animate={{ width: `${(n / max) * 100}%` }}
                  transition={{ delay: i * 0.05 }}
                />
              </div>
              <span className="w-10 shrink-0 text-right tabular-nums">{n}</span>
            </div>
          ))}
        </div>
        <div className="mt-1 text-[11px] text-muted">
          Working memory: {budget.kept} of {budget.loaded} earlier message(s), {budget.working_used} of {budget.working_tokens} tokens
          {budget.dropped ? ` · ${budget.dropped} older left out` : ""}
          {budget.more_not_loaded ? " · more history beyond the load limit" : ""}
        </div>
      </div>

      {pack?.summary && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Summary of {budget.summary_covers} earlier message(s)
          </div>
          <div className="whitespace-pre-wrap rounded-lg bg-panel-2 p-2 text-[11px]">{pack.summary}</div>
        </div>
      )}
      {budget.summary_behind && (
        <div className="text-[11px] text-warn">Older messages aren't summarized yet: updated after this turn's send.</div>
      )}

      {pack && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">What the AI read</div>
          <div className="space-y-1 rounded-lg border border-line p-2">
            {pack.working_memory.map((m: any, i: number) => (
              <div key={`w${i}`} className={`text-[11px] ${m.direction === "outbound" ? "text-right text-ai" : "text-ink"}`}>
                <span className="font-semibold">{m.direction === "outbound" ? "AI" : "Customer"}{m.resend ? " (re-sent)" : ""}: </span>
                {m.text}
              </div>
            ))}
            {pack.new_messages.map((m: any, i: number) => (
              <div key={`n${i}`} className="rounded bg-accent-soft px-1.5 py-0.5 text-[11px]">
                <span className="font-semibold">New{m.source === "lead_form" ? " (lead form)" : ""}: </span>
                {m.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {pack?.dealer?.info && (
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg bg-panel-2 p-2">
            <div className="mb-1 font-semibold">Dealer details it may use</div>
            {pack.dealer.info.address && <div>{pack.dealer.info.address}</div>}
            {pack.dealer.info.phone && <div>{pack.dealer.info.phone}</div>}
            {pack.dealer.info.hours_summary && <div>{pack.dealer.info.hours_summary}</div>}
            {pack.dealer.info.missing?.length > 0 && (
              <div className="mt-1 text-warn">Not entered (the team will confirm): {pack.dealer.info.missing.join(", ")}</div>
            )}
          </div>
          <div className="rounded-lg bg-panel-2 p-2">
            <div className="mb-1 font-semibold">What it may say it knows</div>
            {(pack.about_customer?.known ?? []).length === 0 && (pack.about_customer?.unconfirmed ?? []).length === 0 && (
              <div className="text-muted">nothing yet</div>
            )}
            {(pack.about_customer?.known ?? []).map((k: any, i: number) => (
              <div key={`k${i}`}>
                {k.label}: {k.value} <span className="text-muted">({k.from})</span>
              </div>
            ))}
            {(pack.about_customer?.unconfirmed ?? []).map((u: any, i: number) => (
              <div key={`u${i}`} className="text-warn">
                {u.label}: {u.value} (to confirm)
              </div>
            ))}
          </div>
        </div>
      )}

      {conversation && (
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg bg-panel-2 p-2">
            <div className="mb-1 font-semibold">Asked so far (reply #{conversation.turn})</div>
            {asks.length === 0 ? <div className="text-muted">nothing yet</div> : asks.map(([path, a]) => (
              <div key={path} className="flex justify-between gap-2">
                <span className="truncate">{path}</span>
                <span className="tabular-nums text-muted">×{a.count}</span>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-panel-2 p-2">
            <div className="mb-1 font-semibold">Open questions</div>
            {conversation.open_questions.length === 0 ? <div className="text-muted">none</div> : conversation.open_questions.map((q: any, i: number) => (
              <div key={i}>
                “{q.text}” <span className="rounded bg-panel px-1 text-[10px] text-muted">{String(q.label ?? "").replaceAll("_", " ")}</span>
              </div>
            ))}
            <div className="mb-1 mt-2 font-semibold">Promises</div>
            {conversation.promises.length === 0 ? <div className="text-muted">none</div> : conversation.promises.map((p: any, i: number) => (
              <div key={i}>{p.text}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// What Decide chose beyond the rule (MASTER_PLAN_2 Phases 5 and 9): the
// questions it answers, the one follow-up, a clarification, and why details
// weren't asked.
export function DecideDetails({ output }: { output: any }) {
  if (!output) return null;
  const questions: { text: string; label: string }[] = output.answer_questions ?? [];
  const asks: { label: string; question?: string; hint?: string }[] = output.asks ?? [];
  const notAsked: { label: string; why: string }[] = output.not_asked ?? [];
  const clarify: { label: string; question?: string; explanation?: string }[] = output.clarify?.items ?? [];
  return (
    <div className="space-y-2 text-[11px]">
      {output.annoyed_at_bot && (
        <div className="rounded-lg bg-warn-soft px-2 py-1.5 text-warn">
          The customer is frustrated with the conversation: no questions this time.
        </div>
      )}
      {questions.length > 0 && (
        <Block title="Answers first">
          {questions.map((q, i) => (
            <div key={i}>
              "{q.text}" <span className="rounded bg-panel-2 px-1 text-[10px] text-muted">{String(q.label ?? "").replaceAll("_", " ")}</span>
            </div>
          ))}
        </Block>
      )}
      {clarify.length > 0 && (
        <Block title="Explains again, then asks the same question">
          {clarify.map((c, i) => (
            <div key={i}>
              <div className="text-muted">{c.explanation}</div>
              <div className="font-semibold">{c.question}</div>
            </div>
          ))}
        </Block>
      )}
      {output.confirm && (
        <Block title="Then checks">
          <div>
            {output.confirm.label}: <span className="font-semibold">{output.confirm.display ?? String(output.confirm.value)}</span>
          </div>
        </Block>
      )}
      {asks.length > 0 && (
        <Block title={output.action === "answer" ? "Then asks (one question)" : "Asks (one question)"}>
          {asks.map((a, i) => (
            <div key={i} className="font-semibold">{a.question ?? a.hint ?? a.label}</div>
          ))}
        </Block>
      )}
      {notAsked.length > 0 && (
        <Block title="Not asking">
          {notAsked.map((n, i) => (
            <div key={i}>
              {n.label}: <span className="text-muted">{n.why}</span>
            </div>
          ))}
        </Block>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-panel-2 px-2 py-1.5">
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
