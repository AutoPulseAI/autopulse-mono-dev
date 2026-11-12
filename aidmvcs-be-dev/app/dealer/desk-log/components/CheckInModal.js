"use client";
// Check a customer in at the showroom: find their lead (name, phone or email), then who works the deal. The vehicle,
// the BDC agent and an open trade-in are filled from the lead. A customer with no lead yet is added on the Leads page
// first (the existing form, with its own checks), then checked in here.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Form, ListGroup, Modal, Spinner } from "react-bootstrap";
import moment from "moment-timezone";
import { STAGES } from "../../../lib/deskLog/constants";
import { rememberBack } from "../../components/backLink";
import { deskLogCheckIn, deskLogSearch } from "../deskLogApi";
import { TYPE_LABEL } from "./deskLogUi";

export default function CheckInModal({ dealerId, staff, tz, onHide, onDone }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const [searching, setSearching] = useState(false);
  const [lead, setLead] = useState(null);
  const [form, setForm] = useState({ department: "sales", salesperson_id: "", sales_manager_id: "", stage: "",
    stock_number: "", note: "", at: moment.tz(tz).format("YYYY-MM-DDTHH:mm") });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (lead || q.trim().length < 2) { setFound([]); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await deskLogSearch(dealerId, q.trim());
        if (live) setFound(res.leads || []);
      } catch (e) {
        if (live) setError(e.message);
      } finally {
        if (live) setSearching(false);
      }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, lead, dealerId]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await deskLogCheckIn({ dealer_id: dealerId, lead_id: lead.id, department: form.department,
        checked_in_at: moment.tz(form.at, "YYYY-MM-DDTHH:mm", tz).toISOString(),
        ...(form.salesperson_id ? { salesperson_id: form.salesperson_id } : {}),
        ...(form.sales_manager_id ? { sales_manager_id: form.sales_manager_id } : {}),
        ...(form.stage ? { stage: form.stage } : {}),
        ...(form.stock_number.trim() ? { stock_number: form.stock_number.trim() } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}) });
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const staffOptions = staff.map((s) => <option key={s._id} value={s._id}>{s.name || s.email}</option>);

  return (
    <Modal show onHide={onHide} centered size="lg">
      <Modal.Header closeButton><Modal.Title as="h5">Check in customer</Modal.Title></Modal.Header>
      <Modal.Body>
        {!lead ? (
          <>
            <Form.Control autoFocus placeholder="Customer name, phone or email" value={q}
              onChange={(e) => setQ(e.target.value)} aria-label="Find the customer" />
            {searching && <Spinner animation="border" size="sm" className="mt-2" />}
            {found.length > 0 && (
              <ListGroup className="mt-2">
                {found.map((l) => (
                  <ListGroup.Item key={l.id} action onClick={() => setLead(l)}>
                    <strong>{l.name || "No name"}</strong> <span className="text-muted">{l.phone} {l.email}</span>
                    <small className="d-block text-muted">{TYPE_LABEL[l.lead_type] || l.lead_type} - {l.source}
                      {l.vehicle ? ` - ${l.vehicle}` : ""} - lead from {moment(l.created_at).tz(tz).format("MMM D, YYYY")}</small>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            )}
            {q.trim().length >= 2 && !searching && !found.length && (
              <p className="text-muted mt-2 mb-0">No customer found.</p>
            )}
            <p className="mt-3 mb-0 small">New customer?{" "}
              <Link href="/dealer/leads" onClick={() => rememberBack("/dealer/leads", "/dealer/desk-log", "Desk Log")}>
                Add the lead on the Leads page</Link>, then check them in here.</p>
          </>
        ) : (
          <>
            <div className="d-flex align-items-start mb-3">
              <div className="me-auto"><strong>{lead.name || "No name"}</strong>
                <small className="d-block text-muted">{lead.phone} {lead.email}</small></div>
              <Button size="sm" variant="link" onClick={() => setLead(null)}>Change</Button>
            </div>
            <div className="row g-2">
              <Form.Group className="col-md-6"><Form.Label>Checked in at (dealership time)</Form.Label>
                <Form.Control type="datetime-local" value={form.at} onChange={set("at")} /></Form.Group>
              <Form.Group className="col-md-6"><Form.Label>Department</Form.Label>
                <Form.Select value={form.department} onChange={set("department")}>
                  <option value="sales">Sales</option><option value="service">Service</option></Form.Select></Form.Group>
              <Form.Group className="col-md-6"><Form.Label>Salesperson</Form.Label>
                <Form.Select value={form.salesperson_id} onChange={set("salesperson_id")}>
                  <option value="">-</option>{staffOptions}</Form.Select></Form.Group>
              <Form.Group className="col-md-6"><Form.Label>Sales manager</Form.Label>
                <Form.Select value={form.sales_manager_id} onChange={set("sales_manager_id")}>
                  <option value="">-</option>{staffOptions}</Form.Select></Form.Group>
              <Form.Group className="col-md-6"><Form.Label>Stage</Form.Label>
                <Form.Select value={form.stage} onChange={set("stage")}>
                  <option value="">No stage yet</option>{STAGES.map((s) => <option key={s}>{s}</option>)}</Form.Select>
              </Form.Group>
              <Form.Group className="col-md-6"><Form.Label>Stock #</Form.Label>
                <Form.Control value={form.stock_number} maxLength={40} onChange={set("stock_number")} /></Form.Group>
              <Form.Group className="col-12"><Form.Label>Note</Form.Label>
                <Form.Control as="textarea" rows={2} maxLength={2000} value={form.note} onChange={set("note")} />
              </Form.Group>
            </div>
            <small className="text-muted d-block mt-2">The vehicle, the BDC agent and an open trade-in come from the
              lead; change them later in the visit&apos;s details.</small>
          </>
        )}
        {error && <Alert variant="danger" className="mt-3 mb-0">{error}</Alert>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy || !lead}>{busy ? "Checking in..." : "Check in"}</Button>
      </Modal.Footer>
    </Modal>
  );
}
