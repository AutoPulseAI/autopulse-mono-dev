"use client";
// The lead's details on the lead page (and on the customer profile's Leads tab), editable in one click (13 Nov 2026
// meeting: edit the customer's name and phone from the lead page; lead type and lead source viewable and editable;
// the lead date is never editable. BB, 17 Nov 2026: "too many duplication").
//   - Up type, department, source, sub-source and campaign each show as a labelled field with an icon (23 Nov 2026,
//     as the source / sub-source report names them: Up Type > Source > Sub-Source); sub-source is editable too;
//   - Edit turns the card into a form that saves by itself (SOW G-082): a typed field when it loses focus or on Enter,
//     a menu at once; only what changed is sent (PATCH /api/leads/[id]/details) and the customer record follows (name,
//     phone, email); a field someone else changed meanwhile is refused, not overwritten. "Saving / All changes saved /
//     Not saved + Try again" shows beside Done; Escape in a field puts back the saved value;
//   - the lead date shows once, with a lock;
//   - the lead's status is a pill beside its type and source, in view and edit mode alike; clicking it opens Update
//     Status (17 Nov 2026: "the status is hidden among all of these things");
//   - VIN: typing a VIN or stock # searches the dealer's inventory (api/inventory/lookup); picking a car fills the VIN,
//     year, make and model. Any VIN can still be typed by hand.
import { useEffect, useRef, useState } from "react";
import { Button, Form } from "react-bootstrap";
import useAutosave, { SaveStatus } from "../../../hooks/useAutosave";
import { formatTimestamp } from "../../../utils/dateUtils";
import { leadStatusLabel } from "@lib/statusLabels";
import { upType } from "@lib/reporting/normalize";
import LeadSourcePicker from "./LeadSourcePicker";
import { DEPARTMENT_NAMES, leadDepartment } from "@lib/departmentNames";
import LeadJourney from "../../components/LeadJourney";
import OpportunityMenu from "../../components/OpportunityMenu";

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

const FIELDS = ["name", "phone", "email", "contact_type", "lead_source", "sub_source", "campaign", "vin", "vehicle_year", "vehicle_make", "vehicle_model", "department"];
const DEPT_COLOR = { sales: "#1f5ea8", service: "#0ea5a5", parts: "#7c5a2e" };

export function leadTypeName(lead) {
  if (lead?.contact_type && TYPE_NAMES[lead.contact_type]) return TYPE_NAMES[lead.contact_type];
  const t = upType(lead || {});
  return t === "Phone" ? "Phone Up" : t === "Walk-in" ? "Walk-In" : t;
}

const str = (v) => (v == null ? "" : String(v));
const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });

// One labelled field of where the lead came from: icon, small label, value (a colour dot when the value has one).
function LeadFact({ icon, label, color, muted, children }) {
  const text = typeof children === "string" ? children : undefined;
  return (
    <div className="lead_fact">
      <dt><i className={`${icon} me-1`} aria-hidden="true" />{label}</dt>
      <dd className={muted ? "text-muted" : undefined} title={text}>
        {color && <span className="lead_fact_dot" style={{ background: color }} />}<span className="text-truncate">{children}</span>
      </dd>
    </div>
  );
}

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
// The dealer's campaigns (Lead sources > Edit list > Campaigns) to put the lead in; shown only when it has some.
function CampaignPicker({ dealerId, value, onChange }) {
  const [names, setNames] = useState(null);
  useEffect(() => {
    if (!dealerId) return;
    fetch(`/api/lead-sources?dealer_id=${encodeURIComponent(dealerId)}`, { headers: auth() })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setNames((d?.campaigns || []).map((c) => c.name))).catch(() => setNames([]));
  }, [dealerId]);
  if (!names || (!names.length && !value)) return null;
  return (
    <Form.Group className="col-12"><Form.Label className="mb-0">Campaign</Form.Label>
      <Form.Select size="sm" value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">No campaign</option>
        {value && !names.includes(value) && <option value={value}>{value}</option>}
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
      </Form.Select></Form.Group>
  );
}

