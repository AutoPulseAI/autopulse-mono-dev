// Turns a stream of trace events into what the pipeline diagram shows.
// Live events and replayed events go through this same function, so a replay
// looks exactly like the turn did when it happened.

import type { Pipeline, TraceEvent } from "../types";

export type NodeStatus = "idle" | "running" | "done" | "failed" | "skipped";

export interface NodeRun {
  status: NodeStatus;
  attempt: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output?: any;
  reasoning?: string[] | string | null;
  metrics?: Record<string, unknown>;
  error?: string;
  edgeLabel?: string | null;
  skippedReason?: string;
}

export interface ActiveEdge {
  id: string;
  label: string;
  kind: "main" | "retry" | "fallback";
  seq: number; // changes on every hop so the chip animation restarts
}

export interface TurnView {
  turnId: string | null;
  leadId: string | null;
  trigger: string | null;
  channel: string | null;
  outcome: string | null;
  finished: boolean;
  nodes: Record<string, NodeRun>;
  attempts: Record<string, NodeRun[]>; // every attempt, for compose/guard rewrites
  travelled: string[]; // edge ids in the order they were used
  activeEdge: ActiveEdge | null;
  lastNode: string | null;
  lastEvent: TraceEvent | null;
  retries: number;
  ms: number | null;
}

export const emptyView = (): TurnView => ({
  turnId: null,
  leadId: null,
  trigger: null,
  channel: null,
  outcome: null,
  finished: false,
  nodes: {},
  attempts: {},
  travelled: [],
  activeEdge: null,
  lastNode: null,
  lastEvent: null,
  retries: 0,
  ms: null,
});

function findEdge(pipeline: Pipeline, source: string | null, target: string) {
  if (!source) return undefined;
  return pipeline.edges.find((e) => e.source === source && e.target === target);
}

export function reduce(pipeline: Pipeline, view: TurnView, event: TraceEvent): TurnView {
  if (event.type === "turn_started") {
    return {
      ...emptyView(),
      turnId: event.turn_id,
      leadId: event.lead_id,
      trigger: event.data.trigger ?? null,
      channel: event.data.channel ?? null,
      lastEvent: event,
    };
  }
  if (view.turnId && event.turn_id !== view.turnId) return view; // a different turn

  const node = event.node ?? "";
  const next: TurnView = { ...view, lastEvent: event, nodes: { ...view.nodes }, attempts: { ...view.attempts } };

  switch (event.type) {
    case "node_started": {
      const edge = findEdge(pipeline, view.lastNode, node);
      if (edge) {
        const label = view.nodes[view.lastNode ?? ""]?.edgeLabel ?? "";
        next.activeEdge = { id: edge.id, label, kind: edge.kind, seq: event.seq };
        next.travelled = [...view.travelled, edge.id];
      }
      next.nodes[node] = { status: "running", attempt: event.data.attempt ?? 1, input: event.data.input };
      return next;
    }
    case "node_finished": {
      const run: NodeRun = {
        ...view.nodes[node],
        status: "done",
        attempt: event.data.attempt ?? 1,
        output: event.data.output,
        reasoning: event.data.reasoning,
        metrics: event.data.metrics,
        edgeLabel: event.data.edge_label,
      };
      next.nodes[node] = run;
      next.attempts[node] = [...(view.attempts[node] ?? []), run];
      next.lastNode = node;
      return next;
    }
    case "node_failed":
      next.nodes[node] = { ...view.nodes[node], status: "failed", attempt: event.data.attempt ?? 1, error: event.data.error };
      next.lastNode = node;
      return next;
    case "node_retry": {
      // Guard sent the draft back: show the loop edge and reset the target so it can run again.
      next.retries = view.retries + 1;
      const target = event.data.target as string;
      next.nodes[node] = { ...view.nodes[node], edgeLabel: `rewrite: ${event.data.reason ?? ""}` };
      if (next.nodes[target]) next.nodes[target] = { ...next.nodes[target], status: "idle" };
      return next;
    }
    case "node_skipped":
      next.nodes[node] = { status: "skipped", attempt: 0, skippedReason: event.data.reason };
      return next;
    case "turn_finished":
      next.finished = true;
      next.outcome = event.data.outcome ?? null;
      next.ms = event.data.ms ?? null;
      next.activeEdge = null;
      return next;
    default:
      return next;
  }
}

export function reduceAll(pipeline: Pipeline, events: TraceEvent[]): TurnView {
  return events.reduce((view, e) => reduce(pipeline, view, e), emptyView());
}
