"use client";
// One opportunity's actions on the customer's Leads tab, grouped as in the reference CRM (SOW Appendix B3, 13 Nov 2026
// meeting 10.8 / 10.9 / 10.11) - our own screen, not a copy:
//   Schedule  Reminder (Open tasks at the top of the profile until done) · Appointment (the Appointments page)
//   Log       Phone call made from another phone (the same note as Call) · Store visit (Desk Log check-in) · Other task
//   Connect   Call (opens the phone, then logs it); text and email are in the conversation below
//   Active / Not in Market switch (a flag for staff - the AI's follow-ups are unchanged)
//   Vehicles of interest: several per opportunity, from the dealer's inventory or typed in
// api/leads/[id]/opportunity; every change goes on the customer timeline.
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, Badge, Button, Dropdown, Form, Modal, Spinner } from "react-bootstrap";
import CallButton from "../../../components/CallButton";
import { aiFetch } from "../../../ai/components/aiShared";
import { formatTimestamp } from "../../../../utils/dateUtils";

const carName = (c) => [c.year, c.make, c.model, c.trim].filter(Boolean).join(" ") || c.vin || "Vehicle";

function InventoryPicker({ dealerId, onPick }) {
  const [q, setQ] = useState("");
  const [cars, setCars] = useState([]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3 || !dealerId) { setCars([]); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const data = await aiFetch(`/api/inventory/lookup?dealer_id=${encodeURIComponent(dealerId)}&q=${encodeURIComponent(term)}`);
        if (live) setCars(data.cars || []);
      } catch { if (live) setCars([]); }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q, dealerId]);
  return (
    <div className="position-relative">
      <Form.Control size="sm" placeholder="Search inventory: stock #, VIN, make or model" value={q} onChange={(e) => setQ(e.target.value)} />
      {cars.length > 0 && (
        <div className="border rounded bg-white position-absolute w-100 shadow-sm" style={{ zIndex: 5, maxHeight: 220, overflowY: "auto" }}>
          {cars.map((c) => (
            <button key={c.vin || c.stock} type="button" className="d-block w-100 text-start btn btn-link btn-sm text-decoration-none"
              onClick={() => { onPick({ year: c.year ? String(c.year) : "", make: c.make || "", model: c.model || "", trim: c.trim || "",
                vin: c.vin || "", stock: c.stock || c.stock_number || "" }); setQ(""); setCars([]); }}>
              {carName(c)} <span className="text-muted">{c.stock ? `· #${c.stock}` : ""}{c.vin ? ` · ${c.vin}` : ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// toolsTarget (customer profile Leads tab, 27 Nov 2026): an element in the lead's actions bar - Reminder, Appt., Log
// call and Other task are shown there, beside Call / Add note / Update status, instead of in a row of their own.
// showDetails / onData (the customer's lead, 28 Nov 2026): the reminders, vehicles of interest and Active switch show
// only when the lead's Details are open; onData(data) gives the counts for the folded summary line.
export default function OpportunityActions({ lead, onChanged, actionsRef = null, toolsTarget = null, showDetails = true, onData }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reminder, setReminder] = useState(null); // { due_at, note, assigned_to }
  const [task, setTask] = useState(null);         // other task note
  const [manual, setManual] = useState(null);     // typed vehicle
  const [logSignal, setLogSignal] = useState(0);  // More > Log a call
  const url = `/api/leads/${lead._id}/opportunity`;

  const load = useCallback(() => aiFetch(url).then(setData).catch((e) => setError(e.message)), [url]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (data) onData?.(data); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (body) => {
    setBusy(true); setError(null);
    try { setData(await aiFetch(url, { method: "POST", body: JSON.stringify(body) })); onChanged?.(); return true; }
    catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  };
  const logTask = async () => {
    if (!task?.trim()) return;
    setBusy(true); setError(null);
    try {
      await aiFetch("/api/conversations/notes", { method: "POST", body: JSON.stringify({ lead_id: lead._id,
        dealer_id: lead.dealer_id, internal_use: true, content: `Task done: ${task.trim()}` }) });
      setTask(null); onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (!data) return <div className="small text-muted mb-2">{error || <Spinner size="sm" />}</div>;
  const open = data.reminders.filter((r) => !r.done_at);

  return (
    <div className={toolsTarget ? "opp_box small" : "border rounded p-2 mb-3 small"}>
      {error && <Alert variant="danger" className="py-1 px-2 mb-2">{error}</Alert>}
      {/* One row of solid action blocks for this opportunity (Bibi, 25 Nov 2026: all communication in one place, solid
          blue like SMS Reply). The lead's own SMS Reply, Call, Note, Status and Check in are placed in the slot. */}
      {toolsTarget ? createPortal(
        // One More button beside the Leads page's own actions (the user, 28 Nov 2026: keep the bar as on the Leads page).
        <Dropdown className="inbox_more_menu" align="end">
          <Dropdown.Toggle as="button" type="button" className="inbox_act" id={`opp-more-${lead._id}`}>
            <i className="fa-duotone fa-ellipsis" /><span>More</span>
          </Dropdown.Toggle>
          <Dropdown.Menu>
            <Dropdown.Item onClick={() => setReminder({ due_at: "", note: "", assigned_to: "" })}>
              <i className="fa-solid fa-alarm-clock fa-fw me-2 text-warning" />Reminder</Dropdown.Item>
            <Dropdown.Item href="/dealer/booking"><i className="fa-solid fa-calendar-days fa-fw me-2 text-success" />Appointment</Dropdown.Item>
            <Dropdown.Item onClick={() => setLogSignal((n) => n + 1)}>
              <i className="fa-solid fa-phone-arrow-up-right fa-fw me-2 text-primary" />Log a call made from another phone</Dropdown.Item>
            <Dropdown.Item onClick={() => setTask("")}><i className="fa-solid fa-clipboard-list fa-fw me-2 text-secondary" />Other task</Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>, toolsTarget) : null}
      {toolsTarget && <CallButton logOnly hideButton openSignal={logSignal} phone={lead.phone} leadId={lead._id}
        dealerId={lead.dealer_id} onLogged={onChanged} />}
      {toolsTarget ? null : (
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <div className="opp_tools">
          <span className="opp_slot" ref={actionsRef} />
          <Button size="sm" className="act_remind" onClick={() => setReminder({ due_at: "", note: "", assigned_to: "" })}>
            <i className="fa-duotone fa-alarm-clock" />Reminder</Button>
          <Button size="sm" className="act_appt" href="/dealer/booking"><i className="fa-duotone fa-calendar-days" />Appt.</Button>
          <CallButton logOnly phone={lead.phone} leadId={lead._id} dealerId={lead.dealer_id} label="Log call" onLogged={onChanged}
            className="act_log" icon="fa-duotone fa-phone-arrow-up-right" />
          <Button size="sm" className="act_task" onClick={() => setTask("")}><i className="fa-duotone fa-clipboard-list" />Other task</Button>
          {!actionsRef && <CallButton phone={lead.phone} leadId={lead._id} dealerId={lead.dealer_id} onLogged={onChanged} />}
        </div>
        <Form.Check type="switch" className="ms-auto mb-0" id={`in-market-${lead._id}`} disabled={busy}
          label={data.in_market ? "Active" : "Not in market"} checked={data.in_market}
          title="A flag for your team; the AI's follow-ups don't change"
          onChange={(e) => act({ action: "in_market", value: e.target.checked })} />
      </div>
      )}
      {showDetails && (<>
      {open.length > 0 && (
        <ul className="list-unstyled mb-2">
          {open.map((r) => (
            <li key={r.id} className="d-flex flex-wrap align-items-center gap-2 mb-1">
              <i className="fa-regular fa-bell text-warning" />
              <span>{r.note}</span>
              <span className="text-muted">due {formatTimestamp(r.due_at)}{r.assigned_name ? ` · ${r.assigned_name}` : ""}</span>
              <Button size="sm" variant="link" className="p-0" disabled={busy} onClick={() => act({ action: "reminder_done", reminder_id: r.id })}>Done</Button>
            </li>
          ))}
        </ul>
      )}

      <div className="fw-semibold mb-1 d-flex flex-wrap align-items-center gap-2"><span><i className="fa-solid fa-car me-1" />Vehicles of interest
        <Badge bg="light" text="dark" className="ms-1">{data.vehicles_of_interest.length}</Badge></span>
        {toolsTarget && (
          <Form.Check type="switch" className="ms-auto mb-0 fw-normal" id={`in-market-${lead._id}`} disabled={busy}
            label={data.in_market ? "Active" : "Not in market"} checked={data.in_market}
            title="A flag for your team; the AI's follow-ups don't change"
            onChange={(e) => act({ action: "in_market", value: e.target.checked })} />
        )}</div>
      {data.vehicles_of_interest.length === 0 && <div className="text-muted mb-1">None added (the lead&apos;s own vehicle is shown above).</div>}
      <ul className="list-unstyled mb-1">
        {data.vehicles_of_interest.map((v) => (
          <li key={v.id} className="d-flex flex-wrap align-items-center gap-2">
            <span>{carName(v)}</span>
            <span className="text-muted">{v.stock ? `#${v.stock}` : ""}{v.vin ? ` ${v.vin}` : ""}</span>
            <Button size="sm" variant="link" className="p-0 text-danger" disabled={busy}
              onClick={() => window.confirm(`Remove ${carName(v)}?`) && act({ action: "vehicle_remove", vehicle_id: v.id })}>Remove</Button>
          </li>
        ))}
      </ul>
      <div className="d-flex flex-wrap align-items-center gap-2">
        <div style={{ minWidth: 260, flex: 1 }}><InventoryPicker dealerId={lead.dealer_id} onPick={(vehicle) => act({ action: "vehicle_add", vehicle })} /></div>
        <Button size="sm" variant="link" className="p-0" onClick={() => setManual({ year: "", make: "", model: "", vin: "" })}>Type one in</Button>
      </div>
      {manual && (
        <div className="d-flex flex-wrap gap-1 mt-1">
          {["year", "make", "model", "vin"].map((k) => (
            <Form.Control key={k} size="sm" style={{ maxWidth: k === "year" ? 80 : 160 }} placeholder={k === "vin" ? "VIN (optional)" : k[0].toUpperCase() + k.slice(1)}
              value={manual[k]} onChange={(e) => setManual({ ...manual, [k]: e.target.value })} />
          ))}
          <Button size="sm" variant="custom" disabled={busy} onClick={async () => { if (await act({ action: "vehicle_add", vehicle: manual })) setManual(null); }}>Add</Button>
          <Button size="sm" variant="link" onClick={() => setManual(null)}>Cancel</Button>
        </div>
      )}
      </>)}

      <Modal show={!!reminder} onHide={() => setReminder(null)} centered>
        <Modal.Header closeButton><Modal.Title as="h6">Reminder</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Label className="small mb-0">When</Form.Label>
          <Form.Control size="sm" type="datetime-local" className="mb-2" value={reminder?.due_at || ""}
            onChange={(e) => setReminder({ ...reminder, due_at: e.target.value })} />
          <Form.Label className="small mb-0">What for</Form.Label>
          <Form.Control size="sm" className="mb-2" maxLength={300} placeholder="e.g. Call back about the trade value" value={reminder?.note || ""}
            onChange={(e) => setReminder({ ...reminder, note: e.target.value })} />
          <Form.Label className="small mb-0">For</Form.Label>
          <Form.Select size="sm" value={reminder?.assigned_to || ""} onChange={(e) => setReminder({ ...reminder, assigned_to: e.target.value })}>
            <option value="">Anyone</option>
            {data.staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Form.Select>
          <small className="text-muted d-block mt-2">Shows in Open tasks on the customer&apos;s profile until marked done. The customer gets nothing.</small>
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="outline-custom" onClick={() => setReminder(null)}>Cancel</Button>
          <Button size="sm" variant="custom" disabled={busy || !reminder?.due_at || !reminder?.note?.trim()}
            onClick={async () => { if (await act({ action: "reminder", ...reminder, due_at: new Date(reminder.due_at).toISOString() })) setReminder(null); }}>Save</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={task !== null} onHide={() => setTask(null)} centered>
        <Modal.Header closeButton><Modal.Title as="h6">Log a task</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Control as="textarea" rows={2} size="sm" maxLength={500} placeholder="What was done, e.g. Sent the trade photos to the manager"
            value={task || ""} onChange={(e) => setTask(e.target.value)} />
          <small className="text-muted d-block mt-2">Saved as a note on the lead and on the customer&apos;s timeline.</small>
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="outline-custom" onClick={() => setTask(null)}>Cancel</Button>
          <Button size="sm" variant="custom" disabled={busy || !task?.trim()} onClick={logTask}>Save</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
