"use client";
// A customer's dealership forms (SOW v6 Deliverable K, gaps G-065 / G-066). Start a form: pick the lead (the
// opportunity), the form and the trade-ins -> the on-screen form opens with what the CRM knows already in -> staff
// complete the rest -> Save draft (come back later) or Complete (locked for good; required fields first) -> the PDF
// downloads or prints. The forms are the dealership's own (Admin > Forms Library).
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner, Table } from "react-bootstrap";
import { useUser } from "../../../context/UserContext";
import { formsGet, formsSend, openPdf } from "../../../forms/formsApi";
import FormView from "../../../forms/components/FormView";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });
const leadLabel = (l) => [[l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(" ") || "No vehicle",
  l.fe_lead_status, l.createdAt ? new Date(l.createdAt).toLocaleDateString() : null].filter(Boolean).join(" · ");
const tradeLabel = (t) => [[t.year, t.make, t.model].filter(Boolean).join(" ") || "Trade-in", t.vin].filter(Boolean).join(" · ");

function FillModal({ dealerId, id, onHide, onChanged }) {
  const [doc, setDoc] = useState(null);
  const [data, setData] = useState({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    formsGet(`/api/forms/documents/${id}?dealer_id=${dealerId}`).then((d) => { setDoc(d.document); setData(d.document.data); })
      .catch((e) => setError(e.message));
  }, [id, dealerId]);
  const save = async (complete) => {
    setBusy(true); setError(null);
    try {
      const d = await formsSend(`/api/forms/documents/${id}`, "PATCH", { dealer_id: dealerId, data, complete });
      setDoc(d.document); setData(d.document.data); setDirty(false); onChanged();
      return true;
    } catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  };
  const pdf = async (print) => {
    if (dirty && !(await save(false))) return;
    setBusy(true);
    try { await openPdf(`/api/forms/documents/${id}/pdf?dealer_id=${dealerId}${print ? "&print=1" : ""}`, print ? {} : { download: `${doc.name}.pdf` }); onChanged(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const close = () => { if (!dirty || window.confirm("Close without saving your changes?")) onHide(); };
  const removeDraft = async () => {
    if (!window.confirm("Delete this draft? What was entered on it is lost.")) return;
    setBusy(true); setError(null);
    try { await formsSend(`/api/forms/documents/${id}?dealer_id=${dealerId}`, "DELETE"); onChanged(); onHide(); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  const done = doc?.status === "completed";
  return (
    <Modal show onHide={close} size="xl" centered scrollable backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title as="h6">{doc?.name || "Form"} {doc && (done ? <Badge bg="success">Completed</Badge> : <Badge bg="secondary">Draft</Badge>)}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        {!doc ? <Spinner animation="border" /> : (
          <>
            {done ? <Alert variant="light" className="border py-2 small">Completed by {doc.completed_by || "staff"} on{" "}
              {new Date(doc.completed_at).toLocaleString()}. It can no longer be changed.</Alert>
              : doc.missing_required.length > 0 && <Alert variant="warning" className="py-2 small">Still required:{" "}
                <strong>{doc.missing_required.join(", ")}</strong></Alert>}
            <FormView schema={doc.schema} data={data} trades={doc.trades} hidden={doc.hidden} prefilled={doc.prefilled}
              mode={done ? "view" : "fill"} onChange={(k, v) => { setData((x) => ({ ...x, [k]: v })); setDirty(true); }} />
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        {doc && !done && <Button size="sm" variant="outline-danger" className="me-auto" disabled={busy} onClick={removeDraft}>
          Delete draft</Button>}
        <Button size="sm" variant="outline-custom" disabled={busy || !doc} onClick={() => pdf(false)}>Download PDF</Button>
        <Button size="sm" variant="outline-custom" disabled={busy || !doc} onClick={() => pdf(true)}>Print</Button>
        {!done && <Button size="sm" variant="outline-custom" disabled={busy || !dirty} onClick={() => save(false)}>Save draft</Button>}
        {!done && <Button size="sm" variant="custom" disabled={busy || !doc}
          onClick={() => { if (window.confirm("Complete this form? It can't be changed afterwards.")) save(true); }}>Complete</Button>}
      </Modal.Footer>
    </Modal>
  );
}

export default function DocumentsTab({ customerId }) {
  const { dealerParent } = useUser();
  const dealerId = dealerParent?.id;
  const [leads, setLeads] = useState([]);
  const [trades, setTrades] = useState([]);
  const [docs, setDocs] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [pick, setPick] = useState({ lead_id: "", template_id: "", trade_in_ids: [] });
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loadDocs = useCallback(async () => {
    if (!dealerId) return;
    try { setDocs((await formsGet(`/api/forms/documents?dealer_id=${dealerId}&customer_id=${customerId}`)).documents); }
    catch (e) { setError(e.message); }
  }, [dealerId, customerId]);

  useEffect(() => {
    if (!dealerId) return;
    loadDocs();
    const q = new URLSearchParams({ dealer_id: dealerId, customer_id: customerId, page: "1", limit: "50" });
    fetch(`/api/leads?${q}`, { headers: auth() }).then((r) => r.json()).then((d) => {
      const list = d.data || [];
      setLeads(list);
      if (list[0]) setPick((p) => ({ ...p, lead_id: p.lead_id || list[0]._id }));
    }).catch(() => {});
    fetch(`/api/customers/${customerId}/trade-ins?dealer_id=${dealerId}&limit=50`, { headers: auth() })
      .then((r) => r.json()).then((d) => setTrades(d.data || [])).catch(() => {});
  }, [dealerId, customerId, loadDocs]);

  useEffect(() => {
    if (!dealerId) return;
    formsGet(`/api/forms/templates?dealer_id=${dealerId}&usable=1${pick.lead_id ? `&lead_id=${pick.lead_id}` : ""}`)
      .then((d) => {
        setTemplates(d.templates);
        setPick((p) => ({ ...p, template_id: d.templates.some((t) => t.id === p.template_id) ? p.template_id : "" }));
      }).catch((e) => setError(e.message));
  }, [dealerId, pick.lead_id]);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const { document } = await formsSend("/api/forms/documents", "POST", { dealer_id: dealerId, customer_id: customerId,
        ...pick, lead_id: pick.lead_id || null });
      await loadDocs(); setOpen(document.id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="w_card">
      <h3 className="w_card_title mb-3">Documents</h3>
      {error && <Alert variant="danger" className="py-2">{error}</Alert>}
      <Row className="g-2 small mb-2">
        <Col md={4}><Form.Label className="mb-0">Lead (opportunity)</Form.Label>
          <Form.Select size="sm" value={pick.lead_id} onChange={(e) => setPick({ ...pick, lead_id: e.target.value })}>
            <option value="">No lead</option>
            {leads.map((l) => <option key={l._id} value={l._id}>{leadLabel(l)}</option>)}
          </Form.Select></Col>
        <Col md={4}><Form.Label className="mb-0">Form</Form.Label>
          <Form.Select size="sm" value={pick.template_id} onChange={(e) => setPick({ ...pick, template_id: e.target.value })}>
            <option value="">{templates.length ? "Choose a form..." : "No forms available for this lead"}</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
          </Form.Select></Col>
        <Col md={4}><Form.Label className="mb-0">Trade-ins</Form.Label>
          {trades.length ? trades.map((t) => (
            <Form.Check key={t._id} id={`trade-${t._id}`} label={tradeLabel(t)} checked={pick.trade_in_ids.includes(t._id)}
              onChange={(e) => setPick({ ...pick, trade_in_ids: e.target.checked ? [...pick.trade_in_ids, t._id]
                : pick.trade_in_ids.filter((x) => x !== t._id) })} />
          )) : <div className="text-muted">None on file</div>}</Col>
      </Row>
      <Button size="sm" variant="custom" className="mb-3" disabled={busy || !pick.template_id} onClick={start}>
        {busy ? <Spinner size="sm" /> : "Start the form"}</Button>

      <h6>Forms for this customer</h6>
      {!docs ? <Spinner size="sm" /> : !docs.length ? <p className="small text-muted">None yet.</p> : (
        <Table size="sm" hover className="small">
          <thead><tr><th>Form</th><th>Lead</th><th>Started</th><th>Status</th></tr></thead>
          <tbody>
            {docs.map((d) => {
              const lead = d.lead_id && leads.find((l) => l._id === d.lead_id);
              return (
                <tr key={d.id} role={d.removed ? undefined : "button"} onClick={() => !d.removed && setOpen(d.id)}>
                  <td>{d.name} <small className="text-muted">v{d.version}</small></td>
                  <td>{lead ? leadLabel(lead) : "-"}</td>
                  <td>{d.created_by || "Staff"}, {new Date(d.created_at).toLocaleString()}</td>
                  <td>{d.removed ? <span className="text-muted">removed (retention)</span> : d.status === "completed"
                    ? <Badge bg="success">Completed</Badge> : <Badge bg="secondary">Draft</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {open && <FillModal dealerId={dealerId} id={open} onHide={() => setOpen(null)} onChanged={loadDocs} />}
    </div>
  );
}
