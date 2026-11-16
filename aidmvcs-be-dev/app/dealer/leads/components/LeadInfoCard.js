"use client";
// The lead's details on the lead page (and on the customer profile's Leads tab), editable in one click (13 Nov 2026
// meeting: edit the customer's name and phone from the lead page; lead type and lead source viewable and editable;
// the lead date is never editable. BB, 17 Nov 2026: "too many duplication").
//   - Lead Type is shown (Internet / Phone Up / Walk-In, or Campaign / Other as the lead came in) next to its source;
//   - Edit turns the card into a form; Save sends only what changed (PATCH /api/leads/[id]/details), and the customer
//     record follows (name, phone, email); a field someone else changed meanwhile is refused, not overwritten;
//   - the lead date shows once, with a lock;
//   - the lead's status is a coloured bar at the top, in view and edit mode alike; clicking it opens Update Status
//     (17 Nov 2026: "the status is hidden among all of these things");
//   - VIN: typing a VIN or stock # searches the dealer's inventory (api/inventory/lookup); picking a car fills the VIN,
//     year, make and model. Any VIN can still be typed by hand.
import { useEffect, useState } from "react";
import { Alert, Button, Form, Spinner } from "react-bootstrap";
import { formatTimestamp } from "../../../utils/dateUtils";
import { leadStatusLabel } from "@lib/statusLabels";
import { upType } from "@lib/reporting/normalize";
import LeadSourcePicker from "./LeadSourcePicker";

const TYPE_NAMES = { internet: "Internet", phone: "Phone Up", walk_in: "Walk-In" };
const TYPE_COLOR = { Internet: "#1d6fe0", "Phone Up": "#7c3aed", "Walk-In": "#2fb344", Campaign: "#f7931e" };
// The status bar's colour by the kind of status (labels: app/lib/statusLabels.js).
function statusColor(label) {
  const s = String(label || "").toLowerCase();
  if (/sold/.test(s)) return "#2fb344";
  if (/closed|lost|opt|dnd|no longer/.test(s)) return "#6c757d";
  if (/dealership action|managerial/.test(s)) return "#e5383b";
  if (/no show/.test(s)) return "#f7931e";
  if (/appointment|visit/.test(s)) return "#0ea5a5";
  if (/contact made|replied/.test(s)) return "#7c3aed";
  return "#1d6fe0";
}

const FIELDS = ["name", "phone", "email", "contact_type", "lead_source", "vin", "vehicle_year", "vehicle_make", "vehicle_model"];

export function leadTypeName(lead) {
  if (lead?.contact_type && TYPE_NAMES[lead.contact_type]) return TYPE_NAMES[lead.contact_type];
  const t = upType(lead || {});
  return t === "Phone" ? "Phone Up" : t === "Walk-in" ? "Walk-In" : t;
}

const str = (v) => (v == null ? "" : String(v));
const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });

function StatusBar({ lead, onStatusClick }) {
  const label = leadStatusLabel(lead) || "No status";
  const color = statusColor(label);
  return (
    <button type="button" className="lead_status_bar mb-2" style={{ background: color }} onClick={onStatusClick}
      disabled={!onStatusClick} title={onStatusClick ? "Update the status" : undefined}>
      <span className="small text-uppercase opacity-75 me-2">Status</span>
      <strong className="me-auto">{label}</strong>
      {onStatusClick && <span className="small"><i className="fa-solid fa-pen me-1" />Change</span>}
    </button>
  );
}