function VinLookup({ dealerId, value, onChange, onPick, onCommit }) {
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
        onBlur={() => { setTimeout(() => setOpen(false), 150); setTimeout(() => onCommit?.(), 250); }} />
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
  const leadRef = useRef(given); // the saved lead the next save compares against (a save can finish after a re-render)
  leadRef.current = lead;
  // A different lead (or a newer copy of it) replaces what is shown; a re-render with the same copy keeps a saved edit.
  useEffect(() => { setLead(given); setForm(null); }, [given?._id, given?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // The value a field holds now, as the form shows it (a lead with no department is a sales lead).
  const current = (l, f) => (f === "department" ? leadDepartment(l) : str(l?.[f]).trim());
  const auto = useAutosave(async (values) => {
    const saved = leadRef.current;
    const changes = {};
    for (const f of FIELDS) if (values[f].trim() !== current(saved, f)) changes[f] = { from: saved?.[f] ?? null, to: values[f] };
    if (!Object.keys(changes).length) return;
    const res = await fetch(`/api/leads/${saved._id}/details`, { method: "PATCH", headers: auth(), body: JSON.stringify({ changes }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not save (${res.status})`);
    const next = { ...saved, ...Object.fromEntries(FIELDS.map((f) => [f, data.lead?.[f]])) };
    leadRef.current = next; setLead(next);
    onSaved?.(next);
  }, { delayMs: null });

  const startEdit = () => { setForm({ ...Object.fromEntries(FIELDS.map((f) => [f, str(lead?.[f])])), department: leadDepartment(lead) }); };
  // Typing keeps the change; it is saved when the field loses focus (or Enter). A menu or a picked car saves at once.
  const put = (patch, now = false) => setForm((f) => {
    const next = { ...f, ...patch };
    auto.change(next);
    if (now) setTimeout(() => auto.flush(), 0);
    return next;
  });
  const set = (k) => (e) => put({ [k]: e.target.value });
  const pick = (k) => (e) => put({ [k]: e.target.value }, true);
  const typed = { onBlur: () => auto.flush(), onKeyDown: (e) => {
    if (e.key === "Enter") { e.preventDefault(); auto.flush(); }
    if (e.key === "Escape") { auto.discard(); setForm({ ...Object.fromEntries(FIELDS.map((f) => [f, str(leadRef.current?.[f])])), department: leadDepartment(leadRef.current) }); }
  } };
  const done = async () => { await auto.flush(); if (!auto.unsaved()) setForm(null); };

  // "Change lead type" in the "..." menu: the department, saved like the form's own department menu.
  const changeDepartment = async (dept) => {
    const saved = leadRef.current;
    const res = await fetch(`/api/leads/${saved._id}/details`, { method: "PATCH", headers: auth(),
      body: JSON.stringify({ changes: { department: { from: saved?.department ?? null, to: dept } } }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not save (${res.status})`);
    const next = { ...saved, department: data.lead?.department ?? dept };
    leadRef.current = next; setLead(next);
    onSaved?.(next);
  };

  const type = leadTypeName(lead);
  const vehicle = [lead?.vehicle_year, lead?.vehicle_make, lead?.vehicle_model].filter(Boolean).join(" ");

  if (form) {
    return (
      <div className="lead_edit mb-2">
        <div className="mb-2"><StatusPill lead={lead} onStatusClick={onStatusClick} /></div>
        <div className="row g-2 small">
          <Form.Group className="col-12"><Form.Label className="mb-0">Name</Form.Label>
            <Form.Control size="sm" autoFocus value={form.name} maxLength={120} onChange={set("name")} {...typed} /></Form.Group>
          <Form.Group className="col-6"><Form.Label className="mb-0">Phone</Form.Label>
            <Form.Control size="sm" type="tel" value={form.phone} maxLength={40} onChange={set("phone")} {...typed} /></Form.Group>
          <Form.Group className="col-6"><Form.Label className="mb-0">Email</Form.Label>
            <Form.Control size="sm" type="email" value={form.email} maxLength={200} onChange={set("email")} {...typed} /></Form.Group>
          <Form.Group className="col-12"><Form.Label className="mb-0">Lead type</Form.Label>
            <Form.Select size="sm" value={form.contact_type} onChange={pick("contact_type")}>
              {!lead?.contact_type && <option value="">{type} (as it came in)</option>}
              <option value="internet">Internet</option><option value="phone">Phone Up</option><option value="walk_in">Walk-In</option>
            </Form.Select></Form.Group>
          <Form.Group className="col-12"><Form.Label className="mb-0">Department</Form.Label>
            <Form.Select size="sm" value={form.department} onChange={pick("department")}>
              {Object.entries(DEPARTMENT_NAMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Form.Select>
            <Form.Text>Changing it emails that department&apos;s staff that this lead is theirs.</Form.Text></Form.Group>
          <Form.Group className="col-12"><Form.Label className="mb-0">Lead source</Form.Label>
            <LeadSourcePicker dealerId={lead?.dealer_id} value={form.lead_source}
              onChange={(v) => put({ lead_source: v }, true)} /></Form.Group>
          <Form.Group className="col-12"><Form.Label className="mb-0">Sub-source</Form.Label>
            <Form.Control size="sm" value={form.sub_source} maxLength={80} placeholder="e.g. Chat, Text Lead"
              onChange={set("sub_source")} {...typed} /></Form.Group>
          <CampaignPicker dealerId={lead?.dealer_id} value={form.campaign} onChange={(v) => put({ campaign: v }, true)} />
          <Form.Group className="col-12"><Form.Label className="mb-0">Vehicle (year / make / model)</Form.Label>
            <div className="d-flex gap-1">
              <Form.Control size="sm" style={{ maxWidth: 70 }} placeholder="Year" value={form.vehicle_year} maxLength={4} onChange={set("vehicle_year")} {...typed} />
              <Form.Control size="sm" placeholder="Make" value={form.vehicle_make} maxLength={60} onChange={set("vehicle_make")} {...typed} />
              <Form.Control size="sm" placeholder="Model" value={form.vehicle_model} maxLength={60} onChange={set("vehicle_model")} {...typed} />
            </div></Form.Group>
          <Form.Group className="col-12"><Form.Label className="mb-0">VIN</Form.Label>
            <VinLookup dealerId={lead?.dealer_id} value={form.vin} onChange={(v) => put({ vin: v })} onCommit={() => auto.flush()}
              onPick={(c) => put({ vin: c.vin || form.vin, vehicle_year: c.year ? String(c.year) : form.vehicle_year,
                vehicle_make: c.make || form.vehicle_make, vehicle_model: c.model || form.vehicle_model }, true)} /></Form.Group>
          <div className="col-12 text-muted"><i className="fa-solid fa-lock me-1" />Lead date {formatTimestamp(lead.createdAt, dealerTimezone)} - can&apos;t be changed.
            {lead?.customer_id && " The customer's profile is updated too; an old phone or email stays on file."}</div>
        </div>
        <div className="d-flex align-items-center gap-2 mt-2">
          <Button size="sm" variant="custom" onClick={done} disabled={auto.status === "saving"}>Done</Button>
          <SaveStatus status={auto.status} error={auto.error} onRetry={() => auto.flush()} />
        </div>
      </div>
    );
  }

  return (
    <div className="lead_view mb-1">
      <div className="lead_head mb-2">
        <div className="lead_head_name fw-semibold fs-6 text-truncate" title={lead?.name || ""}>{lead?.name || "No name"}</div>
        <div className="lead_head_tools">
          <Button size="sm" variant="outline-custom" className="text-nowrap" onClick={startEdit} title="Edit the lead's details">
            <i className="fa-solid fa-pen me-1" />Edit</Button>
          <OpportunityMenu lead={lead} timezone={dealerTimezone} onDepartment={changeDepartment} />
        </div>
      </div>
      <div className="d-flex flex-wrap align-items-center gap-1 mb-2">
        <StatusPill lead={lead} onStatusClick={onStatusClick} />
        {lead?.hot && <span className="cp_hot on" title="Marked hot on the customer's profile"><i className="fa-solid fa-fire me-1" />HOT</span>}
      </div>
      {/* Where the lead came from, each in its own labelled field (23 Nov 2026), named as the source / sub-source
          report names them: Up Type > Source > Sub-Source, plus department and campaign. */}
      <dl className="lead_facts">
        <LeadFact icon="fa-solid fa-tag" label="Up type" color={TYPE_COLOR[type]}>{type}</LeadFact>
        <LeadFact icon="fa-solid fa-building" label="Department" color={DEPT_COLOR[leadDepartment(lead)]}>
          {DEPARTMENT_NAMES[leadDepartment(lead)]}</LeadFact>
        <LeadFact icon="fa-solid fa-globe" label="Source">{lead?.lead_source || lead?.source || "Unknown source"}</LeadFact>
        <LeadFact icon="fa-solid fa-sitemap" label="Sub-source" muted={!lead?.sub_source}>{lead?.sub_source || "No sub-source"}</LeadFact>
        {lead?.campaign && <LeadFact icon="fa-solid fa-bullhorn" label="Campaign">{lead.campaign}</LeadFact>}
      </dl>
      {lead?._id && <LeadJourney key={`${lead._id}-${lead.fe_lead_status || ""}`} leadId={lead._id} timezone={dealerTimezone} />}
      <p className="mb-1 small text-break"><i className="fa-solid fa-phone me-2 text-muted" />{lead?.phone || "No phone"}</p>
      <p className="mb-1 small text-break"><i className="fa-solid fa-envelope me-2 text-muted" />{lead?.email || "No email"}</p>
      <p className="mb-1 small"><strong>Vehicle:</strong> {vehicle || "Not given"}{lead?.vin ? <span className="text-muted"> · VIN {lead.vin}</span> : null}</p>
      <p className="mb-0 small text-muted"><i className="fa-solid fa-lock me-1" />Lead date {formatTimestamp(lead.createdAt, dealerTimezone)}</p>
      <UndoReassign lead={lead} onSaved={onSaved} />
    </div>
  );
}
