"use client";
// Add a task from the customer's profile (Bibi, 25 Nov 2026: "Task supposed to trigger in the customer profile, not on
// the lead"). It is the same reminder as Schedule > Reminder on a lead - kept on one of the customer's leads (the
// newest by default) so it shows on Tasks, in Open tasks and in the bell of the person it is for. It never messages
// the customer.
import { useEffect, useState } from "react";
import { Alert, Button, Form, Modal, Spinner } from "react-bootstrap";
import { aiFetch } from "../ai/components/aiShared";

const pad = (n) => String(n).padStart(2, "0");
const localValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const leadLabel = (l) => [l.lead_source || l.source, [l.vehicle_year, l.vehicle_make, l.vehicle_model].filter(Boolean).join(" "),
  l.createdAt ? new Date(l.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null].filter(Boolean).join(" · ") || "Lead";

export default function AddTaskModal({ show, leads = [], staff = [], onHide, onDone }) {
  const [leadId, setLeadId] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [who, setWho] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!show) return;
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000); tomorrow.setHours(10, 0, 0, 0);
    setLeadId(leads[0]?._id || ""); setDue(localValue(tomorrow)); setNote(""); setWho(""); setError("");
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true); setError("");
    try {
      await aiFetch(`/api/leads/${leadId}/opportunity`, { method: "POST", body: JSON.stringify({
        action: "reminder", due_at: new Date(due).toISOString(), note: note.trim(), ...(who ? { assigned_to: who } : {}) }) });
      onDone?.();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton><Modal.Title as="h5">Add a task</Modal.Title></Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        {!leads.length && <Alert variant="warning" className="py-2 small">This customer has no lead yet. Add a lead first.</Alert>}
        <Form.Group className="mb-2">
          <Form.Label className="small">What needs doing</Form.Label>
          <Form.Control value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Call to confirm the trade-in" autoFocus />
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Label className="small">When</Form.Label>
          <Form.Control type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Label className="small">For</Form.Label>
          <Form.Select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">The lead&apos;s owner</option>
            {staff.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </Form.Select>
        </Form.Group>
        {leads.length > 1 && (
          <Form.Group>
            <Form.Label className="small">For which lead</Form.Label>
            <Form.Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              {leads.map((l) => <option key={l._id} value={l._id}>{leadLabel(l)}</option>)}
            </Form.Select>
          </Form.Group>
        )}
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0">
        <Button variant="link" onClick={onHide} disabled={saving}>Cancel</Button>
        <Button variant="custom" onClick={save} disabled={saving || !leadId || !note.trim() || !due}>
          {saving && <Spinner animation="border" size="sm" className="me-2" />}Add task
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
