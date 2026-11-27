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
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Badge, Button, Dropdown, Form, Spinner } from "react-bootstrap";
import { formatTimestamp } from "../../../../utils/dateUtils";
import { formatCurrency } from "../../../../utils/formatCurrency";
import { useCan } from "../../../../hooks/PermissionsContext";
import ExportFormButton from "./ExportFormButton";
import MergeFinder from "./MergeFinder";
import { LeadFacts } from "../../../leads/components/LeadInfoCard";
import { NAME_PART_FIELDS, namePartsOf, tidyCase } from "../../../../lib/personName";

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
// Each phone shows what kind it is by its icon (17 Nov 2026, BB: things defined with icons).
const PHONE_ICON = { mobile: "fa-mobile-screen-button", home: "fa-house", work: "fa-briefcase", other: "fa-phone" };
const PHONE_LABELS = [["mobile", "Cell"], ["home", "Home"], ["work", "Work"], ["other", "Other"]];
const EMAIL_LABELS = [["home", "Personal"], ["work", "Work"], ["other", "Other"]];
const CONTACT_MODES = [["sms", "Text"], ["email", "Email"], ["phone", "Phone call"]];
const FOLLOWUP = [["sms", "Text"], ["email", "Email"]];
const LANGUAGES = [["english", "English"], ["spanish", "Spanish"]];
// Details staff type in (13 Nov 2026 meeting 10.14, BB's VinSolutions "Edit customer"), each with its own pencil.
const TITLES = [["mr", "Mr"], ["mrs", "Mrs"], ["ms", "Ms"], ["miss", "Miss"], ["dr", "Dr"]];
const GENDERS = [["female", "Female"], ["male", "Male"], ["other", "Other"]];
const MARITAL = [["married", "Married"], ["single", "Single"], ["other", "Other"]];
const DETAILS = [
  ["title", "Title", "fa-id-badge", { options: TITLES }], ["nickname", "Nickname", "fa-user-tag", {}],
  ["gender", "Gender", "fa-venus-mars", { options: GENDERS }], ["marital_status", "Married", "fa-ring", { options: MARITAL }],
  ["birthday", "Birthday", "fa-cake-candles", { inputType: "date" }], ["anniversary", "Anniversary", "fa-heart", { inputType: "date" }],
  ["spouse_name", "Spouse", "fa-user-group", {}], ["note", "Customer note", "fa-note-sticky", {}],
];
const shortDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? new Date(`${v}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : v);
const fmtPhone = (v) => (/^\d{10}$/.test(String(v)) ? `(${v.slice(0, 3)}) ${v.slice(3, 6)}-${v.slice(6)}` : v);
const nameOf = (options, v) => options.find(([k]) => k === String(v || "").toLowerCase())?.[1] || v || "Not set";
const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });

function Pencil({ onClick, title }) {
  return (
    <Button size="sm" variant="link" className="p-0 ms-2 text-secondary inline_edit_btn" onClick={onClick} title={title}
      aria-label={title}><i className="fa-solid fa-pen" /></Button>
  );
}

// One field shown as text with a pencil; the pencil turns it into an input or a menu that saves by itself (SOW G-082):
// a menu at once, typed text when the field loses focus or on Enter; Escape puts the saved value back. "Saving /
// Saved / Not saved + Try again" shows beside it; a failed save keeps what was typed.
function InlineField({ label, value, display, options, onSave, inputType = "text", placeholder, allowEmpty = false }) {
  const [draft, setDraft] = useState(null);
  const [state, setState] = useState(null); // null | 'saving' | 'saved' | { error }
  const commit = async (v) => {
    const next = String(v ?? "");
    if (next === String(value ?? "")) { setDraft(null); return; }
    if (!options && !allowEmpty && !next.trim()) { setState({ error: "Can't be empty - put back" }); setDraft(null); return; }
    setState("saving");
    try { await onSave(next); setDraft(null); setState("saved"); setTimeout(() => setState((s) => (s === "saved" ? null : s)), 2500); }
    catch (e) { setState({ error: e.message || "Could not save" }); }
  };
  const status = state === "saving" ? <small className="text-muted">Saving…</small>
    : state === "saved" ? <small className="text-success">Saved</small>
    : state?.error ? <small className="text-danger">Not saved: {state.error}{draft !== null && <> · <Button size="sm"
        variant="link" className="p-0 align-baseline" onClick={() => commit(draft)}>Try again</Button></>}</small> : null;
  if (draft === null) {
    return (
      <span className="d-inline-flex flex-wrap align-items-center gap-1">
        {label && <strong className="me-1">{label}:</strong>}{display ?? value ?? "Not set"}
        <Pencil onClick={() => { setState(null); setDraft(String(value ?? "")); }} title={`Edit ${label || "name"}`} />
        {status}
      </span>
    );
  }
  const current = String(value || "").toLowerCase();
  return (
    <span className="d-inline-flex flex-wrap align-items-center gap-1">
      {label && <strong className="me-1">{label}:</strong>}
      {options ? (
        <Form.Select size="sm" className="w-auto" autoFocus value={draft} disabled={state === "saving"}
          onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
          onBlur={() => state !== "saving" && !state?.error && setDraft(null)}
          onKeyDown={(e) => { if (e.key === "Escape") setDraft(null); }}>
          {current && !options.some(([k]) => k === current) && <option value={value}>{value}</option>}
          {!current && <option value="">Choose...</option>}
          {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Form.Select>
      ) : (
        <Form.Control size="sm" className="w-auto" autoFocus type={inputType} value={draft} placeholder={placeholder}
          maxLength={120} disabled={state === "saving"} onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setState(null); setDraft(null); } }} />
      )}
      {status}
    </span>
  );
}

// The name in parts (19 Nov 2026): the pencil opens First / Middle / Last / Suffix, as the DMS and dealership forms
// keep them; the full name is made from them. Saves by itself when focus leaves the fields or on Enter (SOW G-082);
// Escape puts the saved name back. A customer whose parts were only split from a one-line name opens with the DMS's
// parts when the DMS has them, else the split - shown as "check it" until someone saves.
const NAME_INPUTS = [["first_name", "First"], ["middle_name", "Middle"], ["last_name", "Last"], ["suffix", "Suffix"]];
function NameEditor({ customer, dmsPerson, onSave }) {
  const [draft, setDraft] = useState(null);
  const [state, setState] = useState(null); // null | 'saving' | 'saved' | { error }
  const stored = namePartsOf(customer);
  const fromDms = stored.from === "guess" && (dmsPerson?.first_name || dmsPerson?.last_name);
  const start = fromDms ? Object.fromEntries(NAME_PART_FIELDS.map((f) => [f, tidyCase(dmsPerson[f])])) : stored;
  const hint = stored.from === "staff" ? null : fromDms ? "From the DMS - check and save"
    : stored.from === "guess" ? "Split from the full name - check it" : null;
  const open = () => { setState(null); setDraft(Object.fromEntries(NAME_PART_FIELDS.map((f) => [f, start[f] || ""]))); };
  const commit = async () => {
    if (!draft || state === "saving") return;
    const same = NAME_PART_FIELDS.every((f) => (draft[f] || "").trim() === (stored[f] || "").trim()) && stored.from === "staff";
    if (same) { setDraft(null); return; }
    if (!draft.first_name.trim() && !draft.last_name.trim()) { setState({ error: "A first or last name is needed" }); return; }
    setState("saving");
    try { await onSave(draft); setDraft(null); setState("saved"); setTimeout(() => setState((v) => (v === "saved" ? null : v)), 2500); }
    catch (e) { setState({ error: e.message || "Could not save" }); }
  };
  const status = state === "saving" ? <small className="cp_name_status">Saving…</small>
    : state === "saved" ? <small className="cp_name_status">Saved</small>
    : state?.error ? <small className="cp_name_status cp_name_error">Not saved: {state.error}</small> : null;
  if (!draft) {
    return (
      <span className="d-inline-flex flex-wrap align-items-center gap-1">
        {customer.name || "Unnamed customer"}
        <Pencil onClick={open} title="Edit first, middle and last name" />{status}
      </span>
    );
  }
  return (
    <div className="cp_name_edit" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) commit(); }}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setState(null); setDraft(null); } }}>
      {NAME_INPUTS.map(([f, label], i) => (
        <label key={f} className={`cp_name_part${f === "suffix" ? " cp_name_suffix" : ""}`}>
          <span>{label}</span>
          <Form.Control size="sm" value={draft[f]} autoFocus={i === 0} maxLength={60} disabled={state === "saving"}
            placeholder={f === "middle_name" || f === "suffix" ? "Optional" : ""}
            onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))} />
        </label>
      ))}
      <div className="cp_name_foot">{status || (hint && <small className="cp_name_status">{hint}</small>)}</div>
    </div>
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
  const icon = (e) => (kind === "phone" ? PHONE_ICON[e.label] || "fa-phone" : e.label === "work" ? "fa-briefcase" : "fa-envelope");
  return (
    <div>
      <div className="cp_sub">{title}</div>
      <ul className="list-unstyled mb-1 mt-1">
        {(entries || []).map((e) => (
          <li key={e.value} className="cp_row d-flex flex-wrap align-items-center gap-1 mb-1">
            <i className={`fa-solid ${icon(e)} cp_row_icon`} title={nameOf(labels, e.label)} />
            {editing?.value === e.value ? (
              <>
                {/* Saves when the field loses focus or on Enter (SOW G-082); Escape keeps the old value. */}
                <Form.Control size="sm" className="w-auto" autoFocus value={editing.to} type={kind === "phone" ? "tel" : "email"}
                  disabled={busy} onChange={(ev) => setEditing({ ...editing, to: ev.target.value })}
                  onBlur={() => {
                    if (!editing.to.trim() || editing.to.trim() === show(e.value)) { setEditing(null); return; }
                    run({ action: "replace", value: e.value, to: editing.to }, () => setEditing(null));
                  }}
                  onKeyDown={(ev) => { if (ev.key === "Enter") ev.currentTarget.blur(); if (ev.key === "Escape") { setError(null); setEditing(null); } }} />
                {busy && <small className="text-muted">Saving…</small>}
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
      <div className="cp_sub">Addresses</div>
      <ul className="list-unstyled mb-1 mt-1">
        {(entries || []).map((a) => (
          <li key={a._id} className="cp_row d-flex flex-wrap align-items-center gap-1 mb-1">
            <i className="fa-solid fa-location-dot cp_row_icon" />
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

const FOLD_KEY = "customerProfileFolds2"; // 28 Nov 2026: on the Profile section the cards start open

// A section title that opens / folds its section; folded, it shows the summary beside it.
function FoldTitle({ id, icon, label, open, onToggle, summary }) {
  return (
    <h6 className="cp_section_title">
      <button type="button" className="cp_fold_btn" onClick={() => onToggle(id)} aria-expanded={open}>
        <i className={`fa-solid ${icon}`} />{label}
        <i className={`fa-solid fa-chevron-${open ? "up" : "down"} cp_fold_chevron`} />
      </button>
      {!open && <span className="cp_fold_summary">{summary}</span>}
    </h6>
  );
}

// Saving the customer from the header (name) and from the Overview's cards (contact, preferences, details).
function useCustomerSave(customer, dealerId, onChanged, setNotice) {
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
  return { putCustomer, sendContact };
}

// The customer's sections, as one bar at the top of the right side (the user, 28 Nov 2026). The leads are also listed
// under the customer in the list on the left.
export const PROFILE_TABS = [
  // Profile first, then Leads (the user, 28 Nov 2026).
  // Each section has its own icon colour (customerProfile.css .k_<key>), not all blue (the user, 28 Nov 2026).
  ["profile", "Profile", "fa-solid fa-id-card"],
  ["leads", "Leads", "fa-solid fa-comments"],
  ["activity", "Activity", "fa-solid fa-clock-rotate-left"],
  ["tasks", "Tasks", "fa-solid fa-list-check"],
  ["appointments", "Appts", "fa-solid fa-calendar-days"],
  ["sales", "Sales", "fa-solid fa-key"],
  ["service", "Service", "fa-solid fa-screwdriver-wrench"],
  ["vehicles", "Vehicles", "fa-solid fa-car-side"],
  ["tradeins", "Trade-in", "fa-solid fa-right-left"],
];

// The bar: the sections, then Forms and Actions (Print, Merge, search the web) on the right.
// toolsTarget: where Export to form and Actions are shown (the page head); without it they sit at the end of the bar.
export default function CustomerHeader({ customer, dealerId, onChanged, onOpenTab, counts, activeTab = null, tasksLate = 0, toolsTarget = null }) {
  const primaryAddress = primaryContact(customer.addresses);
  // Merge (Bibi, 26 Nov 2026): the same permission as Customers > Possible duplicates (the merge API checks it too).
  const canMerge = useCan("Manage Leads");
  const [merging, setMerging] = useState(false);
  const [formMessage, setFormMessage] = useState(null); // { variant, text } from Export to form
  const searchFor = encodeURIComponent([customer.name, primaryAddress?.city].filter(Boolean).join(" "));

  return (
    <div className="cp_bar w_card mb-2">
      <nav className="cp_nav" role="tablist" aria-label="Customer sections">
        {PROFILE_TABS.map(([key, label, icon]) => {
          const n = counts?.[key];
          const late = key === "tasks" && tasksLate > 0;
          return (
            <button key={key} type="button" role="tab" aria-selected={activeTab === key}
              className={`cp_nav_item k_${key}${activeTab === key ? " on" : ""}`} onClick={() => onOpenTab?.(key)}
              title={late ? `${tasksLate} overdue` : undefined}>
              <i className={icon} aria-hidden="true" />{label}
              {n ? <span className={`cp_nav_count${late ? " late" : ""}`}>{n}</span> : null}
            </button>
          );
        })}
      </nav>
      {(() => { const tools = (
      <div className="cp_bar_tools">
        {/* The dealership's forms with this customer's data filled in (Forms Library). */}
        <ExportFormButton customerId={String(customer._id)} dealerId={dealerId} onMessage={setFormMessage} />
        <Dropdown align="end">
          <Dropdown.Toggle size="sm" variant="outline-custom" id="customer-actions">
            <i className="fa-solid fa-bolt me-1" />Actions
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {/* SOW G-056: a print-friendly summary of the profile as it is open now (styles.css @media print). */}
            <Dropdown.Item onClick={() => window.print()}><i className="fa-solid fa-print fa-fw me-2" />Print</Dropdown.Item>
            {canMerge && (
              <Dropdown.Item onClick={() => setMerging(true)} title="Find customers that may be the same person and merge them">
                <i className="fa-solid fa-code-merge fa-fw me-2" />Merge
              </Dropdown.Item>
            )}
            <Dropdown.Divider />
            <Dropdown.Header>Search the web for this customer</Dropdown.Header>
            {/* 13 Nov 2026 meeting (10.3, DealerSocket "Search"): opens a new tab. */}
            {[["Google", "fa-brands fa-google", `https://www.google.com/search?q=${searchFor}`],
              ["Facebook", "fa-brands fa-facebook-f", `https://www.facebook.com/search/top?q=${searchFor}`],
              ["LinkedIn", "fa-brands fa-linkedin-in", `https://www.linkedin.com/search/results/all/?keywords=${searchFor}`]]
              .map(([label, icon, url]) => (
                <Dropdown.Item key={label} href={url} target="_blank" rel="noopener noreferrer">
                  <i className={`${icon} fa-fw me-2`} />{label}
                </Dropdown.Item>
              ))}
          </Dropdown.Menu>
        </Dropdown>
      </div>
      ); return toolsTarget ? createPortal(tools, toolsTarget) : tools; })()}
      {canMerge && <MergeFinder show={merging} customerId={String(customer._id)} dealerId={dealerId}
        onHide={() => setMerging(false)} onMerged={() => { setMerging(false); onChanged?.(); }} />}
      {formMessage && <Alert variant={formMessage.variant} className="py-1 small mb-0 mt-2 w-100" dismissible onClose={() => setFormMessage(null)}>{formMessage.text}</Alert>}
    </div>
  );
}

