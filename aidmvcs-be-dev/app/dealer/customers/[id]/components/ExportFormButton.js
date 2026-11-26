"use client";
// "Export to form" on the customer's profile (the user, 16 Nov 2026): a list of the dealership's forms (Forms Library).
// Clicking one opens a check before anything is printed (the user, 17 Nov 2026: "pop up - these are the fields that
// will be filled; if someone needs to add data they can, then print"): every blank of the form with what it will get,
// each editable; blanks with no data can be typed in; signatures, initials and checkboxes are done by hand. A customer
// with more than one lead picks the deal at the top (its vehicle, trade-ins and salesperson go in). Then Download or
// Print - the dealer's own PDF with the data in its blanks.
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Dropdown, Form, Modal, Spinner, Table } from "react-bootstrap";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });
const leadLabel = (l) => [[l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(" ") || "No vehicle",
  l.fe_lead_status, l.createdAt ? new Date(l.createdAt).toLocaleDateString() : null].filter(Boolean).join(" · ");

// asTool: shown as an icon tool in the profile's toolbar (icon over a short label).
export default function ExportFormButton({ customerId, dealerId, asTool = false, onMessage }) {
  const [forms, setForms] = useState(null);
  const [leads, setLeads] = useState([]);
  const [checking, setChecking] = useState(null); // { form, lead_id }
  const [blanks, setBlanks] = useState(null); // from POST /api/forms/export { check: true }
  const [typed, setTyped] = useState({}); // id -> what staff typed
  const [busy, setBusy] = useState(false);
  const [checkError, setCheckError] = useState(null);
  const [ownMessage, setOwnMessage] = useState(null); // { variant, text }
  // In the profile toolbar the message is shown by the header, full width under the toolbar (17 Nov 2026).
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

  const post = (form, leadId, extra) => fetch("/api/forms/export", { method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ dealer_id: dealerId, template_id: form.id, customer_id: customerId, lead_id: leadId || null, ...extra }) });

  // What each blank will get, for the deal picked.
  useEffect(() => {
    if (!checking) return undefined;
    let live = true;
    setBlanks(null); setCheckError(null); setTyped({});
    post(checking.form, checking.lead_id, { check: true })
      .then(async (res) => { const d = await res.json().catch(() => ({})); if (!res.ok) throw new Error(d.error || `Could not load the form (${res.status})`); return d; })
      .then((d) => { if (live) setBlanks(d.fields || []); })
      .catch((e) => { if (live) setCheckError(e.message); });
    return () => { live = false; };
  }, [checking?.form?.id, checking?.lead_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const valueOf = (b) => (Object.hasOwn(typed, b.id) ? typed[b.id] : b.value);
  const changed = (blanks || []).filter((b) => !b.hand && Object.hasOwn(typed, b.id) && typed[b.id] !== b.value);

  const exportForm = async (print) => {
    const { form, lead_id: leadId } = checking;
    setBusy(true); setCheckError(null);
    try {
      const overrides = Object.fromEntries(changed.map((b) => [b.id, typed[b.id]]));
      const res = await post(form, leadId, { overrides });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Could not export (${res.status})`);
      const name = decodeURIComponent((res.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || `${form.name}.pdf`);
      const url = URL.createObjectURL(await res.blob());
      if (print) {
        // Print the filled PDF straight away (the browser's print dialog), without saving it first.
        const frame = document.createElement("iframe");
        frame.style.position = "fixed"; frame.style.width = "0"; frame.style.height = "0"; frame.style.border = "0";
        frame.src = url;
        frame.onload = () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, "_blank"); } };
        document.body.appendChild(frame);
        setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 120000);
      } else {
        const a = document.createElement("a"); a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      const unprintable = decodeURIComponent(res.headers.get("X-Unprintable") || "");
      setMessage({ variant: "success", text: `${form.name} ${print ? "sent to print" : "downloaded"} `
        + `(${res.headers.get("X-Filled") || 0} blanks filled${changed.length ? `, ${changed.length} typed by you` : ""}).`
        + (unprintable ? ` Write these by hand (letters the form can't print): ${unprintable}.` : "") });
      setChecking(null);
    } catch (e) { setCheckError(e.message); } finally { setBusy(false); }
  };

  const choose = (form) => setChecking({ form, lead_id: leads[0]?._id || null });
  const fillable = (blanks || []).filter((b) => !b.hand);
  const byHand = (blanks || []).filter((b) => b.hand);

  return (
    <>
      <Dropdown onToggle={(open) => { if (open) loadLists(); }}>
        <Dropdown.Toggle variant={asTool ? "link" : "outline-custom"} size="sm" disabled={busy} className={asTool ? "cp_tool act_forms" : ""}
          title="Export to form">
          {busy ? <Spinner size="sm" /> : <><i className={`${asTool ? "fa-duotone" : "fa-regular"} fa-file-pdf${asTool ? "" : " me-2"}`} />{asTool ? "Forms" : "Export to form"}</>}
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
      <Modal show={!!checking} onHide={() => !busy && setChecking(null)} size="lg" centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title as="h6">{checking?.form.name}: check before printing</Modal.Title>
        </Modal.Header>
        <Modal.Body className="small">
          {leads.length > 1 && (
            <Form.Group className="mb-3">
              <Form.Label className="mb-1 fw-semibold">Deal</Form.Label>
              <Form.Select size="sm" value={checking?.lead_id || ""} onChange={(e) => setChecking((c) => ({ ...c, lead_id: e.target.value }))}>
                {leads.map((l) => <option key={l._id} value={l._id}>{leadLabel(l)}</option>)}
              </Form.Select>
              <Form.Text>Its vehicle, trade-ins and salesperson go into the form.</Form.Text>
            </Form.Group>
          )}
          {checkError && <Alert variant="danger" className="py-2">{checkError}</Alert>}
          {!blanks && !checkError && <div className="text-center p-4"><Spinner animation="border" /></div>}
          {blanks && (
            <>
              <p className="text-muted mb-2">Each blank shows what will be printed in it. Change any value, or type into an empty
                one; leave it empty to leave the blank empty. Nothing here changes the customer&apos;s record.</p>
              <Table size="sm" className="align-middle mb-2">
                <thead><tr><th style={{ width: 36 }}>#</th><th>Blank on the form</th><th style={{ width: "50%" }}>Will print</th></tr></thead>
                <tbody>
                  {fillable.map((b) => (
                    <tr key={b.id}>
                      <td className="text-muted">{b.n}</td>
                      <td>{b.label}{b.page > 1 ? <span className="text-muted"> · p.{b.page}</span> : null}
                        {b.auto ? <div className="text-muted">{b.fills_with}</div> : <div className="text-muted">not on file - type it if needed</div>}</td>
                      <td>
                        <Form.Control size="sm" value={valueOf(b)} maxLength={300} placeholder={b.auto ? "No data on file" : "Leave empty"}
                          onChange={(e) => setTyped((t) => ({ ...t, [b.id]: e.target.value }))}
                          className={Object.hasOwn(typed, b.id) && typed[b.id] !== b.value ? "border-warning" : undefined} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {byHand.length > 0 && (
                <div className="text-muted">Done by hand on paper: {byHand.map((b) => (
                  <Badge key={b.id} bg="light" text="dark" className="me-1 fw-normal">{b.label}</Badge>))}</div>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          {changed.length > 0 && <span className="small text-muted me-auto">{changed.length} value(s) typed by you</span>}
          <Button size="sm" variant="outline-secondary" disabled={busy} onClick={() => setChecking(null)}>Cancel</Button>
          <Button size="sm" variant="outline-custom" disabled={busy || !blanks} onClick={() => exportForm(false)}>
            <i className="fa-solid fa-download me-1" />Download</Button>
          <Button size="sm" variant="custom" disabled={busy || !blanks} onClick={() => exportForm(true)}>
            {busy ? <Spinner size="sm" /> : <><i className="fa-solid fa-print me-1" />Print</>}</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
