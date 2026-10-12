"use client";
// AI Studio editors for everything that isn't a workflow tree: cadences (a day-by-day timeline), buckets, agents,
// lead sources, single messages, status rules and prompts.
import { useState } from "react";
import { Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { MessageBlock, STATUS_OPTIONS, summary } from "./shared";

const CHANNELS = { sms: "Text", email: "Email", call_task: "Call task" };

export function CadenceTimeline({ content, onChange, placeholders, readOnly }) {
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
      <div className="small text-muted mb-2">
        {content.every && <>Repeats every <strong>{content.every}</strong>. </>}
        {content.stops_when && <>Stops when: {content.stops_when.join(", ")}. </>}
        {content.day_91 && <>{content.day_91}</>}
      </div>
      {steps.map((s, i) => (
        <div key={i} className="d-flex gap-3">
          <div className="text-center" style={{ width: 90 }}>
            <Badge bg="primary" className="w-100 py-2">{s.when || (s.day ? `Day ${s.day}` : `Touch ${i + 1}`)}</Badge>
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
                    <Col md={4}><Form.Control size="sm" placeholder="Name" value={s.label || ""} disabled={readOnly}
                      onChange={(e) => setStep(i, { label: e.target.value })} /></Col>
                    <Col md={4}><Form.Control size="sm" placeholder="When (e.g. Day 3, 3 hours after)" value={s.when || ""}
                      disabled={readOnly} onChange={(e) => setStep(i, { when: e.target.value })} /></Col>
                    <Col md={4} className="d-flex gap-2 align-items-center">
                      {Object.entries(CHANNELS).map(([c, l]) => (
                        <Form.Check key={c} inline label={l} disabled={readOnly} checked={(s.channels || []).includes(c)}
                          onChange={(e) => setStep(i, { channels: e.target.checked ? [...(s.channels || []), c]
                            : (s.channels || []).filter((x) => x !== c) })} />
                      ))}
                    </Col>
                  </Row>
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
          onChange({ ...content, steps: [...steps, { id: `touch_${steps.length + 1}`, label: "New touch", when: "",
            channels: ["sms", "email"], message: { mode: "ai", instruction: "" } }] });
          setOpen(steps.length);
        }}>+ Add touch</Button>
      )}
    </div>
  );
}

const readable = (pattern) => String(pattern || "").replace(/\\[sb]\*?/g, " ").replace(/[()?:^$\\]/g, "")
  .split("|").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);

export function BucketEditor({ content, onChange, readOnly, agents }) {
  const sources = readable(content.source_pattern);
  return (
    <div>
      <Form.Group className="mb-3">
        <Form.Label className="fw-semibold">Lead sources that go into this bucket</Form.Label>
        <div className="d-flex flex-wrap gap-1 mb-2">{sources.map((s) => <Badge key={s} bg="info">{s}</Badge>)}</div>
        <Form.Control size="sm" disabled={readOnly} placeholder="Add sources, separated by commas"
          value={(content.extra_sources || []).join(", ")}
          onChange={(e) => onChange({ ...content, extra_sources: e.target.value.split(",").map((x) => x.trim())
            .filter(Boolean) })} />
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
      {area("playbook", "How this agent talks and what it leans on", 4)}
      {area("never", "Never does", 2)}
      {area("steps_in_when", "Steps in when the customer talks about", 2, "Words or a pattern")}
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
      <div className="d-flex flex-wrap gap-1 mb-3">{readable(content.pattern).map((s) => <Badge key={s} bg="info">{s}</Badge>)}</div>
      <Form.Group className="mb-2">
        <Form.Label className="fw-semibold">Add sources (comma separated)</Form.Label>
        <Form.Control size="sm" disabled={readOnly} value={(content.extra_sources || []).join(", ")}
          onChange={(e) => onChange({ ...content, extra_sources: e.target.value.split(",").map((x) => x.trim())
            .filter(Boolean) })} />
      </Form.Group>
      {content.note && <div className="small text-muted">{content.note}</div>}
    </div>
  );
}

export function RulesEditor({ content, onChange, readOnly }) {
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

export function SingleMessage({ content, onChange, placeholders, readOnly }) {
  return <MessageBlock message={content.message} placeholders={placeholders} readOnly={readOnly}
    onChange={(message) => onChange({ ...content, message })} />;
}
