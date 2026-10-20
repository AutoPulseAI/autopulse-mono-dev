"use client";
// AI Studio: the SMS / email / compliance rules (client, 13 Oct 2026: "each and every rule ... add, update, delete").
// Texting hours can move inside the federal 8 AM - 9 PM window; the AI never texts outside it whatever is saved.
import { Button, Form, Table } from "react-bootstrap";
import { HowTo, WordChips } from "./shared";

const LABELS = {
  reply_window: ["Replies to the customer", "When the AI may answer a customer by text."],
  first_message_window: ["First message to a new lead", "When the first text to a new lead may go out."],
  follow_up_window: ["Follow-ups (cadence texts)", "When follow-up texts the AI starts may go out."],
  follow_up_texts_per_period: ["Follow-up texts allowed", "At most this many follow-up texts…"],
  period_hours: ["…in this many hours", ""],
  dnd_statuses: ["Statuses that mean Do Not Disturb", "A lead with one of these statuses is never messaged."],
  stop_words: ["STOP words", "A message that is only one of these stops texts on that channel."],
  start_words: ["START words", "A message that is only one of these turns texts back on."],
  extra_stop_phrases: ["Extra opt-out phrases", "If a message includes any of these, the customer is opted out of everything."],
  confirmation: ["Confirmation sent after an opt-out", ""],
  invite: ["Invite sent by email (Text YES…)", "Placeholders: {number} = the dealership's texting number."],
  first_channel: ["New leads hear from us first by", ""],
  at_night: ["A lead that comes in outside texting hours", ""],
  placeholder_emails: ["Email addresses never used", "An address starting with one of these (no-reply@…) is skipped."],
  customer_texts: ["Contacted when the customer sent at least this many texts", ""],
  customer_emails: ["…or at least this many emails", ""],
  note: ["Note", ""],
  sms_max_characters: ["Longest text message (characters)", "Longer drafts are rewritten shorter."],
  first_text_max_characters: ["Longest first text (characters)", ""],
  cars_per_text: ["Most cars named in one text", ""],
  cars_per_email: ["Most cars named in one email", ""],
  banned_phrases: ["Phrases the AI must never say", "A draft that uses one is rewritten before it is sent."],
  questions_per_message: ["Questions the AI asks per message (1-3)",
    "Betsy's rule is 1. A required question (the first text's closing question, the after-hours choice) can come with it."],
  switch_ai_off_after_failed_drafts: ["Switch the AI off when it can't write a safe reply twice in a row",
    "Off (recommended): the AI sends a safe message and keeps working toward the appointment. On: the lead goes to staff."],
  ai_resumes_after_staff_minutes: ["Minutes before the AI takes back a conversation staff replied to (0 = never)",
    "When staff text a customer by hand and the customer writes back, the AI answers if no one replies within this long (at once after hours)."],
};

const CHOICES = {
  first_channel: { text: "Text (when there's a phone number)", email: "Email (when there's an email)" },
  at_night: {
    email_now_text_when_open: "Email right away, then the first text when texting hours open",
    wait_for_text: "Wait and send the first text when texting hours open",
    email_only: "Email right away only",
  },
};

const HIDDEN = new Set(["banned_pattern", "rows"]);

function Window({ value, onChange, readOnly }) {
  const [start, end] = value || ["", ""];
  return (
    <div className="d-flex align-items-center gap-2">
      <Form.Control size="sm" type="time" style={{ width: 130 }} min="08:00" max="21:00" disabled={readOnly}
        value={start || ""} onChange={(e) => onChange([e.target.value, end])} />
      <span>to</span>
      <Form.Control size="sm" type="time" style={{ width: 130 }} min="08:00" max="21:00" disabled={readOnly}
        value={end || ""} onChange={(e) => onChange([start, e.target.value])} />
      {value && <Button size="sm" variant="link" className="p-0" disabled={readOnly} onClick={() => onChange(null)}>none</Button>}
      {!value && <Button size="sm" variant="link" className="p-0" disabled={readOnly}
        onClick={() => onChange(["08:00", "21:00"])}>set hours</Button>}
    </div>
  );
}

const isWindow = (v) => v === null || (Array.isArray(v) && v.length === 2 && v.every((x) => /^\d{1,2}:\d{2}$/.test(String(x))));

