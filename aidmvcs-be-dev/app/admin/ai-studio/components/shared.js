"use client";
// AI Studio's shared pieces: the API helper, the plain-English labels, and the message block every step uses.
import { useRef } from "react";
import { Button, ButtonGroup, Form } from "react-bootstrap";

export const api = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("token")}`, ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { problems: data.problems });
  return data;
};

export const MODE_LABELS = { fixed: "Fixed text", ai: "AI writes it", fixed_opening_ai: "Fixed opening + AI" };

export const CONDITION_LABELS = {
  yes: "Customer says yes", no: "Customer says no", anything_else: "Customer says anything else",
  picks_a_time: "Customer picks a time", mentions_trade: "Customer mentions a trade-in",
  mentions_credit: "Customer mentions credit", mentions_price: "Customer mentions price / payment",
  no_reply: "No reply after…",
};

export const OUTCOME_LABELS = {
  ask: "Send the next message", ai: "AI carries on the conversation", book: "Book the time they picked",
  end: "End the workflow", escalate: "Dealership Action Required", set_status: "Set a status",
  call_task: "Create a call task",
};

export const STATUS_OPTIONS = ["Lead", "Lead Not Contacted", "Contacted - No Next Action",
  "Contacted - Specific Follow-up", "Appointment Booked", "No Show", "Visited", "DND", "Managerial Review",
  "Sold Pending", "Sold Delivered", "Unsold", "Closed - Lost"];

const SAMPLE = {
  first_name: "Maria", dealership: "Victory Cars Central", agent_name: "Nicole", vehicle: "2024 Toyota RAV4 XLE",
  model: "RAV4", price: "$31,995", price_line: "It's listed at $31,995, not including tax, documentation and DMV fees.",
  times: "Saturday at 10:00 AM or Sunday at 1:00 PM", date: "Saturday, October 17", time: "10:00 AM",
  address: "3914 Hempstead Tpke, Levittown", ask_for: "Mercy", dealer_phone: "(347) 658-5466",
  credit_app_link: "https://dealer.example/credit", vehicle_link: "https://dealer.example/vdp/rav4",
  opens_at: "9:00 AM tomorrow", recommended_work: "front brake pads",
};
export const fill = (text) => String(text || "").replace(/\{([a-z_]+)\}/g, (m, k) => SAMPLE[k] ?? m);
export const when = (d) => (d ? new Date(d).toLocaleString() : "");
export const clone = (x) => JSON.parse(JSON.stringify(x ?? null));

export function MessageBlock({ message, onChange, placeholders, readOnly, compact }) {
  const focused = useRef("text");
  const m = message || { mode: "fixed" };
  const set = (patch) => onChange({ ...m, ...patch });
  const field = (name, label, rows = 3, hint) => (
    <Form.Group className="mb-2">
      <Form.Label className="small fw-semibold mb-1">{label}</Form.Label>
      <Form.Control as="textarea" rows={rows} value={m[name] || ""} disabled={readOnly}
        onFocus={() => { focused.current = name; }} onChange={(e) => set({ [name]: e.target.value })} />
      {hint && <Form.Text muted>{hint}</Form.Text>}
    </Form.Group>
  );
  return (
    <div>
      <ButtonGroup size="sm" className="mb-2">
        {Object.entries(MODE_LABELS).map(([mode, label]) => (
          <Button key={mode} variant={m.mode === mode ? "primary" : "outline-primary"} disabled={readOnly}
            onClick={() => set({ mode })}>{label}</Button>
        ))}
      </ButtonGroup>
      {!readOnly && (
        <div className="d-flex flex-wrap gap-1 mb-2">
          {Object.entries(placeholders || {}).map(([k, label]) => (
            <Button key={k} size="sm" variant="outline-secondary" className="py-0 px-1" title={label}
              onClick={() => set({ [focused.current]: `${m[focused.current] || ""}{${k}}` })}>{`{${k}}`}</Button>
          ))}
        </div>
      )}
      {m.mode !== "ai" && field("text", m.mode === "fixed" ? "Message (sent exactly as written)" : "Fixed opening", 3)}
      {m.mode !== "fixed" && field("instruction", "What the AI should write, in plain English", 2,
        "e.g. \"Ask if they need help with financing. Mention their trade if they have one.\"")}
      {!compact && m.mode === "fixed" && field("email_subject", "Email subject", 1)}
      {!compact && m.mode === "fixed" && field("email_text", "Email (empty: same as the text message)", 3)}
      {field("fallback", "Backup message (sent if the AI's draft fails its safety checks)", 2)}
      {(m.text || m.fallback) && (
        <div className="small p-2 bg-white border rounded" style={{ whiteSpace: "pre-line" }}>
          <span className="text-muted">Preview: </span>{fill(m.text || m.fallback)}
          {m.mode === "fixed_opening_ai" ? " … (the AI continues)" : ""}
        </div>
      )}
    </div>
  );
}

// One-line summary of a message, for cards and tree nodes.
export const summary = (message) => {
  if (!message) return "(no message)";
  if (message.mode === "ai") return `AI writes: ${message.instruction || ""}`;
  return fill(message.text || message.fallback || "");
};
