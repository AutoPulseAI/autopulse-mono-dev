"use client";
// "Export to form" on the customer's profile (the user, 16 Nov 2026): a list of the dealership's forms (Forms Library);
// clicking one downloads that form - the dealer's own PDF - with this customer's data in its blanks. A customer with
// more than one lead is asked which deal first (its vehicle, trade-ins and salesperson go in).
import { useState } from "react";
import { Alert, Button, Dropdown, Form, Modal, Spinner } from "react-bootstrap";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });
const leadLabel = (l) => [[l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(" ") || "No vehicle",
  l.fe_lead_status, l.createdAt ? new Date(l.createdAt).toLocaleDateString() : null].filter(Boolean).join(" · ");

// asTool: shown as an icon tool in the profile's toolbar (icon over a short label).
export default function ExportFormButton({ customerId, dealerId, asTool = false, onMessage }) {
  const [forms, setForms] = useState(null);
  const [leads, setLeads] = useState([]);
  const [picking, setPicking] = useState(null); // { form, lead_id }
  const [busy, setBusy] = useState(false);
  const [ownMessage, setOwnMessage] = useState(null); // { variant, text }
  // In the profile toolbar the message is shown by the header, full width under the toolbar (17 Nov 2026: it was
  // squeezed inside the toolbar and pushed the icons onto a new line).
  const message = onMessage ? null : ownMessage;
  const setMessage = (m) => (onMessage ? onMessage(m) : setOwnMessage(m));

  const loadLists = async () => {
    if (forms || !dealerId) return;
    try {
      const [f, l] = await Promise.all([
        fetch(`/api/forms/templates?dealer_id=${dealerId}&usable=1`, { headers: auth() }).then((r) => r.json()),
        fetch(`/api/leads?${new URLSearchParams({ dealer_id: dealerId, customer_id: customerId, page: "1", limit: "50" })}`,
          { headers: auth() }).then((r) => r.json()),
      ]);
      setForms(f.templates || []);
      setLeads(l.data || []);
    } catch { setForms([]); }
  };

  const exportForm = async (form, leadId) => {
    setBusy(true); setMessage(null);
    try {
      const res = await fetch("/api/forms/export", { method: "POST", headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ dealer_id: dealerId, template_id: form.id, customer_id: customerId, lead_id: leadId || null }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Could not export (${res.status})`);
      const name = decodeURIComponent((res.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || `${form.name}.pdf`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a"); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      const empty = decodeURIComponent(res.headers.get("X-Empty") || "");
      const unprintable = decodeURIComponent(res.headers.get("X-Unprintable") || "");
      setMessage({ variant: "success", text: `${form.name} downloaded (${res.headers.get("X-Filled") || 0} blanks filled).`
        + (empty ? ` No data on file for: ${empty}.` : "")
        + (unprintable ? ` Write these by hand (letters the form can't print): ${unprintable}.` : "") });
      setPicking(null);
    } catch (e) { setMessage({ variant: "danger", text: e.message }); } finally { setBusy(false); }
  };

  const choose = (form) => {
    if (leads.length > 1) setPicking({ form, lead_id: leads[0]._id });
    else exportForm(form, leads[0]?._id);
  };

  return (
    <>
      <Dropdown onToggle={(open) => { if (open) loadLists(); }}>
        <Dropdown.Toggle variant={asTool ? "link" : "outline-custom"} size="sm" disabled={busy} className={asTool ? "cp_tool" : ""}
          title="Export to form">
          {busy ? <Spinner size="sm" /> : <><i className={`fa-regular fa-file-pdf${asTool ? "" : " me-2"}`} />{asTool ? "Forms" : "Export to form"}</>}
        </Dropdown.Toggle>
        <Dropdown.Menu className="cp_forms_menu" style={{ maxHeight: 320, overflowY: "auto" }}
          popperConfig={{ strategy: "fixed" }} renderOnMount>
          {forms === null && <Dropdown.ItemText><Spinner size="sm" /></Dropdown.ItemText>}
          {forms?.length === 0 && <Dropdown.ItemText className="small text-muted">No forms yet - upload them in Admin → Forms Library.</Dropdown.ItemText>}
          {forms?.map((f) => <Dropdown.Item key={f.id} onClick={() => choose(f)}>{f.name}</Dropdown.Item>)}
        </Dropdown.Menu>
      </Dropdown>
      {message && (
        <Alert variant={message.variant} dismissible onClose={() => setOwnMessage(null)} className="py-1 px-2 small mb-0 mt-1 w-100">
          {message.text}
        </Alert>
      )}
      <Modal show={!!picking} onHide={() => setPicking(null)} centered>
        <Modal.Header closeButton><Modal.Title as="h6">{picking?.form.name}: which deal?</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Select value={picking?.lead_id || ""} onChange={(e) => setPicking((p) => ({ ...p, lead_id: e.target.value }))}>
            {leads.map((l) => <option key={l._id} value={l._id}>{leadLabel(l)}</option>)}
          </Form.Select>
          <Form.Text>Its vehicle, trade-ins and salesperson go into the form.</Form.Text>
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="outline-custom" onClick={() => setPicking(null)}>Cancel</Button>
          <Button size="sm" variant="custom" disabled={busy} onClick={() => exportForm(picking.form, picking.lead_id)}>
            {busy ? <Spinner size="sm" /> : "Export"}</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
