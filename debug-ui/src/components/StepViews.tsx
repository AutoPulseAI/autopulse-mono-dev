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
    </div>
  );
}
