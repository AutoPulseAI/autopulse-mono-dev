"use client";
// AI Studio (client, 13 Oct 2026): everything the AI uses, by section - buckets & agents, cadences (day-by-day
// timelines), workflows (if-then trees), messages, rules & prompts - each with a full version history (draft, publish,
// revert, reset to default). Phase 1: the AI doesn't read these yet, so nothing here changes a customer message.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, Modal, Nav, Row, Spinner, Tab, Tabs } from "react-bootstrap";
import { api, clone, when } from "./components/shared";
import { newNode, WorkflowEditor } from "./components/TreeEditor";
import { AgentEditor, BucketEditor, CadenceTimeline, PromptEditor, RulesEditor, SingleMessage, SourceEditor }
  from "./components/Editors";
import ComplianceEditor from "./components/ComplianceEditor";

const SECTIONS = [
  { key: "buckets", label: "Buckets & Agents", types: ["buckets", "agents", "sources"],
    about: "Which lead sources go into each bucket, the agent that leads it, and how each agent talks." },
  { key: "cadences", label: "Cadences", types: ["cadences"],
    about: "The follow-up timelines: what goes out, on which day, on which channels." },
  { key: "workflows", label: "Workflows", types: ["workflows"],
    about: "If-then flows: what the customer says, what the AI sends, and what happens next." },
  { key: "messages", label: "Messages", types: ["messages"],
    about: "Single messages the AI sends in set moments (after hours, repeat lead, no phone number…)." },
  { key: "rules", label: "Rules & Prompts", types: ["status_rules", "prompts"],
    about: "Statuses, when a lead needs the dealership, and the AI's instructions." },
  { key: "compliance", label: "SMS, Email & Compliance", types: ["compliance"],
    about: "Texting hours and limits, state rules, opt-out words, text or email first, what counts as Contacted, "
      + "message length and banned phrases." },
];
// What "+ New" makes in each section (rules and compliance are added as rows inside their items).
const NEW_TYPE = { buckets: "agents", cadences: "cadences", workflows: "workflows", messages: "messages",
  compliance: "compliance" };
const TYPE_TITLES = { buckets: "Buckets", agents: "Agents", sources: "Lead sources", cadences: "Cadences",
  workflows: "Workflows", messages: "Messages", status_rules: "Statuses & escalations", prompts: "AI prompts",
  compliance: "SMS, email & compliance" };

function Editor({ item, content, onChange, placeholders, readOnly, agents }) {
  const props = { content, onChange, placeholders, readOnly };
  if (item.type === "workflows") return <WorkflowEditor {...props} />;
  if (item.type === "cadences") return <CadenceTimeline {...props} builtIn={item.has_default} />;
  if (item.type === "buckets") return <BucketEditor {...props} agents={agents} />;
  if (item.type === "agents") return <AgentEditor {...props} />;
  if (item.type === "sources") return <SourceEditor {...props} />;
  if (item.type === "messages") return <SingleMessage {...props} builtIn={item.has_default} />;
  if (item.type === "prompts") return <PromptEditor {...props} />;
  if (item.type === "compliance") return <ComplianceEditor {...props} itemKey={item.key} builtIn={item.has_default} />;
  return <RulesEditor {...props} />;
}

