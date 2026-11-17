"use client";
// One visit's details: stock #, vehicle, trade, next step, notes, and the full change history (who, when, from, to).
// G-082: the fields save by themselves (1.5 s after typing stops, or when a field loses focus / the dialog closes),
// with "Saving… / All changes saved / Not saved: why" beside them. A note is saved with its own "Add note" button.
import { useEffect, useState } from "react";
import useAutosave, { SaveStatus } from "../../../hooks/useAutosave";
import { Alert, Button, Form, Modal, Spinner } from "react-bootstrap";
import moment from "moment-timezone";
import { deskLogEntry, deskLogUpdate } from "../deskLogApi";

const FIELD_LABEL = { checked_in: "Checked in", stage: "Stage", outcome: "Outcome", unsold_reason: "Unsold reason",
  salesperson_id: "Salesperson", sales_manager_id: "Sales manager", bdc_agent_id: "BDC agent",
  stock_number: "Stock #", department: "Department", next_step_at: "Next step" };
const fieldLabel = (f) => FIELD_LABEL[f] || f.replace("vehicle.", "Vehicle ").replace("trade.", "Trade ");
const VEHICLE = [["year", "Year"], ["make", "Make"], ["model", "Model"], ["trim", "Trim"], ["vin", "VIN"]];

export default function VisitModal({ id, name, staff, tz, onHide, onChanged }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const d = await deskLogEntry(id);
      setData(d);
      const e = d.entry;
      setForm({ stock_number: e.stock_number || "", vehicle: { ...e.vehicle }, trade: { ...e.trade },
        next_step_at: e.next_step_at ? moment(e.next_step_at).tz(tz).format("YYYY-MM-DDTHH:mm") : "" });
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const staffName = (v) => staff.find((s) => String(s._id) === String(v))?.name;
  const show = (field, v) => {
    if (v == null || v === "") return "-";
    if (field.endsWith("_id")) return staffName(v) || "Staff";
    if (field === "checked_in" || field === "next_step_at") return moment(v).tz(tz).format("MMM D, h:mm A");
    return String(v);
  };

  const auto = useAutosave(async (f) => {
    try {
      await deskLogUpdate(id, { stock_number: f.stock_number, vehicle: f.vehicle, trade: f.trade,
        next_step_at: f.next_step_at ? moment.tz(f.next_step_at, "YYYY-MM-DDTHH:mm", tz).toISOString() : null,
        if_updated_at: data?.entry?.updatedAt });
    } catch (e) {
      if (e.status === 409) await load(); // someone else's newer change: shown, the user makes theirs again
      throw e;
    }
    const d = await deskLogEntry(id);
    setData(d); // history and notes; the form keeps what the user is typing
    await onChanged();
  });
  const edit = (fn) => setForm((f) => { const next = fn(f); auto.change(next); return next; });
  const close = async () => {
    await auto.flush();
    if (auto.unsaved() && !window.confirm("Your last changes could not be saved. Close anyway and lose them?")) return;
    onHide();
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await auto.flush();
      await deskLogUpdate(id, { note: note.trim() });
      setNote("");
      setData(await deskLogEntry(id));
      await onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const vehicleFields = (key) => (
    <div className="row g-2 mb-3">
      {VEHICLE.map(([k, label]) => (
        <Form.Group key={k} className={k === "vin" ? "col-md-4" : "col-md-2"}>
          <Form.Label className="small mb-0">{label}</Form.Label>
          <Form.Control size="sm" value={form[key][k] ?? ""} onBlur={auto.flush}
            onChange={(e) => edit((f) => ({ ...f, [key]: { ...f[key], [k]: e.target.value } }))} />
        </Form.Group>
      ))}
    </div>
  );

  return (
    <Modal show onHide={close} size="lg" centered scrollable>
      <Modal.Header closeButton><Modal.Title as="h5">{name ? `${name}: visit details` : "Visit details"}</Modal.Title></Modal.Header>
      <Modal.Body className="desk_log">
        {!data && !error && <Spinner animation="border" />}
        {form && (
          <>
            <div className="row g-2 mb-3">
              <Form.Group className="col-md-4"><Form.Label className="small mb-0">Stock #</Form.Label>
                <Form.Control size="sm" value={form.stock_number} maxLength={40} onBlur={auto.flush}
                  onChange={(e) => edit((f) => ({ ...f, stock_number: e.target.value }))} /></Form.Group>
              <Form.Group className="col-md-5"><Form.Label className="small mb-0">Next step (dealership time)</Form.Label>
                <Form.Control size="sm" type="datetime-local" value={form.next_step_at} onBlur={auto.flush}
                  onChange={(e) => edit((f) => ({ ...f, next_step_at: e.target.value }))} /></Form.Group>
              <div className="col-md-3 d-flex align-items-end justify-content-end">
                <SaveStatus status={auto.status} error={auto.error} onRetry={auto.flush} />
              </div>
            </div>
            <h6 className="mb-1">Vehicle of interest</h6>
            {vehicleFields("vehicle")}
            <h6 className="mb-1">Trade</h6>
            {vehicleFields("trade")}
            <Form.Group className="mb-2"><Form.Label className="small mb-0">Add a note</Form.Label>
              <Form.Control as="textarea" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
            </Form.Group>
            <div className="text-end mb-3">
              <Button size="sm" onClick={addNote} disabled={busy || !note.trim()}>{busy ? "Saving..." : "Add note"}</Button>
            </div>
            {(data.entry.checklist || []).length > 0 && (
              <>
                <h6>Delivery checklist</h6>
                <div className="mb-3">
                  {data.entry.checklist.map((c, i) => (
                    <Form.Check key={i} id={`chk-${i}`} label={<>{c.item}{c.done && c.by_name
                      ? <small className="text-muted"> ({c.by_name}, {moment(c.at).tz(tz).format("MMM D, h:mm A")})</small> : null}</>}
                      checked={Boolean(c.done)} disabled={busy}
                      onChange={async (e) => {
                        setBusy(true); setError(null);
                        try { await deskLogUpdate(id, { checklist_item: { index: i, done: e.target.checked } });
                          setData(await deskLogEntry(id)); await onChanged(); }
                        catch (err) { setError(err.message); } finally { setBusy(false); }
                      }} />
                  ))}
                </div>
              </>
            )}
            {(data.entry.car_finder_matches || []).length > 0 && (
              <>
                <h6>Car Finder: matching cars that came in</h6>
                <ul className="small mb-3">
                  {data.entry.car_finder_matches.map((m) => (
                    <li key={m.vin}>{m.vehicle}{m.stock_number ? ` · stock #${m.stock_number}` : ""} · VIN {m.vin}
                      {m.price ? ` · $${Number(m.price).toLocaleString("en-US")}` : ""}
                      <small className="text-muted"> ({moment(m.found_at).tz(tz).format("MMM D")})</small></li>
                  ))}
                </ul>
              </>
            )}
            {data.notes.length > 0 && (
              <>
                <h6>Notes</h6>
                <ul className="list-unstyled dl_history mb-3">
                  {data.notes.map((n, i) => (
                    <li key={i}>{n.text}<small className="d-block text-muted">{n.by || "Staff"},{" "}
                      {moment(n.at).tz(tz).format("MMM D, h:mm A")}</small></li>
                  ))}
                </ul>
              </>
            )}
            <h6>History</h6>
            <ul className="list-unstyled dl_history mb-0">
              {data.history.map((h, i) => (
                <li key={i}><strong>{fieldLabel(h.field)}</strong>
                  {h.field === "checked_in" ? `: ${show(h.field, h.to)}` : `: ${show(h.field, h.from)} → ${show(h.field, h.to)}`}
                  <small className="d-block text-muted">{h.by || "Staff"}, {moment(h.at).tz(tz).format("MMM D, h:mm A")}</small>
                </li>
              ))}
            </ul>
          </>
        )}
        {error && <Alert variant="danger" className="mt-3 mb-0">{error}</Alert>}
      </Modal.Body>
    </Modal>
  );
}