// Profile: who the customer is (name, where they came from, since when, last activity, who looks after them), then
// the cards below (CustomerInfoCards).
export function CustomerIdentity({ customer, valueSnapshot, dmsPerson, dealerId, onChanged, staffList, onAssignmentChange }) {
  const canAssignLeads = useCan("Assign Leads");
  const [notice, setNotice] = useState(null);
  const { putCustomer } = useCustomerSave(customer, dealerId, onChanged, setNotice);
  const initials = String(customer.name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className="cp_card mb-3">
      <div className="print_only small text-muted mb-1">Customer summary · printed {new Date().toLocaleString("en-US")}</div>
      <div className="cp_band">
        <div className="cp_avatar" aria-hidden="true">{initials}</div>
        <div className="cp_ident">
          <div className="cp_name">
            <NameEditor customer={customer} dmsPerson={dmsPerson} onSave={(parts) => putCustomer(parts)} />
          </div>
          <div className="cp_meta">
            <Badge bg={null} style={{ backgroundColor: BADGE_COLOR[customer.origin_badge] || BADGE_COLOR.Unknown, color: "#fff" }}>
              {customer.origin_badge}
            </Badge>
            <span><i className="fa-regular fa-calendar me-1" />Customer since {customer.createdAt ? formatTimestamp(customer.createdAt) : "N/A"}</span>
            <span><i className="fa-regular fa-clock me-1" />Last activity {valueSnapshot.last_activity_at ? formatTimestamp(valueSnapshot.last_activity_at) : "N/A"}</span>
          </div>
        </div>
        <label className="cp_assign">
          <span><i className="fa-solid fa-user-tie me-1" />Assigned to</span>
          {canAssignLeads ? (
            // Reuses the leads permission - assigning a customer cascades to all of their leads.
            <Form.Select size="sm" value={customer.assigned_to || ""} onChange={(e) => onAssignmentChange(e.target.value)}
              aria-label="Assigned to">
              <option value="">Unassigned</option>
              {staffList?.map((staff) => <option key={staff._id} value={staff._id}>{staff.name}</option>)}
            </Form.Select>
          ) : (
            <strong>{staffList?.find((s) => String(s._id) === String(customer.assigned_to))?.name || customer.assigned_to_name || "Unassigned"}</strong>
          )}
        </label>
      </div>
      {notice && <Alert variant="success" className="py-1 small cp_notice" dismissible onClose={() => setNotice(null)}>{notice}</Alert>}
    </div>
  );
}

