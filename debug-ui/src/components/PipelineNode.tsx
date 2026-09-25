import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import type { NodeRun, NodeStatus } from "../trace/reducer";
import type { PipelineNodeDef } from "../types";

export type PipelineNodeData = {
  def: PipelineNodeDef;
  run?: NodeRun;
  selected: boolean;
  onSelect: (id: string) => void;
};

export type PipelineFlowNode = Node<PipelineNodeData, "pipeline">;

const BORDER: Record<NodeStatus, string> = {
  idle: "var(--border)",
  running: "var(--accent)",
  done: "var(--ok)",
  failed: "var(--bad)",
  skipped: "var(--border)",
};

const SIDES = [
  ["l", Position.Left],
  ["r", Position.Right],
  ["t", Position.Top],
  ["b", Position.Bottom],
] as const;

const hidden = { opacity: 0, width: 6, height: 6, minWidth: 0, minHeight: 0, border: 0 };

export function PipelineNode({ data }: NodeProps<PipelineFlowNode>) {
  const { def, run, selected, onSelect } = data;
  const status: NodeStatus = run?.status ?? "idle";
  const reduced = useReducedMotion();
  const isStub = Boolean(run?.output?.stub);

  const animate = (() => {
    if (reduced) return { opacity: status === "skipped" ? 0.45 : 1 };
    switch (status) {
      case "running":
        return {
          opacity: 1,
          scale: 1.03,
          boxShadow: [
            "0 0 0 0px color-mix(in srgb, var(--accent) 45%, transparent)",
            "0 0 0 12px color-mix(in srgb, var(--accent) 0%, transparent)",
          ],
          transition: { boxShadow: { duration: 1.1, repeat: Infinity }, scale: { duration: 0.2 } },
        };
      case "done":
        return { opacity: 1, scale: [1.06, 1], boxShadow: "0 1px 2px rgba(0,0,0,0.06)", transition: { duration: 0.35 } };
      case "failed":
        return { opacity: 1, scale: 1, x: [0, -7, 7, -5, 5, 0], transition: { duration: 0.45 } };
      case "skipped":
        return { opacity: 0.45, scale: 1 };
      default:
        return { opacity: 1, scale: 1, boxShadow: "0 1px 2px rgba(0,0,0,0.06)" };
    }
  })();

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(def.id)}
      animate={animate}
      className="relative w-[184px] rounded-xl border-2 bg-panel px-3 py-2 text-left outline-none"
      style={{
        borderColor: BORDER[status],
        outline: selected ? "2px solid var(--accent)" : "none",
        outlineOffset: 3,
        background: status === "running" ? "color-mix(in srgb, var(--accent) 7%, var(--panel))" : "var(--panel)",
      }}
    >
      {SIDES.map(([id, pos]) => (
        <Handle key={`t-${id}`} id={`t-${id}`} type="target" position={pos} style={hidden} isConnectable={false} />
      ))}
      {SIDES.map(([id, pos]) => (
        <Handle key={`s-${id}`} id={`s-${id}`} type="source" position={pos} style={hidden} isConnectable={false} />
      ))}

      <div className="flex items-center gap-1.5">
        <span
          className="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide"
          style={
            def.kind === "ai"
              ? { background: "var(--ai-soft)", color: "var(--ai)" }
              : { background: "var(--panel-2)", color: "var(--muted)" }
          }
        >
          {def.kind === "ai" ? "AI" : "code"}
        </span>
        <span className="truncate text-[13px] font-semibold text-ink">{def.label}</span>
        {run && run.attempt > 1 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="rounded-full bg-warn-soft px-1.5 text-[10px] font-bold text-warn"
          >
            ×{run.attempt}
          </motion.span>
        )}
      </div>
      <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted">{def.description}</div>
      <div className="mt-1.5 flex h-4 items-center justify-between text-[10px]">
        <StatusLine status={status} run={run} />
        {isStub && <span className="rounded bg-panel-2 px-1 text-muted">stub · Stage {def.stage}</span>}
      </div>

      <AnimatePresence>
        {(status === "done" || status === "failed") && (
          <motion.span
            key={status}
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 18 }}
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
            style={{ background: status === "done" ? "var(--ok)" : "var(--bad)" }}
          >
            {status === "done" ? "✓" : "!"}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function StatusLine({ status, run }: { status: NodeStatus; run?: NodeRun }) {
  if (status === "running")
    return (
      <span className="flex items-center gap-1 text-accent">
        <motion.span
          className="inline-block h-1.5 w-1.5 rounded-full bg-accent"
          animate={{ opacity: [1, 0.2, 1] }}
          transition={{ duration: 0.9, repeat: Infinity }}
        />
        working…
      </span>
    );
  if (status === "done") return <span className="text-ok">{String(run?.metrics?.ms ?? "")} ms</span>;
  if (status === "failed") return <span className="text-bad">failed</span>;
  if (status === "skipped") return <span className="text-muted">skipped</span>;
  return <span className="text-muted">waiting</span>;
}