function Field({ name, value, onChange, readOnly }) {
  const [label, hint] = LABELS[name] || [name.replace(/_/g, " "), ""];
  let input;
  if (typeof value === "boolean") {
    input = <Form.Check type="switch" id={`sw-${name}`} disabled={readOnly} checked={value}
      label={value ? "On" : "Off"} onChange={(e) => onChange(e.target.checked)} />;
  } else if (CHOICES[name]) {
    input = (
      <Form.Select size="sm" disabled={readOnly} value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(CHOICES[name]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </Form.Select>
    );
  } else if (name.endsWith("_window")) {
    input = <Window value={value} onChange={onChange} readOnly={readOnly} />;
  } else if (Array.isArray(value)) {
    input = <WordChips words={value} readOnly={readOnly} onChange={onChange} />;
  } else if (typeof value === "number" || value === null) {
    input = <Form.Control size="sm" type="number" min={0} style={{ width: 140 }} disabled={readOnly} value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
  } else {
    input = <Form.Control as={String(value || "").length > 60 ? "textarea" : "input"} rows={3} size="sm"
      disabled={readOnly} value={value || ""} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <Form.Group className="mb-3">
      <Form.Label className="fw-semibold mb-1">{label}</Form.Label>
      {input}
      {hint && <Form.Text muted>{hint}</Form.Text>}
    </Form.Group>
  );
}

const STATE_COLUMNS = [
  ["state", "State"], ["weekday", "Mon-Fri"], ["saturday", "Saturday"], ["sunday", "Sunday"],
  ["holidays_banned", "No texts on holidays"], ["cap_texts", "Texts allowed"], ["cap_hours", "per hours"],
  ["no_unsolicited_sales_texts", "No unsolicited sales texts"], ["note", "Note"],
];

function StateRules({ content, onChange, readOnly }) {
  const rows = content.rows || [];
  const set = (i, patch) => onChange({ ...content, rows: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div>
      <HowTo>each row is one state. Leave a day&apos;s hours empty (&quot;none&quot;) for no texts that day. Add a state
        with &quot;+ Add state&quot;, remove one with ✕. Hours stay inside 8 AM - 9 PM whatever is saved.</HowTo>
      <div style={{ overflowX: "auto" }}>
        <Table size="sm" bordered className="small align-middle">
          <thead><tr>{STATE_COLUMNS.map(([, l]) => <th key={l}>{l}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.state}-${i}`}>
                {STATE_COLUMNS.map(([k]) => (
                  <td key={k}>
                    {["weekday", "saturday", "sunday"].includes(k) ? (
                      <Window value={r[k]} readOnly={readOnly} onChange={(v) => set(i, { [k]: v })} />
                    ) : typeof r[k] === "boolean" ? (
                      <Form.Check disabled={readOnly} checked={!!r[k]} onChange={(e) => set(i, { [k]: e.target.checked })} />
                    ) : ["cap_texts", "cap_hours"].includes(k) ? (
                      <Form.Control size="sm" type="number" min={0} style={{ width: 70 }} disabled={readOnly}
                        value={r[k] ?? ""} onChange={(e) => set(i, { [k]: e.target.value === "" ? null : Number(e.target.value) })} />
                    ) : (
                      <Form.Control size="sm" style={{ width: k === "state" ? 60 : 160 }} disabled={readOnly}
                        value={r[k] || ""} onChange={(e) => set(i, { [k]: k === "state" ? e.target.value.toUpperCase() : e.target.value })} />
                    )}
                  </td>
                ))}
                <td>{!readOnly && <Button size="sm" variant="outline-danger"
                  onClick={() => onChange({ ...content, rows: rows.filter((_, j) => j !== i) })}>✕</Button>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      {!readOnly && <Button size="sm" variant="outline-primary" onClick={() => onChange({ ...content, rows: [...rows, {
        state: "", weekday: ["08:00", "21:00"], saturday: ["08:00", "21:00"], sunday: ["08:00", "21:00"],
        holidays_banned: false, cap_texts: null, cap_hours: null, no_unsolicited_sales_texts: false, note: "" }] })}>
        + Add state</Button>}
    </div>
  );
}

// A rule the dealership adds: an instruction the AI follows in every message, and phrases it must never use.
function CustomRule({ content, onChange, readOnly }) {
  const applies = content.applies_to || ["text", "email"];
  return (
    <div>
      <HowTo>write the rule in plain English - the AI follows it in every message it writes. Add phrases it must never
        say (press Enter after each). Choose where it applies, then Save draft and Publish. Delete removes the rule.</HowTo>
      <Form.Group className="mb-3">
        <Form.Label className="fw-semibold mb-1">The rule</Form.Label>
        <Form.Control as="textarea" rows={3} disabled={readOnly} value={content.rule || ""}
          placeholder='e.g. "Never offer a discount by text." or "Always mention we are family-owned since 1985."'
          onChange={(e) => onChange({ ...content, rule: e.target.value })} />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label className="fw-semibold mb-1">Applies to</Form.Label>
        <div>
          {[["text", "Text messages"], ["email", "Emails"]].map(([k, l]) => (
            <Form.Check key={k} inline label={l} disabled={readOnly} checked={applies.includes(k)}
              onChange={(e) => onChange({ ...content, applies_to: e.target.checked ? [...applies, k]
                : applies.filter((x) => x !== k) })} />
          ))}
        </div>
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label className="fw-semibold mb-1">Phrases the AI must never say (optional)</Form.Label>
        <WordChips words={content.banned_phrases || []} readOnly={readOnly}
          onChange={(next) => onChange({ ...content, banned_phrases: next })} />
      </Form.Group>
    </div>
  );
}

export default function ComplianceEditor({ content, onChange, readOnly, itemKey, builtIn = true }) {
  if (!builtIn) return <CustomRule content={content} onChange={onChange} readOnly={readOnly} />;
  if (itemKey === "state_rules") return <StateRules content={content} onChange={onChange} readOnly={readOnly} />;
  return (
    <div>
      <HowTo>change any rule below, then Save draft and Publish. Lists: type and press Enter to add, ✕ to remove.
        {itemKey === "texting_hours" && " Hours stay inside 8 AM - 9 PM (federal law) whatever is saved."}</HowTo>
      {Object.entries(content).filter(([k]) => !HIDDEN.has(k)).map(([k, v]) => (
        <Field key={k} name={k} value={v} readOnly={readOnly} onChange={(next) => onChange({ ...content, [k]: next })} />
      ))}
      {itemKey === "contacted" && <div className="small text-muted">Used by the Leads &quot;Contacted&quot; filter,
        the dashboard and the reports.</div>}
    </div>
  );
}

export { isWindow };
