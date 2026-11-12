"use client";
// Edit a customer's phones, emails and addresses (SOW Deliverable H, gap G-061). Each change saves at once through
// /api/customers/[id]/contacts and shows "Saved" or the reason it failed. Removed phones / emails are never added
// back by a later lead or import. "Also update their open leads" sends their texts / emails to the new main contact.
import { useState } from "react";
import { Alert, Badge, Button, Form, InputGroup } from "react-bootstrap";

const PHONE_LABELS = ["mobile", "home", "work", "other"];
const EMAIL_LABELS = ["home", "work", "other"];
const fmtPhone = (v) => (/^\d{10}$/.test(String(v)) ? `(${v.slice(0, 3)}) ${v.slice(3, 6)}-${v.slice(6)}` : v);

export default function ContactEditor({ customer, dealerId, onChanged }) {
  const [data, setData] = useState(customer);
  const [newPhone, setNewPhone] = useState({ value: "", label: "mobile" });
  const [newEmail, setNewEmail] = useState({ value: "", label: "home" });
  const [newAddr, setNewAddr] = useState({ line1: "", line2: "", city: "", state: "", zip: "", label: "home" });
  const [updateLeads, setUpdateLeads] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { ok, text }

  const send = async (body, done) => {
    setBusy(true); setStatus(null);
    try {
      const res = await fetch(`/api/customers/${customer._id}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
        body: JSON.stringify({ dealer_id: dealerId, update_open_leads: updateLeads, ...body }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.message || out.error || "Could not save");
      setData(out.customer || data);
      setStatus({ ok: true, text: `Saved${out.leads_updated ? ` · ${out.leads_updated} open lead(s) now use it` : ""}` });
      done?.();
      onChanged?.();
    } catch (e) {
      setStatus({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const contactList = (kind, entries, labels) => (
    <ul className="list-unstyled mb-2">
      {(entries || []).map((e) => (
        <li key={e.value} className="d-flex flex-wrap align-items-center gap-2 mb-1">
          <span>{kind === "phone" ? fmtPhone(e.value) : e.value}</span>
          {e.is_primary ? <Badge bg="custom">Main</Badge> : (
            <Button size="sm" variant="link" className="p-0" disabled={busy}
              onClick={() => send({ kind, action: "set_primary", value: e.value })}>Make main</Button>
          )}
          <Form.Select size="sm" className="w-auto" value={e.label || ""} disabled={busy} aria-label="Label"
            onChange={(ev) => send({ kind, action: "label", value: e.value, label: ev.target.value })}>
            <option value="" disabled>Label</option>
            {labels.map((l) => <option key={l} value={l}>{l}</option>)}
          </Form.Select>
          <Button size="sm" variant="outline-danger" disabled={busy} title="Remove"
            onClick={() => window.confirm(`Remove ${kind === "phone" ? fmtPhone(e.value) : e.value}? It won't be added back by future leads.`)
              && send({ kind, action: "remove", value: e.value })}>
            <i className="fa-regular fa-trash" />
          </Button>
        </li>
      ))}
      {!entries?.length && <li className="text-muted small">None on file</li>}
    </ul>
  );

  return (
    <div className="w-100">
      {status && <Alert variant={status.ok ? "success" : "danger"} className="py-1 small mb-2">{status.text}</Alert>}

      <div className="fw-semibold small mb-1">Phones</div>
      {contactList("phone", data.phones, PHONE_LABELS)}
      <InputGroup size="sm" className="mb-3">
        <Form.Control placeholder="Add a phone (10 digits)" value={newPhone.value}
          onChange={(e) => setNewPhone({ ...newPhone, value: e.target.value })} />
        <Form.Select value={newPhone.label} onChange={(e) => setNewPhone({ ...newPhone, label: e.target.value })}
          style={{ maxWidth: 110 }}>{PHONE_LABELS.map((l) => <option key={l}>{l}</option>)}</Form.Select>
        <Button variant="outline-custom" disabled={busy || !newPhone.value.trim()}
          onClick={() => send({ kind: "phone", action: "add", value: newPhone.value, label: newPhone.label },
            () => setNewPhone({ value: "", label: "mobile" }))}>Add</Button>
      </InputGroup>

      <div className="fw-semibold small mb-1">Emails</div>
      {contactList("email", data.emails, EMAIL_LABELS)}
      <InputGroup size="sm" className="mb-3">
        <Form.Control placeholder="Add an email" value={newEmail.value}
          onChange={(e) => setNewEmail({ ...newEmail, value: e.target.value })} />
        <Form.Select value={newEmail.label} onChange={(e) => setNewEmail({ ...newEmail, label: e.target.value })}
          style={{ maxWidth: 110 }}>{EMAIL_LABELS.map((l) => <option key={l}>{l}</option>)}</Form.Select>
        <Button variant="outline-custom" disabled={busy || !newEmail.value.trim()}
          onClick={() => send({ kind: "email", action: "add", value: newEmail.value, label: newEmail.label },
            () => setNewEmail({ value: "", label: "home" }))}>Add</Button>
      </InputGroup>

      <div className="fw-semibold small mb-1">Addresses</div>
      <ul className="list-unstyled mb-2">
        {(data.addresses || []).map((a) => (
          <li key={a._id} className="d-flex flex-wrap align-items-center gap-2 mb-1">
            <span>{[a.line1, a.line2, a.city, a.state, a.zip].filter(Boolean).join(", ")}</span>
            <Badge bg="light" text="dark">{a.label}</Badge>
            {a.is_primary ? <Badge bg="custom">Main</Badge> : (
              <Button size="sm" variant="link" className="p-0" disabled={busy}
                onClick={() => send({ kind: "address", action: "set_primary", address_id: a._id })}>Make main</Button>
            )}
            <Button size="sm" variant="outline-danger" disabled={busy} title="Remove"
              onClick={() => send({ kind: "address", action: "remove", address_id: a._id })}>
              <i className="fa-regular fa-trash" />
            </Button>
          </li>
        ))}
        {!data.addresses?.length && <li className="text-muted small">None on file</li>}
      </ul>
      <div className="d-flex flex-wrap gap-1 mb-2">
        {["line1", "line2", "city", "state", "zip"].map((k) => (
          <Form.Control key={k} size="sm" style={{ maxWidth: k === "line1" ? 220 : k === "zip" || k === "state" ? 90 : 150 }}
            placeholder={{ line1: "Street", line2: "Apt / suite", city: "City", state: "State", zip: "ZIP" }[k]}
            value={newAddr[k]} onChange={(e) => setNewAddr({ ...newAddr, [k]: e.target.value })} />
        ))}
        <Button size="sm" variant="outline-custom" disabled={busy || !newAddr.line1.trim() || !newAddr.city.trim()}
          onClick={() => send({ kind: "address", action: "add", address: newAddr },
            () => setNewAddr({ line1: "", line2: "", city: "", state: "", zip: "", label: "home" }))}>Add address</Button>
      </div>

      <Form.Check type="checkbox" id="update-open-leads" className="small" checked={updateLeads}
        onChange={(e) => setUpdateLeads(e.target.checked)}
        label="When the main phone or email changes, also update their open leads (where texts and emails go)" />
    </div>
  );
}
