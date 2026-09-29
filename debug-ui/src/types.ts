// Shapes returned by the AI service's /dev/* routes (src/upsell_agent/api/dev.py).

export type NodeKind = "code" | "ai";
export type EdgeKind = "main" | "retry" | "fallback";

export interface PipelineNodeDef {
  id: string;
  label: string;
  kind: NodeKind;
  stage: number;
  description: string;
}

export interface PipelineEdgeDef {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
}

export interface Pipeline {
  nodes: PipelineNodeDef[];
  edges: PipelineEdgeDef[];
  decide_rules: { id: string; label: string }[];
  validate_checks: { id: string; label: string }[];
}

export type TraceEventType =
  | "turn_started"
  | "node_started"
  | "node_finished"
  | "node_failed"
  | "node_retry"
  | "node_skipped"
  | "turn_finished";

export interface TraceEvent {
  type: TraceEventType;
  seq: number;
  ts: string;
  turn_id: string;
  dealer_id: string;
  lead_id: string | null;
  node: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

export interface Dealer {
  id: string;
  name: string;
  // The timezone and opening hours the dealer's rules run in.
  time_zone?: string;
  hours?: Record<string, string>;
  hours_from_record?: boolean;
}

export type LeadStatus = "new" | "active" | "qualified" | "partly_qualified" | "handoff" | "paused" | "opted_out";

export interface Lead {
  id: string;
  customer_id: string;
  name: string;
  lead_type: string | null;
  channel: "sms" | "email";
  comments: string;
  status: LeadStatus;
  status_reason: string | null;
}

export interface ConversationItem {
  direction: "inbound" | "outbound";
  kind: "lead" | "message" | "draft";
  channel: "sms" | "email";
  text: string;
  at: string | null;
  turn_id?: string;
  outcome?: string;
  sent?: boolean;
  // Outbound messages: sent | failed | suppressed | shadow | unknown | "not sent" (a draft).
  status?: string;
  reason?: string | null;
  to?: string | null;
  latency_ms?: number | null;
  platform_record_id?: string | null;
}

export interface TurnSummary {
  turn_id: string;
  trigger: string;
  channel: string;
  outcome: string | null;
  created_at: string;
  ms: number | null;
}

export interface TurnDoc extends TurnSummary {
  events: TraceEvent[];
}

export type SlotState = "filled" | "missing" | "stale" | "needs_confirming";

export interface SlotHistory {
  value: unknown;
  source: string;
  valid_from: string;
  valid_to: string;
  rejected: boolean;
}

export interface Slot {
  path: string;
  label: string;
  group: string;
  value: unknown;
  // The value as a customer reads it ("Wednesday, September 23", "$35,000").
  display?: string;
  state: SlotState;
  source: "platform" | "customer" | null;
  source_message_id: string | null;
  quote: string | null;
  confidence: number | null;
  captured_at: string | null;
  history: SlotHistory[];
}

export interface Models {
  extract: string;
  compose: string;
}

export interface Ping {
  environment: string;
  now: string;
  models: Models;
  offline: boolean;
}

export interface ConversationAsk {
  path: string;
  label: string;
  count: number;
  last_reply: number;
  status: "just asked" | "asked out" | "";
}

export interface ConversationStateView {
  turn: number;
  asks: ConversationAsk[];
  last_asked: string[];
  open_questions: { text: string; label: string; asked_at: string | null; turn: number }[];
  promises: { text: string; made_at: string | null; turn: number }[];
  last_topic: string | null;
  max_asks: number;
  // MASTER_PLAN_3 B1: the "now or when we open?" choice.
  after_hours?: {
    choice: "offered" | "now" | "later";
    times_offered: number;
    offered_turn: number;
    decided_at: string | null;
    why: string | null;
  } | null;
  awaiting_contact_choice?: boolean;
}

export interface SummaryView {
  text: string;
  messages: number;
  updated_at: string | null;
  model: string | null;
}

export interface SlotsView {
  conversation?: ConversationStateView;
  pending_morning_message?: { due_at: string } | null;
  staff_notice?: { at: string; kind: string; text: string } | null;
  summary?: SummaryView;
  implemented: boolean;
  status: string;
  status_reason: string | null;
  lead_type: string;
  effective_lead_type: string;
  slots: Slot[];
  groups: { id: string; label: string }[];
  missing: { id: string; label: string; slots: string[] }[];
  required: { filled: number; total: number };
}

export type FollowupStatus =
  | "pending"
  | "claimed"
  | "sent"
  | "cancelled"
  | "superseded"
  | "suppressed"
  | "failed"
  | "unknown";

export interface Followup {
  id: string;
  // channel_switch: the 24h switch; handoff_check: the staff check after a handoff;
  // resume_at_opening: the after-hours morning message (MASTER_PLAN_3 B1).
  kind: "channel_switch" | "handoff_check" | "resume_at_opening";
  lead_id: string;
  source_message_id?: string;
  from_channel: "sms" | "email";
  to_channel: "sms" | "email";
  to?: string;
  text?: string;
  subject?: string | null;
  due_at: string;
  status: FollowupStatus;
  reason?: string | null;
  fired_at?: string;
  closed_at?: string;
}

export interface ScenarioStep {
  step: string;
  status: "passed" | "failed" | "skipped";
  detail: string;
}

export interface ScenarioRun {
  id: string;
  name: string;
  stage: number | null;
  passed: boolean;
  steps: ScenarioStep[];
  ms: number;
  last_run_at: string;
}

export interface Scenario {
  id: string;
  name: string;
  stage: number | null;
  description: string;
  steps: number;
  last_run: ScenarioRun | null;
}

export interface Metrics {
  dealer_id: string;
  days: number;
  since: string;
  first_reply_ms: { n: number; p50: number | null; p95: number | null; max: number | null; under_8s: number | null };
  turns: number;
  template_fallback: { turns: number; rate: number | null; template_first_replies_by_design: number };
  guard_failures: { drafts: number; turns: number; rate: number | null };
  rejected_extractions: { values: number; per_turn: number | null };
  cost_usd: { total: number; by_day: Record<string, number>; tokens_in: number; tokens_out: number };
  leads: {
    total: number;
    by_status: Record<string, number>;
    qualified_rate: number | null;
    handoff_rate: number | null;
    handoff_turns: number;
  };
  sends: Record<string, number>;
  followups: Record<string, number>;
}

export type Verdict = "better" | "same" | "worse" | "unsafe";

export interface ShadowPair {
  turn_id: string;
  lead_id: string;
  at: string;
  trigger: string | null;
  channel: "sms" | "email";
  customer: string[];
  ai: { text: string; outcome: string | null; used_fallback: boolean; guard_passed: boolean; asked: string[] };
  actual: { text: string; by: "n8n" | "staff"; channel: string; at: string } | null;
  review: { verdict: Verdict; note: string | null } | null;
}

export interface ShadowView {
  dealer_id: string;
  days: number;
  pairs: ShadowPair[];
  summary: { drafts: number; with_actual_reply: number; reviewed: number; verdicts: Record<Verdict, number> };
}

export interface RolloutCheck {
  dealer_id: string;
  ai_mode: "off" | "shadow" | "live";
  days: number;
  leads: number;
  passed: boolean;
  checks: Record<string, boolean>;
  platform_auto_messages: { lead_id: string; at: string; text: string }[];
  ai_double_sends: { lead_id: string; turn_id: string; sends: number }[];
  unanswered_messages: { lead_id: string; text: string; at: string }[];
  events_never_handled: { event: string; why: string }[];
}
