"use client";
// The lead's details on the lead page (and on the customer profile's Leads tab), editable in one click (13 Nov 2026
// meeting: edit the customer's name and phone from the lead page; lead type and lead source viewable and editable;
// the lead date is never editable. BB, 17 Nov 2026: "too many duplication").
//   - Lead Type is shown (Internet / Phone Up / Walk-In, or Campaign / Other as the lead came in) next to its source;
//   - Edit turns the card into a form; Save sends only what changed (PATCH /api/leads/[id]/details), and the customer
//     record follows (name, phone, email); a field someone else changed meanwhile is refused, not overwritten;
//   - the lead date shows once, with a lock;
//   - the lead's status is a pill beside its type and source, in view and edit mode alike; clicking it opens Update
//     Status (17 Nov 2026: "the status is hidden among all of these things");
//   - VIN: typing a VIN or stock # searches the dealer's inventory (api/inventory/lookup); picking a car fills the VIN,
//     year, make and model. Any VIN can still be typed by hand.
import { useEffect, useState } from "react";
import { Alert, Button, Form, Spinner } from "react-bootstrap";
import { formatTimestamp } from "../../../utils/dateUtils";
import { leadStatusLabel } from "@lib/statusLabels";
import { upType } from "@lib/reporting/normalize";
import LeadSourcePicker from "./LeadSourcePicker";
import { DEPARTMENT_NAMES, leadDepartment } from "@lib/departmentNames";

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

const FIELDS = ["name", "phone", "email", "contact_type", "lead_source", "vin", "vehicle_year", "vehicle_make", "vehicle_model", "department"];
const DEPT_COLOR = { sales: "#1f5ea8", service: "#0ea5a5", parts: "#7c5a2e" };

export function leadTypeName(lead) {
  if (lead?.contact_type && TYPE_NAMES[lead.contact_type]) return TYPE_NAMES[lead.contact_type];
  const t = upType(lead || {});
  return t === "Phone" ? "Phone Up" : t === "Walk-in" ? "Walk-In" : t;
}

const str = (v) => (v == null ? "" : String(v));
const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });

// The lead's status as a pill next to its type and source: tinted in its colour, click to change it.
function StatusPill({ lead, onStatusClick }) {
  const label = leadStatusLabel(lead) || "No status";
  const color = statusColor(label);
  return (
    <button type="button" className="lead_status_pill" onClick={onStatusClick} disabled={!onStatusClick}
      style={{ color, borderColor: `${color}55`, background: `${color}14` }} title={onStatusClick ? "Change the status" : label}>
      <span className="lead_status_dot" style={{ background: color }} />{label}
      {onStatusClick && <i className="fa-solid fa-chevron-down ms-1" style={{ fontSize: "0.65em" }} />}
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

// The lead's last reassignment, with Undo while the lead is still with the person it went to (BB, 14 Nov 2026).
function UndoReassign({ lead, onSaved }) {
  const [last, setLast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    let live = true;
    if (!lead?._id) return undefined;
    fetch(`/api/leads/${lead._id}/undo-reassign`, { headers: auth(), cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { last: null })).then((d) => { if (live) setLast(d.last); }).catch(() => null);
    return () => { live = false; };
  }, [lead?._id, lead?.assigned_to]);
  if (!last?.can_undo && !msg) return null;
  const undo = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${lead._id}/undo-reassign`, { method: "POST", headers: auth() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not undo");
      setMsg(`Back with ${data.name || "nobody (unassigned)"}.`); setLast(null);
      onSaved?.({ ...lead, assigned_to: data.assigned_to });
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  return (
    <p className="mb-0 mt-1 small text-muted">
      {msg || <>Reassigned {last.from ? `from ${last.from} ` : ""}to {last.to || "nobody"}{last.by ? ` by ${last.by}` : ""}.
        <Button size="sm" variant="link" className="p-0 ms-1" disabled={busy} onClick={undo}>
          <i className="fa-solid fa-rotate-left me-1" />Undo</Button></>}
    </p>
  );
}

export default function LeadInfoCard({ lead: given, dealerTimezone, onSaved, onStatusClick }) {
  const [lead, setLead] = useState(given);
  const [form, setForm] = useState(null); // null = viewing
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // A different lead (or a newer copy of it) replaces what is shown; a re-render with the same copy keeps a saved edit.
  useEffect(() => { setLead(given); setForm(null); setError(null); }, [given?._id, given?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = () => { setError(null); setForm({ ...Object.fromEntries(FIELDS.map((f) => [f, str(lead?.[f])])), department: leadDepartment(lead) }); };
  // The value a field holds now, as the form shows it (a lead with no department is a sales lead).
  const current = (f) => (f === "department" ? leadDepartment(lead) : str(lead?.[f]).trim());
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    const changes = {};
    for (const f of FIELDS) if (form[f].trim() !== current(f)) changes[f] = { from: lead?.[f] ?? null, to: form[f] };
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
        <div className="mb-2"><StatusPill lead={lead} onStatusClick={onStatusClick} /></div>
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
          <Form.Group className="col-12"><Form.Label className="mb-0">Department</Form.Label>
            <Form.Select size="sm" value={form.department} onChange={set("department")}>
              {Object.entries(DEPARTMENT_NAMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Form.Select>
            {form.department !== leadDepartment(lead) && (
              <Form.Text>{DEPARTMENT_NAMES[form.department]} staff get an email that this lead is theirs.</Form.Text>
            )}</Form.Group>
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
      <div className="d-flex align-items-start gap-2 mb-2">
        <div className="me-auto min-w-0">
          <div className="fw-semibold fs-6 text-truncate">{lead?.name || "No name"}</div>
          <div className="d-flex flex-wrap align-items-center gap-1 mt-1">
            <span className="badge" style={{ background: TYPE_COLOR[type] || "#6c757d" }}>{type}</span>
            <span className="badge" title="Department" style={{ background: DEPT_COLOR[leadDepartment(lead)] }}>
              {DEPARTMENT_NAMES[leadDepartment(lead)]}</span>
            <span className="small text-muted me-1">{lead?.lead_source || lead?.source || "Unknown source"}</span>
            <StatusPill lead={lead} onStatusClick={onStatusClick} />
          </div>
        </div>
        <Button size="sm" variant="outline-custom" className="text-nowrap" onClick={startEdit} title="Edit the lead's details">
          <i className="fa-solid fa-pen me-1" />Edit</Button>
      </div>
      <p className="mb-1 small text-break"><i className="fa-solid fa-phone me-2 text-muted" />{lead?.phone || "No phone"}</p>
      <p className="mb-1 small text-break"><i className="fa-solid fa-envelope me-2 text-muted" />{lead?.email || "No email"}</p>
      <p className="mb-1 small"><strong>Vehicle:</strong> {vehicle || "Not given"}{lead?.vin ? <span className="text-muted"> · VIN {lead.vin}</span> : null}</p>
      <p className="mb-0 small text-muted"><i className="fa-solid fa-lock me-1" />Lead date {formatTimestamp(lead.createdAt, dealerTimezone)}</p>
      <UndoReassign lead={lead} onSaved={onSaved} />
    </div>
  );
}
