"use client";
// AI Studio (client, 13 Oct 2026): the super admin sees and edits everything the AI uses - agents, buckets, lead sources,
// cadences, messages, scripts / if-then flows, status rules and prompts - with a full version history (draft, publish,
// revert, reset to default). Phase 1: the AI does not read these yet, so nothing here changes a customer message.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, ButtonGroup, Card, Col, Form, Modal, Row, Spinner, Tab, Tabs } from "react-bootstrap";

const TYPE_LABELS = {
  agents: "Agents", buckets: "Buckets", sources: "Lead sources", cadences: "Cadences & workflows",
  messages: "Messages", scripts: "Scripts & if-then flows", status_rules: "Statuses & escalations", prompts: "AI prompts",
};
const MODE_LABELS = { fixed: "Fixed text", ai: "AI writes it", fixed_opening_ai: "Fixed opening + AI" };
const SAMPLE = {
  first_name: "Maria", dealership: "Victory Cars Central", agent_name: "Nicole", vehicle: "2024 Toyota RAV4 XLE",
  model: "RAV4", price: "$31,995", price_line: "It's listed at $31,995, not including tax, documentation and DMV fees.",
  times: "Saturday at 10:00 AM or Sunday at 1:00 PM", date: "Saturday, October 17", time: "10:00 AM",
  address: "3914 Hempstead Tpke, Levittown", ask_for: "Mercy", dealer_phone: "(347) 658-5466",
  credit_app_link: "https://dealer.example/credit", vehicle_link: "https://dealer.example/vdp/rav4",
  opens_at: "9:00 AM tomorrow", recommended_work: "front brake pads",
};

