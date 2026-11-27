"use client";
// Merge review (SOW B3, G-008): two customers side by side. Pick the customer to keep and, for name / email / address,
// which value to keep -> Preview -> Merge. Nothing merges until Merge. Used by Customers > Possible duplicates and by
// the Merge button on a customer's profile (26 Nov 2026). The merge itself: app/api/customers/merge.
//   customers  [a, b] in the duplicates list's shape ({ _id, name, emails[], phones[], address, leads })
//   keep       the one picked to keep at first
//   onDone({ merged, keep_id, merge_id })   after Merge or "Not the same person"
import { useEffect, useState } from "react";
import { Alert, Button, Form, Offcanvas, Spinner, Table } from "react-bootstrap";
import AppIcon, { Avatar, IconLabel } from "../../components/AppIcon";

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function MergeReview({ customers, keep: firstKeep, dealerId, onHide, onDone }) {
  const [keep, setKeep] = useState(firstKeep);
  const [picks, setPicks] = useState({});
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setKeep(firstKeep); setPicks({}); setReason(""); setPreview(null); setError(null); }, [customers, firstKeep]);

  const pair = customers || [];
  const other = pair.find((c) => c._id !== keep);
  const body = () => ({ dealer_id: dealerId, keep_id: keep, merge_id: other?._id, picks, reason });
  const run = async (fn) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const previewMerge = () => run(async () => setPreview(await post("/api/customers/merge", { ...body(), confirm: false })));
  const confirmMerge = () => run(async () => {
    await post("/api/customers/merge", { ...body(), confirm: true });
    onDone?.({ merged: true, keep_id: keep, merge_id: other?._id });
  });
  const notSame = () => run(async () => {
    await post("/api/customers/duplicates", { dealer_id: dealerId, customer_ids: pair.map((c) => c._id), decision: "not_duplicate" });
    onDone?.({ merged: false });
  });

  return (
    <Offcanvas show={pair.length === 2} onHide={onHide} placement="end" style={{ width: "min(620px, 100vw)" }}>
      <Offcanvas.Header closeButton><Offcanvas.Title as="h6"><AppIcon name="customers" className="me-2" />Merge review</Offcanvas.Title></Offcanvas.Header>
      <Offcanvas.Body className="small d-flex flex-column">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        <p className="text-muted mb-2">Pick the customer to keep and the value to keep for each field. Nothing merges until you confirm.</p>
        {pair.length === 2 && (
          <div className="table-responsive">
            <Table size="sm" className="align-middle">
              <thead><tr><th />{pair.map((c) => (
                <th key={c._id}><Form.Check type="radio" id={`keep-${c._id}`} name="keep" checked={keep === c._id} aria-label={`Keep ${c.name || "this customer"}`}
                  onChange={() => { setKeep(c._id); setPicks({}); setPreview(null); }}
                  label={<span className="ap_person"><Avatar name={c.name} small /><span>{c.name || "(no name)"}</span></span>} /></th>))}</tr></thead>
              <tbody>
                {[["name", "Name", "customer", (c) => c.name], ["email", "Email", "email", (c) => c.emails[0]], ["address", "Address", "source", (c) => c.address]].map(([field, label, icon, get]) => (
                  <tr key={field}><td className="fw-semibold"><IconLabel name={icon}>{label}</IconLabel></td>
                    {pair.map((c) => {
                      const isKeep = c._id === keep;
                      const on = (picks[field] === "merge") !== isKeep;
                      return <td key={c._id} className="text-break"><Form.Check type="radio" id={`${field}-${c._id}`} name={`pick-${field}`} disabled={!get(c)} checked={!!get(c) && on}
                        onChange={() => { setPicks({ ...picks, [field]: isKeep ? "keep" : "merge" }); setPreview(null); }} label={get(c) || "Not set"} /></td>;
                    })}
                  </tr>
                ))}
                <tr><td className="fw-semibold"><IconLabel name="phone">Phone</IconLabel></td>{pair.map((c) => <td key={c._id}>{c.phones.join(", ") || "Not set"}</td>)}</tr>
                <tr><td className="fw-semibold"><IconLabel name="lead">Leads</IconLabel></td>{pair.map((c) => <td key={c._id}>{c.leads}</td>)}</tr>
              </tbody>
            </Table>
          </div>
        )}
        <Form.Control size="sm" placeholder="Why (optional)" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        {preview && (
          <div className="mt-3">
            <div className="fw-semibold mb-1">Opportunities stay separate</div>
            <Table size="sm" className="align-middle">
              <thead><tr><th><IconLabel name="vehicle">Lead</IconLabel></th><th><IconLabel name="source">Source</IconLabel></th><th><IconLabel name="status">Status</IconLabel></th><th><IconLabel name="owner">Owner</IconLabel></th></tr></thead>
              <tbody>{[...preview.keep.opportunities, ...preview.merge.opportunities].map((o) => (
                <tr key={o.id}><td>{o.vehicle || "No vehicle"}</td><td>{o.source || "-"}</td><td>{o.status || "-"}</td><td>{o.owner || "Unassigned"}</td></tr>))}</tbody>
            </Table>
            <ul className="mb-1">
              <li>Nothing is deleted or moved: every lead keeps its own source, dates, status, owner, conversation and AI follow-ups.</li>
              <li>The value not picked is kept on the merge, and Undo puts it back. {preview.merge.deals} sale(s), {preview.merge.service_visits} service visit(s) and {preview.merge.trade_ins} trade-in(s) will show there.</li>
              <li>It can be undone from Customers &gt; Possible duplicates &gt; &quot;Recent merges&quot;.</li>
              {preview.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </div>
        )}
        <div className="d-flex gap-2 justify-content-end mt-auto pt-3">
          <Button size="sm" variant="outline-secondary" disabled={busy} onClick={notSame}>Not the same person</Button>
          {!preview ? (
            <Button size="sm" variant="custom" disabled={busy} onClick={previewMerge}>{busy ? <Spinner size="sm" /> : "Preview"}</Button>
          ) : (
            <Button size="sm" variant="custom" disabled={busy} onClick={confirmMerge}>{busy ? <Spinner size="sm" /> : "Merge"}</Button>
          )}
        </div>
      </Offcanvas.Body>
    </Offcanvas>
  );
}
