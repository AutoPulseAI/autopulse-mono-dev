import { AnimatePresence, motion } from "framer-motion";

import { formatDate, formatDateTime } from "../time";
import type { LifecycleView, Slot, SlotState, SlotsView } from "../types";
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
  if (slot.captured_at) lines.push(`Captured ${formatDateTime(slot.captured_at)}`);
  for (const h of slot.history) {
    lines.push(`Earlier: ${formatValue(h.value)}${h.rejected ? " (customer said wrong)" : ""} until ${formatDate(h.valid_to)}`);
  }
  return lines.join("\n");
}

// MASTER_PLAN_3 C3: the lifecycle stage, coloured by how far along the lead is; hover for the history.
const STAGE_COLOUR: Record<string, string> = {
  new_lead: "var(--muted)", no_contact_made: "var(--warn)", contact_made_no_next_action: "var(--accent)",
  contact_made_specific_followup: "var(--ai)", appointment_set: "var(--ok)", appointment_no_show: "var(--warn)",
  sales_visit: "var(--ok)", opted_out: "var(--bad)", closed_lost: "var(--bad)",
};

// MASTER_PLAN_3 C5: the appointment's confirmation, in a word.
function confirmationWord(appt: NonNullable<LifecycleView["appointment"]>): string {
  if (appt.showed) return "showed";
  if (appt.confirmed) return "confirmed";
  const c = appt.confirmation;
  if (c?.status === "declined") return "said N";
  if (c?.status === "asked") return c.asked_again ? "asked twice" : "asked Y/N";
  return "not asked yet";
}

function StageBadge({ lifecycle }: { lifecycle: LifecycleView }) {
  const colour = STAGE_COLOUR[lifecycle.stage ?? ""] ?? "var(--muted)";
  const lines = [
    `${lifecycle.label}${lifecycle.since ? ` since ${formatDateTime(lifecycle.since)}` : ""}`,
    lifecycle.reason ? `Why: ${lifecycle.reason}` : "",
    lifecycle.opportunity_age_days != null ? `Opportunity day ${lifecycle.opportunity_age_days + 1} of 91` : "",
    lifecycle.next_action ? `Next step: ${lifecycle.next_action.display} at ${lifecycle.next_action.time} ` +
      `(${lifecycle.next_action.call_requested ? "asked for a call" : lifecycle.next_action.channel}; ` +
      `"${lifecycle.next_action.words}")` : "",
    lifecycle.appointment?.at ? `Appointment: ${formatDateTime(lifecycle.appointment.at)} (${confirmationWord(lifecycle.appointment)})` +
      `${lifecycle.appointment.booking_id ? `, booking ${lifecycle.appointment.booking_id}` : ""}` : "",
    ...(lifecycle.history.length ? ["", "History:"] : []),
    ...lifecycle.history.slice().reverse().map((h) =>
      `${formatDateTime(h.at)}  ${h.from ?? "—"} → ${h.to}  (${h.rule}, ${h.source}): ${h.reason}`),
  ].filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== ""));
  return (
    <span className="shrink-0 rounded px-1.5 text-[10px] font-bold"
          style={{ color: colour, border: `1px solid ${colour}` }} title={lines.join("\n")}>
      {lifecycle.label}
      {lifecycle.next_action && <span className="ml-1 font-medium">· {lifecycle.next_action.display}</span>}
      {lifecycle.appointment?.at && <span className="ml-1 font-medium">· {confirmationWord(lifecycle.appointment)}</span>}
    </span>
  );
}

export function SlotsPanel({ slots }: { slots: SlotsView | null }) {
  const pct = slots && slots.required.total ? (slots.required.filled / slots.required.total) * 100 : 0;
  const groups = (slots?.groups ?? []).filter((g) => slots?.slots.some((s) => s.group === g.id));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Slots</div>
        {slots && (
          <>
            <span className="rounded bg-panel-2 px-1.5 text-[10px] font-semibold text-muted">
              {slots.effective_lead_type.replace("_", "-")}
              {slots.effective_lead_type !== slots.lead_type && ` (was ${slots.lead_type})`}
            </span>
            <StatusBadge status={slots.status} />
            {slots.lifecycle?.stage && <StageBadge lifecycle={slots.lifecycle} />}
            {slots.cadence && (
              <span
                className="shrink-0 rounded bg-panel-2 px-1.5 text-[10px] font-semibold text-muted"
                title={slots.cadence.next_touch
                  ? `Next: touch ${slots.cadence.next_touch.touch_number} (${slots.cadence.next_touch.theme_label}), cadence day ` +
                    `${slots.cadence.next_touch.day}, ${formatDateTime(slots.cadence.next_touch.due_at)}
${slots.cadence.next_touch.why}`
                  : "No follow-up touch is scheduled"}
              >
                cadence day {slots.cadence.day}
                {slots.cadence.next_touch ? ` · next: ${slots.cadence.next_touch.theme_label}` : " · idle"}
              </span>
            )}
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
      <div className="scroll-thin flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-auto p-2">
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
                            {slot.display || formatValue(slot.value)}
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