const api = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("token")}`, ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { problems: data.problems });
  return data;
};
const fill = (text) => String(text || "").replace(/\{([a-z_]+)\}/g, (m, k) => SAMPLE[k] ?? m);
const when = (d) => (d ? new Date(d).toLocaleString() : "");

function PlaceholderPicker({ placeholders, onPick }) {
  return (
    <div className="d-flex flex-wrap gap-1 mb-2">
      {Object.entries(placeholders || {}).map(([k, label]) => (
        <Button key={k} size="sm" variant="outline-secondary" title={label} onClick={() => onPick(`{${k}}`)}>
          {`{${k}}`}
        </Button>
      ))}
    </div>
  );
}

function MessageBlock({ message, onChange, placeholders, readOnly }) {
  const focused = useRef("text");
  const m = message || { mode: "fixed" };
  const set = (patch) => onChange({ ...m, ...patch });
  const insert = (token) => {
    const field = focused.current;
    set({ [field]: `${m[field] || ""}${token}` });
  };
  const field = (name, label, rows = 3, hint) => (
    <Form.Group className="mb-2">
      <Form.Label className="small fw-semibold mb-1">{label}</Form.Label>
      <Form.Control as="textarea" rows={rows} value={m[name] || ""} disabled={readOnly}
        onFocus={() => { focused.current = name; }} onChange={(e) => set({ [name]: e.target.value })} />
      {hint && <Form.Text muted>{hint}</Form.Text>}
    </Form.Group>
  );
  return (
    <div className="border rounded p-2 bg-light">
      <ButtonGroup size="sm" className="mb-2">
        {Object.entries(MODE_LABELS).map(([mode, label]) => (
          <Button key={mode} variant={m.mode === mode ? "primary" : "outline-primary"} disabled={readOnly}
            onClick={() => set({ mode })}>{label}</Button>
        ))}
      </ButtonGroup>
      {!readOnly && <PlaceholderPicker placeholders={placeholders} onPick={insert} />}
      {m.mode !== "ai" && field("text", m.mode === "fixed" ? "Text message (sent exactly as written)" : "Fixed opening",
        3)}
      {m.mode !== "fixed" && field("instruction", "What the AI should write (plain English)", 3,
        "Example: \"Ask if they need help with financing. Mention their trade if they have one.\"")}
      {m.mode === "fixed" && field("email_subject", "Email subject", 1)}
      {m.mode === "fixed" && field("email_text", "Email (leave empty to use the text message)", 4)}
      {field("fallback", "Fallback message (sent if the AI's draft fails its safety checks)", 2)}
      {(m.text || m.fallback) && (
        <div className="small mt-2">
          <div className="fw-semibold">Preview (sample customer)</div>
          <div className="p-2 bg-white border rounded" style={{ whiteSpace: "pre-line" }}>
            {fill(m.text || m.fallback)}{m.mode === "fixed_opening_ai" ? " … (the AI continues)" : ""}
          </div>
        </div>
      )}
    </div>
  );
}

function StepsEditor({ steps, onChange, placeholders, readOnly }) {
  const ids = steps.map((s) => s.id).filter(Boolean);
  const set = (i, patch) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div>
      {steps.map((step, i) => (
        <Card key={i} className="mb-2">
          <Card.Header className="d-flex justify-content-between align-items-center py-2">
            <span className="fw-semibold">
              {i + 1}. {step.label || step.id}
              {step.when && <Badge bg="secondary" className="ms-2">{step.when}</Badge>}
              {step.if && <Badge bg="info" className="ms-2">if customer says: {step.if}</Badge>}
              {step.escalates && <Badge bg="warning" text="dark" className="ms-2">Dealership Action Required</Badge>}
            </span>
            {!readOnly && (
              <Button size="sm" variant="outline-danger" onClick={() => onChange(steps.filter((_, j) => j !== i))}>
                Remove step
              </Button>
            )}
          </Card.Header>
          <Card.Body>
            <Row className="g-2 mb-2">
              <Col md={3}><Form.Control size="sm" placeholder="Step name" value={step.id || ""} disabled={readOnly}
                onChange={(e) => set(i, { id: e.target.value })} /></Col>
              <Col md={4}><Form.Control size="sm" placeholder="Label" value={step.label || ""} disabled={readOnly}
                onChange={(e) => set(i, { label: e.target.value })} /></Col>
              <Col md={3}><Form.Control size="sm" placeholder="When (e.g. Day 3)" value={step.when || ""}
                disabled={readOnly} onChange={(e) => set(i, { when: e.target.value })} /></Col>
              {"go" in step && (
                <Col md={2}>
                  <Form.Select size="sm" value={step.go || "end"} disabled={readOnly}
                    onChange={(e) => set(i, { go: e.target.value })} title="What happens next">
                    <option value="end">Then: end</option>
                    <option value="ai">Then: AI carries on</option>
                    {ids.filter((x) => x !== step.id).map((x) => <option key={x} value={x}>Then: {x}</option>)}
                    {[...new Set(steps.map((s) => s.on_step).filter(Boolean))].map((x) => (
                      <option key={`on-${x}`} value={x}>Then: ask "{x}"</option>))}
                  </Form.Select>
                </Col>
              )}
            </Row>
            {step.message && <MessageBlock message={step.message} placeholders={placeholders} readOnly={readOnly}
              onChange={(message) => set(i, { message })} />}
          </Card.Body>
        </Card>
      ))}
      {!readOnly && (
        <Button size="sm" variant="outline-primary" onClick={() => onChange([...steps, {
          id: `step_${steps.length + 1}`, label: "New step", when: "", message: { mode: "fixed", text: "" } }])}>
          + Add step
        </Button>
      )}
    </div>
  );
}

function ContentEditor({ type, content, onChange, placeholders, readOnly }) {
  const keys = Object.keys(content || {});
  const set = (patch) => onChange({ ...content, ...patch });
  return (
    <div>
      {keys.map((key) => {
        const value = content[key];
        const label = key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
        if (key === "message") {
          return <div key={key} className="mb-3"><MessageBlock message={value} placeholders={placeholders}
            readOnly={readOnly} onChange={(message) => set({ message })} /></div>;
        }
        if (key === "steps" && Array.isArray(value)) {
          return <div key={key} className="mb-3"><StepsEditor steps={value} placeholders={placeholders}
            readOnly={readOnly} onChange={(steps) => set({ steps })} /></div>;
        }
        if (typeof value === "string" || value === null) {
          const long = String(value || "").length > 80 || type === "prompts";
          return (
            <Form.Group key={key} className="mb-2">
              <Form.Label className="small fw-semibold mb-1">{label}</Form.Label>
              <Form.Control as={long ? "textarea" : "input"} rows={type === "prompts" ? 18 : 3} value={value || ""}
                disabled={readOnly} onChange={(e) => set({ [key]: e.target.value })}
                style={type === "prompts" ? { fontFamily: "monospace", fontSize: 12 } : undefined} />
            </Form.Group>
          );
        }
        if (typeof value === "boolean") {
          return <Form.Check key={key} type="switch" className="mb-2" label={label} checked={value} disabled={readOnly}
            onChange={(e) => set({ [key]: e.target.checked })} />;
        }
        return (
          <Form.Group key={key} className="mb-2">
            <Form.Label className="small fw-semibold mb-1">{label} <span className="text-muted">(advanced)</span>
            </Form.Label>
            <Form.Control as="textarea" rows={6} disabled={readOnly} style={{ fontFamily: "monospace", fontSize: 12 }}
              defaultValue={JSON.stringify(value, null, 2)}
              onBlur={(e) => { try { set({ [key]: JSON.parse(e.target.value) }); } catch { /* keep the old value */ } }} />
          </Form.Group>
        );
      })}
    </div>
  );
}

export default function AiStudioPage() {
  const [list, setList] = useState(null);
  const [placeholders, setPlaceholders] = useState({});
  const [selected, setSelected] = useState(null);
  const [item, setItem] = useState(null);
  const [draft, setDraft] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [viewVersion, setViewVersion] = useState(null);
  const [creating, setCreating] = useState(null);

  const loadList = useCallback(async () => {
    try {
      const data = await api("/api/admin/ai-studio");
      setList(data.items);
      setPlaceholders(data.placeholders || {});
    } catch (e) { setMessage({ variant: "danger", text: e.message }); }
  }, []);
  const loadItem = useCallback(async (id) => {
    const data = await api(`/api/admin/ai-studio/${id}`);
    setItem(data);
    const editable = data.versions.find((v) => v.version === (data.draft_version || data.published_version))
      || data.versions[0];
    setDraft(JSON.parse(JSON.stringify(editable?.content || {})));
    setNote("");
  }, []);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (selected) loadItem(selected).catch((e) => setMessage({ variant: "danger", text: e.message })); },
    [selected, loadItem]);

  const grouped = useMemo(() => (list || []).reduce((acc, i) => ({ ...acc, [i.type]: [...(acc[i.type] || []), i] }), {}),
    [list]);

  const act = async (fn, ok) => {
    setBusy(true); setMessage(null);
    try {
      await fn();
      setMessage({ variant: "success", text: ok });
      await loadList(); if (selected) await loadItem(selected);
    } catch (e) {
      setMessage({ variant: "danger", text: e.message, problems: e.problems });
    } finally { setBusy(false); }
  };
  const saveDraft = async () => {
    setBusy(true); setMessage(null);
    try {
      const res = await api(`/api/admin/ai-studio/${selected}`, { method: "PUT", body: JSON.stringify({ content: draft,
        note }) });
      setMessage(res.problems?.length
        ? { variant: "warning", text: `Draft v${res.version} saved. Fix these before publishing:`, problems: res.problems }
        : { variant: "success", text: `Draft v${res.version} saved. Publish it when you're ready.` });
      await loadList(); await loadItem(selected);
    } catch (e) { setMessage({ variant: "danger", text: e.message, problems: e.problems }); } finally { setBusy(false); }
  };
  const publish = () => act(() => api(`/api/admin/ai-studio/${selected}`, { method: "POST",
    body: JSON.stringify({ action: "publish" }) }), "Published.");
  const revert = (version) => act(() => api(`/api/admin/ai-studio/${selected}`, { method: "POST",
    body: JSON.stringify({ action: "revert", version }) }), `Reverted to version ${version}.`);
  const reset = () => act(() => api(`/api/admin/ai-studio/${selected}`, { method: "POST",
    body: JSON.stringify({ action: "reset" }) }), "Reset to the AutoPulse default.");
  const create = () => act(async () => {
    const res = await api("/api/admin/ai-studio", { method: "POST", body: JSON.stringify({
      type: creating.type, name: creating.name,
      content: creating.type === "scripts" || creating.type === "cadences"
        ? { trigger: "", steps: [{ id: "start", label: "First message", message: { mode: "fixed", text: "" },
          go: "end" }] }
        : creating.type === "agents" ? { playbook: "", never: "", steps_in_when: "", examples: [] }
          : { message: { mode: "fixed", text: "" } } }) });
    setCreating(null); setSelected(res.id);
  }, "Created as a draft.");

  const readOnly = !!item?.locked;
  const published = item?.versions.find((v) => v.version === item.published_version);

  return (
    <div className="container-fluid py-3">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h4 className="mb-0">AI Studio</h4>
        <Button size="sm" onClick={() => setCreating({ type: "scripts", name: "" })}>+ New</Button>
      </div>
      <Alert variant="info" className="py-2 small">
        Everything the AI uses, with its full history. You can edit, save drafts, publish, revert and reset any item.
        <strong> The AI isn&apos;t reading these settings yet</strong>: until the next update connects it, nothing here
        changes a customer message.
      </Alert>
      {message && (
        <Alert variant={message.variant} onClose={() => setMessage(null)} dismissible className="py-2">
          {message.text}
          {message.problems && <ul className="mb-0 mt-1">{message.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </Alert>
      )}
      <Row>
        <Col md={3}>
          {!list && <Spinner size="sm" />}
          {Object.entries(TYPE_LABELS).map(([type, label]) => grouped[type] && (
            <div key={type} className="mb-3">
              <div className="small text-uppercase text-muted fw-semibold mb-1">{label}</div>
              {grouped[type].map((i) => (
                <div key={i.id} role="button" onClick={() => setSelected(i.id)}
                  className={`p-2 rounded mb-1 small ${selected === i.id ? "bg-primary text-white" : "bg-light"}`}>
                  {i.name}
                  <div className="d-flex gap-1 mt-1">
                    {i.published_version && <Badge bg="success">v{i.published_version} live</Badge>}
                    {i.draft_version && <Badge bg="warning" text="dark">draft v{i.draft_version}</Badge>}
                    {i.locked && <Badge bg="secondary">locked</Badge>}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </Col>
        <Col md={9}>
          {!item && <div className="text-muted mt-4">Pick something on the left to see and edit it.</div>}
          {item && draft && (
            <Card>
              <Card.Header className="d-flex justify-content-between align-items-center">
                <div>
                  <strong>{item.name}</strong> <span className="text-muted small">({TYPE_LABELS[item.type]})</span>
                  {item.locked && <Badge bg="secondary" className="ms-2">Locked: keeps the AI legal and safe</Badge>}
                </div>
                <div className="d-flex gap-2">
                  {!readOnly && <Form.Control size="sm" placeholder="What did you change? (optional)" value={note}
                    onChange={(e) => setNote(e.target.value)} style={{ width: 260 }} />}
                  {!readOnly && <Button size="sm" variant="outline-primary" disabled={busy} onClick={saveDraft}>
                    Save draft</Button>}
                  {!readOnly && item.draft_version && <Button size="sm" variant="success" disabled={busy}
                    onClick={publish}>Publish draft v{item.draft_version}</Button>}
                  {!readOnly && item.has_default && <Button size="sm" variant="outline-secondary" disabled={busy}
                    onClick={reset}>Reset to default</Button>}
                </div>
              </Card.Header>
              <Card.Body>
                <Tabs defaultActiveKey="edit" className="mb-3">
                  <Tab eventKey="edit" title={item.draft_version ? `Editing draft v${item.draft_version}` : "Edit"}>
                    <ContentEditor type={item.type} content={draft} onChange={setDraft} placeholders={placeholders}
                      readOnly={readOnly} />
                  </Tab>
                  <Tab eventKey="history" title={`History (${item.versions.length})`}>
                    {item.versions.map((v) => (
                      <div key={v.version} className="d-flex justify-content-between align-items-center border-bottom py-2">
                        <div className="small">
                          <strong>v{v.version}</strong>{" "}
                          <Badge bg={v.status === "published" ? "success" : v.status === "draft" ? "warning" : "light"}
                            text={v.status === "published" ? undefined : "dark"}>{v.status}</Badge>{" "}
                          {v.note || ""}
                          <div className="text-muted">
                            {v.created_by_name} · {when(v.created_at)}
                            {v.published_at ? ` · published ${when(v.published_at)} by ${v.published_by_name}` : ""}
                          </div>
                        </div>
                        <div className="d-flex gap-2">
                          <Button size="sm" variant="outline-secondary" onClick={() => setViewVersion(v)}>View</Button>
                          {!readOnly && v.version !== item.published_version && (
                            <Button size="sm" variant="outline-warning" disabled={busy}
                              onClick={() => revert(v.version)}>Revert to this</Button>)}
                        </div>
                      </div>
                    ))}
                  </Tab>
                  {published && (
                    <Tab eventKey="live" title={`Live (v${published.version})`}>
                      <ContentEditor type={item.type} content={published.content} onChange={() => {}}
                        placeholders={placeholders} readOnly />
                    </Tab>
                  )}
                </Tabs>
              </Card.Body>
            </Card>
          )}
        </Col>
      </Row>

      <Modal show={!!viewVersion} onHide={() => setViewVersion(null)} size="xl">
        <Modal.Header closeButton><Modal.Title>Version {viewVersion?.version}</Modal.Title></Modal.Header>
        <Modal.Body>
          {viewVersion && <ContentEditor type={item?.type} content={viewVersion.content} onChange={() => {}}
            placeholders={placeholders} readOnly />}
        </Modal.Body>
      </Modal>

      <Modal show={!!creating} onHide={() => setCreating(null)}>
        <Modal.Header closeButton><Modal.Title>New</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Select className="mb-2" value={creating?.type || "scripts"}
            onChange={(e) => setCreating({ ...creating, type: e.target.value })}>
            {Object.entries(TYPE_LABELS).filter(([t]) => t !== "prompts" && t !== "status_rules")
              .map(([t, l]) => <option key={t} value={t}>{l}</option>)}
          </Form.Select>
          <Form.Control placeholder="Name (e.g. Trade-in follow-up)" value={creating?.name || ""}
            onChange={(e) => setCreating({ ...creating, name: e.target.value })} />
        </Modal.Body>
        <Modal.Footer><Button disabled={busy || !creating?.name} onClick={create}>Create draft</Button></Modal.Footer>
      </Modal>
    </div>
  );
}
