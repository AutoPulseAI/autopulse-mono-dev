import type { SlotsView } from "../types";

// What the AI remembers about the conversation itself (MASTER_PLAN_2 Phase 9):
// what it asked and how often, the customer's open questions, what it promised,
// and the rolling summary of older messages.
export function ConversationPanel({ slots }: { slots: SlotsView | null }) {
  const c = slots?.conversation;
  if (!c) {
    return <div className="border-l border-line p-3 text-[11px] text-muted">No conversation yet.</div>;
  }
  return (
    <div className="scroll-thin min-h-0 space-y-2 overflow-y-auto border-l border-line p-2 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Conversation</span>
        <span className="text-muted">{c.turn} repl{c.turn === 1 ? "y" : "ies"} sent</span>
      </div>

      <Section title={`Asked (at most ${c.max_asks} times each)`}>
        {c.asks.length === 0 ? (
          <Empty>nothing yet</Empty>
        ) : (
          c.asks.map((a) => (
            <div key={a.path} className="flex items-center justify-between gap-2">
              <span className="truncate" title={a.path}>{a.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {a.status && (
                  <span
                    className="rounded px-1 text-[10px]"
                    style={{
                      background: a.status === "asked out" ? "var(--warn-soft)" : "var(--accent-soft)",
                      color: a.status === "asked out" ? "var(--warn)" : "var(--accent)",
                    }}
                  >
                    {a.status}
                  </span>
                )}
                <span className="tabular-nums text-muted" title={`last asked in reply #${a.last_reply}`}>x{a.count}</span>
              </span>
            </div>
          ))
        )}
      </Section>

      <Section title="Open questions">
        {c.open_questions.length === 0 ? (
          <Empty>none</Empty>
        ) : (
          c.open_questions.map((q, i) => (
            <div key={i}>
              "{q.text}" <span className="rounded bg-panel-2 px-1 text-[10px] text-muted">{q.label.replaceAll("_", " ")}</span>
            </div>
          ))
        )}
      </Section>

      <Section title="Promised">
        {c.promises.length === 0 ? <Empty>nothing</Empty> : c.promises.map((p, i) => <div key={i}>{p.text}</div>)}
      </Section>

      {c.after_hours && (
        <Section title="After hours (now or when we open?)">
          <div>
            <span className="rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent">
              {c.after_hours.choice === "offered" ? "offered, no answer yet" : c.after_hours.choice}
            </span>{" "}
            <span className="text-muted">
              offered x{c.after_hours.times_offered}
              {c.awaiting_contact_choice ? " · our last reply asked it" : ""}
            </span>
          </div>
          {c.after_hours.why && <div className="text-muted">{c.after_hours.why}</div>}
          {slots?.pending_morning_message && (
            <div>Morning message due {new Date(slots.pending_morning_message.due_at).toLocaleString()}</div>
          )}
        </Section>
      )}

      {(c.visit || slots?.booking || slots?.pending_visit_followup) && (
        <Section title="Visit / booking">
          {c.visit && (
            <>
              <div>
                <span className="rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent">
                  {c.visit.stopped
                    ? "declined 3 times: no more offers"
                    : c.visit.declined
                      ? `declined, parked (attempt ${c.visit.attempts} of 3)`
                      : `offered (attempt ${c.visit.attempts} of 3)`}
                </span>{" "}
                <span className="text-muted">
                  angles: {c.visit.angles_used.join(" → ").replaceAll("_", " ") || "none"}
                  {c.awaiting_visit_pick ? " · our last reply offered times" : ""}
                </span>
              </div>
              {c.visit.offered_times.length > 0 && (
                <div>Times offered: {c.visit.offered_times.map((t) => t.display).join(", ")}</div>
              )}
              {c.visit.pending_pick && (
                <div>Picked {c.visit.pending_pick.display}, waiting for their email or phone to book it</div>
              )}
              {c.visit.objections.length > 0 && (
                <div className="text-muted">Objections: {c.visit.objections.join(", ").replaceAll("_", " ")}</div>
              )}
              {c.visit.why && <div className="text-muted">{c.visit.why}</div>}
            </>
          )}
          {slots?.booking && (
            <div>
              Booking{" "}
              <span className="rounded bg-panel-2 px-1 text-[10px] font-semibold">{slots.booking.status}</span>{" "}
              {new Date(slots.booking.date).toLocaleDateString(undefined, { timeZone: "UTC" })} at {slots.booking.time}
              {slots.booking.notes && <span className="text-muted"> · {slots.booking.notes}</span>}
            </div>
          )}
          {slots?.pending_visit_followup && (
            <div>Fresh visit offer due {new Date(slots.pending_visit_followup.due_at).toLocaleString()}</div>
          )}
        </Section>
      )}

      {slots?.staff_notice && (
        <Section title="Notice for the team">
          <div className="rounded bg-warn-soft p-1.5 text-warn">{slots.staff_notice.text}</div>
          <div className="text-[10px] text-muted">
            Kept on the AI's lead state only: the platform doesn't show these notices yet.
          </div>
        </Section>
      )}

      {c.last_topic && (
        <Section title="Last reply was about">
          <div>{c.last_topic}</div>
        </Section>
      )}

      <Section title={slots?.summary?.text ? `Summary of ${slots.summary.messages} older message(s)` : "Summary"}>
        {slots?.summary?.text ? (
          <div className="whitespace-pre-wrap rounded bg-panel-2 p-1.5">{slots.summary.text}</div>
        ) : (
          <Empty>not needed yet (the whole conversation fits)</Empty>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 font-semibold">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-muted">{children}</div>;
}
