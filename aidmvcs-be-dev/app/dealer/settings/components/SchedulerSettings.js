"use client";
// Settings > Service scheduler (SOW v6 Appendix A 1A, G-072 to G-074): this rooftop's Dealer-FX or Xtime (via
// DealerVault) settings - provider, location, department, time zone, services and their length, advisors, booking
// restrictions - and the vendor access we are waiting for. Settings only (the user, 18 Nov 2026): nothing reads slots
// or books yet; the status stays PENDING VENDOR VERIFICATION until the vendor confirms access in writing.
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Col, Form, Row, Spinner } from "react-bootstrap";
import { useUser } from "../../context/UserContext";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dealertoken")}`, "Content-Type": "application/json" });
const PROVIDERS = [["none", "No scheduler"], ["dealer_fx", "Dealer-FX"], ["xtime_dealervault", "Xtime (through DealerVault)"]];

export default function SchedulerSettings() {
  const { dealerParent } = useUser();
  const dealerId = dealerParent?.id;
  const [data, setData] = useState(null);
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!dealerId) return;
    fetch(`/api/scheduler-settings?dealer_id=${dealerId}`, { headers: auth() }).then((r) => r.json())
      .then((d) => { setData(d); setS({ ...d.settings, advisorsText: (d.settings.advisors || []).join(", "),
        access_requested_on: d.settings.access_requested_on ? String(d.settings.access_requested_on).slice(0, 10) : "" }); })
      .catch(() => setMsg({ variant: "danger", text: "Could not load the scheduler settings" }));
  }, [dealerId]);

  if (!s) return <Spinner size="sm" />;
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  const editable = data.can_edit;
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const { advisorsText, history: _h, ...rest } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
      const res = await fetch("/api/scheduler-settings", { method: "PUT", headers: auth(), body: JSON.stringify({ dealer_id: dealerId,
        settings: { ...rest, advisors: advisorsText.split(",").map((a) => a.trim()).filter(Boolean) } }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Could not save (${res.status})`);
      setData(d); setMsg({ variant: "success", text: d.changed ? "Saved" : "Nothing changed" });
    } catch (e) { setMsg({ variant: "danger", text: e.message }); } finally { setBusy(false); }
  };
  const services = s.services || [];
  const setService = (i, k, v) => setS({ ...s, services: services.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });

  return (
    <div className="w_card">
      <div className="d-flex align-items-center gap-2 mb-2">
        <h5 className="mb-0">Service scheduler</h5>
        <Badge bg="warning" text="dark">Pending vendor verification</Badge>
      </div>
      <Alert variant="info" className="small">
        Online booking into Dealer-FX or Xtime is <strong>not connected yet</strong>: it needs API access from the vendor.
        Until then the AI never offers or confirms a scheduler slot. Fill in these settings so the connection can be made as
        soon as access arrives. Vendor passwords and keys are never typed here - they are kept in the server&apos;s secret store.
      </Alert>
      {msg && <Alert variant={msg.variant} className="py-2 small">{msg.text}</Alert>}
      <fieldset disabled={!editable || busy}>
        <Row className="g-2 small">
          <Col md={4}><Form.Label className="mb-0">Scheduler</Form.Label>
            <Form.Select size="sm" value={s.provider} onChange={set("provider")}>
              {PROVIDERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Form.Select></Col>
          <Col md={4}><Form.Label className="mb-0">Location / store id at the vendor</Form.Label>
            <Form.Control size="sm" value={s.location || ""} onChange={set("location")} /></Col>
          <Col md={2}><Form.Label className="mb-0">Department</Form.Label>
            <Form.Control size="sm" value={s.department || ""} onChange={set("department")} /></Col>
          <Col md={2}><Form.Label className="mb-0">Time zone</Form.Label>
            <Form.Control size="sm" placeholder="Dealer's own" value={s.timezone || ""} onChange={set("timezone")} /></Col>
          <Col md={12}><Form.Label className="mb-0">Services and their length</Form.Label>
            {services.map((x, i) => (
              <div key={i} className="d-flex gap-1 mb-1">
                <Form.Control size="sm" placeholder="Service, e.g. Oil change" value={x.name || ""} onChange={(e) => setService(i, "name", e.target.value)} />
                <Form.Control size="sm" type="number" min={1} style={{ maxWidth: 110 }} placeholder="Minutes" value={x.duration_min || ""}
                  onChange={(e) => setService(i, "duration_min", e.target.value)} />
                <Button size="sm" variant="link" className="text-danger" onClick={() => setS({ ...s, services: services.filter((_, j) => j !== i) })}>Remove</Button>
              </div>
            ))}
            <Button size="sm" variant="link" className="p-0" onClick={() => setS({ ...s, services: [...services, { name: "", duration_min: "" }] })}>
              <i className="fa-solid fa-plus me-1" />Add a service</Button></Col>
          <Col md={6}><Form.Label className="mb-0">Service advisors (comma-separated)</Form.Label>
            <Form.Control size="sm" value={s.advisorsText} onChange={set("advisorsText")} /></Col>
          <Col md={6}><Form.Label className="mb-0">Booking restrictions</Form.Label>
            <Form.Control size="sm" as="textarea" rows={2} placeholder="e.g. no same-day bookings; loaners by request" value={s.booking_restrictions || ""} onChange={set("booking_restrictions")} /></Col>
          <Col md={6}><Form.Label className="mb-0">Vendor contact</Form.Label>
            <Form.Control size="sm" value={s.vendor_contact || ""} onChange={set("vendor_contact")} /></Col>
          <Col md={3}><Form.Label className="mb-0">Access requested on</Form.Label>
            <Form.Control size="sm" type="date" value={s.access_requested_on || ""} onChange={set("access_requested_on")} /></Col>
          <Col md={12}><Form.Label className="mb-0">Notes</Form.Label>
            <Form.Control size="sm" as="textarea" rows={2} value={s.notes || ""} onChange={set("notes")} /></Col>
        </Row>
        {editable && <Button size="sm" variant="custom" className="mt-2" onClick={save}>{busy ? <Spinner size="sm" /> : "Save"}</Button>}
      </fieldset>
      <h6 className="mt-4">What the vendor must confirm before booking is built</h6>
      <ul className="small mb-2">{data.checklist.map((c) => <li key={c}>{c}</li>)}</ul>
      {data.settings.history?.length > 0 && (
        <details className="small"><summary className="text-muted">Changes</summary>
          <ul className="mb-0">{data.settings.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString()} · {h.by_name || "Staff"} · {h.change}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
