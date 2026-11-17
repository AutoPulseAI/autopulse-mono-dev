"use client";
// Desk Log settings (lib/deskLog/rules.js): which outcomes send the dealership's managers an alert, and the Sold
// Pending delivery checklist. Who follows up and how is the AI's, set in AI Studio - not here.
import { useEffect, useState } from "react";
import { Alert, Button, Form, Modal, Spinner, Table } from "react-bootstrap";
import { deskLogRules, saveDeskLogRules } from "../deskLogApi";

export default function RulesModal({ dealerId, onHide, onSaved }) {
  const [data, setData] = useState(null);
  const [rules, setRules] = useState({});
  const [checklist, setChecklist] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const apply = (d) => { setData(d); setRules(d.rules); setChecklist((d.checklist || []).join("\n")); };
  useEffect(() => { deskLogRules(dealerId).then(apply).catch((e) => setError(e.message)); }, [dealerId]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      apply(await saveDeskLogRules({ dealer_id: dealerId, rules, checklist: checklist.split("\n") }));
      onSaved?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const ro = !data?.can_edit || busy;

  return (
    <Modal show onHide={onHide} size="lg" centered scrollable>
      <Modal.Header closeButton><Modal.Title as="h5">Desk Log settings</Modal.Title></Modal.Header>
      <Modal.Body className="small">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        {!data ? <Spinner animation="border" /> : (
          <>
            <p className="text-muted mb-2">Follow-ups after a visit are run by the AI (set up by AutoPulse). Here you choose
              which outcomes alert your managers, and your delivery checklist.</p>
            <Table size="sm" className="align-middle mb-3">
              <thead><tr><th>Outcome</th><th className="text-center">Alert managers</th></tr></thead>
              <tbody>
                {data.outcomes.map(({ key, label }) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td className="text-center"><Form.Check className="d-inline-block" checked={Boolean(rules[key]?.alert_managers)}
                      disabled={ro} aria-label={`Alert managers: ${label}`}
                      onChange={(e) => setRules((r) => ({ ...r, [key]: { alert_managers: e.target.checked } }))} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Form.Group><Form.Label className="fw-semibold mb-0">Sold Pending delivery checklist (one item per line)</Form.Label>
              <Form.Control as="textarea" rows={5} value={checklist} disabled={ro} placeholder="e.g. Insurance card received"
                onChange={(e) => setChecklist(e.target.value)} />
              <Form.Text>Added to a visit when it is marked Sold Pending, and ticked off there.</Form.Text></Form.Group>
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-custom" onClick={onHide}>Close</Button>
        {data?.can_edit && <Button variant="custom" disabled={busy} onClick={save}>{busy ? <Spinner size="sm" /> : "Save"}</Button>}
      </Modal.Footer>
    </Modal>
  );
}
