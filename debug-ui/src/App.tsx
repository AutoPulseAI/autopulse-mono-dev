import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "./api";
import { NodeInspector } from "./components/NodeInspector";
import { PipelineGraph } from "./components/PipelineGraph";
import { MetricsTab } from "./components/MetricsTab";
import { ScenariosTab } from "./components/ScenariosTab";
import { SchedulerTab } from "./components/SchedulerTab";
import { ShadowTab } from "./components/ShadowTab";
import { Simulator } from "./components/Simulator";
import { ConversationPanel } from "./components/ConversationPanel";
import { ModelsBanner } from "./components/ModelsBanner";
import { SlotsPanel } from "./components/SlotsPanel";
import { Timeline, TRIGGER_LABEL } from "./components/Timeline";
import { outcomeColor } from "./components/ui";
import { emptyView, reduce, reduceAll, type TurnView } from "./trace/reducer";
import { useReplay } from "./trace/useReplay";
import { useTraceStream } from "./trace/useTraceStream";
import type { ConversationItem, Dealer, Lead, Ping, Pipeline, SlotsView, TraceEvent, TurnSummary } from "./types";

type Tab = "pipeline" | "scheduler" | "metrics" | "shadow" | "scenarios";

// Minimum time between live trace events in the animation.
const LIVE_EVENT_GAP_MS = 320;
type Theme = "system" | "light" | "dark";

function readTheme(): Theme {
  try {
    return (localStorage.getItem("debug-ui-theme") as Theme) || "system";
  } catch {
    return "system";
  }
}

