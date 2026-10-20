"use client";
// AI Studio's shared pieces: the API helper, the plain-English labels, and the message block every step uses.
import { useRef } from "react";
import { Button, ButtonGroup, Form } from "react-bootstrap";

export const api = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("token")}`, ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { problems: data.problems, data });
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
  trim: "XLE", mileage: "24,850 miles", color: "Magnetic Gray", vin: "2T3P1RFV8RW123456",
};
export const fill = (text) => String(text || "").replace(/\{([a-z_]+)\}/g, (m, k) => SAMPLE[k] ?? m);
// Every time in AI Studio, the same for everyone wherever they are (client, 13 Oct 2026): the dealership's time
// (New York) and UTC, e.g. "Oct 13, 2026, 5:43 PM ET (21:43 UTC)".
export const STUDIO_TZ = "America/New_York";
export const when = (d) => {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  const local = t.toLocaleString("en-US", { timeZone: STUDIO_TZ, month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit" });
  const zone = t.toLocaleString("en-US", { timeZone: STUDIO_TZ, timeZoneName: "short" }).split(" ").pop()
    .replace(/^E[SD]T$/, "ET");
  const utc = t.toLocaleString("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
  return `${local} ${zone} (${utc} UTC)`;
};
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

// A built-in match pattern, as the plain words and phrases it looks for ("\b(credit|approv\w*|bad credit)\b" ->
// ["credit", "approv…", "bad credit"]) - nobody should have to read a pattern.
const splitTop = (text) => {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "|" && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  return parts;
};

// "financ\w* (with|for) (bad|low|no)" -> every combination, as plain words.
const expand = (text) => {
  const m = text.match(/\((?:\?:)?([^()]*)\)\??/);
  if (!m) return [text];
  const optional = m[0].endsWith("?");
  const choices = [...splitTop(m[1]), ...(optional ? [""] : [])];
  return choices.flatMap((c) => expand(text.replace(m[0], c))).slice(0, 24);
};

const tidy = (raw) => raw
  .replace(/\\b|\^|\$/g, "")
  .replace(/\\s[+*]?|\\W\{[^}]*\}|\[\\s_-\]\*|\[\\s-\]\??/g, " ")
  .replace(/\\w\*|\\w\+/g, "…")
  .replace(/\\d\{?\d*,?\d*\}?/g, "#")
  .replace(/(.)\?/g, "$1")
  .replace(/\\(.)/g, "$1")
  .replace(/\[[^\]]*\]/g, "")
  .replace(/\{\d*,?\d*\}/g, "")
  .replace(/\s+/g, " ")
  .trim();

// A built-in match pattern, as the plain words and phrases it looks for ("\b(credit|approv\w*|bad credit)\b" ->
// ["credit", "approv…", "bad credit"]) - nobody should have to read a pattern.
export function patternToWords(pattern) {
  let text = String(pattern || "").trim();
  const outer = text.match(/^\\b\((.*)\)\\b$/);
  if (outer && !/^\\b\(.*\)\\b\|/.test(text)) text = outer[1];
  const words = splitTop(text).flatMap(expand).map(tidy).filter((w) => w.length > 1 && !/[\\[\]{}()|]/.test(w));
  return [...new Set(words)];
}

export function WordChips({ words, onChange, readOnly, placeholder = "Add a word or phrase and press Enter" }) {
  const add = (e) => {
    if (e.key !== "Enter" && e.key !== ",") return;
    e.preventDefault();
    const value = e.currentTarget.value.trim();
    if (value && !words.includes(value)) onChange([...words, value]);
    e.currentTarget.value = "";
  };
  return (
    <div className="border rounded p-2 bg-white">
      <div className="d-flex flex-wrap gap-1">
        {words.map((w) => (
          <span key={w} className="badge rounded-pill text-bg-light border d-inline-flex align-items-center gap-1"
            style={{ fontSize: 13, fontWeight: 500 }}>
            {w}
            {!readOnly && <span role="button" className="text-danger" onClick={() => onChange(words.filter((x) => x !== w))}>
              ✕</span>}
          </span>
        ))}
        {!readOnly && <input onKeyDown={add} placeholder={placeholder} className="border-0 flex-grow-1"
          style={{ minWidth: 220, outline: "none", fontSize: 13 }} />}
      </div>
    </div>
  );
}

export function HowTo({ children }) {
  return <div className="small p-2 mb-3 rounded" style={{ background: "#fff8e6", border: "1px solid #f3dfa3" }}>
    <strong>How to edit: </strong>{children}</div>;
}
