"use client";
// AI Studio editors for everything that isn't a workflow tree: cadences (a day-by-day timeline), buckets, agents,
// lead sources, single messages, status rules and prompts.
import { useState } from "react";
import { Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { HowTo, MessageBlock, STATUS_OPTIONS, WordChips, patternToWords, summary } from "./shared";

const CHANNELS = { sms: "Text", email: "Email", call_task: "Call task" };
const UNITS = ["minutes", "hours", "days", "weeks", "months", "years"];

// "3 hours after the previous touch", "Day 2 at 10:00" - the timing in words, for the chip on each touch.
export const waitLabel = (w) => {
  if (!w) return null;
  const n = Number(w.amount) || 0;
  const unit = n === 1 ? w.unit?.replace(/s$/, "") : w.unit;
  if (!n) return w.after === "start" ? "Right away" : "Right after";
  if (w.after === "start" && w.unit === "days") return `Day ${n + 1}${w.at ? ` · ${w.at}` : ""}`;
  return `${w.after === "start" ? "" : "+"}${n} ${unit}${w.after === "start" ? " after start" : ""}${w.at ? ` · ${w.at}` : ""}`;
};

// One wait: any number of minutes ... years, after the previous touch or the start, optionally at a time of day.
export function WaitEditor({ wait, onChange, readOnly, allowAfter = true, label = "Send" }) {
  const w = wait || { amount: 1, unit: "days", after: "previous" };
  const set = (patch) => onChange({ ...w, ...patch });
  return (
    <div className="d-flex flex-wrap align-items-center gap-2 small">
      <span className="fw-semibold">{label}</span>
      <Form.Control size="sm" type="number" min={0} step="any" style={{ width: 80 }} disabled={readOnly}
        value={w.amount ?? 0} onChange={(e) => set({ amount: e.target.value === "" ? 0 : Number(e.target.value) })} />
      <Form.Select size="sm" style={{ width: 110 }} disabled={readOnly} value={w.unit || "days"}
        onChange={(e) => set({ unit: e.target.value })}>
        {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
      </Form.Select>
      {allowAfter && (
        <Form.Select size="sm" style={{ width: 200 }} disabled={readOnly} value={w.after || "previous"}
          onChange={(e) => set({ after: e.target.value })}>
          <option value="previous">after the previous touch</option>
          <option value="start">after the cadence starts</option>
        </Form.Select>
      )}
      <span>at</span>
      <Form.Control size="sm" style={{ width: 100 }} placeholder="any time" disabled={readOnly} value={w.at || ""}
        onChange={(e) => set({ at: e.target.value || undefined })} />
    </div>
  );
}

const STOPS = ["customer replies", "appointment set", "opt-out"];

function StartsWhen({ content, onChange, readOnly }) {
  const start = content.starts_when || { type: "status" };
  const set = (patch) => onChange({ ...content, starts_when: { ...start, ...patch } });
  const stops = content.stops_when || STOPS;
  return (
    <Card className="mb-3" style={{ borderColor: "#c9d3e6" }}>
      <Card.Body className="py-2 small">
        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <span className="fw-semibold">Starts when</span>
          <Form.Select size="sm" style={{ width: 230 }} disabled={readOnly} value={start.type || "status"}
            onChange={(e) => set({ type: e.target.value })}>
            <option value="status">staff set the lead&apos;s status to</option>
            <option value="lead_created">a new lead comes in</option>
            <option value="customer_says">the customer says</option>
            <option value="ai_asked">the AI asks a question (no reply yet)</option>
          </Form.Select>
          {start.type === "status" && (
            <Form.Select size="sm" style={{ width: 240 }} disabled={readOnly} value={start.status || ""}
              onChange={(e) => set({ status: e.target.value })}>
              <option value="">Choose a status…</option>
              {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
            </Form.Select>
          )}
        </div>
        {start.type === "customer_says" && (
          <WordChips words={start.phrases || []} readOnly={readOnly} placeholder="Add words that start it and press Enter"
            onChange={(next) => set({ phrases: next })} />
        )}
        <div className="d-flex flex-wrap gap-3 mt-2">
          <span className="fw-semibold">Stops when</span>
          {STOPS.map((s) => (
            <Form.Check key={s} inline label={s} disabled={readOnly || s === "opt-out"} checked={stops.includes(s)}
              onChange={(e) => onChange({ ...content, stops_when: e.target.checked ? [...stops, s]
                : stops.filter((x) => x !== s) })} />
          ))}
        </div>
      </Card.Body>
    </Card>
  );
}

export function CadenceTimeline({ content, onChange, placeholders, readOnly, builtIn = true }) {
  const [open, setOpen] = useState(null);
  const steps = content.steps || [];
  const setStep = (i, patch) => onChange({ ...content, steps: steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i, d) => {
    const next = [...steps];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange({ ...content, steps: next });
  };
  return (
    <div>
      <HowTo>click a touch to change <strong>when</strong> it goes out (any number of minutes, hours, days, weeks,
        months or years), its channels and its message. Use ↑ ↓ to change the order, ✕ to remove a touch, and
        &quot;+ Add touch&quot; to add one. Then Save draft and Publish.</HowTo>
      {!builtIn && <StartsWhen content={content} onChange={onChange} readOnly={readOnly} />}
      {content.repeat && (
        <Card className="mb-3" style={{ borderColor: "#c9d3e6" }}>
          <Card.Body className="py-2 d-grid gap-2">
            <WaitEditor label="First touch" wait={content.repeat.first} readOnly={readOnly}
              onChange={(first) => onChange({ ...content, repeat: { ...content.repeat, first } })} />
            <WaitEditor label="Then every" allowAfter={false} wait={content.repeat.every} readOnly={readOnly}
              onChange={(every) => onChange({ ...content, repeat: { ...content.repeat, every } })} />
            <WaitEditor label="Until" allowAfter={false} wait={content.repeat.until} readOnly={readOnly}
              onChange={(until) => onChange({ ...content, repeat: { ...content.repeat, until: { ...until, after: "start" } } })} />
            {content.closes_after && (
              <WaitEditor label="Close the opportunity after" allowAfter={false} wait={content.closes_after}
                readOnly={readOnly}
                onChange={(closes_after) => onChange({ ...content, closes_after: { ...closes_after, after: "start" } })} />
            )}
            <div className="small text-muted">The touches below take turns, the least recently used first.</div>
          </Card.Body>
        </Card>
      )}
      {steps.map((s, i) => (
        <div key={i} className="d-flex gap-3">
          <div className="text-center" style={{ width: 90 }}>
            <span className="d-block w-100 py-1" style={{ background: "#e8f0fd", color: "#2c5aa0", borderRadius: 20,
              fontSize: 12, fontWeight: 600 }}>{waitLabel(s.wait) || s.when || (s.day ? `Day ${s.day}` : `Touch ${i + 1}`)}</span>
            {i < steps.length - 1 && <div className="mx-auto" style={{ width: 2, height: "100%", minHeight: 24,
              background: "#c9d3e6" }} />}
          </div>
          <Card className="flex-grow-1 mb-2">
            <Card.Body className="py-2">
              <div className="d-flex justify-content-between align-items-start" role="button"
                onClick={() => setOpen(open === i ? null : i)}>
                <div>
                  <div className="fw-semibold">{s.label || s.id}</div>
                  <div className="d-flex gap-1 my-1">
                    {(s.channels || []).map((c) => <Badge key={c} bg="light" text="dark">{CHANNELS[c] || c}</Badge>)}
                  </div>
                  {open !== i && <div className="small text-muted">{summary(s.message)}</div>}
                </div>
                {!readOnly && (
                  <div className="d-flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="light" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
                    <Button size="sm" variant="light" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>↓</Button>
                    <Button size="sm" variant="outline-danger"
                      onClick={() => onChange({ ...content, steps: steps.filter((_, j) => j !== i) })}>✕</Button>
                  </div>
                )}
              </div>
              {open === i && (
                <div className="mt-2">
                  <Row className="g-2 mb-2">
                    <Col md={6}><Form.Control size="sm" placeholder="Name" value={s.label || ""} disabled={readOnly}
                      onChange={(e) => setStep(i, { label: e.target.value })} /></Col>
                    <Col md={6} className="d-flex gap-2 align-items-center">
                      {Object.entries(CHANNELS).map(([c, l]) => (
                        <Form.Check key={c} inline label={l} disabled={readOnly} checked={(s.channels || []).includes(c)}
                          onChange={(e) => setStep(i, { channels: e.target.checked ? [...(s.channels || []), c]
                            : (s.channels || []).filter((x) => x !== c) })} />
                      ))}
                    </Col>
                  </Row>
                  {(s.wait || !content.repeat) && (
                    <div className="mb-2"><WaitEditor wait={s.wait} readOnly={readOnly}
                      onChange={(wait) => setStep(i, { wait })} /></div>
                  )}
                  <MessageBlock message={s.message} placeholders={placeholders} readOnly={readOnly}
                    onChange={(message) => setStep(i, { message })} />
                </div>
              )}
            </Card.Body>
          </Card>
        </div>
      ))}
      {!readOnly && (
        <Button size="sm" variant="outline-primary" onClick={() => {
          onChange({ ...content, steps: [...steps, { id: `touch_${Date.now().toString(36)}`, label: "New touch",
            channels: ["sms", "email"], ...(content.repeat ? {} : { wait: { amount: 1, unit: "days", after: "previous", at: "10:00" } }),
            message: { mode: "ai", instruction: "" } }] });
          setOpen(steps.length);
        }}>+ Add touch</Button>
      )}
    </div>
  );
}


export function BucketEditor({ content, onChange, readOnly, agents }) {
  const sources = content.sources || patternToWords(content.source_pattern);
  return (
    <div>
      <HowTo>type a lead source name and press Enter to add it, or ✕ to remove one. Choose the agent that leads this
        bucket, then Save draft and Publish.</HowTo>
      <Form.Group className="mb-3">
        <Form.Label className="fw-semibold">Lead sources that go into this bucket</Form.Label>
        <WordChips words={sources} readOnly={readOnly} placeholder="Add a lead source (e.g. Dealer Inspire) and press Enter"
          onChange={(next) => onChange({ ...content, sources: next })} />
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label className="fw-semibold">Agent that leads this bucket</Form.Label>
        <Form.Select disabled={readOnly} value={content.agent || ""}
          onChange={(e) => onChange({ ...content, agent: e.target.value })}>
          {agents.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
        </Form.Select>
      </Form.Group>
      <Form.Group className="mb-3">
        <Form.Label className="fw-semibold">What to lean on (word track)</Form.Label>
        <Form.Control as="textarea" rows={3} disabled={readOnly} value={content.word_track || ""}
          onChange={(e) => onChange({ ...content, word_track: e.target.value })} />
      </Form.Group>
      <div className="small text-muted">
        Follows: Sales follow-up Days 1-7 → Days 8-30 (weekly) → Days 31-90 (every 2 weeks). The bucket changes the
        language, not the cadence (your rule, 26 Sep: &quot;These cadences will apply to ALL new lead buckets&quot;).
      </div>
    </div>
  );
}

export function AgentEditor({ content, onChange, readOnly }) {
  const area = (key, label, rows, hint) => (
    <Form.Group className="mb-3">
      <Form.Label className="fw-semibold">{label}</Form.Label>
      <Form.Control as="textarea" rows={rows} disabled={readOnly} value={content[key] || ""}
        onChange={(e) => onChange({ ...content, [key]: e.target.value })} />
      {hint && <Form.Text muted>{hint}</Form.Text>}
    </Form.Group>
  );
  return (
    <div>
      <HowTo>change how this agent talks, what it must never do, and the words that bring it in (press Enter to add a
        word, ✕ to remove). Then Save draft and Publish.</HowTo>
      {area("playbook", "How this agent talks and what it leans on", 4)}
      {area("never", "Never does", 2)}
      <Form.Group className="mb-3">
        <Form.Label className="fw-semibold">This agent takes over when the customer mentions</Form.Label>
        <WordChips words={content.keywords || patternToWords(content.steps_in_when)} readOnly={readOnly}
          onChange={(next) => onChange({ ...content, keywords: next })} />
        <Form.Text muted>If a message includes any of these, this agent answers it. &quot;…&quot; means any ending
          (approv… = approve, approved, approval).</Form.Text>
      </Form.Group>
      <Form.Group className="mb-2">
        <Form.Label className="fw-semibold">Example conversations (one per box: what a great reply looks like)</Form.Label>
        {(content.examples || []).map((ex, i) => (
          <div key={i} className="d-flex gap-2 mb-2">
            <Form.Control as="textarea" rows={3} disabled={readOnly} value={ex}
              onChange={(e) => onChange({ ...content, examples: content.examples.map((x, j) => (j === i ? e.target.value : x)) })} />
            {!readOnly && <Button size="sm" variant="outline-danger"
              onClick={() => onChange({ ...content, examples: content.examples.filter((_, j) => j !== i) })}>✕</Button>}
          </div>
        ))}
        {!readOnly && <Button size="sm" variant="outline-primary"
          onClick={() => onChange({ ...content, examples: [...(content.examples || []), ""] })}>+ Add example</Button>}
      </Form.Group>
    </div>
  );
}

export function SourceEditor({ content, onChange, readOnly }) {
  return (
    <div>
      <HowTo>type a source name and press Enter to add it, ✕ to remove one. Then Save draft and Publish.</HowTo>
      <WordChips words={content.sources || patternToWords(content.pattern)} readOnly={readOnly}
        placeholder="Add a lead source and press Enter" onChange={(next) => onChange({ ...content, sources: next })} />
      {content.note && <div className="small text-muted">{content.note}</div>}
    </div>
  );
}

export function RulesEditor({ content, onChange, readOnly }) {
  if (content.kinds && Array.isArray(content.counts)) {
    // Dealership Action Required: which alerts count (client, 16 Oct 2026).
    const counts = content.counts;
    return (
      <div>
        <HowTo>tick what should land in Dealership Action Required (and its count on the dashboard). Unticked
          alerts still show on the lead itself. Then Save draft and Publish.</HowTo>
        {Object.entries(content.kinds).map(([kind, label]) => (
          <Form.Check key={kind} id={`kind-${kind}`} className="mb-2" disabled={readOnly} label={label}
            checked={counts.includes(kind)}
            onChange={(e) => onChange({ ...content, counts: e.target.checked ? [...counts, kind]
              : counts.filter((k) => k !== kind) })} />
        ))}
      </div>
    );
  }
  if (content.rules) {
    return (
      <Table size="sm" bordered>
        <thead><tr><th>When the AI&apos;s reason starts with</th><th>Why it needs the dealership</th><th /></tr></thead>
        <tbody>
          {content.rules.map((r, i) => (
            <tr key={i}>
              {["reason_starts_with", "why"].map((k) => (
                <td key={k}><Form.Control size="sm" disabled={readOnly} value={r[k] || ""}
                  onChange={(e) => onChange({ ...content, rules: content.rules.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} /></td>
              ))}
              <td>{!readOnly && <Button size="sm" variant="outline-danger"
                onClick={() => onChange({ ...content, rules: content.rules.filter((_, j) => j !== i) })}>✕</Button>}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    );
  }
  const map = content.map || content.stages || {};
  const key = content.map ? "map" : "stages";
  return (
    <Table size="sm" bordered>
      <thead><tr><th>{content.map ? "Status set by staff" : "Stage"}</th><th>{content.map ? "Workflow it starts" : "Status shown"}</th></tr></thead>
      <tbody>
        {Object.entries(map).map(([k, v]) => (
          <tr key={k}><td>{k}</td><td>
            {content.map ? <Form.Control size="sm" disabled={readOnly} value={v}
              onChange={(e) => onChange({ ...content, [key]: { ...map, [k]: e.target.value } })} />
              : <Form.Select size="sm" disabled={readOnly} value={v}
                onChange={(e) => onChange({ ...content, [key]: { ...map, [k]: e.target.value } })}>
                {[...new Set([v, ...STATUS_OPTIONS])].map((s) => <option key={s}>{s}</option>)}</Form.Select>}
          </td></tr>
        ))}
      </tbody>
    </Table>
  );
}

export function PromptEditor({ content, onChange, readOnly }) {
  return (
    <Form.Control as="textarea" rows={28} disabled={readOnly} value={content.text || ""}
      style={{ fontFamily: "monospace", fontSize: 12 }} onChange={(e) => onChange({ ...content, text: e.target.value })} />
  );
}

export function SingleMessage({ content, onChange, placeholders, readOnly, builtIn = true }) {
  return (
    <div>
      <HowTo>choose how the message is written, type it (click a {"{placeholder}"} button to insert the customer&apos;s
        name, vehicle and so on), check the preview, then Save draft and Publish.</HowTo>
      {!builtIn && (
        <Form.Group className="mb-3">
          <Form.Label className="fw-semibold">Send this when the customer says</Form.Label>
          <WordChips words={(content.send_when || {}).phrases || []} readOnly={readOnly}
            placeholder="Add words (e.g. your hours) and press Enter"
            onChange={(phrases) => onChange({ ...content, send_when: { type: "customer_says", phrases } })} />
        </Form.Group>
      )}
      <MessageBlock message={content.message} placeholders={placeholders} readOnly={readOnly}
        onChange={(message) => onChange({ ...content, message })} />
    </div>
  );
}
