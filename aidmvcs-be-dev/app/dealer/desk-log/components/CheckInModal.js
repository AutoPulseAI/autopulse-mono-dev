"use client";
// Add Customer / check in (Betsy's Desk Log; 13 Nov 2026 meeting): find the customer (name, phone, email) - or, if
// they're not in the CRM, add them right here (name, phone, email, lead type, lead source, vehicle): their lead and
// customer are created in the same step as the check-in (app/lib/deskLog/newCustomer.js). Then who works the deal.
// For an existing customer the vehicle, the BDC agent and an open trade-in are filled from the lead.
// Stock #: typing it searches the dealer's inventory (stock # or VIN); picking a car fills the stock #, the year /
// make / model and VIN of the visit (and of a new customer's vehicle of interest).
import { useEffect, useState } from "react";
import { Alert, Button, Form, ListGroup, Modal, Spinner } from "react-bootstrap";
import moment from "moment-timezone";
import { STAGES } from "../../../lib/deskLog/constants";
import LeadSourcePicker from "../../leads/components/LeadSourcePicker";
import { deskLogCheckIn, deskLogSearch, deskLogStock } from "../deskLogApi";
import { TYPE_LABEL } from "./deskLogUi";

export default function CheckInModal({ dealerId, staff, tz, onHide, onDone, initialLeadId = null }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState([]);
  const [searching, setSearching] = useState(false);
  const [lead, setLead] = useState(null);
  const [form, setForm] = useState({ department: "sales", salesperson_id: "", sales_manager_id: "", stage: "",
    stock_number: "", note: "", at: moment.tz(tz).format("YYYY-MM-DDTHH:mm") });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // A customer not in the CRM yet: their details (lead type defaults to Walk-In - they are in the showroom).
  const [fresh, setFresh] = useState(null);
  const startNew = () => {
    const t = q.trim();
    const isEmail = /@/.test(t); const isPhone = !isEmail && t.replace(/\D/g, "").length >= 7;
    setFresh({ name: isEmail || isPhone ? "" : t, phone: isPhone ? t : "", email: isEmail ? t : "", contact_type: "walk_in",
      lead_source: "", vehicle_year: "", vehicle_make: "", vehicle_model: "" });
    setError(null);
  };
  const setF = (k) => (e) => setFresh((f) => ({ ...f, [k]: e.target.value }));

  // From a customer's profile: that lead is already picked.
  useEffect(() => {
    if (!initialLeadId) return;
    deskLogSearch(dealerId, initialLeadId).then((res) => { if (res.leads?.[0]) setLead(res.leads[0]); }).catch(() => {});
  }, [initialLeadId, dealerId]);

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

  // Stock # lookup: cars in stock matching what is typed; `car` is the one picked (sent as the visit's vehicle).
  const [cars, setCars] = useState([]);
  const [car, setCar] = useState(null);
  const [stockLooking, setStockLooking] = useState(false);
  useEffect(() => {
    const s = form.stock_number.trim();
    if (car || s.length < 2) { setCars([]); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      setStockLooking(true);
      try { const res = await deskLogStock(dealerId, s); if (live) setCars(res.cars || []); }
      catch { if (live) setCars([]); }
      finally { if (live) setStockLooking(false); }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [form.stock_number, car, dealerId]);
  const carName = (c) => [c.year, c.make, c.model, c.trim].filter(Boolean).join(" ");
  const pickCar = (c) => {
    setCar(c); setCars([]);
    setForm((f) => ({ ...f, stock_number: c.stock_number || f.stock_number }));
    if (fresh) setFresh((f) => ({ ...f, vehicle_year: c.year ? String(c.year) : "", vehicle_make: c.make || "",
      vehicle_model: c.model || "", vin: c.vin || "" }));
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const who = fresh ? { new_customer: fresh } : { lead_id: lead.id };
      const res = await deskLogCheckIn({ dealer_id: dealerId, ...who, department: form.department,
        checked_in_at: moment.tz(form.at, "YYYY-MM-DDTHH:mm", tz).toISOString(),
        ...(form.salesperson_id ? { salesperson_id: form.salesperson_id } : {}),
        ...(form.sales_manager_id ? { sales_manager_id: form.sales_manager_id } : {}),
        ...(form.stage ? { stage: form.stage } : {}),
        ...(form.stock_number.trim() ? { stock_number: form.stock_number.trim() } : {}),
        ...(car ? { vehicle: { year: car.year, make: car.make, model: car.model, trim: car.trim, vin: car.vin } } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}) });
      const name = fresh ? fresh.name : lead.name || "The customer";
      onDone(fresh ? `${name} added as a new customer and checked in.`
        : res?.appointment ? `${name} checked in - today's appointment is marked Showed.` : `${name} checked in.`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const staffOptions = staff.map((s) => <option key={s._id} value={s._id}>{s.name || s.email}</option>);

  return (
    <Modal show onHide={onHide} centered size="lg">
      <Modal.Header closeButton><Modal.Title as="h5">{fresh ? "New customer" : "Add Customer / check in"}</Modal.Title></Modal.Header>
      <Modal.Body>
        {fresh && (
          <div className="row g-2 mb-3">
            <Form.Group className="col-md-6"><Form.Label>Name *</Form.Label>
              <Form.Control autoFocus value={fresh.name} maxLength={120} onChange={setF("name")} /></Form.Group>
            <Form.Group className="col-md-6"><Form.Label>Lead type *</Form.Label>
              <Form.Select value={fresh.contact_type} onChange={setF("contact_type")}>
                <option value="walk_in">Walk-In</option><option value="phone">Phone Up</option><option value="internet">Internet</option>
              </Form.Select></Form.Group>
            <Form.Group className="col-md-6"><Form.Label>Phone</Form.Label>
              <Form.Control type="tel" value={fresh.phone} maxLength={40} onChange={setF("phone")} /></Form.Group>
            <Form.Group className="col-md-6"><Form.Label>Email</Form.Label>
              <Form.Control type="email" value={fresh.email} maxLength={200} onChange={setF("email")} /></Form.Group>
            <Form.Group className="col-md-6"><Form.Label>Lead source</Form.Label>
              <LeadSourcePicker dealerId={dealerId} value={fresh.lead_source}
                onChange={(v) => setFresh((f) => ({ ...f, lead_source: v }))} /></Form.Group>
            <Form.Group className="col-md-6"><Form.Label>Vehicle of interest</Form.Label>
              <div className="d-flex gap-1">
                <Form.Control placeholder="Year" style={{ maxWidth: 80 }} value={fresh.vehicle_year} maxLength={4} onChange={setF("vehicle_year")} />
                <Form.Control placeholder="Make" value={fresh.vehicle_make} maxLength={40} onChange={setF("vehicle_make")} />
                <Form.Control placeholder="Model" value={fresh.vehicle_model} maxLength={60} onChange={setF("vehicle_model")} />
              </div></Form.Group>
            <div className="col-12"><small className="text-muted">A phone number or an email is needed. If the phone or email
              belongs to a customer already in the CRM, this new lead is added to that customer.</small>
              <Button size="sm" variant="link" className="ms-2 p-0" onClick={() => setFresh(null)}>Back to search</Button></div>
          </div>
        )}
        {fresh ? null : !lead ? (
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
              <p className="text-muted mt-2 mb-0">No customer found with &quot;{q.trim()}&quot;.</p>
            )}
            <Button variant="outline-custom" className="mt-3" onClick={startNew}>
              <i className="fa-solid fa-user-plus me-1"></i>Add a new customer{q.trim() && !/@|\d{4}/.test(q) ? `: ${q.trim()}` : ""}
            </Button>
          </>
        ) : null}
        {(lead || fresh) && (
          <>
            {lead && !fresh && <div className="d-flex align-items-start mb-3">
              <div className="me-auto"><strong>{lead.name || "No name"}</strong>
                <small className="d-block text-muted">{lead.phone} {lead.email}</small></div>
              <Button size="sm" variant="link" onClick={() => setLead(null)}>Change</Button>
            </div>}
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
              <Form.Group className="col-md-6 position-relative"><Form.Label>Stock #</Form.Label>
                <Form.Control value={form.stock_number} maxLength={40} placeholder="Stock # or VIN, e.g. 2788C"
                  onChange={(e) => { setCar(null); set("stock_number")(e); }} autoComplete="off" />
                {stockLooking && <Spinner animation="border" size="sm" className="mt-1" />}
                {car && <small className="d-block text-success mt-1"><i className="fa-solid fa-car me-1"></i>
                  {carName(car)}{car.vin ? ` - VIN ${car.vin}` : ""}</small>}
                {!car && cars.length > 0 && (
                  <ListGroup className="position-absolute w-100 shadow-sm" style={{ zIndex: 5 }}>
                    {cars.map((c) => (
                      <ListGroup.Item key={c.vin || c.stock_number} action onClick={() => pickCar(c)} className="py-1">
                        <strong>{c.stock_number || "No stock #"}</strong> {carName(c)}
                        <small className="d-block text-muted">{[c.condition, c.color, c.mileage ? `${c.mileage.toLocaleString()} mi` : null,
                          c.price ? `$${c.price.toLocaleString()}` : null, c.vin].filter(Boolean).join(" - ")}</small>
                      </ListGroup.Item>
                    ))}
                  </ListGroup>
                )}
                {!car && !stockLooking && form.stock_number.trim().length >= 2 && !cars.length && (
                  <small className="d-block text-muted mt-1">Not in this dealership&apos;s inventory - saved as typed.</small>
                )}
              </Form.Group>
              <Form.Group className="col-12"><Form.Label>Note</Form.Label>
                <Form.Control as="textarea" rows={2} maxLength={2000} value={form.note} onChange={set("note")} />
              </Form.Group>
            </div>
            {!fresh && <small className="text-muted d-block mt-2">The vehicle, the BDC agent and an open trade-in come from the
              lead; change them later in the visit&apos;s details.</small>}
          </>
        )}
        {error && <Alert variant="danger" className="mt-3 mb-0">{error}</Alert>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-custom" onClick={onHide} disabled={busy}>Cancel</Button>
        <Button variant="custom" onClick={save} disabled={busy || (!lead && !(fresh && fresh.name.trim()
          && (fresh.phone.trim() || fresh.email.trim())))}>{busy ? "Saving..." : fresh ? "Add and check in" : "Check in"}</Button>
      </Modal.Footer>
    </Modal>
  );
}
