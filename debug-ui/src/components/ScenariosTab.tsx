import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { api } from "../api";
import type { Scenario } from "../types";

// Scenario files are named <workflow>_<area>__<what it shows> (the scope PDF's workflow numbers), so the
// readable title comes from the file name and the group from its prefix.
const readable = (id: string) => {
  const [area, what] = id.replace(/^w\d+_/, "").split("__");
  const text = (what ?? area).replace(/_/g, " ");
  return { area: area.replace(/_/g, " "), what: text.charAt(0).toUpperCase() + text.slice(1) };
};

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

  const workflows = Array.from(new Set(scenarios.map((s) => s.workflow))).sort();
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

      {workflows.map((workflow) => {
        const inStage = scenarios.filter((s) => s.workflow === workflow);
        const ok = inStage.filter((s) => s.last_run?.passed).length;
        return (
          <section key={workflow} className="mb-4">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="rounded bg-panel-2 px-1.5 text-[11px] font-bold uppercase text-muted">{workflow}</span>
              <span className="text-[13px] font-semibold">{inStage[0]?.workflow_name ?? ""}</span>
              <span className="ml-auto text-[11px] text-muted">
                {ok}/{inStage.length} passing
              </span>
              <button
                type="button"
                disabled={running !== null}
                onClick={() => run(inStage.map((s) => s.id))}
                className="rounded bg-panel-2 px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50"
              >
                Run group
              </button>
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
                        <div className="truncate text-[12px] font-semibold">
                          <span className="mr-1.5 rounded bg-panel-2 px-1 text-[10px] font-semibold text-muted">{readable(s.id).area}</span>
                          {readable(s.id).what}
                        </div>
                        <div className="truncate text-[11px] text-muted">{s.name} · <span className="font-mono">{s.id}</span></div>
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
