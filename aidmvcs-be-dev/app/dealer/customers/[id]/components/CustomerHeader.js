"use client";
// The customer profile's header. Every detail is edited where it is shown, one field at a time (17 Nov 2026, Betsy:
// "we should be able to make changes to the customer profile"; the user: "every individual item should have its own
// edit", no long form):
//   - name, preferred contact, follow-up preference, language: the pencil beside it (PUT /api/customers/[id]; a new
//     name also goes on the customer's leads that had the old one);
//   - each phone / email: change it in place, make it the main one, set Cell / Home / Work, remove it, or add another
//     (POST /api/customers/[id]/contacts; open leads on a changed / removed number or address get the new one);
//   - postal addresses: add, remove, make main.
// Every change goes on the customer's timeline. After a save the profile reloads (onChanged).
import { useState } from "react";
import { Alert, Badge, Button, Form, Spinner } from "react-bootstrap";
import { formatTimestamp } from "../../../../utils/dateUtils";
import { formatCurrency } from "../../../../utils/formatCurrency";
import { useCan } from "../../../../hooks/PermissionsContext";
import CallButton from "../../../components/CallButton";
import ExportFormButton from "./ExportFormButton";

export function primaryContact(entries) {
  if (!entries?.length) return null;
  return entries.find((entry) => entry.is_primary) || entries[0];
}

const BADGE_COLOR = {
  "DealerVault": "#cb5c63",
  "Inbound Lead": "#476c02",
  "Inbound & DealerVault": "#a16f3c",
  "Manual": "#5a67d8",
  "Unknown": "#fc9009",
};
const PHONE_LABELS = [["mobile", "Cell"], ["home", "Home"], ["work", "Work"], ["other", "Other"]];
const EMAIL_LABELS = [["home", "Personal"], ["work", "Work"], ["other", "Other"]];
const CONTACT_MODES = [["sms", "Text"], ["email", "Email"], ["phone", "Phone call"]];
const FOLLOWUP = [["sms", "Text"], ["email", "Email"]];
const LANGUAGES = [["english", "English"], ["spanish", "Spanish"]];
const fmtPhone = (v) => (/^\d{10}$/.test(String(v)) ? `(${v.slice(0, 3)}) ${v.slice(3, 6)}-${v.slice(6)}` : v);
const nameOf = (options, v) => options.find(([k]) => k === String(v || "").toLowerCase())?.[1] || v || "Not set";
const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });

function Pencil({ onClick, title }) {
  return (
    <Button size="sm" variant="link" className="p-0 ms-2 text-secondary inline_edit_btn" onClick={onClick} title={title}
      aria-label={title}><i className="fa-solid fa-pen" /></Button>
  );
}

// One field shown as text with a pencil; the pencil turns it into an input / select with Save and Cancel.
function InlineField({ label, value, display, options, onSave, inputType = "text", placeholder }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await onSave(draft); setDraft(null); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (draft === null) {
    return (
      <span className="d-inline-flex align-items-center">
        {label && <strong className="me-1">{label}:</strong>}{display ?? value ?? "Not set"}
        <Pencil onClick={() => { setError(null); setDraft(String(value ?? "")); }} title={`Edit ${label || "name"}`} />
      </span>
    );
  }
  const current = String(value || "").toLowerCase();
  return (
    <span className="d-inline-flex flex-wrap align-items-center gap-1">
      {label && <strong className="me-1">{label}:</strong>}
      {options ? (
        <Form.Select size="sm" className="w-auto" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}>
          {current && !options.some(([k]) => k === current) && <option value={value}>{value}</option>}
          {!current && <option value="">Choose...</option>}
          {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Form.Select>
      ) : (
        <Form.Control size="sm" className="w-auto" autoFocus type={inputType} value={draft} placeholder={placeholder}
          maxLength={120} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setDraft(null); }} />
      )}
      <Button size="sm" variant="custom" onClick={save} disabled={busy || (!options && !draft.trim())}>
        {busy ? <Spinner size="sm" /> : "Save"}</Button>
      <Button size="sm" variant="outline-secondary" onClick={() => setDraft(null)} disabled={busy}>Cancel</Button>
      {error && <small className="text-danger w-100">{error}</small>}
    </span>
  );
}

