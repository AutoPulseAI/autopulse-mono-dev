"use client";
// A customer's dealership forms (SOW v6 Deliverable K, gaps G-065 / G-066): pick the lead (the opportunity), the form
// and the trade-ins -> check every value that goes in (missing ones flagged, required ones block saving) -> preview
// the PDF -> save the copy, which is stored on the customer and the lead exactly as generated -> download / print.
// The forms are the dealership's own (Admin > Forms Library).
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Col, Form, Row, Spinner, Table } from "react-bootstrap";
import { useUser } from "../../../context/UserContext";
import { formsGet, formsSend, openPdf } from "../../../forms/formsApi";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });
const leadLabel = (l) => [[l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(" ") || "No vehicle",
  l.fe_lead_status, l.createdAt ? new Date(l.createdAt).toLocaleDateString() : null].filter(Boolean).join(" · ");
const tradeLabel = (t) => [[t.year, t.make, t.model].filter(Boolean).join(" ") || "Trade-in", t.vin].filter(Boolean).join(" · ");

export default function DocumentsTab({ customerId }) {
  const { dealerParent } = useUser();
  const dealerId = dealerParent?.id;
  const [leads, setLeads] = useState([]);
  const [trades, setTrades] = useState([]);
  const [docs, setDocs] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [pick, setPick] = useState({ lead_id: "", template_id: "", trade_in_ids: [] });
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

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
    setReview(null);
    formsGet(`/api/forms/templates?dealer_id=${dealerId}&usable=1${pick.lead_id ? `&lead_id=${pick.lead_id}` : ""}`)
      .then((d) => {
        setTemplates(d.templates);
        setPick((p) => ({ ...p, template_id: d.templates.some((t) => t.id === p.template_id) ? p.template_id : "" }));
      }).catch((e) => setError(e.message));
  }, [dealerId, pick.lead_id]);

  const body = (action) => ({ dealer_id: dealerId, customer_id: customerId, ...pick, lead_id: pick.lead_id || null, action });
  const run = async (fn) => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const doReview = () => run(async () => setReview(await formsSend("/api/forms/documents", "POST", body("review"))));
  const doPreview = () => run(() => openPdf("/api/forms/documents", { method: "POST", body: body("preview") }));
  const doSave = () => run(async () => {
    await formsSend("/api/forms/documents", "POST", body("save"));
    setReview(null); setNotice("Saved on the customer. Download or print it below."); await loadDocs();
  });
  const fileOf = (d, print) => run(() => openPdf(`/api/forms/documents/${d.id}?dealer_id=${dealerId}${print ? "&print=1" : ""}`,
    print ? {} : { download: `${d.name}.pdf` }).then(loadDocs));
  const changePick = (patch) => { setPick((p) => ({ ...p, ...patch })); setReview(null); };

  return (
    <div className="w_card">
      <h3 className="w_card_title mb-3">Documents</h3>
      {error && <Alert variant="danger" className="py-2">{error}</Alert>}
      {notice && <Alert variant="success" className="py-2">{notice}</Alert>}

      <Row className="g-2 small mb-2">
        <Col md={4}><Form.Label className="mb-0">Lead (opportunity)</Form.Label>
          <Form.Select size="sm" value={pick.lead_id} onChange={(e) => changePick({ lead_id: e.target.value })}>
            <option value="">No lead</option>
            {leads.map((l) => <option key={l._id} value={l._id}>{leadLabel(l)}</option>)}
          </Form.Select></Col>
        <Col md={4}><Form.Label className="mb-0">Form</Form.Label>
          <Form.Select size="sm" value={pick.template_id} onChange={(e) => changePick({ template_id: e.target.value })}>
            <option value="">{templates.length ? "Choose a form..." : "No forms available for this lead"}</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.category})</option>)}
          </Form.Select></Col>
        <Col md={4}><Form.Label className="mb-0">Trade-ins</Form.Label>
          {trades.length ? trades.map((t) => (
            <Form.Check key={t._id} id={`trade-${t._id}`} label={tradeLabel(t)} checked={pick.trade_in_ids.includes(t._id)}
              onChange={(e) => changePick({ trade_in_ids: e.target.checked ? [...pick.trade_in_ids, t._id]
                : pick.trade_in_ids.filter((x) => x !== t._id) })} />
          )) : <div className="text-muted">None on file</div>}</Col>
      </Row>
      <div className="d-flex gap-2 mb-3">
        <Button size="sm" variant="custom" disabled={busy || !pick.template_id} onClick={doReview}>
          {busy ? <Spinner size="sm" /> : "Fill in and check"}</Button>
      </div>

      {review && (
        <div className="border rounded p-2 mb-3">
          <div className="d-flex align-items-center mb-2">
            <strong className="me-auto">{review.template.name} (v{review.template.version})</strong>
            {review.trade_ins > 0 && <small className="text-muted me-2">{review.trade_ins} trade-in(s)</small>}
          </div>
          {review.missing_required.length > 0 && (
            <Alert variant="warning" className="py-2 small">
              Required and empty: <strong>{review.missing_required.join(", ")}</strong>. Fill them on the customer, the
              lead or the trade-in first - nothing is made up.
            </Alert>
          )}
          <Table size="sm" className="small mb-2">
            <thead><tr><th>Where on the form</th><th>Filled with</th><th>Value</th></tr></thead>
            <tbody>
              {review.rows.map((r, i) => (
                <tr key={i} className={r.missing && r.required ? "table-warning" : ""}>
                  <td>{r.where}</td><td>{r.label}{r.required && <Badge bg="secondary" className="ms-1">required</Badge>}</td>
                  <td>{r.hidden ? <span className="text-muted">managers only</span>
                    : r.missing ? <span className="text-danger">missing - left blank</span> : r.value}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="d-flex gap-2 justify-content-end">
            <Button size="sm" variant="outline-custom" disabled={busy} onClick={doPreview}>Preview PDF</Button>
            <Button size="sm" variant="custom" disabled={busy || review.missing_required.length > 0} onClick={doSave}>
              Save copy on the customer</Button>
          </div>
        </div>
      )}

      <h6>Saved copies</h6>
      {!docs ? <Spinner size="sm" /> : !docs.length ? <p className="small text-muted">None yet.</p> : (
        <Table size="sm" className="small">
          <thead><tr><th>Form</th><th>Lead</th><th>Made by</th><th>Missing when made</th><th /></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.name} <small className="text-muted">v{d.version}</small></td>
                <td>{d.lead_id && leads.find((l) => l._id === d.lead_id) ? leadLabel(leads.find((l) => l._id === d.lead_id)) : "-"}</td>
                <td>{d.created_by || "Staff"}, {new Date(d.created_at).toLocaleString()}</td>
                <td>{d.missing.length ? d.missing.join(", ") : "-"}</td>
                <td className="text-end text-nowrap">
                  {d.removed ? <span className="text-muted">removed (retention)</span> : (
                    <>
                      <Button size="sm" variant="link" className="p-0 me-2" onClick={() => fileOf(d, false)}>Download</Button>
                      <Button size="sm" variant="link" className="p-0" onClick={() => fileOf(d, true)}>Print</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
