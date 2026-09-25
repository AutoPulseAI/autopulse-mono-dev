import type { LeadStatus } from "../types";

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  new: { bg: "var(--panel-2)", fg: "var(--muted)", label: "new" },
  active: { bg: "var(--accent-soft)", fg: "var(--accent)", label: "AI active" },
  qualified: { bg: "var(--ok-soft)", fg: "var(--ok)", label: "qualified" },
  handoff: { bg: "var(--warn-soft)", fg: "var(--warn)", label: "handed off" },
  paused: { bg: "var(--warn-soft)", fg: "var(--warn)", label: "paused" },
  opted_out: { bg: "var(--bad-soft)", fg: "var(--bad)", label: "opted out" },
};

export function StatusBadge({ status }: { status: LeadStatus | string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.new;
  return (
    <span className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold" style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

const OUTCOME_COLOR: Record<string, string> = {
  ask: "var(--accent)",
  template_reply: "var(--ok)",
  confirm: "var(--warn)",
  qualified: "var(--ok)",
  handoff: "var(--warn)",
  stop: "var(--bad)",
  fallback: "var(--warn)",
  error: "var(--bad)",
};

export function outcomeColor(outcome: string | null | undefined): string {
  return (outcome && OUTCOME_COLOR[outcome]) || "var(--muted)";
}
