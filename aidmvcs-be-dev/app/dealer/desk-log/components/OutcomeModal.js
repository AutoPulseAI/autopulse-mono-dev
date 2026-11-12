"use client";
// Confirms an outcome before it is saved: it changes the lead's status (and what runs for that status). Future
// Follow-Up needs the follow-up date and time (SOW 9C).
import { useState } from "react";
import { Alert, Button, Form, Modal } from "react-bootstrap";
import moment from "moment-timezone";
import { UNSOLD_REASONS } from "../../../lib/deskLog/constants";
import { outcomeEffect } from "./deskLogUi";

export default function OutcomeModal({ row, choice, tz, onHide, onSave }) {
  const needsDate = choice.reason === UNSOLD_REASONS.FUTURE_FOLLOW_UP;
  const [when, setWhen] = useState(row.next_step_at ? moment(row.next_step_at).tz(tz).format("YYYY-MM-DDTHH:mm") : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    if (needsDate && !when) { setError("Pick the follow-up date and time."); return; }
    setBusy(true);
    setError(null);
    try {
      await onSave({ outcome: choice.outcome, unsold_reason: choice.reason,
        ...(needsDate ? { next_step_at: moment.tz(when, "YYYY-MM-DDTHH:mm", tz).toISOString() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}) });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal show onHide={onHide} centered>
      <Modal.Header closeButton><Modal.Title as="h5">{row.customer || "Visit"}: {choice.label}</Modal.Title></Modal.Header>
      <Modal.Body>
        <p className="mb-3">{outcomeEffect(choice)}</p>
        {needsDate && (
          <Form.Group className="mb-3">
            <Form.Label>Follow-up date and time (dealership time)</Form.Label>
            <Form.Control type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Form.Group>
        )}
        <Form.Group>
          <Form.Label>Note (optional)</Form.Label>
          <Form.Control as="textarea" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Form.Group>
        {error && <Alert variant="danger" className="mt-3 mb-0">{error}</Alert>}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy}>{busy ? "Saving..." : "Save outcome"}</Button>
      </Modal.Footer>
    </Modal>
  );
}
