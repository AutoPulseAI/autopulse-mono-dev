import { AnimatePresence, motion } from "framer-motion";

import type { Slot, SlotState, SlotsView } from "../types";
import { StatusBadge } from "./ui";

const STATE_STYLE: Record<SlotState, { bg: string; fg: string; border: string; label: string }> = {
  filled: { bg: "var(--ok-soft)", fg: "var(--ok)", border: "var(--ok)", label: "filled" },
  needs_confirming: { bg: "var(--warn-soft)", fg: "var(--warn)", border: "var(--warn)", label: "confirming" },
  stale: { bg: "var(--panel-2)", fg: "var(--muted)", border: "var(--border)", label: "stale · will re-ask" },
  missing: { bg: "transparent", fg: "var(--muted)", border: "var(--border)", label: "still to ask" },
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return value.toLocaleString();
  return String(value).replaceAll("_", " ");
}

function tooltip(slot: Slot): string {
  const lines = [`${slot.label} (${slot.path})`];
  if (slot.source === "platform") lines.push("From the platform (Customer 360)");
  if (slot.quote) lines.push(`Customer said: "${slot.quote}"`);
  if (slot.confidence != null) lines.push(`Confidence ${Math.round(slot.confidence * 100)}%`);
  if (slot.captured_at) lines.push(`Captured ${new Date(slot.captured_at).toLocaleString()}`);
  for (const h of slot.history) {
    lines.push(`Earlier: ${formatValue(h.value)}${h.rejected ? " (customer said wrong)" : ""} until ${new Date(h.valid_to).toLocaleDateString()}`);
  }
  return lines.join("\n");
}

export function SlotsPanel({ slots }: { slots: SlotsView | null }) {
  const pct = slots && slots.required.total ? (slots.required.filled / slots.required.total) * 100 : 0;
  const groups = (slots?.groups ?? []).filter((g) => slots?.slots.some((s) => s.group === g.id));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Slots</div>
        {slots && (
          <>
            <span className="rounded bg-panel-2 px-1.5 text-[10px] font-semibold text-muted">
              {slots.effective_lead_type.replace("_", "-")}
              {slots.effective_lead_type !== slots.lead_type && ` (was ${slots.lead_type})`}
            </span>
            <StatusBadge status={slots.status} />
            {slots.status_reason && <span className="truncate text-[10px] text-muted">{slots.status_reason}</span>}
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-muted">
            {slots?.required.filled ?? 0} of {slots?.required.total ?? 0} required
          </span>
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-panel-2">
            <motion.div
              className="h-full rounded-full"
              style={{ background: pct >= 100 ? "var(--ok)" : "var(--accent)" }}
              animate={{ width: `${pct}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />
          </div>
        </div>
      </div>
      <div className="scroll-thin flex flex-1 gap-3 overflow-x-auto overflow-y-auto p-2">
        {!slots || slots.slots.length === 0 ? (
          <div className="text-[12px] text-muted">No slots captured yet for this lead.</div>
        ) : (
          groups.map((group) => (
            <div key={group.id} className="min-w-[150px]">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">{group.label}</div>
              <div className="flex flex-col gap-1">
                <AnimatePresence>
                  {slots.slots
                    .filter((s) => s.group === group.id)
                    .map((slot) => {
                      const s = STATE_STYLE[slot.state];
                      return (
                        <motion.div
                          key={slot.path}
                          layout
                          initial={{ opacity: 0, scale: 0.7 }}
                          animate={{ opacity: 1, scale: 1, backgroundColor: s.bg, borderColor: s.border }}
                          exit={{ opacity: 0, scale: 0.7 }}
                          transition={{ type: "spring", stiffness: 400, damping: 28 }}
                          className="rounded-lg border px-2 py-1"
                          style={{ borderStyle: slot.state === "missing" ? "dashed" : "solid" }}
                          title={tooltip(slot)}
                        >
                          <div className="flex items-center gap-1 text-[10px] text-muted">
                            <span className="truncate">{slot.label}</span>
                            {slot.source && (
                              <span
                                className="shrink-0 rounded px-1 text-[9px] font-bold"
                                style={
                                  slot.source === "platform"
                                    ? { background: "var(--ai-soft)", color: "var(--ai)" }
                                    : { background: "var(--accent-soft)", color: "var(--accent)" }
                                }
                              >
                                {slot.source === "platform" ? "DMS" : "said"}
                              </span>
                            )}
                            {slot.history.length > 0 && <span className="shrink-0 text-warn">↻{slot.history.length}</span>}
                          </div>
                          <div className="text-[12px] font-semibold" style={{ color: slot.state === "missing" ? "var(--muted)" : "var(--text)" }}>
                            {formatValue(slot.value)}
                            <span className="ml-1.5 text-[10px] font-medium" style={{ color: s.fg }}>
                              {s.label}
                            </span>
                          </div>
                        </motion.div>
                      );
                    })}
                </AnimatePresence>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
