import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { api } from "../api";
import type { Scenario } from "../types";

// Stage names from MASTER_PLAN_1.md, for the progress headings.
const STAGE_NAMES: Record<number, string> = {
  1: "Local stack and foundations",
  2: "Event intake",
  3: "Debug UI",
  4: "Sending and template first reply",
  5: "Platform → AI wiring",
  6: "Customer 360 check",
  7: "Slot engine",
  8: "AI turn pipeline",
  9: "Campaign replies",
  10: "24h channel switch",
  11: "No double messaging and staff takeover",
  12: "Real providers and hardening",
  13: "Shadow and rollout",
  // MASTER_PLAN_2 phases are stored as 100 + phase.
  101: "Context builder and conversation state",
  102: "Never silent",
  103: "Rolling summary",
  104: "Understanding the customer",
  105: "Conversational Decide",
  106: "Answer sources",
  107: "Plain, explainable replies",
  108: "Dates and time",
  // MASTER_PLAN_3 Part A phases are stored as 200 + phase.
  201: "Inventory read layer",
  202: "Shopping criteria",
  // MASTER_PLAN_3 Part C phases are stored as 300 + phase.
  301: "Send check (compliance engine, with B2/B3)",
  // MASTER_PLAN_3 Part B phases are stored as 400 + phase.
  401: "After-hours first reply",
  404: "The visit as the goal",
  405: "Booking the visit",
};

const stageLabel = (stage: number) =>
  stage > 400 ? `Plan 3 · Phase B${stage - 400}`
    : stage > 300 ? `Plan 3 · Phase C${stage - 300}`
    : stage > 200 ? `Plan 3 · Phase A${stage - 200}` : stage > 100 ? `Plan 2 · Phase ${stage - 100}` : `Stage ${stage}`;

export function ScenariosTab({ onError }: { onError: (m: string) => void }) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [running, setRunning] = useState<string[] | "all" | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = async () => {
    try {
      setScenarios(await api.scenarios());
    } catch (e) {
      onError(String(e));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (ids?: string[]) => {
    setRunning(ids ?? "all");
    try {
      await api.runScenarios(ids);
    } catch (e) {
      onError(String(e));
    } finally {
      setRunning(null);
      await load();
    }
  };

  const stages = Array.from(new Set(scenarios.map((s) => s.stage ?? 0))).sort((a, b) => a - b);
  const passed = scenarios.filter((s) => s.last_run?.passed).length;
  const isRunning = (id: string) => running === "all" || (Array.isArray(running) && running.includes(id));

  return (
    <div className="scroll-thin h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-center gap-4 rounded-xl border border-line bg-panel p-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Build progress</div>
          <div className="text-[20px] font-bold tabular-nums">
            {passed} <span className="text-[13px] font-medium text-muted">of {scenarios.length} scenarios passing</span>
          </div>
        </div>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
          <motion.div
            className="h-full rounded-full bg-ok"
            animate={{ width: scenarios.length ? `${(passed / scenarios.length) * 100}%` : "0%" }}
            transition={{ type: "spring", stiffness: 90, damping: 18 }}
          />
        </div>
        <button
          type="button"
          disabled={running !== null}
          onClick={() => run()}
          className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
        >
          {running === "all" ? "Running all…" : "Run all"}
        </button>
      </div>

      {stages.map((stage) => {
        const inStage = scenarios.filter((s) => (s.stage ?? 0) === stage);
        const ok = inStage.filter((s) => s.last_run?.passed).length;
        return (
          <section key={stage} className="mb-4">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="rounded bg-panel-2 px-1.5 text-[11px] font-bold text-muted">{stageLabel(stage)}</span>
              <span className="text-[13px] font-semibold">{STAGE_NAMES[stage] ?? ""}</span>
              <span className="ml-auto text-[11px] text-muted">
                {ok}/{inStage.length} passing
              </span>
            </div>
            <div className="space-y-1.5">
              {inStage.map((s) => {
                const state = isRunning(s.id) ? "running" : s.last_run ? (s.last_run.passed ? "pass" : "fail") : "not run";
                const color = state === "pass" ? "var(--ok)" : state === "fail" ? "var(--bad)" : state === "running" ? "var(--accent)" : "var(--muted)";
                return (
                  <motion.div key={s.id} layout className="rounded-lg border border-line bg-panel">
                    <div className="flex items-center gap-2 p-2">
                      <motion.span
                        key={state}
                        initial={{ scale: 0.4 }}
                        animate={state === "running" ? { scale: [1, 1.3, 1] } : { scale: 1 }}
                        transition={state === "running" ? { repeat: Infinity, duration: 0.9 } : { type: "spring", stiffness: 500 }}
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: color }}
                      />
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === s.id ? null : s.id)}>
                        <div className="truncate text-[12px] font-semibold">{s.name}</div>
                        <div className="truncate text-[11px] text-muted">{s.description}</div>
                      </button>
                      <span className="text-[11px] font-semibold uppercase" style={{ color }}>
                        {state}
                      </span>
                      {s.last_run && <span className="w-14 text-right text-[10px] tabular-nums text-muted">{s.last_run.ms} ms</span>}
                      <button
                        type="button"
                        disabled={running !== null}
                        onClick={() => run([s.id])}
                        className="rounded bg-panel-2 px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
                      >
                        Run
                      </button>
                    </div>
                    <AnimatePresence>
                      {open === s.id && s.last_run && (
                        <motion.ol
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden border-t border-line px-3 py-1.5"
                        >
                          {s.last_run.steps.map((step, i) => (
                            <li key={i} className="flex gap-2 py-0.5 text-[11px]">
                              <span
                                style={{
                                  color: step.status === "passed" ? "var(--ok)" : step.status === "failed" ? "var(--bad)" : "var(--muted)",
                                }}
                              >
                                {step.status === "passed" ? "✓" : step.status === "failed" ? "✗" : "–"}
                              </span>
                              <span className="font-mono text-muted">{step.step}</span>
                              <span className="truncate">{step.detail}</span>
                            </li>
                          ))}
                        </motion.ol>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