export default function AiStudioPage() {
  const [list, setList] = useState(null);
  const [placeholders, setPlaceholders] = useState({});
  const [section, setSection] = useState("workflows");
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
    setDraft(clone(editable?.content || {}));
    setNote("");
  }, []);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    if (selected) loadItem(selected).catch((e) => setMessage({ variant: "danger", text: e.message }));
  }, [selected, loadItem]);

  const current = SECTIONS.find((s) => s.key === section);
  const inSection = useMemo(() => (list || []).filter((i) => current.types.includes(i.type)), [list, current]);
  const agents = useMemo(() => (list || []).filter((i) => i.type === "agents"), [list]);
  useEffect(() => {
    if (inSection.length && !inSection.some((i) => i.id === selected)) setSelected(inSection[0].id);
  }, [inSection, selected]);

  const run = async (fn, ok) => {
    setBusy(true); setMessage(null);
    try {
      const res = await fn();
      setMessage(res?.problems?.length
        ? { variant: "warning", text: `${ok} Fix these before publishing:`, problems: res.problems }
        : { variant: "success", text: ok });
      await loadList(); if (selected) await loadItem(selected);
      return res;
    } catch (e) {
      setMessage({ variant: "danger", text: e.message, problems: e.problems });
      return null;
    } finally { setBusy(false); }
  };
  const call = (method, body) => api(`/api/admin/ai-studio/${selected}`, { method, body: JSON.stringify(body) });

  const create = async () => {
    const content = creating.type === "workflows"
      ? { trigger: { type: "customer_says", phrases: [] }, tree: newNode("First message") }
      : creating.type === "cadences" ? { starts_when: { type: "status", status: "" },
        stops_when: ["customer replies", "appointment set", "opt-out"], steps: [] }
        : creating.type === "agents" ? { playbook: "", never: "", steps_in_when: "", examples: [] }
        : creating.type === "buckets" ? { sources: [], word_track: "", agent: "sales" }
        : creating.type === "compliance" ? { rule: "", applies_to: ["text", "email"], banned_phrases: [] }
          : { message: { mode: "fixed", text: "" } };
    const res = await run(() => api("/api/admin/ai-studio", { method: "POST",
      body: JSON.stringify({ type: creating.type, name: creating.name, content }) }), "Created as a draft.");
    if (res?.id) { setCreating(null); setSelected(res.id); }
  };

  const readOnly = !!item?.locked;
  const published = item?.versions.find((v) => v.version === item.published_version);

  return (
    <div className="container-fluid py-3" style={{ background: "#f7f8fb", minHeight: "100vh" }}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <div>
          <h4 className="mb-0">AI Studio</h4>
          <div className="small text-muted">{current.about}</div>
        </div>
        {NEW_TYPE[current.key] && (
          <Button onClick={() => setCreating({ type: NEW_TYPE[current.key], name: "" })}>
            + New {current.key === "compliance" ? "rule" : TYPE_TITLES[NEW_TYPE[current.key]].replace(/s$/, "").toLowerCase()}
          </Button>
        )}
      </div>
      <Alert variant="info" className="py-2 small">
        <strong>Live:</strong> what you <strong>publish</strong> here is what the AI uses, within a minute. Drafts are
        never sent to customers. &quot;Reset to default&quot; or reverting puts the earlier version back the same way.
      </Alert>

      <Nav variant="pills" activeKey={section} onSelect={(k) => { setSection(k); setSelected(null); setItem(null); }}
        className="mb-3">
        {SECTIONS.map((s) => <Nav.Item key={s.key}><Nav.Link eventKey={s.key}>{s.label}</Nav.Link></Nav.Item>)}
      </Nav>

      {message && (
        <Alert variant={message.variant} onClose={() => setMessage(null)} dismissible className="py-2">
          {message.text}
          {message.problems && <ul className="mb-0 mt-1">{message.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </Alert>
      )}

      <Row>
        <Col md={section === "workflows" ? 2 : 3}>
          {!list && <Spinner size="sm" />}
          {current.types.map((type) => {
            const rows = inSection.filter((i) => i.type === type);
            if (!rows.length) return null;
            return (
              <div key={type} className="mb-3">
                {current.types.length > 1 && <div className="small text-uppercase text-muted fw-semibold mb-1">
                  {TYPE_TITLES[type]}</div>}
                {rows.map((i) => (
                  <div key={i.id} role="button" onClick={() => setSelected(i.id)}
                    className="mb-1" style={{ padding: "9px 12px", borderRadius: 10, cursor: "pointer",
                      background: selected === i.id ? "#3b7ddd" : "#fff", color: selected === i.id ? "#fff" : "#1f2a44",
                      boxShadow: selected === i.id ? "none" : "0 1px 2px rgba(30,60,120,.08)" }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{i.name}</div>
                    <div className="d-flex gap-3 mt-1" style={{ fontSize: 11.5,
                      color: selected === i.id ? "rgba(255,255,255,.85)" : "#6b7a90" }}>
                      {i.published_version && <span><span style={{ color: selected === i.id ? "#b9f5c9" : "#27ae60" }}>●</span>
                        {" "}Live · v{i.published_version}</span>}
                      {i.draft_version && <span><span style={{ color: "#f0a500" }}>●</span> Draft v{i.draft_version}</span>}
                      {i.locked && <span>🔒 Locked</span>}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </Col>
        <Col md={section === "workflows" ? 10 : 9}>
          {item && draft && current.types.includes(item.type) && (
            <Card>
              <Card.Header className="d-flex flex-wrap gap-2 justify-content-between align-items-center">
                <div>
                  <strong>{item.name}</strong>
                  {published && (
                    <div className="small text-muted">
                      Live v{published.version} · published {when(published.published_at || published.created_at)}
                      {published.published_by_name ? ` by ${published.published_by_name}` : ""} ·{" "}
                      {item.ai_applied_version === published.version
                        ? <span style={{ color: "#27ae60" }}>AI using it since {when(item.ai_applied_at)}</span>
                        : <span style={{ color: "#b07800" }}>AI picks it up within a minute</span>}
                    </div>
                  )}
                  {item.locked && <Badge bg="secondary" className="ms-2">Locked: keeps the AI legal and safe</Badge>}
                </div>
                {!readOnly && (
                  <div className="d-flex flex-wrap gap-2">
                    <Form.Control size="sm" placeholder="What did you change? (optional)" value={note}
                      onChange={(e) => setNote(e.target.value)} style={{ width: 240 }} />
                    <Button size="sm" variant="outline-primary" disabled={busy}
                      onClick={() => run(async () => {
                        try {
                          return await call("PUT", { content: draft, note, base_version: item.latest_version });
                        } catch (e) {
                          if (!e.data?.conflict) throw e;
                          // Someone saved since this was opened: never overwrite them without asking.
                          if (!window.confirm(`${e.data.changed_by} changed this on ${when(e.data.changed_at)}, `
                            + "after you opened it. Save your version on top? (Theirs stays in History.)")) {
                            throw new Error(`Not saved. ${e.data.changed_by} changed it on ${when(e.data.changed_at)}; `
                              + "open it again to see their change.");
                          }
                          return call("PUT", { content: draft, note, force: true });
                        }
                      }, "Draft saved.")}>Save draft</Button>
                    {item.draft_version && <Button size="sm" variant="success" disabled={busy}
                      onClick={() => run(() => call("POST", { action: "publish" }), "Published.")}>
                      Publish draft v{item.draft_version}</Button>}
                    {item.has_default && <Button size="sm" variant="outline-secondary" disabled={busy}
                      onClick={() => run(() => call("POST", { action: "reset" }), "Reset to the AutoPulse default.")}>
                      Reset to default</Button>}
                    {!item.has_default && !item.locked && <Button size="sm" variant="outline-danger" disabled={busy}
                      onClick={async () => {
                        if (!window.confirm(`Delete "${item.name}"? The AI stops using it within a minute.`)) return;
                        const res = await run(() => call("DELETE"), `Deleted "${item.name}".`);
                        if (res?.deleted) { setSelected(null); setItem(null); }
                      }}>Delete</Button>}
                  </div>
                )}
              </Card.Header>
              <Card.Body>
                <Tabs defaultActiveKey="edit" className="mb-3">
                  <Tab eventKey="edit" title={item.draft_version ? `Editing draft v${item.draft_version}` : "Edit"}>
                    <Editor item={item} content={draft} onChange={setDraft} placeholders={placeholders}
                      readOnly={readOnly} agents={agents} />
                  </Tab>
                  {published && (
                    <Tab eventKey="live" title={`Live (v${published.version})`}>
                      <Editor item={item} content={published.content} onChange={() => {}} placeholders={placeholders}
                        readOnly agents={agents} />
                    </Tab>
                  )}
                  <Tab eventKey="history" title={`History (${item.versions.length})`}>
                    {item.versions.map((v) => (
                      <div key={v.version} className="d-flex justify-content-between align-items-center border-bottom py-2">
                        <div className="small">
                          <strong>v{v.version}</strong>{" "}
                          <Badge bg={v.status === "published" ? "success" : v.status === "draft" ? "warning" : "light"}
                            text={v.status === "published" ? undefined : "dark"}>{v.status}</Badge>{" "}{v.note || ""}
                          <div className="text-muted">{v.created_by_name} · {when(v.created_at)}
                            {v.published_at ? ` · published ${when(v.published_at)} by ${v.published_by_name}` : ""}</div>
                        </div>
                        <div className="d-flex gap-2">
                          <Button size="sm" variant="outline-secondary" onClick={() => setViewVersion(v)}>View</Button>
                          {!readOnly && v.version !== item.published_version && (
                            <Button size="sm" variant="outline-warning" disabled={busy}
                              onClick={() => run(() => call("POST", { action: "revert", version: v.version }),
                                `Reverted to version ${v.version}.`)}>Revert to this</Button>)}
                        </div>
                      </div>
                    ))}
                  </Tab>
                </Tabs>
              </Card.Body>
            </Card>
          )}
        </Col>
      </Row>

      <Modal show={!!viewVersion} onHide={() => setViewVersion(null)} size="xl">
        <Modal.Header closeButton><Modal.Title>{item?.name}: version {viewVersion?.version}</Modal.Title></Modal.Header>
        <Modal.Body>
          {viewVersion && item && <Editor item={item} content={viewVersion.content} onChange={() => {}}
            placeholders={placeholders} readOnly agents={agents} />}
        </Modal.Body>
      </Modal>

      <Modal show={!!creating} onHide={() => setCreating(null)}>
        <Modal.Header closeButton><Modal.Title>New</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Select className="mb-2" value={creating?.type || "workflows"}
            onChange={(e) => setCreating({ ...creating, type: e.target.value })}>
            {["workflows", "cadences", "agents", "buckets", "messages", "compliance"].map((t) => <option key={t} value={t}>
              {t === "compliance" ? "Rule (SMS / email)" : TYPE_TITLES[t]}</option>)}
          </Form.Select>
          <Form.Control placeholder="Name (e.g. Trade-in follow-up)" value={creating?.name || ""}
            onChange={(e) => setCreating({ ...creating, name: e.target.value })} />
        </Modal.Body>
        <Modal.Footer><Button disabled={busy || !creating?.name} onClick={create}>Create draft</Button></Modal.Footer>
      </Modal>
    </div>
  );
}