// The VIN box: free text, plus cars from the dealer's inventory matching what is typed (VIN or stock #).
function VinLookup({ dealerId, value, onChange, onPick }) {
  const [cars, setCars] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const q = String(value || "").trim();
    if (!open || q.length < 3 || !dealerId) { setCars([]); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/inventory/lookup?dealer_id=${encodeURIComponent(dealerId)}&q=${encodeURIComponent(q)}`,
          { headers: auth(), cache: "no-store" });
        const data = res.ok ? await res.json() : { cars: [] };
        if (live) setCars(data.cars || []);
      } catch { if (live) setCars([]); }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [value, open, dealerId]);
  const name = (c) => [c.year, c.make, c.model, c.trim].filter(Boolean).join(" ");
  return (
    <div className="position-relative">
      <Form.Control size="sm" value={value} maxLength={17} placeholder="Type a VIN or stock # to search the inventory"
        autoComplete="off" onChange={(e) => { setOpen(true); onChange(e.target.value.toUpperCase()); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && cars.length > 0 && (
        <div className="list-group position-absolute w-100 shadow-sm" style={{ zIndex: 5 }}>
          {cars.map((c) => (
            <button type="button" key={c.vin || c.stock_number} className="list-group-item list-group-item-action py-1 small"
              onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(c); setOpen(false); }}>
              <strong>{name(c)}</strong>{c.stock_number ? ` · stock #${c.stock_number}` : ""}
              <span className="d-block text-muted">{[c.vin, c.condition, c.color].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LeadInfoCard({ lead: given, dealerTimezone, onSaved, onStatusClick }) {
  const [lead, setLead] = useState(given);
  const [form, setForm] = useState(null); // null = viewing
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // A different lead (or a newer copy of it) replaces what is shown; a re-render with the same copy keeps a saved edit.
  useEffect(() => { setLead(given); setForm(null); setError(null); }, [given?._id, given?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = () => { setError(null); setForm(Object.fromEntries(FIELDS.map((f) => [f, str(lead?.[f])]))); };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    const changes = {};
    for (const f of FIELDS) if (form[f].trim() !== str(lead?.[f]).trim()) changes[f] = { from: lead?.[f] ?? null, to: form[f] };
    if (!Object.keys(changes).length) { setForm(null); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/leads/${lead._id}/details`, { method: "PATCH", headers: auth(), body: JSON.stringify({ changes }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Could not save (${res.status})`);
      const next = { ...lead, ...Object.fromEntries(FIELDS.map((f) => [f, data.lead?.[f]])) };
      setLead(next); setForm(null);
      onSaved?.(next);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const type = leadTypeName(lead);
  const vehicle = [lead?.vehicle_year, lead?.vehicle_make, lead?.vehicle_model].filter(Boolean).join(" ");

  if (form) {
    return (
      <div className="lead_edit mb-2">
        <StatusBar lead={lead} onStatusClick={onStatusClick} />
        <div className="row g-2 small">
          <Form.Group className="col-12"><Form.Label className="mb-0">Name</Form.Label>
            <Form.Control size="sm" autoFocus value={form.name} maxLength={120} onChange={set("name")} /></Form.Group>
          <Form.Group className="col-6"><Form.Label className="mb-0">Phone</Form.Label>
            <Form.Control size="sm" type="tel" value={form.phone} maxLength={40} onChange={set("phone")} /></Form.Group>
          <Form.Group className="col-6"><Form.Label className="mb-0">Email</Form.Label>
            <Form.Control size="sm" type="email" value={form.email} maxLength={200} onChange={set("email")} /></Form.Group>
          <Form.Group className="col-12"><Form.Label className="mb-0">Lead type</Form.Label>
            <Form.Select size="sm" value={form.contact_type} onChange={set("contact_type")}>
              {!lead?.contact_type && <option value="">{type} (as it came in)</option>}
              <option value="internet">Internet</option><option value="phone">Phone Up</option><option value="walk_in">Walk-In</option>
            </Form.Select></Form.Group>
          <Form.Group className="col-12"><Form.Label className="mb-0">Lead source</Form.Label>
            <LeadSourcePicker dealerId={lead?.dealer_id} value={form.lead_source}
              onChange={(v) => setForm((f) => ({ ...f, lead_source: v }))} /></Form.Group>
          <Form.Group className="col-12"><Form.Label className="mb-0">Vehicle (year / make / model)</Form.Label>
            <div className="d-flex gap-1">
              <Form.Control size="sm" style={{ maxWidth: 70 }} placeholder="Year" value={form.vehicle_year} maxLength={4} onChange={set("vehicle_year")} />
              <Form.Control size="sm" placeholder="Make" value={form.vehicle_make} maxLength={60} onChange={set("vehicle_make")} />
              <Form.Control size="sm" placeholder="Model" value={form.vehicle_model} maxLength={60} onChange={set("vehicle_model")} />
            </div></Form.Group>
          <Form.Group className="col-12"><Form.Label className="mb-0">VIN</Form.Label>
            <VinLookup dealerId={lead?.dealer_id} value={form.vin} onChange={(v) => setForm((f) => ({ ...f, vin: v }))}
              onPick={(c) => setForm((f) => ({ ...f, vin: c.vin || f.vin, vehicle_year: c.year ? String(c.year) : f.vehicle_year,
                vehicle_make: c.make || f.vehicle_make, vehicle_model: c.model || f.vehicle_model }))} /></Form.Group>
          <div className="col-12 text-muted"><i className="fa-solid fa-lock me-1" />Lead date {formatTimestamp(lead.createdAt, dealerTimezone)} - can&apos;t be changed.
            {lead?.customer_id && " The customer's profile is updated too; an old phone or email stays on file."}</div>
        </div>
        {error && <Alert variant="danger" className="py-1 px-2 small mt-2 mb-0">{error}</Alert>}
        <div className="d-flex gap-2 mt-2">
          <Button size="sm" variant="custom" onClick={save} disabled={busy}>{busy ? <Spinner size="sm" /> : "Save"}</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => { setForm(null); setError(null); }} disabled={busy}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="lead_view mb-1">
      <StatusBar lead={lead} onStatusClick={onStatusClick} />
      <div className="d-flex align-items-start mb-1">
        <div className="me-auto">
          <div className="fw-semibold fs-6">{lead?.name || "No name"}</div>
          <span className="badge me-1" style={{ background: TYPE_COLOR[type] || "#6c757d" }}>{type}</span>
          <span className="small">{lead?.lead_source || lead?.source || "Unknown source"}</span>
        </div>
        <Button size="sm" variant="outline-custom" onClick={startEdit} title="Edit the lead's details">
          <i className="fa-solid fa-pen me-1" />Edit</Button>
      </div>
      <p className="mb-1 small text-break"><i className="fa-solid fa-phone me-2 text-muted" />{lead?.phone || "No phone"}</p>
      <p className="mb-1 small text-break"><i className="fa-solid fa-envelope me-2 text-muted" />{lead?.email || "No email"}</p>
      <p className="mb-1 small"><strong>Vehicle:</strong> {vehicle || "Not given"}{lead?.vin ? <span className="text-muted"> · VIN {lead.vin}</span> : null}</p>
      <p className="mb-0 small text-muted"><i className="fa-solid fa-lock me-1" />Lead date {formatTimestamp(lead.createdAt, dealerTimezone)}</p>
    </div>
  );
}
