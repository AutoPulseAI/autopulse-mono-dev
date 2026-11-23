"use client";
// Admin > DMS feed, the customer side of the reconciliation (SOW Appendix B; 23 Nov 2026):
//   SourcePrecedenceCard  which source wins, per field, for all dealers or one dealer (api/admin/dms-feed/policy)
//   FieldDecisionsCard    what each DealerVault file said about customers' names, phones, emails and mileage and
//                         what was decided (ACCEPT / RETAIN / APPEND / REVIEW / REJECT), with the reviews to resolve
//                         (api/admin/dms-feed/fields)
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Form, Spinner, Table } from "react-bootstrap";

const call = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("token")}`, ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
};
const n = (v) => Number(v || 0).toLocaleString("en-US");
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export const FIELD_DECISION = {
  ACCEPT: { label: "Accepted", bg: "success" },
  RETAIN: { label: "Kept what was on file", bg: "secondary" },
  APPEND: { label: "Kept as history", bg: "info" },
  REVIEW: { label: "Needs review", bg: "warning" },
  REJECT: { label: "Rejected", bg: "danger" },
};
const FIELD_NAMES = { name: "Name", phone: "Phone", email: "Email", mileage: "Mileage" };
const fieldName = (f) => (String(f).startsWith("mileage:") ? `Mileage · VIN ${f.slice(8)}` : FIELD_NAMES[f] || f);

export function SourcePrecedenceCard({ dealers = [] }) {
  const [scope, setScope] = useState("*");
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const d = await call(`/api/admin/dms-feed/policy?dealer=${encodeURIComponent(scope)}`);
      setData(d); setDraft(JSON.parse(JSON.stringify(d.effective))); setMsg(null);
    } catch (e) { setMsg({ v: "danger", t: e.message }); }
    setBusy(false);
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  const move = (field, i, by) => setDraft((d) => {
    const order = [...d[field].precedence];
    const j = i + by;
    if (j < 0 || j >= order.length) return d;
    [order[i], order[j]] = [order[j], order[i]];
    return { ...d, [field]: { ...d[field], precedence: order } };
  });
  const setVal = (field, k, v) => setDraft((d) => ({ ...d, [field]: { ...d[field], [k]: v } }));
  const save = async (reset = false) => {
    if (!window.confirm(reset ? "Put these settings back to the defaults?" : "Save the source precedence? The next DealerVault import uses it.")) return;
    setBusy(true);
    try {
      const fields = reset ? {} : Object.fromEntries(Object.entries(draft).map(([f, p]) => [f, {
        precedence: p.precedence, ...(p.dms_contacts ? { dms_contacts: p.dms_contacts } : {}),
        ...(p.review_drop_miles ? { review_drop_miles: Number(p.review_drop_miles) } : {}),
        ...(p.review_jump_miles_per_year ? { review_jump_miles_per_year: Number(p.review_jump_miles_per_year) } : {}) }]));
      await call("/api/admin/dms-feed/policy", { method: "PUT", body: JSON.stringify({ dealer: scope, fields }) });
      await load();
      setMsg({ v: "success", t: "Saved." });
    } catch (e) { setMsg({ v: "danger", t: e.message }); }
    setBusy(false);
  };
  const names = Object.fromEntries((data?.sources || []).map((s) => [s.id, s.name]));

  return (
    <div className="w_card">
      <div className="d-flex align-items-center flex-wrap gap-2 mb-2">
        <h3 className="w_card_title mb-0 me-auto">Source precedence</h3>
        <Form.Select size="sm" className="w-auto" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Dealer">
          <option value="*">All dealers</option>
          {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Form.Select>
        {busy && <Spinner size="sm" />}
      </div>
      <p className="small text-muted mb-2">Which source wins when two disagree, per field. The first wins over the ones below
        it. Mileage follows the date of the repair order or sale: the newest valid reading wins, and a reading that drops
        or jumps too much waits for a person. A dealer&apos;s own settings win over &quot;All dealers&quot;.</p>
      {msg && <Alert variant={msg.v} className="py-2 small">{msg.t}</Alert>}
      {draft && (
        <div className="table-responsive">
          <Table size="sm" className="small mb-2">
            <thead><tr><th>Field</th><th>Which source wins (first = strongest)</th><th>Rules</th></tr></thead>
            <tbody>{Object.entries(draft).map(([field, p]) => (
              <tr key={field}>
                <td className="fw-semibold text-nowrap">{p.label}<div className="text-muted fw-normal">{p.kind === "event" ? "Dated by the event" : "Undated profile data"}</div></td>
                <td>
                  <ol className="mb-0 ps-3">{p.precedence.map((s, i) => (
                    <li key={s} className="d-flex align-items-center gap-1">
                      <span className="me-auto">{names[s] || s}</span>
                      <Button size="sm" variant="link" className="p-0 px-1" disabled={i === 0} onClick={() => move(field, i, -1)} aria-label="Up"><i className="fa-solid fa-arrow-up" /></Button>
                      <Button size="sm" variant="link" className="p-0 px-1" disabled={i === p.precedence.length - 1} onClick={() => move(field, i, 1)} aria-label="Down"><i className="fa-solid fa-arrow-down" /></Button>
                    </li>))}</ol>
                </td>
                <td style={{ minWidth: 220 }}>
                  {p.dms_contacts && (
                    <Form.Select size="sm" value={p.dms_contacts} onChange={(e) => setVal(field, "dms_contacts", e.target.value)} aria-label="DMS contacts">
                      <option value="history">A DMS {field} is kept as history only</option>
                      <option value="fill_missing">A DMS {field} is added when the profile has none</option>
                    </Form.Select>)}
                  {p.review_drop_miles != null && (
                    <div className="d-flex flex-column gap-1">
                      <label className="d-flex align-items-center gap-1">Review a drop over
                        <Form.Control size="sm" type="number" min={1} style={{ width: 90 }} value={p.review_drop_miles}
                          onChange={(e) => setVal(field, "review_drop_miles", e.target.value)} /> miles</label>
                      <label className="d-flex align-items-center gap-1">Review a rise over
                        <Form.Control size="sm" type="number" min={1} style={{ width: 100 }} value={p.review_jump_miles_per_year}
                          onChange={(e) => setVal(field, "review_jump_miles_per_year", e.target.value)} /> miles a year</label>
                    </div>)}
                </td>
              </tr>))}</tbody>
          </Table>
        </div>
      )}
      <div className="d-flex gap-2">
        <Button size="sm" variant="custom" disabled={busy || !draft} onClick={() => save(false)}>Save</Button>
        <Button size="sm" variant="outline-secondary" disabled={busy || !draft} onClick={() => save(true)}>Back to defaults</Button>
      </div>
      {data?.history?.length > 0 && (
        <div className="small text-muted mt-2">Last change: {day(data.history[0].at)} by {data.history[0].by_name || "a super admin"}</div>)}
    </div>
  );
}

export function FieldDecisionsCard({ dealers = [] }) {
  const [f, setF] = useState({ dealer: "", decision: "", field: "", open: false });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const load = useCallback(async () => {
    setBusy(true);
    const q = new URLSearchParams({ page: String(page), ...(f.dealer ? { dealer: f.dealer } : {}),
      ...(f.decision ? { decision: f.decision } : {}), ...(f.field ? { field: f.field } : {}), ...(f.open ? { open: "1" } : {}) });
    try { setData(await call(`/api/admin/dms-feed/fields?${q}`)); setErr(null); } catch (e) { setErr(e.message); }
    setBusy(false);
  }, [f, page]);
  useEffect(() => { load(); }, [load]);
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPage(1); };
  const resolve = async (row, action) => {
    if (!window.confirm(action === "accept" ? `Make ${row.value} the current value?` : "Keep the current value and close this review?")) return;
    try { await call("/api/admin/dms-feed/fields", { method: "POST", body: JSON.stringify({ id: row._id, action }) }); await load(); }
    catch (e) { setErr(e.message); }
  };
  const s = data?.summary;

  return (
    <div className="w_card">
      <div className="d-flex align-items-center flex-wrap gap-2 mb-2">
        <h3 className="w_card_title mb-0 me-auto">Customer field decisions</h3>
        {busy && <Spinner size="sm" />}
      </div>
      <p className="small text-muted mb-2">What each DealerVault file said about a customer&apos;s name, phones, emails and
        vehicle mileage, and what was done with it. Nothing is overwritten without a reason, and every value stays in the history.</p>
      {err && <Alert variant="danger" className="py-2 small">{err}</Alert>}
      {s && (
        <div className="d-flex flex-wrap gap-2 mb-2 small">
          {Object.entries(FIELD_DECISION).map(([k, d]) => (
            <Badge key={k} bg={d.bg} text={k === "REVIEW" || k === "APPEND" ? "dark" : undefined} role="button"
              onClick={() => set("decision", f.decision === k ? "" : k)} style={{ cursor: "pointer", opacity: f.decision && f.decision !== k ? 0.5 : 1 }}>
              {d.label}: {n(s[k])}</Badge>))}
          {s.open_reviews > 0 && <span className="text-warning fw-semibold">{n(s.open_reviews)} to review</span>}
        </div>
      )}
      <div className="dmsf_filters mb-2">
        <Form.Select size="sm" value={f.dealer} onChange={(e) => set("dealer", e.target.value)}>
          <option value="">All dealers</option>
          {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Form.Select>
        <Form.Select size="sm" value={f.field} onChange={(e) => set("field", e.target.value)}>
          <option value="">All fields</option>
          {Object.entries(FIELD_NAMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Form.Select>
        <Form.Check type="switch" id="dmsf_open_reviews" className="small ms-1" label="Only reviews still open"
          checked={f.open} onChange={(e) => set("open", e.target.checked)} />
      </div>
      {data && !data.rows.length && <div className="dmsf_empty">Nothing recorded yet for these filters. Rows appear from the next DealerVault import.</div>}
      {data?.rows?.length > 0 && (
        <Table responsive size="sm" className="dmsf_tbl small mb-0">
          <thead><tr><th>Recorded</th><th>Customer</th><th>Field</th><th>Incoming</th><th>On file</th><th>Result</th><th>Why</th><th>Source</th><th /></tr></thead>
          <tbody>{data.rows.map((r) => {
            const d = FIELD_DECISION[r.decision] || { label: r.decision, bg: "light" };
            const openReview = r.decision === "REVIEW" && !r.review_resolved_at;
            return (
              <tr key={r._id}>
                <td className="text-nowrap">{day(r.imported_at)}{r.dealer && <div className="dmsf_sub">{r.dealer}</div>}</td>
                <td><a href={`/dealer/customers/${r.customer_id}`}>{r.customer || "Customer"}</a></td>
                <td className="text-nowrap">{fieldName(r.field)}</td>
                <td className="fw-semibold">{typeof r.value === "number" ? n(r.value) : r.value}{r.precision === "APPROXIMATE" && <span className="text-muted"> (about)</span>}</td>
                <td>{r.prior_value == null ? <span className="text-muted">-</span> : typeof r.prior_value === "number" ? n(r.prior_value) : r.prior_value}</td>
                <td><Badge bg={d.bg} text={r.decision === "REVIEW" || r.decision === "APPEND" ? "dark" : undefined}>{d.label}</Badge>
                  {r.status && <div className="dmsf_sub">{r.status.replace(/_/g, " ").toLowerCase()}</div>}</td>
                <td>{r.reason}{r.review_resolved_at && <div className="dmsf_sub">Resolved {day(r.review_resolved_at)}: {r.review_resolved_by_name}</div>}</td>
                <td className="text-nowrap">{r.source_event_type === "repair_order" ? "RO" : r.source_event_type === "sale" ? "Deal" : r.source}
                  {r.source_record_id ? ` ${r.source_record_id}` : ""}{r.source_event_date && <div className="dmsf_sub">{day(r.source_event_date)}</div>}</td>
                <td className="text-end text-nowrap">{openReview && <>
                  <Button size="sm" variant="outline-success" className="me-1" onClick={() => resolve(r, "accept")}>Use it</Button>
                  <Button size="sm" variant="outline-secondary" onClick={() => resolve(r, "keep")}>Keep current</Button></>}</td>
              </tr>);
          })}</tbody>
        </Table>
      )}
      {data && data.pages > 1 && (
        <div className="d-flex align-items-center justify-content-between mt-2 small">
          <span className="text-muted">{n(data.total)} rows · page {data.page} of {data.pages}</span>
          <div className="d-flex gap-1">
            <Button size="sm" variant="outline-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="sm" variant="outline-secondary" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
