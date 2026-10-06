import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { api } from "../api";
import type { Scenario } from "../types";
import { ScenarioRunScreen } from "./ScenarioRunScreen";

// Scenario files are named <workflow>_<area>__<what it shows> (the scope PDF's workflow numbers); `area`
// groups rows inside a workflow (e.g. every w04_visit_offer__* row is about the visit offer).
const areaOf = (id: string) => id.replace(/^w\d+_/, "").split("__")[0].replace(/_/g, " ");

export function ScenariosTab({ onError }: { onError: (m: string) => void }) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [running, setRunning] = useState<string[] | "all" | null>(null);
  const [screen, setScreen] = useState<{ scenario: Scenario; start: boolean } | null>(null);

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
      <AnimatePresence>
        {screen && (
          <ScenarioRunScreen
            key={screen.scenario.id}
            scenario={screen.scenario}
            startOnOpen={screen.start}
            onClose={() => {
              setScreen(null);
              void load();
            }}
            onError={onError}
          />
        )}
      </AnimatePresence>
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
                    <div className="flex items-start gap-2 p-2.5">
                      <motion.span
                        key={state}
                        initial={{ scale: 0.4 }}
                        animate={state === "running" ? { scale: [1, 1.3, 1] } : { scale: 1 }}
                        transition={state === "running" ? { repeat: Infinity, duration: 0.9 } : { type: "spring", stiffness: 500 }}
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: color }}
                      />
                      {/* The name is a one-line summary of what this proves; the description spells out the
                          exact expected behaviour, so reading both tells the whole story without opening it. */}
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setScreen({ scenario: s, start: false })}>
                        <div className="flex items-baseline gap-1.5">
                          <span className="rounded bg-panel-2 px-1 text-[10px] font-semibold text-muted">{areaOf(s.id)}</span>
                          <span className="text-[13px] font-semibold leading-snug">{s.name}</span>
                        </div>
                        <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{s.description}</div>
                        <div className="mt-1 font-mono text-[10px] text-muted/70">{s.id}</div>
                      </button>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-[11px] font-semibold uppercase" style={{ color }}>
                          {state}
                        </span>
                        {s.last_run && <span className="text-[10px] tabular-nums text-muted">{s.last_run.ms} ms</span>}
                        <button
                          type="button"
                          disabled={running !== null}
                          onClick={() => setScreen({ scenario: s, start: true })}
                          className="rounded bg-panel-2 px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
                        >
                          Run
                        </button>
                      </div>
                    </div>
                    {s.last_run && !s.last_run.passed && (
                      <div className="border-t border-line px-3 py-1 text-[11px] text-bad">
                        ✗ {s.last_run.steps.find((st) => st.status === "failed")?.step}: {s.last_run.steps.find((st) => st.status === "failed")?.detail}
                      </div>
                    )}
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
