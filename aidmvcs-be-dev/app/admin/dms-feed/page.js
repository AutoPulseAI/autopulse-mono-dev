"use client";
// Admin > DMS feed (SOW G-084 to G-087, 17 Nov 2026): files held back (release / discard), what each recent file did
// (accepted / kept the newer data / needs review / rejected rows), and one record's full history across files.
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Form, Spinner, Table } from "react-bootstrap";

const call = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("token")}`, ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
};
const TYPE = { SL: "Sales", SV: "Service ROs", SV_APPT: "Service appointments", PTINV: "Parts" };
const when = (v) => (v ? new Date(v).toLocaleString() : "");
const fileDate = (s) => (s && s.length === 12 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10)} UTC` : s || "");

export default function DmsFeedPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lookup, setLookup] = useState({ record: "", type: "SL" });
  const [history, setHistory] = useState(null);
  const load = useCallback(async () => {
    try { setData(await call("/api/admin/dms-feed")); setError(null); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const decide = async (f, action) => {
    if (!window.confirm(action === "release" ? `Import ${f.fileName} anyway?` : `Discard ${f.fileName}? It will never be imported.`)) return;
    try { await call(`/api/admin/dms-feed/held/${f._id}`, { method: "POST", body: JSON.stringify({ action }) }); await load(); }
    catch (e) { setError(e.message); }
  };
  const find = async () => {
    setHistory(null);
    try { setHistory(await call(`/api/admin/dms-feed?record=${encodeURIComponent(lookup.record.trim())}&type=${lookup.type}`)); }
    catch (e) { setError(e.message); }
  };

  return (
    <div className="page_content">
      <div className="page_head"><h3 className="page_title mb-0">DMS feed</h3></div>
      <div className="page_body">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        <p className="small text-muted">Every DealerVault file is checked before import. A file that is malformed or far
          smaller than usual is held here and nothing from it is written. An older file never overwrites newer data, and
          a blank field never wipes a value already on file.</p>

        <div className="w_card">
          <h3 className="w_card_title">Held files</h3>
          {!data ? <Spinner size="sm" /> : !data.held.length ? <p className="text-muted small mb-0">None held.</p> : (
            <Table size="sm" responsive className="small align-middle mb-0">
              <thead><tr><th>File</th><th>Rows</th><th>Why held</th><th>Status</th><th /></tr></thead>
              <tbody>{data.held.map((f) => (
                <tr key={f._id}>
                  <td>{f.fileName}<div className="text-muted">{TYPE[f.fileType] || f.fileType} · {when(f.createdAt)}</div></td>
                  <td>{f.records}{f.expected ? <span className="text-muted"> (usually ~{Math.round(f.expected)})</span> : null}</td>
                  <td>{(f.reasons || []).join("; ")}</td>
                  <td><Badge bg={f.status === "held" ? "warning" : f.status === "discarded" ? "secondary" : "success"} text={f.status === "held" ? "dark" : undefined}>{f.status.replace("_", " ")}</Badge>
                    {f.decided_by_name && <div className="text-muted">{f.decided_by_name}</div>}</td>
                  <td className="text-nowrap">{f.status === "held" && <>
                    <Button size="sm" variant="outline-custom" className="me-1" onClick={() => decide(f, "release")}>Import anyway</Button>
                    <Button size="sm" variant="outline-secondary" onClick={() => decide(f, "discard")}>Discard</Button></>}</td>
                </tr>))}</tbody>
            </Table>
          )}
        </div>

        <div className="w_card">
          <h3 className="w_card_title">Recent files</h3>
          {!data ? <Spinner size="sm" /> : (
            <Table size="sm" responsive className="small align-middle mb-0">
              <thead><tr><th>File</th><th>Accepted</th><th>Kept newer data</th><th>Needs review</th><th>Rejected</th></tr></thead>
              <tbody>{data.files.map((f) => (
                <tr key={f._id}>
                  <td>{f._id}<div className="text-muted">{TYPE[f.fileType] || f.fileType} · {when(f.at)} · {(f.statuses || []).join(", ")}</div></td>
                  <td>{f.accept}</td><td>{f.retain}</td>
                  <td className={f.review ? "text-warning fw-semibold" : ""}>{f.review}</td>
                  <td className={f.reject ? "text-danger fw-semibold" : ""}>{f.reject}</td>
                </tr>))}</tbody>
            </Table>
          )}
          <div className="text-muted small mt-2">Files imported before 18 Nov 2026 have no decisions recorded.</div>
        </div>

        <div className="w_card">
          <h3 className="w_card_title">One record&apos;s history</h3>
          <div className="d-flex flex-wrap gap-2 mb-2">
            <Form.Select size="sm" className="w-auto" value={lookup.type} onChange={(e) => setLookup((l) => ({ ...l, type: e.target.value }))}>
              {Object.entries(TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Form.Select>
            <Form.Control size="sm" className="w-auto" placeholder="Deal / RO / appointment / part number" value={lookup.record}
              onChange={(e) => setLookup((l) => ({ ...l, record: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && find()} />
            <Button size="sm" variant="custom" disabled={!lookup.record.trim()} onClick={find}>Show history</Button>
          </div>
          {history && (!history.history.length ? <p className="text-muted small mb-0">No file has this record.</p> : (
            <Table size="sm" responsive className="small mb-0">
              <thead><tr><th>File date</th><th>File</th><th>Decision</th><th>Why</th><th>Blank, kept as on file</th></tr></thead>
              <tbody>{history.history.map((h, i) => (
                <tr key={i}><td className="text-nowrap">{fileDate(h.file_date)}</td><td>{h.file}</td>
                  <td><Badge bg={h.decision === "REJECT" ? "danger" : h.decision === "REVIEW" ? "warning" : h.decision === "RETAIN" ? "secondary" : "success"}>{h.decision || "-"}</Badge></td>
                  <td>{h.reason}{h.review?.length ? ` (${h.review.join(", ")})` : ""}</td>
                  <td>{h.retained_fields?.join(", ")}</td></tr>))}</tbody>
            </Table>
          ))}
        </div>
      </div>
    </div>
  );
}