// Phones or emails: each one editable on its own, plus "Add".
function ContactList({ kind, entries, labels, send }) {
  const [editing, setEditing] = useState(null); // { value, to }
  const [adding, setAdding] = useState(null);   // { value, label }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const show = (v) => (kind === "phone" ? fmtPhone(v) : v);
  const run = async (body, done) => {
    setBusy(true); setError(null);
    try { await send({ kind, ...body }); done?.(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const title = kind === "phone" ? "Phones" : "Emails";
  return (
    <div>
      <strong>{title}:</strong>
      <ul className="list-unstyled mb-1 mt-1">
        {(entries || []).map((e) => (
          <li key={e.value} className="d-flex flex-wrap align-items-center gap-1 mb-1">
            {editing?.value === e.value ? (
              <>
                <Form.Control size="sm" className="w-auto" autoFocus value={editing.to} type={kind === "phone" ? "tel" : "email"}
                  onChange={(ev) => setEditing({ ...editing, to: ev.target.value })}
                  onKeyDown={(ev) => { if (ev.key === "Escape") setEditing(null); }} />
                <Button size="sm" variant="custom" disabled={busy || !editing.to.trim()}
                  onClick={() => run({ action: "replace", value: e.value, to: editing.to }, () => setEditing(null))}>
                  {busy ? <Spinner size="sm" /> : "Save"}</Button>
                <Button size="sm" variant="outline-secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
              </>
            ) : (
              <>
                <span>{show(e.value)}</span>
                <Form.Select size="sm" className="w-auto py-0 contact_label" value={e.label || ""} disabled={busy}
                  aria-label={`${kind} type`} onChange={(ev) => run({ action: "label", value: e.value, label: ev.target.value })}>
                  {!e.label && <option value="">Type</option>}
                  {labels.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Form.Select>
                {e.is_primary ? <Badge bg="custom">Main</Badge> : (
                  <Button size="sm" variant="link" className="p-0" disabled={busy}
                    onClick={() => run({ action: "set_primary", value: e.value })}>Make main</Button>
                )}
                {kind === "phone" && e.sms_opt_in && <Badge bg="success">SMS opt-in</Badge>}
                <Pencil onClick={() => { setError(null); setEditing({ value: e.value, to: show(e.value) }); }}
                  title={`Change ${show(e.value)}`} />
                <Button size="sm" variant="link" className="p-0 ms-1 text-danger" disabled={busy} title={`Remove ${show(e.value)}`}
                  onClick={() => window.confirm(`Remove ${show(e.value)}? It won't be added back by future leads.`)
                    && run({ action: "remove", value: e.value })}>
                  <i className="fa-regular fa-trash" />
                </Button>
              </>
            )}
          </li>
        ))}
        {!entries?.length && <li className="text-muted small">None on file</li>}
      </ul>
      {adding ? (
        <div className="d-flex flex-wrap align-items-center gap-1">
          <Form.Control size="sm" className="w-auto" autoFocus type={kind === "phone" ? "tel" : "email"}
            placeholder={kind === "phone" ? "10-digit phone" : "name@example.com"} value={adding.value}
            onChange={(ev) => setAdding({ ...adding, value: ev.target.value })} />
          <Form.Select size="sm" className="w-auto" value={adding.label} aria-label={`${kind} type`}
            onChange={(ev) => setAdding({ ...adding, label: ev.target.value })}>
            {labels.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Form.Select>
          <Button size="sm" variant="custom" disabled={busy || !adding.value.trim()}
            onClick={() => run({ action: "add", value: adding.value, label: adding.label }, () => setAdding(null))}>
            {busy ? <Spinner size="sm" /> : "Add"}</Button>
          <Button size="sm" variant="outline-secondary" disabled={busy} onClick={() => setAdding(null)}>Cancel</Button>
        </div>
      ) : (
        <Button size="sm" variant="link" className="p-0" onClick={() => { setError(null); setAdding({ value: "", label: labels[0][0] }); }}>
          <i className="fa-solid fa-plus me-1" />Add {kind === "phone" ? "a phone" : "an email"}</Button>
      )}
      {error && <small className="text-danger d-block">{error}</small>}
    </div>
  );
}

// Postal addresses: each one removable or made main, and "Add an address" (street, apt, city, state, ZIP, type).
const ADDRESS_LABELS = [["home", "Home"], ["work", "Work"], ["billing", "Billing"], ["other", "Other"]];
const EMPTY_ADDRESS = { line1: "", line2: "", city: "", state: "", zip: "", label: "home" };
function AddressList({ entries, send }) {
  const [adding, setAdding] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (body, done) => {
    setBusy(true); setError(null);
    try { await send({ kind: "address", ...body }); done?.(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div>
      <strong>Addresses:</strong>
      <ul className="list-unstyled mb-1 mt-1">
        {(entries || []).map((a) => (
          <li key={a._id} className="d-flex flex-wrap align-items-center gap-1 mb-1">
            <span>{[a.line1, a.line2, a.city, a.state, a.zip].filter(Boolean).join(", ")}</span>
            <Badge bg="light" text="dark">{nameOf(ADDRESS_LABELS, a.label)}</Badge>
            {a.is_primary ? <Badge bg="custom">Main</Badge> : (
              <Button size="sm" variant="link" className="p-0" disabled={busy}
                onClick={() => run({ action: "set_primary", address_id: a._id })}>Make main</Button>
            )}
            <Button size="sm" variant="link" className="p-0 ms-1 text-danger" disabled={busy} title="Remove this address"
              onClick={() => window.confirm("Remove this address?") && run({ action: "remove", address_id: a._id })}>
              <i className="fa-regular fa-trash" />
            </Button>
          </li>
        ))}
        {!entries?.length && <li className="text-muted small">None on file</li>}
      </ul>
      {adding ? (
        <div className="d-flex flex-wrap align-items-center gap-1">
          {["line1", "line2", "city", "state", "zip"].map((k) => (
            <Form.Control key={k} size="sm" style={{ maxWidth: k === "line1" ? 200 : k === "zip" || k === "state" ? 80 : 140 }}
              placeholder={{ line1: "Street", line2: "Apt / suite", city: "City", state: "State", zip: "ZIP" }[k]}
              value={adding[k]} onChange={(e) => setAdding({ ...adding, [k]: e.target.value })} />
          ))}
          <Form.Select size="sm" className="w-auto" value={adding.label} aria-label="Address type"
            onChange={(e) => setAdding({ ...adding, label: e.target.value })}>
            {ADDRESS_LABELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Form.Select>
          <Button size="sm" variant="custom" disabled={busy || !adding.line1.trim() || !adding.city.trim()}
            onClick={() => run({ action: "add", address: adding }, () => setAdding(null))}>{busy ? <Spinner size="sm" /> : "Add"}</Button>
          <Button size="sm" variant="outline-secondary" disabled={busy} onClick={() => setAdding(null)}>Cancel</Button>
        </div>
      ) : (
        <Button size="sm" variant="link" className="p-0" onClick={() => { setError(null); setAdding({ ...EMPTY_ADDRESS }); }}>
          <i className="fa-solid fa-plus me-1" />Add an address</Button>
      )}
      {error && <small className="text-danger d-block">{error}</small>}
    </div>
  );
}

export default function CustomerHeader({ customer, valueSnapshot, onSendMessage, staffList, onAssignmentChange, callLeadId,
  dealerId, onChanged }) {
  const primaryEmail = primaryContact(customer.emails);
  const primaryPhone = primaryContact(customer.phones);
  // Same phone-priority reuse of getReplyChannel()'s rule (viewConversations.js:21-33):
  // SMS whenever a phone is on file, otherwise email, otherwise no button at all.
  const sendLabel = primaryPhone ? "Send SMS" : primaryEmail ? "Send Mail" : null;
  // Reuses the leads permission - assigning a customer cascades to all of
  // their leads, so it belongs to the same permission as assigning a lead.
  const canAssignLeads = useCan("Assign Leads");
  const [notice, setNotice] = useState(null);

  const putCustomer = async (body) => {
    const res = await fetch(`/api/customers/${customer._id}`, { method: "PUT", headers: auth(),
      body: JSON.stringify({ dealer_id: dealerId, ...body }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.message || out.error || "Could not save");
    setNotice("Saved");
    onChanged?.();
  };
  const sendContact = async (body) => {
    const res = await fetch(`/api/customers/${customer._id}/contacts`, { method: "POST", headers: auth(),
      body: JSON.stringify({ dealer_id: dealerId, update_open_leads: true, ...body }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.message || out.error || "Could not save");
    setNotice(`Saved${out.leads_updated ? ` · ${out.leads_updated} open lead(s) now use it` : ""}`);
    onChanged?.();
  };

  return (
    <div className="w_card mb-3">
      <div className="d-flex align-items-start justify-content-between flex-wrap gap-2 mb-3">
        <div>
          <h3 className="w_card_title mb-1">
            <InlineField value={customer.name || ""} display={customer.name || "Unnamed customer"}
              placeholder="Customer name" onSave={(name) => putCustomer({ name })} />
          </h3>
          <Badge bg={null} style={{ backgroundColor: BADGE_COLOR[customer.origin_badge] || BADGE_COLOR.Unknown, color: "#fff" }}>
            {customer.origin_badge}
          </Badge>
        </div>
        <div className="d-flex align-items-center flex-wrap gap-2">
          {canAssignLeads && (
            <Form.Select
              size="sm"
              style={{ width: "auto" }}
              value={customer.assigned_to || ""}
              onChange={(e) => onAssignmentChange(e.target.value)}
              aria-label="Assigned to"
            >
              <option value="">Unassigned</option>
              {staffList?.map((staff) => (
                <option key={staff._id} value={staff._id}>{staff.name}</option>
              ))}
            </Form.Select>
          )}
          {primaryPhone && (
            <CallButton phone={primaryPhone.value} leadId={callLeadId} dealerId={dealerId} />
          )}
          {/* The dealership's forms with this customer's data filled in (Forms Library). */}
          <ExportFormButton customerId={String(customer._id)} dealerId={dealerId} />
          {sendLabel && (
            <Button variant="custom" size="sm" onClick={onSendMessage}>
              <i className={`fa-solid ${primaryPhone ? "fa-comment-sms" : "fa-envelope"} me-2`} />
              {sendLabel}
            </Button>
          )}
        </div>
      </div>
      {notice && <Alert variant="success" className="py-1 small mb-2" dismissible onClose={() => setNotice(null)}>{notice}</Alert>}

      <div className="row gy-3">
        <div className="col-md-6">
          <ContactList kind="phone" entries={customer.phones} labels={PHONE_LABELS} send={sendContact} />
        </div>
        <div className="col-md-6">
          <ContactList kind="email" entries={customer.emails} labels={EMAIL_LABELS} send={sendContact} />
        </div>
        <div className="col-12">
          <AddressList entries={customer.addresses} send={sendContact} />
        </div>
        <div className="col-md-4">
          <InlineField label="Preferred contact" value={customer.preferred_communication_mode}
            display={nameOf(CONTACT_MODES, customer.preferred_communication_mode)} options={CONTACT_MODES}
            onSave={(v) => putCustomer({ preferred_communication_mode: v })} />
        </div>
        <div className="col-md-4">
          <InlineField label="Follow-up preference" value={customer.followup_preference}
            display={nameOf(FOLLOWUP, customer.followup_preference)} options={FOLLOWUP}
            onSave={(v) => putCustomer({ followup_preference: v })} />
        </div>
        <div className="col-md-4">
          <InlineField label="Language" value={customer.user_language}
            display={nameOf(LANGUAGES, customer.user_language)} options={LANGUAGES}
            onSave={(v) => putCustomer({ user_language: v })} />
        </div>
      </div>

      <hr />

      <div className="row gy-2 small">
        <div className="col-md-3"><strong>Last activity:</strong> {valueSnapshot.last_activity_at ? formatTimestamp(valueSnapshot.last_activity_at) : "N/A"}</div>
        <div className="col-md-3"><strong>Customer since:</strong> {customer.createdAt ? formatTimestamp(customer.createdAt) : "N/A"}</div>
        <div className="col-md-2"><strong>Total sales:</strong> {formatCurrency(valueSnapshot.total_deal_price)}</div>
        <div className="col-md-2"><strong>Service (all-pay):</strong> {formatCurrency(valueSnapshot.total_repair_order_sale)}</div>
        <div className="col-md-2"><strong>Service (customer-pay):</strong> {formatCurrency(valueSnapshot.total_repair_order_customer_sale)}</div>
      </div>
    </div>
  );
}
