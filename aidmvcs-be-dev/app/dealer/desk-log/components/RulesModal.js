"use client";
// The dealership's Desk Log follow-up rules (SOW v6 Deliverable J matrix): for each outcome and unsold reason - who
// follows up, whose next step it is and when it's due, whether managers are alerted, the report group - and the Sold
// Pending delivery checklist. Saved as a new version each time. The AI's wording per reason is in AI Studio.
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

  const set = (key, patch) => setRules((r) => ({ ...r, [key]: { ...r[key], ...patch } }));
  const save = async () => {
    setBusy(true); setError(null);
    try {
      apply(await saveDeskLogRules({ dealer_id: dealerId, rules, checklist: checklist.split("\n") }));
      onSaved?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const ro = !data?.can_edit || busy;

  return (
    <Modal show onHide={onHide} size="xl" centered scrollable>
      <Modal.Header closeButton><Modal.Title as="h5">Desk Log follow-up rules
        {data?.version ? <small className="text-muted ms-2">version {data.version}</small> : null}</Modal.Title></Modal.Header>
      <Modal.Body className="small">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        {!data ? <Spinner animation="border" /> : (
          <>
            <p className="text-muted">What happens when a visit gets each outcome. &quot;Staff only&quot; and &quot;Nobody&quot;
              turn the AI off for that lead. The AI&apos;s message for each unsold reason is set in AI Studio &gt; Cadences &gt;
              Unsold.</p>
            <Table size="sm" className="align-middle">
              <thead><tr><th>Outcome</th><th>Who follows up</th><th>Whose step</th><th>Next step due (hours)</th>
                <th>Alert managers</th><th>Report group</th></tr></thead>
              <tbody>
                {data.outcomes.map(({ key, label, locked }) => {
                  const r = rules[key] || {};
                  return (
                    <tr key={key}>
                      <td className="fw-semibold">{label}{locked && <div className="text-muted fw-normal">fixed: no outreach</div>}</td>
                      <td><Form.Select size="sm" value={r.who} disabled={ro || locked} onChange={(e) => set(key, { who: e.target.value })}>
                        {Object.entries(data.who).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Form.Select></td>
                      <td><Form.Select size="sm" value={r.owner} disabled={ro || locked || r.who === "ai" || r.who === "nobody"}
                        onChange={(e) => set(key, { owner: e.target.value })}>
                        {Object.entries(data.owners).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Form.Select></td>
                      <td style={{ width: 120 }}><Form.Control size="sm" type="number" min={1} max={720} placeholder="none"
                        value={r.next_step_hours ?? ""} disabled={ro || locked || r.who === "ai" || r.who === "nobody"}
                        onChange={(e) => set(key, { next_step_hours: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                      <td className="text-center"><Form.Check checked={Boolean(r.alert_managers)} disabled={ro || locked}
                        onChange={(e) => set(key, { alert_managers: e.target.checked })} aria-label={`Alert managers: ${label}`} /></td>
                      <td style={{ width: 150 }}><Form.Control size="sm" value={r.report_group || ""} placeholder="(the outcome)"
                        disabled={ro || locked} maxLength={40} onChange={(e) => set(key, { report_group: e.target.value })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Form.Group className="mb-2"><Form.Label className="fw-semibold mb-0">Sold Pending delivery checklist (one item per line)</Form.Label>
              <Form.Control as="textarea" rows={5} value={checklist} disabled={ro} placeholder="e.g. Insurance card received"
                onChange={(e) => setChecklist(e.target.value)} />
              <Form.Text>Copied to a visit when it is marked Sold Pending; ticked off on the visit.</Form.Text></Form.Group>
            {data.history.length > 0 && (
              <details><summary className="text-muted">Versions</summary>
                <ul className="mb-0">{data.history.map((h) => <li key={h.version}>v{h.version} · {h.by_name || "Staff"} ·
                  {" "}{new Date(h.at).toLocaleString()}</li>)}</ul></details>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-custom" onClick={onHide}>Close</Button>
        {data?.can_edit && <Button variant="custom" disabled={busy} onClick={save}>{busy ? <Spinner size="sm" /> : "Save rules"}</Button>}
      </Modal.Footer>
    </Modal>
  );
}
