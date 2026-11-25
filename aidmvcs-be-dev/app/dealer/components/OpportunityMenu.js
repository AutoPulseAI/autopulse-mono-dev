"use client";
// The lead's "..." menu (19 Nov 2026, SOW reference B5 - DealerSocket's opportunity menu), on the lead card (Leads page
// and the customer's Leads tab). Each item opens something that already exists, from this one place:
//   Print a document     the Forms Library's fill-and-print (ExportFormButton, SOW K)
//   Print work notes     the lead's notes (/api/conversations/notes), as a printable page
//   Delivery checklist   the Sold Pending checklist of the lead's Desk Log visit, ticked as on the Desk Log
//   Change lead type     Sales / Service / Parts - the lead's department (PATCH /api/leads/[id]/details, which emails
//                        the new department's staff), done by the card that owns the lead (onDepartment)
//   View audit log       every logged change on the lead, who and when (/api/leads/[id]/opportunity/menu)
//   Add to campaign      one of the dealership's campaigns that hasn't started sending (/api/campaigns/[id]/leads)
import { forwardRef, useState } from "react";
import { Alert, Badge, Button, Dropdown, Form, ListGroup, Modal, Spinner } from "react-bootstrap";
import ExportFormButton from "../customers/[id]/components/ExportFormButton";
import { DEPARTMENT_NAMES, DEPARTMENTS, leadDepartment } from "@lib/departmentNames";
import { formatTimestamp } from "../../utils/dateUtils";
import ViewAdfModal from "../leads/components/ViewAdfModal";
import "./opportunity.css";

const auth = (json = false) => ({ ...(json ? { "Content-Type": "application/json" } : {}),
  Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });
