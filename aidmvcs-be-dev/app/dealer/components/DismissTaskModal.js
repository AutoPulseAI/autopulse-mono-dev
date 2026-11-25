"use client";
// Dismiss a task: close it without doing it, with why (Bibi, 25 Nov 2026). Only for people whose role has
// "Dismiss Tasks" (app/lib/taskPermission.js); the server checks it too. Works for an AI call task (kind "call") and a
// reminder staff set (kind "reminder"). It can be undone from Actions > Tasks > Closed.
import { useEffect, useState } from "react";
import { Alert, Button, Form, Modal, Spinner } from "react-bootstrap";
import { aiFetch } from "../ai/components/aiShared";

export const DISMISS_TASKS = "Dismiss Tasks";

export async function dismissTask(task, reason, dealerId) {
  if (task.kind === "call") {
    return aiFetch(`/api/dealer-ai/call-tasks/${task.id}`, { method: "POST",
      body: JSON.stringify({ action: "dismiss", note: `Call task dismissed (no call made): ${reason}`, dealer_id: dealerId }) });
  }
  return aiFetch(`/api/leads/${task.lead_id}/opportunity`, { method: "POST",
    body: JSON.stringify({ action: "reminder_dismiss", reminder_id: task.id, reason }) });
}

export default function DismissTaskModal({ task, dealerId, onHide, onDone }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setReason(""); setError(""); }, [task]);

  const submit = async () => {
    setSaving(true); setError("");
    try {
      await dismissTask(task, reason.trim(), dealerId);
      onDone?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal show={!!task} onHide={onHide} centered>
      <Modal.Header closeButton><Modal.Title as="h5">Dismiss this task</Modal.Title></Modal.Header>
      <Modal.Body>
        {task && <p className="mb-2"><strong>{task.text || task.why}</strong></p>}
        <p className="text-muted small mb-2">It closes without being done and leaves every open list. It can be brought back
          from Tasks &gt; Closed.</p>
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        <Form.Group>
          <Form.Label className="small">Why is it dismissed?</Form.Label>
          <Form.Control as="textarea" rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Customer already bought elsewhere" autoFocus />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0">
        <Button variant="link" onClick={onHide} disabled={saving}>Cancel</Button>
        <Button variant="danger" onClick={submit} disabled={saving || !reason.trim()}>
          {saving && <Spinner animation="border" size="sm" className="me-2" />}Dismiss task
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
