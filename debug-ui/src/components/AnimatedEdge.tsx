import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import { motion, useReducedMotion } from "framer-motion";

import type { ActiveEdge } from "../trace/reducer";
import type { EdgeKind } from "../types";

export type PipelineEdgeData = {
  kind: EdgeKind;
  travelled: boolean;
  active: ActiveEdge | null;
  retries: number;
};

export type PipelineFlowEdge = Edge<PipelineEdgeData, "animated">;

const COLOR: Record<EdgeKind, string> = {
  main: "var(--accent)",
  retry: "var(--warn)",
  fallback: "var(--warn)",
};

export function AnimatedEdge(props: EdgeProps<PipelineFlowEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  const reduced = useReducedMotion();
  const kind = data?.kind ?? "main";
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: kind === "retry" ? 0.9 : 0.35,
  });
  const active = data?.active?.id === id ? data.active : null;
  const travelled = Boolean(data?.travelled);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={travelled ? "edge-travelled" : undefined}
        style={{
          stroke: travelled ? COLOR[kind] : "var(--idle)",
          strokeWidth: travelled ? 2.25 : 1.5,
          strokeDasharray: !travelled && kind !== "main" ? "4 5" : undefined,
          opacity: travelled || kind === "main" ? 1 : 0.55,
          transition: "stroke 300ms, opacity 300ms",
        }}
      />
      <EdgeLabelRenderer>
        {kind === "retry" && (data?.retries ?? 0) > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="nodrag nopan pointer-events-none absolute rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-bold text-warn"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            ↺ rewrite ×{data?.retries}
          </motion.div>
        )}
        {active &&
          (reduced ? (
            <div
              className="nodrag nopan pointer-events-none absolute rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
              style={{
                background: COLOR[kind],
                transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              }}
            >
              {active.label || "→"}
            </div>
          ) : (
            <motion.div
              key={active.seq}
              className="nodrag nopan pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow-md"
              style={{ background: COLOR[kind], offsetPath: `path("${path}")`, offsetRotate: "0deg" }}
              initial={{ offsetDistance: "0%", opacity: 0, scale: 0.6 }}
              animate={{ offsetDistance: "100%", opacity: [0, 1, 1, 0], scale: 1 }}
              transition={{ duration: 0.9, ease: "easeInOut", opacity: { times: [0, 0.1, 0.8, 1], duration: 0.9 } }}
            >
              {active.label || "→"}
            </motion.div>
          ))}
      </EdgeLabelRenderer>
    </>
  );
}