async function call(url, options = {}) {
  const res = await fetch(url, { ...options, headers: auth(Boolean(options.body)) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const noteText = (n) => {
  const raw = n.mail_content || (typeof n.body === "string" ? n.body : "") || "";
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
};

const Dots = forwardRef(function Dots({ onClick }, ref) {
  return (
    <Button ref={ref} size="sm" variant="outline-custom" className="opp_dots" title="More: print, checklist, audit log, campaign..."
      aria-label="More actions" onClick={(e) => { e.preventDefault(); onClick?.(e); }}>
      <i className="fa-regular fa-ellipsis" />
    </Button>
  );
});

export default function OpportunityMenu({ lead, timezone, onDepartment }) {
  const [open, setOpen] = useState(null); // "print" | "checklist" | "type" | "audit" | "campaign"
  const [info, setInfo] = useState(null); // GET /api/leads/[id]/opportunity/menu
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(null);
  const [adfOpen, setAdfOpen] = useState(false); // 24 Nov 2026: the lead's ADF file, from the lead page too
  const leadId = lead?._id;
  const dealerId = lead?.dealer_id ? String(lead.dealer_id) : null;
  const customerId = lead?.customer_id ? String(lead.customer_id?._id || lead.customer_id) : null;

  const load = async () => {
    if (!leadId) return;
    setLoading(true);
    try { setInfo(await call(`/api/leads/${leadId}/opportunity/menu`)); setError(""); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  const show = (what) => { setNotice(""); setError(""); setOpen(what); };
  const close = () => { setOpen(null); setNotice(""); setError(""); };

  const printNotes = async () => {
    setNotice(""); setError("");
    const win = window.open("", "_blank"); // opened at the click, so the browser doesn't block it
    try {
      const data = await call(`/api/conversations/notes?${new URLSearchParams({ lead_id: leadId, dealer_id: dealerId })}`);
      const notes = (data.notes || []).slice().reverse();
      const vehicle = [lead.vehicle_year, lead.vehicle_make, lead.vehicle_model].filter(Boolean).join(" ");
      if (!win) { setError("Your browser blocked the print window. Allow pop-ups for this site and try again."); return; }
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Work notes - ${esc(lead.name)}</title>
        <style>body{font-family:Arial,sans-serif;margin:24px;color:#222}h1{font-size:20px;margin:0 0 4px}
        .sub{color:#666;font-size:13px;margin-bottom:16px}.n{border-top:1px solid #ddd;padding:8px 0;font-size:14px}
        .at{color:#666;font-size:12px}</style></head><body>
        <h1>Work notes: ${esc(lead.name || "Lead")}</h1>
        <div class="sub">${esc([lead.phone, lead.email, vehicle].filter(Boolean).join(" · "))}<br>Printed ${esc(formatTimestamp(new Date(), timezone))}</div>
        ${notes.length ? notes.map((n) => `<div class="n"><div class="at">${esc(formatTimestamp(n.timestamp || n.date, timezone))}</div>${esc(noteText(n))}</div>`).join("")
          : "<p>No notes on this lead yet.</p>"}
        </body></html>`);
      win.document.close();
      win.focus();
      win.print();
    } catch (e) {
      win?.close();
      setError(e.message);
    }
  };

  const tick = async (item) => {
    setBusy(`c${item.index}`);
    try {
      await call(`/api/desk-log/${info.checklist.entry_id}`, { method: "PATCH",
        body: JSON.stringify({ checklist_item: { index: item.index, done: !item.done } }) });
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };

  const addTo = async (c) => {
    setBusy(c.id);
    try {
      const data = await call(`/api/campaigns/${c.id}/leads`, { method: "POST", body: JSON.stringify({ lead_id: leadId }) });
      setNotice(data.message || "Added");
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };

  const convert = async (dept) => {
    setBusy(dept);
    try { await onDepartment(dept); close(); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };

  const checklist = info?.checklist;
  const doneCount = checklist ? checklist.items.filter((i) => i.done).length : 0;

  return (
    <>
      <Dropdown align="end" onToggle={(isOpen) => { if (isOpen && !info) load(); }}>
        <Dropdown.Toggle as={Dots} />
        <Dropdown.Menu className="opp_menu">
          <Dropdown.Item onClick={() => show("print")} disabled={!customerId}>
            <i className="fa-regular fa-print" />Print a document{!customerId && <small className="d-block text-muted">Needs a customer profile</small>}
          </Dropdown.Item>
          <Dropdown.Item onClick={printNotes}><i className="fa-regular fa-note-sticky" />Print work notes</Dropdown.Item>
          {checklist && (
            <Dropdown.Item onClick={() => show("checklist")}>
              <i className="fa-regular fa-list-check" />Delivery checklist ({doneCount}/{checklist.items.length})
            </Dropdown.Item>
          )}
          {onDepartment && (
            <Dropdown.Item onClick={() => show("type")}><i className="fa-regular fa-arrows-rotate" />Change lead type
              <small className="d-block text-muted">Now: {DEPARTMENT_NAMES[leadDepartment(lead)]}</small></Dropdown.Item>
          )}
          <Dropdown.Item onClick={() => setAdfOpen(true)}><i className="fa-regular fa-file-code" />View ADF</Dropdown.Item>
          <Dropdown.Item onClick={() => show("audit")}><i className="fa-regular fa-clock-rotate-left" />View audit log</Dropdown.Item>
          <Dropdown.Item onClick={() => show("campaign")}><i className="fa-regular fa-bullhorn" />Add customer to campaign</Dropdown.Item>
          {loading && <div className="px-3 small text-muted"><Spinner size="sm" className="me-1" />Loading...</div>}
        </Dropdown.Menu>
      </Dropdown>
      {error && !open && <Alert variant="danger" className="py-1 px-2 small mt-1 mb-0" dismissible onClose={() => setError("")}>{error}</Alert>}

      <ViewAdfModal show={adfOpen} onHide={() => setAdfOpen(false)} leadId={leadId} />
      <Modal show={!!open} onHide={close} centered size={open === "audit" ? "lg" : undefined} scrollable>
        <Modal.Header closeButton>
          <Modal.Title className="fs-6">
            {{ print: "Print a document", checklist: "Delivery checklist", type: "Change lead type", audit: "Audit log",
              campaign: "Add customer to campaign" }[open]}: {lead?.name || "Lead"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && <Alert variant="danger" className="py-2 small">{error}</Alert>}
          {notice && <Alert variant="success" className="py-2 small">{notice}</Alert>}
          {open !== "print" && open !== "type" && loading && !info && <div className="text-center py-3"><Spinner size="sm" /></div>}

          {open === "print" && (
            <>
              <p className="small text-muted">Pick one of your dealership&apos;s forms. You check the filled-in blanks, then print or download it.</p>
              <ExportFormButton customerId={customerId} dealerId={dealerId} />
            </>
          )}

          {open === "type" && (
            <>
              <p className="small text-muted">Moves this lead to another department without closing it. That department&apos;s staff get an email that it&apos;s theirs.</p>
              <div className="d-flex gap-2">
                {DEPARTMENTS.map((d) => (
                  <Button key={d} variant={leadDepartment(lead) === d ? "custom" : "outline-custom"} disabled={!!busy || leadDepartment(lead) === d}
                    onClick={() => convert(d)}>{busy === d ? <Spinner size="sm" /> : DEPARTMENT_NAMES[d]}</Button>
                ))}
              </div>
            </>
          )}

          {open === "checklist" && checklist && (
            <>
              <p className="small text-muted">From the showroom visit on {formatTimestamp(checklist.visit_at, timezone)} (Sold Pending). Ticks show on the Desk Log too.</p>
              {checklist.items.map((item) => (
                <Form.Check key={item.index} id={`opp-check-${item.index}`} className="mb-2" disabled={busy === `c${item.index}`}
                  checked={item.done} onChange={() => tick(item)}
                  label={<>{item.item}{item.done && item.at && <small className="text-muted ms-2">{formatTimestamp(item.at, timezone)}</small>}</>} />
              ))}
            </>
          )}

          {open === "audit" && info && (
            info.audit.length ? (
              <ListGroup variant="flush" className="small">
                {info.audit.map((a, i) => (
                  <ListGroup.Item key={i} className="px-0">
                    <div className="d-flex gap-2">
                      <Badge bg={a.actor === "ai" ? "primary" : a.actor === "staff" ? "dark" : "secondary"} className="align-self-start">
                        {a.actor === "ai" ? "AI" : a.actor === "staff" ? "Staff" : a.actor === "customer" ? "Customer" : "System"}</Badge>
                      <span className={`me-auto ${a.undone ? "text-decoration-line-through text-muted" : ""}`}>{a.text}</span>
                      <span className="text-muted text-nowrap">{formatTimestamp(a.at, timezone)}</span>
                    </div>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            ) : <p className="text-muted small mb-0">Nothing has been changed on this lead yet.</p>
          )}

          {open === "campaign" && info && (
            info.campaigns.length ? (
              <ListGroup variant="flush" className="small">
                {info.campaigns.map((c) => (
                  <ListGroup.Item key={c.id} className="px-0 d-flex align-items-center gap-2">
                    <span className="me-auto">{c.name}
                      <small className="d-block text-muted">{c.channel === "sms" ? "Text" : "Email"} · {c.status}
                        {c.scheduled_date ? ` · ${formatTimestamp(c.scheduled_date, timezone)}` : ""}</small></span>
                    {c.member ? <Badge bg="success">Added</Badge> : (
                      <Button size="sm" variant="outline-custom" disabled={!!busy} onClick={() => addTo(c)}>
                        {busy === c.id ? <Spinner size="sm" /> : "Add"}</Button>
                    )}
                  </ListGroup.Item>
                ))}
              </ListGroup>
            ) : <p className="text-muted small mb-0">No campaign can take customers right now (only campaigns that haven&apos;t started sending can). Create one on the Campaigns page.</p>
          )}
        </Modal.Body>
      </Modal>
    </>
  );
}
