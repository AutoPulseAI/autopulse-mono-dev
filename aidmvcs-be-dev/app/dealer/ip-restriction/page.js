"use client";
// IP restriction (19 Nov 2026, SOW reference B8): the networks this dealership's staff may use the CRM from. Empty =
// anywhere (as before). The dealership account (or AutoPulse inside the store) edits it; everyone else sees it.
// /api/ip-restriction; enforcement in lib/ipRestriction.js.
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Form, Spinner, Table } from "react-bootstrap";
import { useUser } from "../context/UserContext";
import { formatTimestamp } from "../../utils/dateUtils";

const auth = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });

export default function IpRestrictionPage() {
  const { dealerParent, user } = useUser();
  const dealerId = dealerParent?.id || user?.id;
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = (d) => { setData(d); setRows((d.entries || []).map((e) => ({ value: e.value, label: e.label || "" }))); };
  const load = useCallback(async () => {
    if (!dealerId) return;
    const res = await fetch(`/api/ip-restriction?dealer_id=${dealerId}`, { headers: auth() });
    const body = await res.json().catch(() => ({}));
    if (res.ok) apply(body); else setError(body.error || body.message || "Could not load");
  }, [dealerId]);
  useEffect(() => { load(); }, [load]);

  const save = async (next) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/ip-restriction", { method: "PUT", headers: auth(),
        body: JSON.stringify({ dealer_id: dealerId, entries: next.filter((r) => r.value.trim()) }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || body.message || "Not saved");
      apply(body);
      setNotice(body.entries.length ? "Saved. Staff can now use the CRM only from these networks." : "Saved. No restriction: staff can use the CRM from anywhere.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const set = (i, k, v) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const edit = data?.can_edit;

  return (
    <div className="page_content">
      <h2 className="fs-4 mb-3">IP restriction</h2>
      <div className="w_card">
        <p className="small text-muted">
          List the dealership&apos;s internet connections (an IP address, or a range such as 203.0.113.0/24) and staff can
          sign in and use the CRM only from them - for example only from the showroom. Leave it empty to allow anywhere.
          AutoPulse support is never blocked. Your internet provider can tell you your fixed IP address.
        </p>
        {data && (
          <Alert variant="light" className="py-2 small">
            Your IP right now: <strong>{data.your_ip || "not visible"}</strong>
            {edit && data.your_ip && !data.via_login_as && (
              <Button size="sm" variant="link" className="p-0 ms-2 align-baseline"
                disabled={rows.some((r) => r.value === data.your_ip)}
                onClick={() => setRows((cur) => [...cur, { value: data.your_ip, label: "This network" }])}>Add it</Button>
            )}
          </Alert>
        )}
        {error && <Alert variant="danger" className="py-2 small">{error}</Alert>}
        {notice && <Alert variant="success" className="py-2 small">{notice}</Alert>}
        {!data ? <div className="text-center py-3"><Spinner size="sm" /></div> : (
          <>
            <Table size="sm" className="small">
              <thead><tr><th>IP address or range</th><th>Name</th><th>Added by</th>{edit && <th />}</tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const saved = data.entries.find((e) => e.value === r.value);
                  return (
                    <tr key={i}>
                      <td>{edit ? <Form.Control size="sm" value={r.value} placeholder="203.0.113.7" aria-label="IP address or range"
                        onChange={(e) => set(i, "value", e.target.value)} /> : r.value}</td>
                      <td>{edit ? <Form.Control size="sm" value={r.label} placeholder="Showroom" maxLength={60} aria-label="Name"
                        onChange={(e) => set(i, "label", e.target.value)} /> : (r.label || "-")}</td>
                      <td className="text-muted text-nowrap">{saved ? `${saved.added_by_name || ""} ${saved.at ? formatTimestamp(saved.at) : ""}` : "new"}</td>
                      {edit && <td className="text-end"><Button size="sm" variant="link" className="p-0 text-danger"
                        onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}>Remove</Button></td>}
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={4} className="text-center text-muted py-3">No restriction: the CRM works from anywhere.</td></tr>}
              </tbody>
            </Table>
            {edit ? (
              <div className="d-flex gap-2">
                <Button size="sm" variant="outline-custom" onClick={() => setRows((cur) => [...cur, { value: "", label: "" }])}>+ Add a network</Button>
                <Button size="sm" variant="custom" disabled={busy} onClick={() => save(rows)}>{busy ? <Spinner size="sm" /> : "Save"}</Button>
                {data.entries.length > 0 && (
                  <Button size="sm" variant="outline-danger" className="ms-auto" disabled={busy}
                    onClick={() => window.confirm("Remove the restriction? Staff will be able to use the CRM from anywhere.") && save([])}>
                    Turn off restriction</Button>
                )}
              </div>
            ) : <p className="small text-muted mb-0">Only the dealership account can change this list.</p>}
            {data.history?.length > 0 && (
              <details className="mt-3 small"><summary>Change history</summary>
                <ul className="mb-0 ps-3">{data.history.map((h, i) => (
                  <li key={i}>{formatTimestamp(h.at)} · {h.by_name}: {h.from} → {h.to}</li>))}</ul>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
