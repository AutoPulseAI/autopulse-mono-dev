"use client";
// The form builder (SOW v6 Deliverable K; the user, 13 Nov 2026: "an editable form ... they will be able to change
// everything, like the applications that let you create your own forms"). The form read from the dealer's PDF opens
// here as an on-screen form: click any field to change it (label, type, width, required, choices, the CRM value that
// fills it), move / copy / delete it, add fields and sections, rename the form. "Preview PDF" shows how it will print.
// Saving a form already used for customers makes a new version (their copies keep the one they were made with).
// The "Settings" tab: category, on / off, department, roles, lead statuses, how long filled copies are kept.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Alert, Badge, Button, ButtonGroup, Col, Dropdown, Form, Nav, Row, Spinner } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import { formsGet, formsSend, openPdf } from "../formsApi";
import FormView from "../components/FormView";
import { FIELD_TYPES, INPUT_TYPES, REPEATS, WIDTHS, newId } from "../../../lib/forms/schema";

const blankField = (type) => ({ id: newId(), type, label: type === "heading" || type === "paragraph" ? "" : FIELD_TYPES[type],
  required: false, width: "full", options: type === "select" || type === "radio" ? ["Option 1", "Option 2"] : [],
  source: null, help: null, text: type === "heading" ? "Heading" : type === "paragraph" ? "Text" : null });

