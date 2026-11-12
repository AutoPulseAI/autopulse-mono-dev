"use client";
// Reassign many leads at once (SOW Deliverable B b5, gap G-010): pick leads on the page -> pick the new owner ->
// Preview (nothing changes yet) -> Confirm -> what changed, what was already theirs, what failed and why.
// Only for staff with "Assign Leads" (the server checks it too: /api/leads/bulk-assign).
import { useState } from "react";
import { Alert, Button, Form, Modal, Spinner, Table } from "react-bootstrap";

const call = async (body) => {
  const res = await fetch("/api/leads/bulk-assign", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data;
};

export default function BulkAssign({ dealerId, selectedIds, staffList, onClear, onDone }) {
  const [to, setTo] = useState("");
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const count = selectedIds.length;
  if (!count && !preview && !result) return null;

  const body = { dealer_id: dealerId, lead_ids: selectedIds, assigned_to: to || null };
  const doPreview = async () => {
    setBusy(true); setError(null);
    try { setPreview(await call({ ...body, confirm: false })); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const doConfirm = async () => {
    setBusy(true); setError(null);
    try { setResult(await call({ ...body, confirm: true })); setPreview(null); onDone?.(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const close = () => { setPreview(null); setResult(null); setError(null); };
  const finish = () => { close(); onClear?.(); };

  return (
    <>
      {count > 0 && (
        <div className="d-flex flex-wrap align-items-center gap-2 p-2 mb-2 border rounded bg-light">
          <strong className="small">{count} selected</strong>
          <span className="small text-muted">Reassign to</span>
          <Form.Select size="sm" className="w-auto" value={to} onChange={(e) => setTo(e.target.value)}
            aria-label="New owner for the selected leads">
            <option value="">Unassigned</option>
            {staffList.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </Form.Select>
          <Button size="sm" variant="custom" disabled={busy} onClick={doPreview}>
            {busy ? <Spinner size="sm" /> : "Preview"}
          </Button>
          <Button size="sm" variant="link" onClick={onClear}>Clear selection</Button>
          {error && !preview && <span className="small text-danger">{error}</span>}
        </div>
      )}

      <Modal show={!!preview || !!result} onHide={result ? finish : close} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title as="h6">{result ? "Reassignment done" : "Check before reassigning"}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && <Alert variant="danger" className="py-2 small">{error}</Alert>}
          {preview && (
            <>
              <p className="small mb-2">
                {preview.summary.will_change} will move to <strong>{preview.rows.find((r) => r.will_be)?.will_be}</strong>
                {preview.summary.already ? `, ${preview.summary.already} already theirs` : ""}
                {preview.summary.errors ? `, ${preview.summary.errors} can't be changed` : ""}. Nothing has changed yet.
              </p>
              <Table size="sm" className="small mb-0">
                <thead><tr><th>Lead</th><th>Now</th><th>After</th></tr></thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.lead_id} className={r.error ? "text-danger" : r.change ? "" : "text-muted"}>
                      <td>{r.name || r.lead_id}</td>
                      <td>{r.error ? "-" : r.current}</td>
                      <td>{r.error || (r.change ? r.will_be : "No change")}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
          {result && (
            <>
              <p className="small mb-2">
                Reassigned: <strong>{result.updated}</strong> · Already theirs: {result.unchanged} · Failed: {result.failed.length}
              </p>
              {result.failed.length > 0 && (
                <Table size="sm" className="small mb-0">
                  <thead><tr><th>Lead</th><th>Why it failed</th></tr></thead>
                  <tbody>{result.failed.map((f) => <tr key={f.lead_id}><td>{f.lead_id}</td><td>{f.reason}</td></tr>)}</tbody>
                </Table>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          {preview && (
            <>
              <Button size="sm" variant="outline-custom" onClick={close}>Cancel</Button>
              <Button size="sm" variant="custom" disabled={busy || !preview.summary.will_change} onClick={doConfirm}>
                {busy ? <Spinner size="sm" /> : `Confirm (${preview.summary.will_change})`}
              </Button>
            </>
          )}
          {result && <Button size="sm" variant="custom" onClick={finish}>Done</Button>}
        </Modal.Footer>
      </Modal>
    </>
  );
}