// The Overview's cards: contact (phones, emails, addresses), preferences and more details, customer value. Each
// detail is still edited where it is shown; the cards fold as before (remembered in this browser).
export function CustomerInfoCards({ customer, valueSnapshot, dealerId, onChanged, latestLead }) {
  const primaryEmail = primaryContact(customer.emails);
  const primaryPhone = primaryContact(customer.phones);
  const [notice, setNotice] = useState(null);
  const { putCustomer, sendContact } = useCustomerSave(customer, dealerId, onChanged, setNotice);
  // "More details" starts folded; a click opens it (19 Nov 2026: keeps the profile short).
  const [showDetails, setShowDetails] = useState(false);
  // Contact, Preferences and Customer value fold like More details (25 Nov 2026): folded they show one summary line;
  // open / folded is remembered in this browser.
  const [fold, setFold] = useState({ contact: true, prefs: true, value: true });
  useEffect(() => {
    try { const kept = JSON.parse(localStorage.getItem(FOLD_KEY) || "null"); if (kept) setFold((f) => ({ ...f, ...kept })); } catch { /* folded */ }
  }, []);
  const toggleFold = (id) => setFold((f) => {
    const next = { ...f, [id]: !f[id] };
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)); } catch { /* not kept */ }
    return next;
  });
  const detailsFilled = DETAILS.filter(([key]) => customer.details?.[key]).length;

  return (
    <div className="cp_card mb-3">
      {/* The newest lead, each fact in its own labelled field (approved 24 Nov 2026). */}
      {latestLead && <div className="p-2 bg-white"><div className="cp_section_title small mb-1"><i className="fa-solid fa-bolt me-1" />Newest lead</div><LeadFacts lead={latestLead} /></div>}
      {notice && <Alert variant="success" className="py-1 small cp_notice" dismissible onClose={() => setNotice(null)}>{notice}</Alert>}
      <div className="cp_body">
        <section className="cp_section cp_contact">
          <FoldTitle id="contact" icon="fa-address-card" label="Contact" open={fold.contact} onToggle={toggleFold}
            summary={[primaryPhone?.value, primaryEmail?.value].filter(Boolean).join(" · ") || "No phone or email"} />
          {fold.contact && <div className="row gy-2">
            <div className="col-md-6">
              <ContactList kind="phone" entries={customer.phones} labels={PHONE_LABELS} send={sendContact} />
            </div>
            <div className="col-md-6">
              <ContactList kind="email" entries={customer.emails} labels={EMAIL_LABELS} send={sendContact} />
            </div>
            <div className="col-12">
              <AddressList entries={customer.addresses} send={sendContact} />
            </div>
          </div>}
        </section>
        <section className="cp_section">
          <FoldTitle id="prefs" icon="fa-sliders" label="Preferences" open={fold.prefs} onToggle={toggleFold}
            summary={`Contact: ${nameOf(CONTACT_MODES, customer.preferred_communication_mode) || "Not set"} · Follow-up: ${nameOf(FOLLOWUP, customer.followup_preference) || "Not set"} · Language: ${nameOf(LANGUAGES, customer.user_language) || "Not set"}`} />
          {fold.prefs && <>
          <div className="cp_pref"><i className="fa-solid fa-headset" />
            <InlineField label="Preferred contact" value={customer.preferred_communication_mode}
              display={nameOf(CONTACT_MODES, customer.preferred_communication_mode)} options={CONTACT_MODES}
              onSave={(v) => putCustomer({ preferred_communication_mode: v })} /></div>
          <div className="cp_pref"><i className="fa-solid fa-reply" />
            <InlineField label="Follow-up by" value={customer.followup_preference}
              display={nameOf(FOLLOWUP, customer.followup_preference)} options={FOLLOWUP}
              onSave={(v) => putCustomer({ followup_preference: v })} /></div>
          <div className="cp_pref"><i className="fa-solid fa-language" />
            <InlineField label="Language" value={customer.user_language}
              display={nameOf(LANGUAGES, customer.user_language)} options={LANGUAGES}
              onSave={(v) => putCustomer({ user_language: v })} /></div>
          <h6 className="cp_section_title mt-3">
            <button type="button" className="cp_fold_btn" onClick={() => setShowDetails((v) => !v)}
              aria-expanded={showDetails} aria-controls="cp_more_details">
              <i className="fa-solid fa-address-book" />More details
              {detailsFilled > 0 && <span className="cp_fold_count">{detailsFilled}</span>}
              <i className={`fa-solid fa-chevron-${showDetails ? "up" : "down"} cp_fold_chevron`} />
            </button>
          </h6>
          {showDetails && <div id="cp_more_details">{DETAILS.map(([key, label, icon, opts]) => {
            const v = customer.details?.[key] || "";
            return (
              <div className="cp_pref" key={key}><i className={`fa-solid ${icon}`} />
                <InlineField label={label} value={v} options={opts.options} inputType={opts.inputType} allowEmpty
                  display={v ? (opts.options ? nameOf(opts.options, v) : opts.inputType === "date" ? shortDate(v) : v) : "Not set"}
                  onSave={(nv) => putCustomer({ details: { [key]: nv } })} /></div>
            );
          })}</div>}
          </>}
        </section>
        <section className="cp_section">
          <FoldTitle id="value" icon="fa-sack-dollar" label="Customer value" open={fold.value} onToggle={toggleFold}
            summary={`Sales ${formatCurrency(valueSnapshot.total_deal_price)} · Service ${formatCurrency(valueSnapshot.total_repair_order_sale)}`} />
          {fold.value && <div className="cp_tiles">
            <div className="cp_tile"><i className="fa-solid fa-car" /><span>Total sales</span><strong>{formatCurrency(valueSnapshot.total_deal_price)}</strong></div>
            <div className="cp_tile"><i className="fa-solid fa-screwdriver-wrench" /><span>Service (all-pay)</span><strong>{formatCurrency(valueSnapshot.total_repair_order_sale)}</strong></div>
            <div className="cp_tile"><i className="fa-solid fa-user-check" /><span>Service (customer-pay)</span><strong>{formatCurrency(valueSnapshot.total_repair_order_customer_sale)}</strong></div>
          </div>}
        </section>
      </div>
    </div>
  );
}