function SourceSelect({ sources, value, onChange, repeat }) {
  const groups = useMemo(() => {
    const out = new Map();
    for (const s of sources) {
      if (!out.has(s.group)) out.set(s.group, []);
      out.get(s.group).push(s);
    }
    return [...out.entries()];
  }, [sources]);
  return (
    <Form.Select size="sm" value={value || ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Typed in by staff</option>
      {groups.map(([group, items]) => (
        <optgroup key={group} label={group === "Trade-in" && !repeat ? "Trade-in (the first one picked)" : group}>
          {items.map((s) => <option key={s.key} value={s.key}>{s.label}{s.sensitive ? " (managers only)" : ""}</option>)}
        </optgroup>
      ))}
    </Form.Select>
  );
}

export default function FormBuilderPage() {
  const { id } = useParams();
  const router = useRouter();
  const { dealerParent } = useUser();
  const dealerId = dealerParent?.id;
  const [meta, setMeta] = useState(null);
  const [schema, setSchema] = useState(null);
  const [settings, setSettings] = useState(null);
  const [tab, setTab] = useState("form");
  const [selected, setSelected] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const base = `/api/forms/templates/${id}`;

  const apply = (d) => {
    setMeta(d);
    const t = d.template;
    setSchema(t.schema || { title: t.name, description: null, sections: [{ id: newId("s"), title: "", repeat: null, fields: [] }] });
    setSettings({ name: t.name, category: t.category, active: t.active, departments: t.departments, role_ids: t.role_ids,
      statuses: t.statuses, retention_days: t.retention_days ?? "" });
    setDirty(false);
  };
  const load = useCallback(async () => {
    if (!dealerId) return;
    try { apply(await formsGet(`${base}?dealer_id=${dealerId}`)); } catch (e) { setError(e.message); }
  }, [base, dealerId]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, done) => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); if (done) setNotice(done); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const edit = (fn) => { setSchema((s) => fn(structuredClone(s))); setDirty(true); };
  const where = (s, fieldId) => {
    for (const sec of s.sections) { const i = sec.fields.findIndex((f) => f.id === fieldId); if (i >= 0) return [sec, i]; }
    return [null, -1];
  };
  const field = useMemo(() => {
    if (!schema || !selected) return null;
    for (const sec of schema.sections) { const f = sec.fields.find((x) => x.id === selected); if (f) return { f, sec }; }
    return null;
  }, [schema, selected]);
  const setField = (patch) => edit((s) => { const [sec, i] = where(s, selected); if (sec) Object.assign(sec.fields[i], patch); return s; });
  const moveField = (d) => edit((s) => {
    const [sec, i] = where(s, selected);
    if (!sec) return s;
    const si = s.sections.indexOf(sec);
    if (i + d >= 0 && i + d < sec.fields.length) [sec.fields[i], sec.fields[i + d]] = [sec.fields[i + d], sec.fields[i]];
    else if (s.sections[si + d]) { // across into the next / previous section
      const [f] = sec.fields.splice(i, 1);
      if (d < 0) s.sections[si - 1].fields.push(f); else s.sections[si + 1].fields.unshift(f);
    }
    return s;
  });
  const addField = (sectionId, type) => {
    const f = blankField(type);
    edit((s) => { s.sections.find((x) => x.id === sectionId).fields.push(f); return s; });
    setSelected(f.id);
  };

  const save = () => run(async () => {
    const d = await formsSend(base, "PATCH", { dealer_id: dealerId, schema });
    apply({ ...meta, template: d.template });
  }, "Form saved.");
  const saveSettings = () => run(async () => {
    const d = await formsSend(base, "PATCH", { dealer_id: dealerId, ...settings,
      retention_days: settings.retention_days === "" ? null : Number(settings.retention_days) });
    setMeta((m) => ({ ...m, template: d.template }));
  }, "Settings saved.");
  const remove = () => run(async () => {
    if (!window.confirm(`Delete "${t.name}" from the Forms Library? Staff won't be able to start it any more. Forms `
      + "already filled for customers are kept as they are.")) return;
    await formsSend(`${base}?dealer_id=${dealerId}`, "DELETE");
    router.push("/dealer/forms");
  });
  const reread = (file) => run(async () => {
    if (dirty && !window.confirm("Reading a new PDF replaces the unsaved changes here. Go on?")) return;
    const fd = new FormData(); fd.set("dealer_id", dealerId); fd.set("file", file);
    const d = await formsSend(base, "POST", fd);
    apply({ ...meta, template: d.template });
  }, "The new PDF was read into a new version. Check it and save.");

  if (!meta || !schema) {
    return <div className="page_content d-flex justify-content-center p-5">
      {error ? <Alert variant="danger">{error}</Alert> : <Spinner animation="border" />}</div>;
  }
  const t = meta.template;
  const can = meta.can_manage;
  const toggle = (k, v) => setSettings((s) => ({ ...s, [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v] }));

  return (
    <div className="page_content">
      <div className="page_head d-flex flex-wrap align-items-center gap-2">
        <Button size="sm" variant="link" className="p-0 me-1" onClick={() => router.push("/dealer/forms")}>
          <i className="fa-solid fa-arrow-left me-1" />Forms Library</Button>
        <h3 className="page_title mb-0 me-auto">{t.name} <small className="text-muted fs-6">v{t.current_version}</small>
          {" "}{t.active ? <Badge bg="success">On</Badge> : <Badge bg="secondary">Off</Badge>}</h3>
        {t.source_filename && <Button size="sm" variant="outline-custom"
          onClick={() => run(() => openPdf(`${base}/source?dealer_id=${dealerId}`))}>Original PDF</Button>}
        <Button size="sm" variant="outline-custom" disabled={busy}
          onClick={() => run(() => openPdf(`${base}/preview`, { method: "POST", body: { dealer_id: dealerId, schema } }))}>
          Preview PDF</Button>
        {can && <Button size="sm" variant="outline-danger" disabled={busy} onClick={remove}>
          <i className="fa-regular fa-trash-can me-1" />Delete form</Button>}
        {can && <Button size="sm" variant="custom" disabled={busy || !dirty} onClick={save}>{busy ? <Spinner size="sm" /> : "Save form"}</Button>}
      </div>
      <div className="page_body">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        {notice && <Alert variant="success" className="py-2">{notice}</Alert>}
        {!t.active && <Alert variant="info" className="py-2 small">This form is <strong>off</strong>: staff can&apos;t use it
          yet. Check every field, save, then switch it on in Settings.</Alert>}
        <Nav variant="tabs" activeKey={tab} onSelect={setTab} className="mb-3">
          <Nav.Item><Nav.Link eventKey="form">Form</Nav.Link></Nav.Item>
          <Nav.Item><Nav.Link eventKey="settings">Settings</Nav.Link></Nav.Item>
          <Nav.Item><Nav.Link eventKey="history">Versions &amp; history</Nav.Link></Nav.Item>
        </Nav>

        {tab === "form" && (
          <Row className="g-3">
            <Col lg={8}>
              <div className="w_card">
                {can && (
                  <Row className="g-2 mb-3 small">
                    <Col md={6}><Form.Label className="mb-0">Form title (printed at the top)</Form.Label>
                      <Form.Control size="sm" value={schema.title} onChange={(e) => edit((s) => ({ ...s, title: e.target.value }))} /></Col>
                    <Col md={6}><Form.Label className="mb-0">Description (optional)</Form.Label>
                      <Form.Control size="sm" value={schema.description || ""} onChange={(e) => edit((s) => ({ ...s, description: e.target.value }))} /></Col>
                  </Row>
                )}
                {schema.sections.map((sec, si) => (
                  <div key={sec.id} className="border rounded p-2 mb-3">
                    {can && (
                      <div className="d-flex flex-wrap align-items-center gap-2 mb-2 small">
                        <Form.Control size="sm" style={{ maxWidth: 260 }} placeholder="Section title" value={sec.title}
                          onChange={(e) => edit((s) => { s.sections[si].title = e.target.value; return s; })} />
                        <Form.Check id={`rep-${sec.id}`} label={REPEATS.trade_in} checked={sec.repeat === "trade_in"}
                          onChange={(e) => edit((s) => { s.sections[si].repeat = e.target.checked ? "trade_in" : null; return s; })} />
                        <ButtonGroup size="sm" className="ms-auto">
                          <Button variant="light" disabled={si === 0} onClick={() => edit((s) => { [s.sections[si - 1], s.sections[si]] = [s.sections[si], s.sections[si - 1]]; return s; })}>↑</Button>
                          <Button variant="light" disabled={si === schema.sections.length - 1} onClick={() => edit((s) => { [s.sections[si + 1], s.sections[si]] = [s.sections[si], s.sections[si + 1]]; return s; })}>↓</Button>
                          <Button variant="light" className="text-danger" disabled={schema.sections.length === 1}
                            onClick={() => { if (window.confirm("Delete this section and its fields?")) edit((s) => { s.sections.splice(si, 1); return s; }); }}>✕</Button>
                        </ButtonGroup>
                      </div>
                    )}
                    <FormView schema={{ title: "", sections: [sec] }} mode="design" selected={selected} onSelect={setSelected} />
                    {can && (
                      <Dropdown className="mt-2">
                        <Dropdown.Toggle size="sm" variant="outline-custom">+ Add field</Dropdown.Toggle>
                        <Dropdown.Menu>
                          {Object.entries(FIELD_TYPES).map(([k, label]) => <Dropdown.Item key={k} onClick={() => addField(sec.id, k)}>{label}</Dropdown.Item>)}
                        </Dropdown.Menu>
                      </Dropdown>
                    )}
                  </div>
                ))}
                {can && <Button size="sm" variant="outline-custom" onClick={() => edit((s) => { s.sections.push({ id: newId("s"), title: "New section", repeat: null, fields: [] }); return s; })}>+ Add section</Button>}
              </div>
            </Col>
            <Col lg={4}>
              <div className="w_card small" style={{ position: "sticky", top: 12 }}>
                {!field ? <p className="text-muted mb-0">Click a field on the form to change it.</p> : (
                  <>
                    <div className="d-flex align-items-center mb-2">
                      <strong className="me-auto">{FIELD_TYPES[field.f.type]}</strong>
                      {can && (
                        <ButtonGroup size="sm">
                          <Button variant="light" title="Move up" onClick={() => moveField(-1)}>↑</Button>
                          <Button variant="light" title="Move down" onClick={() => moveField(1)}>↓</Button>
                          <Button variant="light" title="Copy" onClick={() => edit((s) => { const [sec, i] = where(s, selected); sec.fields.splice(i + 1, 0, { ...structuredClone(sec.fields[i]), id: newId() }); return s; })}>⧉</Button>
                          <Button variant="light" className="text-danger" title="Delete" onClick={() => { edit((s) => { const [sec, i] = where(s, selected); sec.fields.splice(i, 1); return s; }); setSelected(null); }}>✕</Button>
                        </ButtonGroup>
                      )}
                    </div>
                    <fieldset disabled={!can}>
                      <Form.Group className="mb-2"><Form.Label className="mb-0">Type</Form.Label>
                        <Form.Select size="sm" value={field.f.type} onChange={(e) => {
                          const type = e.target.value;
                          setField({ type, ...(type === "heading" || type === "paragraph" ? { text: field.f.text || field.f.label, source: null, required: false } : {}),
                            ...((type === "select" || type === "radio") && !field.f.options.length ? { options: ["Option 1", "Option 2"] } : {}) });
                        }}>{Object.entries(FIELD_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Form.Select></Form.Group>
                      {field.f.type === "heading" || field.f.type === "paragraph" ? (
                        <Form.Group className="mb-2"><Form.Label className="mb-0">Wording</Form.Label>
                          <Form.Control as="textarea" rows={field.f.type === "paragraph" ? 6 : 2} value={field.f.text || ""}
                            onChange={(e) => setField({ text: e.target.value })} /></Form.Group>
                      ) : (
                        <>
                          <Form.Group className="mb-2"><Form.Label className="mb-0">Label</Form.Label>
                            <Form.Control size="sm" value={field.f.label} onChange={(e) => setField({ label: e.target.value })} /></Form.Group>
                          <Form.Group className="mb-2"><Form.Label className="mb-0">Filled from the CRM</Form.Label>
                            <SourceSelect sources={meta.sources} value={field.f.source} repeat={field.sec.repeat === "trade_in"}
                              onChange={(source) => setField({ source })} />
                            <Form.Text>Staff can still change it on the form.</Form.Text></Form.Group>
                          {(field.f.type === "select" || field.f.type === "radio") && (
                            <Form.Group className="mb-2"><Form.Label className="mb-0">Choices (one per line)</Form.Label>
                              <Form.Control as="textarea" rows={4} value={field.f.options.join("\n")}
                                onChange={(e) => setField({ options: e.target.value.split("\n") })} /></Form.Group>
                          )}
                          <Form.Group className="mb-2"><Form.Label className="mb-0">Help text (optional)</Form.Label>
                            <Form.Control size="sm" value={field.f.help || ""} onChange={(e) => setField({ help: e.target.value })} /></Form.Group>
                          <Form.Check id="f-req" className="mb-2" label="Required (the form can't be completed without it)"
                            checked={field.f.required} disabled={field.f.type === "checkbox"} onChange={(e) => setField({ required: e.target.checked })} />
                        </>
                      )}
                      {INPUT_TYPES.includes(field.f.type) && (
                        <Form.Group><Form.Label className="mb-0">Width</Form.Label>
                          <Form.Select size="sm" value={field.f.width} onChange={(e) => setField({ width: e.target.value })}>
                            {Object.entries(WIDTHS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Form.Select></Form.Group>
                      )}
                    </fieldset>
                  </>
                )}
              </div>
            </Col>
          </Row>
        )}

        {tab === "settings" && settings && (
          <div className="w_card small">
            <fieldset disabled={!can}>
              <Row className="g-2 mb-3">
                <Col md={4}><Form.Label className="mb-0">Name in the library</Form.Label>
                  <Form.Control size="sm" value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} /></Col>
                <Col md={3}><Form.Label className="mb-0">Category</Form.Label>
                  <Form.Select size="sm" value={settings.category} onChange={(e) => setSettings({ ...settings, category: e.target.value })}>
                    {meta.categories.map((c) => <option key={c}>{c}</option>)}</Form.Select></Col>
                <Col md={3}><Form.Label className="mb-0">Keep filled forms (days)</Form.Label>
                  <Form.Control size="sm" type="number" min={30} placeholder="always" value={settings.retention_days}
                    onChange={(e) => setSettings({ ...settings, retention_days: e.target.value })} /></Col>
                <Col md={2} className="d-flex align-items-end">
                  <Form.Check type="switch" id="f-active" label={settings.active ? "On - staff can use it" : "Off"} checked={settings.active}
                    onChange={(e) => setSettings({ ...settings, active: e.target.checked })} /></Col>
              </Row>
              <div className="mb-2"><strong>Department</strong> <span className="text-muted">(none = both)</span><br />
                {["sales", "service"].map((d) => <Form.Check key={d} inline id={`d-${d}`} label={d === "sales" ? "Sales" : "Service"}
                  checked={settings.departments.includes(d)} onChange={() => toggle("departments", d)} />)}</div>
              <div className="mb-2"><strong>Roles that can use it</strong> <span className="text-muted">(none = every role)</span><br />
                {meta.roles.length ? meta.roles.map((r) => <Form.Check key={r.id} inline id={`r-${r.id}`} label={r.name}
                  checked={settings.role_ids.includes(r.id)} onChange={() => toggle("role_ids", r.id)} />) : <span className="text-muted">No staff roles set up.</span>}</div>
              <div className="mb-3"><strong>Available when the lead is</strong> <span className="text-muted">(none = any status)</span><br />
                {meta.statuses.map((s) => <Form.Check key={s} inline id={`s-${s}`} label={s} checked={settings.statuses.includes(s)}
                  onChange={() => toggle("statuses", s)} />)}</div>
            </fieldset>
            {can && <Button size="sm" variant="custom" disabled={busy} onClick={saveSettings}>Save settings</Button>}
          </div>
        )}

        {tab === "history" && (
          <div className="w_card small">
            {can && (
              <Form.Group className="mb-3"><Form.Label className="mb-0">Read a new PDF of this form (it becomes a new version
                for you to check; forms already filled keep theirs)</Form.Label>
                <Form.Control size="sm" type="file" accept="application/pdf" disabled={busy}
                  onChange={(e) => { if (e.target.files?.[0]) reread(e.target.files[0]); e.target.value = ""; }} /></Form.Group>
            )}
            <h6>Versions</h6>
            <ul>{t.version_list.map((v) => <li key={v.version}>v{v.version}{v.version === t.current_version ? " (in use)" : ""} ·
              {" "}{v.created_by || "Staff"}, {new Date(v.created_at).toLocaleString()}{v.from_pdf ? ` · from ${v.from_pdf}` : ""}</li>)}</ul>
            <h6>History</h6>
            <ul className="mb-0">{t.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString()} · {h.by_name || "Staff"} ·
              {" "}{h.action}{h.detail ? `: ${h.detail}` : ""}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}