export default function App() {
  const [env, setEnv] = useState<"checking" | "ok" | "disabled">("checking");
  const [envError, setEnvError] = useState("");
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [dealerId, setDealerId] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [slots, setSlots] = useState<SlotsView | null>(null);
  const [turns, setTurns] = useState<TurnSummary[]>([]);
  const [mode, setMode] = useState<"live" | "replay">("live");
  const [liveView, setLiveView] = useState<TurnView>(emptyView());
  const [replayEvents, setReplayEvents] = useState<TraceEvent[] | null>(null);
  const [replayTurnId, setReplayTurnId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>("load_context");
  const [follow, setFollow] = useState(true);
  const [tab, setTab] = useState<Tab>("pipeline");
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [models, setModels] = useState<Ping | null>(null);

  const replay = useReplay(pipeline, replayEvents);
  const view = mode === "live" ? liveView : replay.view;
  const leadRef = useRef(leadId);
  leadRef.current = leadId;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const showError = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  // --- theme -----------------------------------------------------------------
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      localStorage.setItem("debug-ui-theme", theme);
    } catch {
      /* storage unavailable: theme just won't persist */
    }
  }, [theme]);

  // --- startup: DEV check (layer 3 of the DEV-only guarantee) -----------------
  useEffect(() => {
    api
      .ping()
      .then(async (ping) => {
        setModels(ping);
        setEnv("ok");
        const [p, d] = await Promise.all([api.pipeline(), api.dealers()]);
        setPipeline(p);
        setDealers(d);
        setDealerId((cur) => cur ?? d[0]?.id ?? null);
      })
      .catch((e) => {
        setEnv("disabled");
        setEnvError(String(e));
      });
  }, []);

  const loadLeads = useCallback(async () => {
    if (!dealerId) return;
    try {
      const list = await api.leads(dealerId);
      setLeads(list);
      setLeadId((cur) => (cur && list.some((l) => l.id === cur) ? cur : list[0]?.id ?? null));
    } catch (e) {
      showError(String(e));
    }
  }, [dealerId, showError]);

  const loadLeadDetail = useCallback(async () => {
    if (!dealerId || !leadId) return;
    try {
      const [c, s, t] = await Promise.all([
        api.conversation(dealerId, leadId),
        api.slots(dealerId, leadId),
        api.turns(dealerId, leadId),
      ]);
      setConversation(c);
      setSlots(s);
      setTurns(t);
    } catch (e) {
      showError(String(e));
    }
  }, [dealerId, leadId, showError]);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  // Switching lead: go live and show that lead's latest turn as the starting picture.
  useEffect(() => {
    setMode("live");
    setReplayEvents(null);
    setReplayTurnId(null);
    setLiveView(emptyView());
    setConversation([]);
    setSlots(null);
    setTurns([]);
    if (!dealerId || !leadId || !pipeline) return;
    void loadLeadDetail();
    api
      .turns(dealerId, leadId)
      .then(async (list) => {
        const last = list[list.length - 1];
        if (!last || leadRef.current !== leadId) return;
        const doc = await api.turn(dealerId, last.turn_id);
        if (leadRef.current === leadId) setLiveView((cur) => (cur.turnId ? cur : reduceAll(pipeline, doc.events)));
      })
      .catch(() => undefined);
  }, [dealerId, leadId, pipeline, loadLeadDetail]);

  // --- live stream ------------------------------------------------------------
  // Real steps finish in milliseconds, so live events for the selected lead
  // are queued and applied at a watchable pace (like replay) instead of all
  // at once. The service itself is never slowed down for the animation.
  const liveQueue = useRef<TraceEvent[]>([]);
  const pacer = useRef<number | undefined>(undefined);

  const applyLive = useCallback(
    (event: TraceEvent) => {
      if (!pipeline) return;
      setLiveView((cur) => reduce(pipeline, cur, event));
      if (event.type === "turn_finished") void loadLeadDetail();
    },
    [pipeline, loadLeadDetail],
  );

  const drain = useCallback(() => {
    const next = liveQueue.current.shift();
    if (!next) {
      pacer.current = undefined;
      return;
    }
    applyLive(next);
    pacer.current = window.setTimeout(drain, LIVE_EVENT_GAP_MS);
  }, [applyLive]);

  useEffect(() => {
    liveQueue.current = [];
    window.clearTimeout(pacer.current);
    pacer.current = undefined;
  }, [leadId]);

  const onEvent = useCallback(
    (event: TraceEvent) => {
      if (!pipeline) return;
      if (event.type === "turn_finished") {
        void loadLeads();
      }
      if (event.lead_id !== leadRef.current) return;
      if (event.type === "turn_started" && modeRef.current === "replay") {
        setMode("live"); // a new turn for the lead you're looking at: jump back to live
      }
      liveQueue.current.push(event);
      if (pacer.current === undefined) drain();
    },
    [pipeline, loadLeads, drain],
  );
  const streamStatus = useTraceStream(env === "ok" ? dealerId : null, onEvent);

  // "Follow active step": whenever a step starts (live or replay), inspect it.
  useEffect(() => {
    const e = view.lastEvent;
    if (follow && e?.type === "node_started" && e.node) setSelectedNode(e.node);
  }, [view.lastEvent, follow]);

  const pickTurn = async (turnId: string) => {
    if (!dealerId) return;
    try {
      const doc = await api.turn(dealerId, turnId);
      setReplayTurnId(turnId);
      setReplayEvents(doc.events);
      setMode("replay");
    } catch (e) {
      showError(String(e));
    }
  };

  if (env === "checking") return <Centered>Connecting to the AI service…</Centered>;
  if (env === "disabled") return <Disabled detail={envError} />;
  if (!pipeline || !dealerId) return <Centered>Loading…</Centered>;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-bad px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white">DEV</span>
          <h1 className="text-[15px] font-bold">AI Pipeline Debugger</h1>
        </div>
        <nav className="ml-4 flex gap-1">
          {(["pipeline", "scheduler", "metrics", "shadow", "scenarios"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="relative rounded-md px-3 py-1 text-[12px] font-semibold capitalize"
              style={{ color: tab === t ? "var(--text)" : "var(--muted)" }}
            >
              {tab === t && <motion.span layoutId="main-tab" className="absolute inset-0 rounded-md bg-panel-2" />}
              <span className="relative">{t}</span>
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {models && <ModelsBanner ping={models} />}
          <select
            value={dealerId}
            onChange={(e) => {
              setDealerId(e.target.value);
              setLeadId(null);
            }}
            className="rounded-md border border-line bg-panel px-2 py-1 text-[12px]"
          >
            {dealers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <span className="flex items-center gap-1.5 text-[11px] text-muted" title="Live trace stream">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: streamStatus === "open" ? "var(--ok)" : streamStatus === "connecting" ? "var(--warn)" : "var(--bad)" }}
            />
            {streamStatus === "open" ? "live" : streamStatus}
          </span>
          <button
            type="button"
            onClick={() => setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"))}
            className="rounded-md bg-panel-2 px-2 py-1 text-[11px] text-muted"
            title="Theme"
          >
            {theme === "system" ? "◐ auto" : theme === "light" ? "☀ light" : "☾ dark"}
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1">
        {tab === "pipeline" && (
          <div className="grid h-full grid-cols-[300px_1fr_380px]">
            <aside className="min-h-0 border-r border-line bg-panel">
              <Simulator
                dealerId={dealerId}
                leads={leads}
                selectedLeadId={leadId}
                onSelectLead={setLeadId}
                conversation={conversation}
                offline={models?.offline ?? false}
                onChanged={() => {
                  void loadLeads();
                  void loadLeadDetail();
                }}
                onError={showError}
              />
            </aside>

            <section className="flex min-h-0 flex-col">
              <TurnHeader view={view} mode={mode} />
              <div className="min-h-0 flex-[3]">
                <PipelineGraph pipeline={pipeline} view={view} selectedNode={selectedNode} onSelectNode={setSelectedNode} />
              </div>
              <div className="grid min-h-0 flex-[1.2] grid-cols-[1fr_300px] border-t border-line bg-panel">
                <SlotsPanel slots={slots} />
                <ConversationPanel slots={slots} />
              </div>
            </section>

            <aside className="min-h-0 border-l border-line bg-panel">
              <NodeInspector pipeline={pipeline} view={view} nodeId={selectedNode} follow={follow} onFollowChange={setFollow} />
            </aside>
          </div>
        )}
        {tab === "scheduler" && (
          <SchedulerTab
            dealerId={dealerId}
            dealer={dealers.find((d) => d.id === dealerId)}
            leads={leads}
            onError={showError}
          />
        )}
        {tab === "metrics" && <MetricsTab dealerId={dealerId} onError={showError} />}
        {tab === "shadow" && <ShadowTab dealerId={dealerId} onError={showError} />}
        {tab === "scenarios" && <ScenariosTab onError={showError} />}
      </main>

      {tab === "pipeline" && (
        <Timeline
          turns={turns}
          mode={mode}
          replayTurnId={replayTurnId}
          replay={replay}
          onPickTurn={pickTurn}
          onLive={() => {
            setMode("live");
            setReplayTurnId(null);
          }}
        />
      )}

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-16 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-lg bg-bad px-3 py-2 text-[12px] text-white shadow-lg"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TurnHeader({ view, mode }: { view: TurnView; mode: "live" | "replay" }) {
  return (
    <div className="flex h-9 items-center gap-3 border-b border-line bg-panel px-3 text-[12px]">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{mode === "live" ? "Live turn" : "Replay"}</span>
      {view.turnId ? (
        <>
          <span className="font-mono text-[11px] text-muted">{view.turnId.slice(0, 8)}</span>
          <span>{view.trigger === "inbound_message" ? "customer reply" : (TRIGGER_LABEL[view.trigger ?? ""] ?? view.trigger)}</span>
          <span className="rounded bg-panel-2 px-1.5 text-[11px] uppercase">{view.channel}</span>
          <AnimatePresence mode="wait">
            <motion.span
              key={view.outcome ?? "running"}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-semibold"
              style={{ color: view.finished ? outcomeColor(view.outcome) : "var(--accent)" }}
            >
              {view.finished ? `→ ${view.outcome}` : "running…"}
            </motion.span>
          </AnimatePresence>
          {view.finished && view.ms !== null && <span className="text-muted">{view.ms} ms</span>}
          {view.retries > 0 && <span className="text-warn">↺ {view.retries} rewrite</span>}
        </>
      ) : (
        <span className="text-muted">No turn yet. Create a lead or reply as the customer.</span>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-[13px] text-muted">{children}</div>;
}

function Disabled({ detail }: { detail: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-line bg-panel p-6 text-center">
        <div className="text-[16px] font-bold">Debug UI is only available in DEV</div>
        <p className="mt-2 text-[13px] text-muted">
          The AI service didn't answer <code className="font-mono">/dev/ping</code>. Either it isn't running, or it is
          running with <code className="font-mono">ENVIRONMENT</code> set to something other than{" "}
          <code className="font-mono">DEV</code>, so its debug routes don't exist.
        </p>
        <p className="mt-3 font-mono text-[11px] text-muted">{detail}</p>
      </div>
    </div>
  );
}
