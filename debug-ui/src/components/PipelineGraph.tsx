import { Background, Controls, MarkerType, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useMemo } from "react";

import type { TurnView } from "../trace/reducer";
import type { Pipeline } from "../types";
import { AnimatedEdge, type PipelineFlowEdge } from "./AnimatedEdge";
import { PipelineNode, type PipelineFlowNode } from "./PipelineNode";

// Two rows, like the plan's sketch: decisions left→right on top, then the
// reply comes back right→left underneath, with the fallback template below.
const POSITIONS: Record<string, { x: number; y: number }> = {
  load_context: { x: 0, y: 0 },
  extract: { x: 240, y: 0 },
  validate: { x: 480, y: 0 },
  decide: { x: 720, y: 0 },
  compose: { x: 720, y: 200 },
  guard: { x: 480, y: 200 },
  send: { x: 240, y: 200 },
  schedule: { x: 0, y: 200 },
  fallback: { x: 360, y: 360 },
  // Not part of a turn: the 24h channel switch firing, which goes straight to Send.
  followup: { x: 20, y: 360 },
};

// Which side of each node an edge leaves from / arrives at.
const HANDLES: Record<string, [string, string]> = {
  "load_context-extract": ["s-r", "t-l"],
  "load_context-fallback": ["s-b", "t-l"],
  "extract-fallback": ["s-b", "t-t"],
  "extract-validate": ["s-r", "t-l"],
  "validate-decide": ["s-r", "t-l"],
  "decide-compose": ["s-b", "t-t"],
  "compose-guard": ["s-l", "t-r"],
  "guard-send": ["s-l", "t-r"],
  "guard-compose": ["s-t", "t-t"],
  "guard-fallback": ["s-b", "t-r"],
  "fallback-send": ["s-l", "t-b"],
  "send-schedule": ["s-l", "t-r"],
  "followup-send": ["s-r", "t-b"],
};

const nodeTypes = { pipeline: PipelineNode };
const edgeTypes = { animated: AnimatedEdge };

interface Props {
  pipeline: Pipeline;
  view: TurnView;
  selectedNode: string | null;
  onSelectNode: (id: string) => void;
}

function Graph({ pipeline, view, selectedNode, onSelectNode }: Props) {
  const nodes = useMemo<PipelineFlowNode[]>(
    () =>
      pipeline.nodes.map((def) => ({
        id: def.id,
        type: "pipeline",
        position: POSITIONS[def.id] ?? { x: 0, y: 480 },
        data: { def, run: view.nodes[def.id], selected: selectedNode === def.id, onSelect: onSelectNode },
        draggable: false,
      })),
    [pipeline, view.nodes, selectedNode, onSelectNode],
  );

  const edges = useMemo<PipelineFlowEdge[]>(() => {
    const travelled = new Set(view.travelled);
    return pipeline.edges.map((e) => {
      const [sourceHandle, targetHandle] = HANDLES[e.id] ?? ["s-r", "t-l"];
      const color = travelled.has(e.id) ? (e.kind === "main" ? "var(--accent)" : "var(--warn)") : "var(--idle)";
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle,
        targetHandle,
        type: "animated",
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        data: { kind: e.kind, travelled: travelled.has(e.id), active: view.activeEdge, retries: view.retries },
      };
    });
  }, [pipeline, view.travelled, view.activeEdge, view.retries]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      nodesConnectable={false}
      elementsSelectable={false}
      proOptions={{ hideAttribution: true }}
      minZoom={0.4}
      maxZoom={1.6}
    >
      <Background gap={20} size={1} color="var(--grid)" />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}

export function PipelineGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}
