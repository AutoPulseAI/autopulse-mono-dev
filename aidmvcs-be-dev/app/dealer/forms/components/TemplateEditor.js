"use client";
// One form of the Forms Library: who can use it and when (G-064), what fills each field (G-065), its versions and
// change history. A fillable PDF lists its own fields: pick what fills each one. A flat PDF gets boxes placed by page
// and position (points from the bottom-left corner; "Show grid" opens the page with a 50-point grid to read them off).
// "Preview mapping" opens the blank form with each field / box labelled - no customer data.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner, Table } from "react-bootstrap";
import { formsGet, formsSend, openPdf } from "../formsApi";

function SourceSelect({ sources, value, onChange, disabled }) {
  const groups = useMemo(() => {
    const out = new Map();
    for (const s of sources) { if (!out.has(s.group)) out.set(s.group, []); out.get(s.group).push(s); }
    return [...out.entries()];
  }, [sources]);
  return (
    <Form.Select size="sm" value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">Leave blank</option>
      {groups.map(([group, items]) => (
        <optgroup key={group} label={group}>
          {items.map((s) => <option key={s.key} value={s.key}>{s.label}{s.sensitive ? " (managers only)" : ""}</option>)}
        </optgroup>
      ))}
    </Form.Select>
  );
}

export default function TemplateEditor({ dealerId, id, canManage, categories, onHide }) {
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [mapping, setMapping] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const base = `/api/forms/templates/${id}`;

  const apply = (d) => {
    setData(d);
    const t = d.template;
    setSettings({ name: t.name, category: t.category, active: t.active, departments: t.departments,
      role_ids: t.role_ids, statuses: t.statuses, retention_days: t.retention_days ?? "" });
    if (t.fillable) {
      const byField = new Map(t.mapping.filter((m) => m.field).map((m) => [m.field, m]));
      setMapping(t.fields.map((f) => ({ field: f.name, type: f.type, source: byField.get(f.name)?.source || "",
        required: Boolean(byField.get(f.name)?.required) })));
    } else {
      setMapping(t.mapping.map((m) => ({ ...m })));
    }
  };
  const load = useCallback(async () => {
    try { apply(await formsGet(`${base}?dealer_id=${dealerId}`)); } catch (e) { setError(e.message); }
  }, [base, dealerId]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, done) => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); if (done) setNotice(done); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const saveSettings = () => run(async () => {
    const d = await formsSend(base, "PATCH", { dealer_id: dealerId, ...settings,
      retention_days: settings.retention_days === "" ? null : Number(settings.retention_days) });
    setData((x) => ({ ...x, template: d.template }));
  }, "Settings saved.");
  const saveMapping = () => run(async () => {
    const rows = data.template.fillable ? mapping.filter((m) => m.source).map(({ field, source, required }) => ({ field, source, required }))
      : mapping;
    const d = await formsSend(base, "PATCH", { dealer_id: dealerId, mapping: rows });
    apply({ ...data, template: d.template });
  }, "Mapping saved.");
  const newVersion = (file) => run(async () => {
    const fd = new FormData(); fd.set("dealer_id", dealerId); fd.set("file", file);
    const d = await formsSend(base, "POST", fd);
    apply({ ...data, template: d.template });
    if (d.dropped?.length) setNotice(`New version saved. Not on the new PDF any more (map again): ${d.dropped.join(", ")}`);
  }, "New version saved; the mapping was carried over.");
  const pdf = (q) => run(() => openPdf(`${base}/pdf?dealer_id=${dealerId}${q}`));

  if (!data || !settings) {
    return <Modal show onHide={onHide} size="xl" centered><Modal.Body className="text-center p-5">
      {error ? <Alert variant="danger">{error}</Alert> : <Spinner animation="border" />}</Modal.Body></Modal>;
  }
  const t = data.template;
  const ro = !canManage || busy;
  const toggle = (key, value) => setSettings((s) => ({ ...s, [key]: s[key].includes(value)
    ? s[key].filter((x) => x !== value) : [...s[key], value] }));
  const setRow = (i, patch) => setMapping((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Modal show onHide={onHide} size="xl" centered scrollable>
      <Modal.Header closeButton>
        <Modal.Title as="h5">{t.name} <small className="text-muted">v{t.current_version} ·
          {t.fillable ? " fillable PDF" : " flat PDF"}</small></Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        {notice && <Alert variant="success" className="py-2">{notice}</Alert>}

        <h6>Who can use it, and when</h6>
        <Row className="g-2 small mb-2">
          <Col md={4}><Form.Label className="mb-0">Name</Form.Label>
            <Form.Control size="sm" value={settings.name} disabled={ro} onChange={(e) => setSettings({ ...settings, name: e.target.value })} /></Col>
          <Col md={3}><Form.Label className="mb-0">Category</Form.Label>
            <Form.Select size="sm" value={settings.category} disabled={ro} onChange={(e) => setSettings({ ...settings, category: e.target.value })}>
              {categories.map((c) => <option key={c}>{c}</option>)}</Form.Select></Col>
          <Col md={3}><Form.Label className="mb-0">Keep filled copies (days)</Form.Label>
            <Form.Control size="sm" type="number" min={30} placeholder="always" value={settings.retention_days} disabled={ro}
              onChange={(e) => setSettings({ ...settings, retention_days: e.target.value })} /></Col>
          <Col md={2} className="d-flex align-items-end">
            <Form.Check type="switch" id="form-active" label={settings.active ? "On" : "Off"} checked={settings.active}
              disabled={ro} onChange={(e) => setSettings({ ...settings, active: e.target.checked })} /></Col>
        </Row>
        <Row className="g-2 small mb-2">
          <Col md={3}><div className="mb-1 fw-semibold">Department (none = both)</div>
            {["sales", "service"].map((d) => <Form.Check key={d} inline id={`dep-${d}`} label={d === "sales" ? "Sales" : "Service"}
              checked={settings.departments.includes(d)} disabled={ro} onChange={() => toggle("departments", d)} />)}</Col>
          <Col md={4}><div className="mb-1 fw-semibold">Roles (none = every role)</div>
            {data.roles.length ? data.roles.map((r) => <Form.Check key={r.id} inline id={`role-${r.id}`} label={r.name}
              checked={settings.role_ids.includes(r.id)} disabled={ro} onChange={() => toggle("role_ids", r.id)} />)
              : <span className="text-muted">No staff roles set up.</span>}</Col>
          <Col md={5}><div className="mb-1 fw-semibold">Available when the lead is (none = any status)</div>
            {data.statuses.map((s) => <Form.Check key={s} inline id={`st-${s}`} label={s} checked={settings.statuses.includes(s)}
              disabled={ro} onChange={() => toggle("statuses", s)} />)}</Col>
        </Row>
        {canManage && <div className="text-end mb-3"><Button size="sm" variant="custom" disabled={busy} onClick={saveSettings}>Save settings</Button></div>}

        <div className="d-flex align-items-center mb-1">
          <h6 className="mb-0 me-auto">What fills each field</h6>
          <Button size="sm" variant="link" onClick={() => pdf("&layout=1")}>Preview mapping</Button>
          {!t.fillable && <Button size="sm" variant="link" onClick={() => pdf("&layout=1&grid=1")}>Show grid</Button>}
        </div>
        <p className="small text-muted mb-2">
          {t.fillable ? `The PDF's ${t.fields.length} fields. Pick what fills each one; a field left blank stays blank.`
            : `This PDF has no fields: place a box for each value - page, then the position in points from the bottom-left `
              + `corner (open "Show grid" to read them off the page) and the text size.`}
          {" "}Required fields must have a value before a copy can be saved. Payoff and lienholder print only for managers.
        </p>
        <Table size="sm" className="small align-middle">
          <thead>
            {t.fillable ? <tr><th>PDF field</th><th>Filled with</th><th>Required</th></tr>
              : <tr><th>Page</th><th>x</th><th>y</th><th>Size</th><th>Label</th><th>Filled with</th><th>Required</th><th /></tr>}
          </thead>
          <tbody>
            {mapping.map((m, i) => (t.fillable ? (
              <tr key={m.field}>
                <td className="text-break">{m.field} <small className="text-muted">{m.type?.replace("Field", "")}</small></td>
                <td style={{ minWidth: 260 }}><SourceSelect sources={data.sources} value={m.source} disabled={ro}
                  onChange={(source) => setRow(i, { source, required: source ? m.required : false })} /></td>
                <td><Form.Check checked={m.required} disabled={ro || !m.source} onChange={(e) => setRow(i, { required: e.target.checked })} /></td>
              </tr>
            ) : (
              <tr key={i}>
                {["page", "x", "y", "size"].map((k) => (
                  <td key={k} style={{ width: 80 }}><Form.Control size="sm" type="number" value={m[k] ?? ""} disabled={ro}
                    onChange={(e) => setRow(i, { [k]: e.target.value === "" ? "" : Number(e.target.value) })} /></td>
                ))}
                <td><Form.Control size="sm" value={m.label || ""} disabled={ro} onChange={(e) => setRow(i, { label: e.target.value })} /></td>
                <td style={{ minWidth: 240 }}><SourceSelect sources={data.sources} value={m.source} disabled={ro} onChange={(source) => setRow(i, { source })} /></td>
                <td><Form.Check checked={Boolean(m.required)} disabled={ro} onChange={(e) => setRow(i, { required: e.target.checked })} /></td>
                <td><Button size="sm" variant="link" className="text-danger p-0" disabled={ro}
                  onClick={() => setMapping((rows) => rows.filter((_, j) => j !== i))}>Remove</Button></td>
              </tr>
            )))}
          </tbody>
        </Table>
        {canManage && (
          <div className="d-flex gap-2 justify-content-end mb-3">
            {!t.fillable && <Button size="sm" variant="outline-custom" disabled={busy}
              onClick={() => setMapping((rows) => [...rows, { page: 1, x: 50, y: 700, size: 10, label: "", source: "", required: false }])}>
              + Add box</Button>}
            <Button size="sm" variant="custom" disabled={busy} onClick={saveMapping}>Save mapping</Button>
          </div>
        )}

        <h6>Versions</h6>
        {canManage && (
          <Form.Group className="mb-2 small">
            <Form.Label className="mb-0">Replace the PDF with a new version (the older ones are kept; copies already
              filled keep their version)</Form.Label>
            <Form.Control size="sm" type="file" accept="application/pdf" disabled={busy}
              onChange={(e) => { if (e.target.files?.[0]) newVersion(e.target.files[0]); e.target.value = ""; }} />
          </Form.Group>
        )}
        <Table size="sm" className="small">
          <tbody>
            {t.version_list.map((v) => (
              <tr key={v.version}>
                <td>v{v.version} {v.version === t.current_version && <Badge bg="primary" className="ms-1">in use</Badge>}</td>
                <td>{v.filename}</td><td>{v.fillable ? "fillable" : "flat"}</td><td>{v.mapped} mapped</td>
                <td className="text-muted">{v.uploaded_by || "Staff"}, {new Date(v.uploaded_at).toLocaleString()}</td>
                <td><Button size="sm" variant="link" className="p-0" onClick={() => pdf(`&version=${v.version}`)}>Open</Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
        <details className="small">
          <summary className="text-muted">Change history</summary>
          <ul className="mb-0 ps-3">
            {t.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString()} · {h.by_name || "Staff"} · {h.action}
              {h.detail ? `: ${h.detail}` : ""}</li>)}
          </ul>
        </details>
      </Modal.Body>
    </Modal>
  );
}
