"use client";
// Possible duplicate customers (SOW Deliverable B b3, gap G-008): customers that share a phone number or an email.
// A manager opens them and, when they are two different people (a couple, a parent and child), marks them
// "Not the same person" so they aren't flagged again. Nothing is merged automatically.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Form, Offcanvas, Spinner, Table } from "react-bootstrap";
import AppIcon, { Avatar, IconLabel } from "../../components/AppIcon";
import { useUser } from "../../context/UserContext";
import { useCan } from "../../../hooks/PermissionsContext";
import { formatTimestamp } from "../../../utils/dateUtils";

export default function DuplicateCustomersPage() {
  const { user, dealerParent } = useUser();
  const dealerId = (dealerParent || user)?.id;
  const canReview = useCan("Manage Leads");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    if (!dealerId) return;
    setError(null);
    try {
      const res = await fetch(`/api/customers/duplicates?dealer_id=${dealerId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load the list");
      setData(body);
    } catch (e) { setError(e.message); }
  }, [dealerId]);
  useEffect(() => { load(); }, [load]);

  // Merge (G-008): pick which customer to keep -> Preview -> Confirm. Undo from "Recent merges".
  const [merge, setMerge] = useState(null); // { customers: [a, b], keep, reason, preview, error }
  const post = async (url, body) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      body: JSON.stringify({ dealer_id: dealerId, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  };
  const mergeBody = (m) => ({ keep_id: m.keep, merge_id: m.customers.find((c) => c._id !== m.keep)._id, picks: m.picks || {}, reason: m.reason });
  const previewMerge = async () => {
    setBusy("merge");
    try { const p = await post("/api/customers/merge", { ...mergeBody(merge), confirm: false }); setMerge({ ...merge, preview: p, error: null }); }
    catch (e) { setMerge({ ...merge, error: e.message }); } finally { setBusy(null); }
  };
  const confirmMerge = async () => {
    setBusy("merge");
    try { await post("/api/customers/merge", { ...mergeBody(merge), confirm: true }); setMerge(null); await load(); }
    catch (e) { setMerge({ ...merge, error: e.message }); } finally { setBusy(null); }
  };
  const undoMerge = async (mergedId) => {
    setBusy(`undo:${mergedId}`); setError(null);
    try { await post("/api/customers/merge", { merge_id: mergedId, undo: true }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  const notSame = async (ids) => {
    setBusy(ids.join(":")); setError(null);
    try {
      const res = await fetch("/api/customers/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
        body: JSON.stringify({ dealer_id: dealerId, customer_ids: ids, decision: "not_duplicate" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save");
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  return (
    <div className="page_content">
      <div className="page_head d-flex align-items-center gap-2">
        <Link href="/dealer/customers" className="btn btn-sm btn-outline-custom">
          <i className="fa-regular fa-arrow-left me-1" />Back
        </Link>
        <h3 className="page_title mb-0">Possible duplicate customers</h3>
      </div>
      <div className="page_body">
        <div className="w_card">
          <p className="small text-muted">
            Customers that share a phone number or an email address. Open them to check; if they are the same person, merge them;
            if not, mark them so they aren&apos;t shown again. Nothing is merged automatically: a new lead that matches a
            sales / service customer gets its own customer here until you confirm it is the same person (check their ID).
          </p>
          {!canReview && <Alert variant="warning" className="small">Only managers can review duplicates.</Alert>}
          {error && <Alert variant="danger" className="small">{error}</Alert>}
          {!data && !error && <div className="text-center py-4"><Spinner size="sm" /></div>}
          {data && data.total === 0 && <div className="text-muted small">No possible duplicates.</div>}
          {data && data.total > data.groups.length && (
            <div className="small text-muted mb-2">Showing the {data.groups.length} most recent of {data.total} groups.</div>
          )}
          {data?.groups.map((g) => (
            <div key={g.customers.map((c) => c._id).join("-")} className="border rounded p-2 mb-3">
              <Table size="sm" className="small mb-2">
                <thead><tr><th>Customer</th><th>Phones</th><th>Emails</th><th>Leads</th><th>Created</th></tr></thead>
                <tbody>
                  {g.customers.map((c) => (
                    <tr key={c._id}>
                      <td>
                        <Link href={`/dealer/customers/${c._id}`}>{c.name || "(no name)"}</Link>
                        {c.dealership_history && <Badge bg="warning" text="dark" className="ms-1">Sales / service customer</Badge>}
                      </td>
                      <td>{c.phones.join(", ") || "-"}</td>
                      <td>{c.emails.join(", ") || "-"}</td>
                      <td>{c.leads}</td>
                      <td>{c.created_at ? formatTimestamp(c.created_at) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {g.pairs.map((p) => {
                const [a, b] = p.customer_ids.map((id) => g.customers.find((c) => c._id === id)?.name || id);
                const key = p.customer_ids.join(":");
                return (
                  <div key={key} className="d-flex flex-wrap align-items-center gap-2 small mb-1">
                    <span><strong>{a}</strong> and <strong>{b}</strong> share</span>
                    {p.shared.map((s) => <Badge key={s} bg="light" text="dark">{s}</Badge>)}
                    {canReview && (
                      <Button size="sm" variant="custom" onClick={() => setMerge({
                        customers: p.customer_ids.map((id) => g.customers.find((c) => c._id === id)),
                        keep: g.customers.find((c) => p.customer_ids.includes(c._id))._id, reason: "" })}>
                        Merge…
                      </Button>
                    )}
                    {canReview && (
                      <Button size="sm" variant="outline-custom" disabled={busy === key}
                        onClick={() => notSame(p.customer_ids)}>
                        {busy === key ? <Spinner size="sm" /> : "Not the same person"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {data?.recent_merges?.length > 0 && (
          <div className="w_card mt-3">
            <h3 className="w_card_title">Recent merges</h3>
            <Table size="sm" className="small mb-0">
              <thead><tr><th>Merged</th><th>Into</th><th>By</th><th>When</th><th>Why</th><th /></tr></thead>
              <tbody>
                {data.recent_merges.map((m) => (
                  <tr key={m.merged_id}>
                    <td>{m.merged_name || m.merged_id}</td>
                    <td><Link href={`/dealer/customers/${m.kept_id}`}>{m.kept_name || m.kept_id}</Link></td>
                    <td>{m.merged_by_name || "-"}</td>
                    <td>{m.merged_at ? formatTimestamp(m.merged_at) : "-"}</td>
                    <td>{m.reason || "-"}</td>
                    <td className="text-end">
                      {canReview && (
                        <Button size="sm" variant="outline-custom" disabled={busy === `undo:${m.merged_id}`}
                          onClick={() => undoMerge(m.merged_id)}>Undo</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>

      {/* Merge review (SOW B3): side by side, nothing merges until Confirm, every lead stays its own opportunity. */}
      <Offcanvas show={!!merge} onHide={() => setMerge(null)} placement="end" style={{ width: "min(620px, 100vw)" }}>
        <Offcanvas.Header closeButton><Offcanvas.Title as="h6"><AppIcon name="customers" className="me-2" />Merge review</Offcanvas.Title></Offcanvas.Header>
        <Offcanvas.Body className="small d-flex flex-column">
          {merge?.error && <Alert variant="danger" className="py-2">{merge.error}</Alert>}
          <p className="text-muted mb-2">Pick the customer to keep and the value to keep for each field. Nothing merges until you confirm.</p>
          {merge && (
            <div className="table-responsive">
              <Table size="sm" className="align-middle">
                <thead><tr><th />{merge.customers.map((c) => (
                  <th key={c._id}><Form.Check type="radio" id={`keep-${c._id}`} name="keep" checked={merge.keep === c._id} aria-label={`Keep ${c.name || "this customer"}`}
                    onChange={() => setMerge({ ...merge, keep: c._id, picks: {}, preview: null })}
                    label={<span className="ap_person"><Avatar name={c.name} small /><span>{c.name || "(no name)"}</span></span>} /></th>))}</tr></thead>
                <tbody>
                  {[["name", "Name", "customer", (c) => c.name], ["email", "Email", "email", (c) => c.emails[0]], ["address", "Address", "source", (c) => c.address]].map(([field, label, icon, get]) => (
                    <tr key={field}><td className="fw-semibold"><IconLabel name={icon}>{label}</IconLabel></td>
                      {merge.customers.map((c) => {
                        const isKeep = c._id === merge.keep;
                        const on = (merge.picks?.[field] === "merge") !== isKeep;
                        return <td key={c._id} className="text-break"><Form.Check type="radio" id={`${field}-${c._id}`} name={`pick-${field}`} disabled={!get(c)} checked={!!get(c) && on}
                          onChange={() => setMerge({ ...merge, picks: { ...merge.picks, [field]: isKeep ? "keep" : "merge" }, preview: null })} label={get(c) || "Not set"} /></td>;
                      })}
                    </tr>
                  ))}
                  <tr><td className="fw-semibold"><IconLabel name="phone">Phone</IconLabel></td>{merge.customers.map((c) => <td key={c._id}>{c.phones.join(", ") || "Not set"}</td>)}</tr>
                  <tr><td className="fw-semibold"><IconLabel name="lead">Leads</IconLabel></td>{merge.customers.map((c) => <td key={c._id}>{c.leads}</td>)}</tr>
                </tbody>
              </Table>
            </div>
          )}
          <Form.Control size="sm" placeholder="Why (optional)" maxLength={300} value={merge?.reason || ""}
            onChange={(e) => setMerge({ ...merge, reason: e.target.value })} />
          {merge?.preview && (
            <div className="mt-3">
              <div className="fw-semibold mb-1">Opportunities stay separate</div>
              <Table size="sm" className="align-middle">
                <thead><tr><th><IconLabel name="vehicle">Lead</IconLabel></th><th><IconLabel name="source">Source</IconLabel></th><th><IconLabel name="status">Status</IconLabel></th><th><IconLabel name="owner">Owner</IconLabel></th></tr></thead>
                <tbody>{[...merge.preview.keep.opportunities, ...merge.preview.merge.opportunities].map((o) => (
                  <tr key={o.id}><td>{o.vehicle || "No vehicle"}</td><td>{o.source || "-"}</td><td>{o.status || "-"}</td><td>{o.owner || "Unassigned"}</td></tr>))}</tbody>
              </Table>
              <ul className="mb-1">
                <li>Nothing is deleted or moved: every lead keeps its own source, dates, status, owner, conversation and AI follow-ups.</li>
                <li>The value not picked is kept on the merge, and Undo puts it back. {merge.preview.merge.deals} sale(s), {merge.preview.merge.service_visits} service visit(s) and {merge.preview.merge.trade_ins} trade-in(s) will show there.</li>
                <li>It can be undone from &quot;Recent merges&quot;.</li>
                {merge.preview.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </div>
          )}
          <div className="d-flex gap-2 justify-content-end mt-auto pt-3">
            <Button size="sm" variant="outline-secondary" disabled={busy === merge?.customers?.map((c) => c._id).join(":")}
              onClick={async () => { const ids = merge.customers.map((c) => c._id); setMerge(null); await notSame(ids); }}>Not the same person</Button>
            {!merge?.preview ? (
              <Button size="sm" variant="custom" disabled={busy === "merge"} onClick={previewMerge}>{busy === "merge" ? <Spinner size="sm" /> : "Preview"}</Button>
            ) : (
              <Button size="sm" variant="custom" disabled={busy === "merge"} onClick={confirmMerge}>{busy === "merge" ? <Spinner size="sm" /> : "Merge"}</Button>
            )}
          </div>
        </Offcanvas.Body>
      </Offcanvas>
    </div>
  );
}
