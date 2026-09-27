import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import type { NodeRun, TurnView } from "../trace/reducer";
import type { Pipeline } from "../types";
import { JsonView } from "./JsonView";
import { ComposePreview, ContextPackView, DecideDetails, DecideRules, GuardChecks, InventoryView, ValidateBins } from "./StepViews";

type Tab = "reasoning" | "input" | "output" | "metrics";
const TABS: { id: Tab; label: string }[] = [
  { id: "reasoning", label: "Reasoning" },
  { id: "input", label: "Input" },
  { id: "output", label: "Output" },
  { id: "metrics", label: "Metrics" },
];

interface Props {
  pipeline: Pipeline;
  view: TurnView;
  nodeId: string | null;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
}

export function NodeInspector({ pipeline, view, nodeId, follow, onFollowChange }: Props) {
  const [tab, setTab] = useState<Tab>("reasoning");
  const def = pipeline.nodes.find((n) => n.id === nodeId);
  const attempts = (nodeId && view.attempts[nodeId]) || [];
  const [attemptIdx, setAttemptIdx] = useState<number | null>(null);

  useEffect(() => {
    setAttemptIdx(null);
  }, [nodeId, view.turnId]);

  const current = nodeId ? view.nodes[nodeId] : undefined;
  const run: NodeRun | undefined = attemptIdx !== null && attempts[attemptIdx] ? attempts[attemptIdx] : current;
  const runKey = `${view.turnId}-${nodeId}-${run?.attempt ?? 0}-${run?.status}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Step inspector</div>
          <div className="truncate text-[14px] font-semibold">{def?.label ?? "Pick a step"}</div>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <input type="checkbox" checked={follow} onChange={(e) => onFollowChange(e.target.checked)} />
          follow active step
        </label>
      </div>

      {!def ? (
        <div className="p-4 text-[12px] text-muted">Click a step in the diagram to see its input, reasoning and output.</div>
      ) : (
        <>
          <div className="flex items-center gap-1 border-b border-line px-2 pt-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="relative px-2.5 pb-2 text-[12px] font-medium"
                style={{ color: tab === t.id ? "var(--text)" : "var(--muted)" }}
              >
                {t.label}
                {tab === t.id && (
                  <motion.span layoutId="inspector-tab" className="absolute inset-x-1 bottom-0 h-0.5 rounded bg-accent" />
                )}
              </button>
            ))}
            {attempts.length > 1 && (
              <div className="ml-auto flex gap-1 pb-1.5">
                {attempts.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setAttemptIdx(i)}
                    className="rounded px-1.5 text-[10px] font-semibold"
                    style={{
                      background: (attemptIdx ?? attempts.length - 1) === i ? "var(--warn-soft)" : "var(--panel-2)",
                      color: (attemptIdx ?? attempts.length - 1) === i ? "var(--warn)" : "var(--muted)",
                    }}
                  >
                    try {i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="scroll-thin flex-1 overflow-y-auto p-3">
            {!run || run.status === "idle" ? (
              <div className="text-[12px] text-muted">This step hasn't run in this turn yet.</div>
            ) : run.status === "skipped" ? (
              <div className="rounded-lg bg-panel-2 p-2 text-[12px] text-muted">Skipped: {run.skippedReason}</div>
            ) : run.status === "running" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[12px] text-accent">
                  <motion.span
                    className="h-2 w-2 rounded-full bg-accent"
                    animate={{ scale: [1, 1.6, 1] }}
                    transition={{ repeat: Infinity, duration: 0.9 }}
                  />
                  Running…
                </div>
                <JsonView value={run.input} />
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${tab}-${runKey}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {tab === "reasoning" && <ReasoningTab nodeId={def.id} run={run} pipeline={pipeline} runKey={runKey} />}
                  {tab === "input" && <JsonView value={run.input} />}
                  {tab === "output" && <JsonView value={run.output} />}
                  {tab === "metrics" && <MetricsTab run={run} />}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ReasoningTab({ nodeId, run, pipeline, runKey }: { nodeId: string; run: NodeRun; pipeline: Pipeline; runKey: string }) {
  const lines = Array.isArray(run.reasoning) ? run.reasoning : run.reasoning ? [run.reasoning] : [];
  return (
    <div className="space-y-3">
      {nodeId === "load_context" && <ContextPackView output={run.output} />}
      {nodeId === "search_stock" && <InventoryView inventory={run.output} />}
      {nodeId === "validate" && <ValidateBins output={run.output} pipeline={pipeline} runKey={runKey} />}
      {nodeId === "decide" && <DecideRules output={run.output} pipeline={pipeline} runKey={runKey} />}
      {nodeId === "decide" && <DecideDetails output={run.output} />}
      {nodeId === "guard" && <GuardChecks output={run.output} />}
      {(nodeId === "compose" || nodeId === "fallback") && <ComposePreview output={run.output} />}
      {run.error && <div className="rounded-lg bg-bad-soft p-2 font-mono text-[11px] text-bad">{run.error}</div>}
      {lines.length > 0 && (
        <ul className="space-y-1">
          {lines.map((line, i) => (
            <motion.li
              key={`${runKey}-${i}`}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 * i }}
              className="flex gap-2 rounded-md bg-panel-2 px-2 py-1.5 text-[12px] leading-snug"
            >
              <span className="text-accent">›</span>
              <span>{line}</span>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MetricsTab({ run }: { run: NodeRun }) {
  const m = run.metrics ?? {};
  const rows: [string, unknown][] = [
    ["Time", m.ms !== undefined ? `${m.ms} ms` : "—"],
    ["Attempt", run.attempt],
    ["Model", m.model ?? "— (plain code)"],
    ["Tokens in / out", m.tokens_in !== undefined ? `${m.tokens_in} / ${m.tokens_out}` : "—"],
    ["Cost", m.cost_usd !== undefined ? `$${Number(m.cost_usd).toFixed(4)}` : "—"],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="font-medium">{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
