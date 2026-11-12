"use client";
// Click-to-call with the call logged (SOW Deliverable H, gap G-059: call from the profile, the lead and the Desk Log,
// "without building a new native dialer"). The button opens the phone (tel:); the staff member then says how the
// call went, and it is saved as a note on the lead - so it shows in the conversation, the customer timeline and the
// appointment's "customer agreed" check ("Called the customer ...", lib/bookingCreator.js CALL_LOGGED).
// Calls from the Call Tasks page keep their own outcome flow (ai/components/CallOutcomeModal.js).
import { useState } from "react";
import { Alert, Button, Form, Modal, Spinner } from "react-bootstrap";
import { CALL_OUTCOMES, aiFetch, callOutcomeLabel, telHref } from "../ai/components/aiShared";

export default function CallButton({ phone, leadId, dealerId, size = "sm", variant = "outline-custom", label = "Call",
  className = "", iconOnly = false, onLogged }) {
  const [show, setShow] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const href = telHref(phone);
  if (!href) return null;

  const open = () => {
    // The phone opens from the link itself; the "how did it go" box comes up right after.
    setTimeout(() => { setOutcome(""); setNotes(""); setError(""); setShow(true); }, 400);
  };
  const save = async () => {
    if (!outcome) { setError("Pick how the call went."); return; }
    if (!leadId) { setError("This customer has no lead to log the call on."); return; }
    setSaving(true); setError("");
    try {
      await aiFetch("/api/conversations/notes", {
        method: "POST",
        body: JSON.stringify({ lead_id: leadId, dealer_id: dealerId, internal_use: true,
          content: `Called the customer (${phone}): ${callOutcomeLabel(outcome)}.${notes.trim() ? ` Notes: ${notes.trim()}` : ""}` }),
      });
      setShow(false);
      onLogged?.();
    } catch (e) {
      setError(e.message || "Could not save the call");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button as="a" href={href} size={size} variant={variant} className={className} onClick={open}
        title={`Call ${phone}`} aria-label={`Call ${phone}`}>
        <i className={`fa-solid fa-phone${iconOnly ? "" : " me-1"}`} />{iconOnly ? null : label}
      </Button>
      <Modal show={show} onHide={() => setShow(false)} centered>
        <Modal.Header closeButton><Modal.Title as="h6">How did the call go?</Modal.Title></Modal.Header>
        <Modal.Body>
          {error && <Alert variant="danger" className="py-2 small">{error}</Alert>}
          <Form.Select size="sm" className="mb-2" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Call result">
            <option value="">Pick one</option>
            {CALL_OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Form.Select>
          <Form.Control as="textarea" rows={2} size="sm" placeholder="Notes (optional)" value={notes}
            onChange={(e) => setNotes(e.target.value)} />
          <small className="text-muted d-block mt-2">Saved as a note on the lead. Closing this box saves nothing.</small>
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="outline-custom" onClick={() => setShow(false)}>I didn&apos;t call</Button>
          <Button size="sm" variant="custom" disabled={saving} onClick={save}>{saving ? <Spinner size="sm" /> : "Save"}</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
