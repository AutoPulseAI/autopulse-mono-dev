"use client";
// Admin > DMS feed (SOW G-084 to G-087, 17 Nov 2026; reworked 18 Nov 2026): totals for the period, files held back
// (import anyway / discard), every imported file with its dealer and what happened to its rows (paged, filtered; click a
// file for its reasons and the rows that need a look), and one record's full history across files. 23 Nov 2026: the
// customer side - source precedence per field and every field decision (./FieldCards.js, SOW Appendix B).
// 23 Nov 2026: the page opens on the dealer's DMS as we hold it (./Mirror.js: stores, the delivery calendar, the four
// departments in the DMS's own categories, records that need a look); the import mechanics below sit under
// "How the files were imported".
// Times are shown in UTC with the dealer's own time beside them.
import { Fragment, useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Form, Spinner, Table } from "react-bootstrap";
import { FieldDecisionsCard, SourcePrecedenceCard } from "./FieldCards";
import DmsMirror from "./Mirror";

const call = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("token")}`, ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
};

const TYPE = { SL: "Sales", SV: "Service ROs", SV_APPT: "Service appointments", PTINV: "Parts" };
const KEY_NAME = { SL: "deal number", SV: "RO number", SV_APPT: "appointment number", PTINV: "part number" };
const DECISION = {
  ACCEPT: { label: "Accepted", color: "#1f9d55", bg: "success" },
  RETAIN: { label: "Kept newer data", color: "#8a94a6", bg: "secondary" },
  // A REVIEW row was imported, but its customer or car could not be linked: the records are under "Needs a look" above.
  REVIEW: { label: "Imported, not linked", color: "#d69e2e", bg: "warning" },
  REJECT: { label: "Rejected", color: "#d64545", bg: "danger" },
};
const CODE = {
  CUSTOMER_UNRESOLVED: "Customer not found", CUSTOMER_AMBIGUOUS: "More than one customer matches",
  CUSTOMER_MERGED: "Customer was merged", VIN_MISSING: "No VIN", VIN_INVALID: "VIN not valid",
  VEHICLE_NOT_FOUND: "Vehicle not found", VEHICLE_AMBIGUOUS: "More than one vehicle matches",
  INVALID_RECORD: "Row not valid", INVALID_DEAL_NUMBER: "Deal number not valid", INVALID_PART_NUMBER: "Part number not valid",
  ROW_MISSING_RO_NUMBER: "No RO number", ROW_SOURCE_MISMATCH: "Row is for another store",
  SV_REPEAT_PARSE_ERROR: "Repair lines could not be read", SV_APPT_MISSING_APPOINTMENT_NUMBER: "No appointment number",
  SV_APPT_INVALID_DATE: "Appointment date not valid", SV_APPT_RO_UNRESOLVED: "Its RO was not found",
  SV_APPT_RO_AMBIGUOUS: "More than one RO matches", SV_APPT_OPERATION_DELIMITERS: "Service lines could not be read",
  SV_APPT_INVALID_SOURCE_FIELD: "A field is not valid", RECORD_EXCEEDS_MAX_JOB_BYTES: "Row too large",
  REPEATING_VALUE_NOT_STRING: "A repeating field is not valid", DEALER_NOT_FOUND: "Store not linked to a dealer",
  DEALER_AMBIGUOUS: "Store linked to more than one dealer",
};
const HELD_STATUS = { held: ["Waiting", "warning"], release_requested: ["Importing soon", "info"], releasing: ["Importing", "info"],
  released: ["Imported", "success"], discarded: ["Discarded", "secondary"] };

const n = (v) => Number(v || 0).toLocaleString("en-US");
const stampDate = (s) => (s && /^\d{12}$/.test(s) ? new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10))) : null);
const fmt = (d, timeZone) => {
  try { return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d); }
  catch { return ""; }
};
const utc = (d) => (d ? `${fmt(new Date(d), "UTC")} UTC` : "");
const dealerTime = (d, tz) => (d && tz ? `${fmt(new Date(d), tz)} dealer time` : "");
/** A code or reason as words; a file date inside a reason ("a newer file (202611170600) ...") as a date. */
const words = (s) => {
  if (!s) return "";
  if (CODE[s]) return CODE[s];
  if (/^[A-Z0-9_]+$/.test(s)) { const t = s.toLowerCase().replace(/_/g, " "); return t[0].toUpperCase() + t.slice(1); }
  const t = s.replace(/\b(\d{12})\b/g, (m) => utc(stampDate(m)));
  return t[0].toUpperCase() + t.slice(1);
};
const field = (f) => String(f).replace(/^extra\./, "").replace(/[_.]/g, " ");
const fileStatus = (statuses = []) => (statuses.includes("failed") ? ["Failed", "danger"]
  : statuses.some((s) => s === "pending" || s === "processing") ? ["Importing", "info"]
  : statuses.includes("completed_with_errors") ? ["Done, some rows rejected", "warning"] : ["Done", "success"]);

const CSS = `
.dmsf_tiles{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-bottom:16px}
@media (max-width:1199px){.dmsf_tiles{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:575px){.dmsf_tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
.dmsf_tile{background:#fff;border:1px solid #e6e9ef;border-radius:10px;padding:12px 14px}
.dmsf_tile .v{font-size:22px;font-weight:600;line-height:1.2;color:#1f2a44}
.dmsf_tile .l{font-size:12px;color:#6b7489;display:flex;align-items:center;gap:6px;margin-top:2px}
.dmsf_tile .s{font-size:11px;color:#8a94a6;margin-top:2px}
.dmsf_dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
.dmsf_filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:16px}
.dmsf_filters .form-select{width:auto;min-width:150px}
.dmsf_bar{display:flex;gap:2px;height:6px;width:140px;border-radius:3px;overflow:hidden;background:#eef1f5}
.dmsf_bar span{display:block;height:100%}
.dmsf_tbl th{font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#6b7489;font-weight:600;white-space:nowrap;border-bottom-width:1px}
.dmsf_tbl td{vertical-align:middle}
.dmsf_tbl .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.dmsf_tbl .zero{color:#c3c9d4}
.dmsf_row{cursor:pointer}
.dmsf_row:hover td{background:#f6f8fb}
.dmsf_row.open td{background:#eef4ff}
.dmsf_sub{font-size:11px;color:#8a94a6}
.dmsf_detail{background:#fafbfd;padding:12px 16px!important}
.dmsf_reason{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:13px}
.dmsf_reason .c{margin-left:auto;font-variant-numeric:tabular-nums;color:#1f2a44;font-weight:600}
.dmsf_pager{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:12px;font-size:13px;color:#6b7489}
.dmsf_empty{padding:24px;text-align:center;color:#8a94a6;font-size:14px}
`;

function Pager({ page, pages, total, limit, onPage, noun }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="dmsf_pager">
      <span>{n(from)}–{n(to)} of {n(total)} {noun}</span>
      {pages > 1 && <div className="d-flex align-items-center gap-2">
        <Button size="sm" variant="outline-secondary" disabled={page <= 1} onClick={() => onPage(1)}>First</Button>
        <Button size="sm" variant="outline-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span>Page {n(page)} of {n(pages)}</span>
        <Button size="sm" variant="outline-secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
        <Button size="sm" variant="outline-secondary" disabled={page >= pages} onClick={() => onPage(pages)}>Last</Button>
      </div>}
    </div>
  );
}

const Tile = ({ value, label, sub, color }) => (
  <div className="dmsf_tile">
    <div className="v">{value}</div>
    <div className="l">{color && <span className="dmsf_dot" style={{ background: color }} />}{label}</div>
    {sub && <div className="s">{sub}</div>}
  </div>
);

const Num = ({ v, strong }) => <td className={`num ${v ? "" : "zero"}`} style={v && strong ? { color: strong, fontWeight: 600 } : undefined}>{v ? n(v) : "0"}</td>;

function DecisionBar({ f }) {
  const total = f.accept + f.retain + f.review + f.reject;
  if (!total) return null;
  return (
    <div className="dmsf_bar" title={Object.keys(DECISION).map((k) => `${DECISION[k].label}: ${n(f[k.toLowerCase()])}`).join(" · ")}>
      {Object.keys(DECISION).map((k) => f[k.toLowerCase()] ? <span key={k} style={{ width: `${(f[k.toLowerCase()] / total) * 100}%`, background: DECISION[k].color }} /> : null)}
    </div>
  );
}

function FileDetail({ f, detail }) {
  if (!detail) return <Spinner size="sm" />;
  if (detail.error) return <span className="text-danger small">{detail.error}</span>;
  if (!detail.recorded) return <span className="small text-muted">No decisions were recorded for this file (imported before 18 Nov 2026).</span>;
  return (
    <div className="row g-3">
      <div className="col-lg-5 col-12">
        <div className="small fw-semibold mb-1">What happened to the {n(detail.recorded)} rows</div>
        {detail.reasons.map((r) => (
          <div key={`${r.decision}|${r.reason}`} className="dmsf_reason">
            <span className="dmsf_dot" style={{ background: DECISION[r.decision]?.color }} />
            <span><span className="text-muted">{DECISION[r.decision]?.label}:</span> {r.reason.split(", ").map(words).join(", ")}</span>
            <span className="c">{n(r.count)}</span>
          </div>
        ))}
      </div>
      <div className="col-lg-7 col-12">
        <div className="small fw-semibold mb-1">Rows that need a look{detail.problems.length >= 100 ? " (first 100)" : ""}</div>
        {!detail.problems.length ? <div className="small text-muted">None. Every row was imported or already had newer data.</div> : (
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            <Table size="sm" className="dmsf_tbl small mb-0 bg-white">
              <thead><tr><th>{KEY_NAME[f.type] || "Record"}</th><th>Customer</th><th>Result</th><th>Why</th></tr></thead>
              <tbody>{detail.problems.map((r) => (
                <tr key={r.key}><td className="text-nowrap">{r.record || <span className="text-muted">none</span>}</td>
                  <td>{r.customer || <span className="text-muted">-</span>}</td>
                  <td><Badge bg={DECISION[r.decision].bg} text={r.decision === "REVIEW" ? "dark" : undefined}>{DECISION[r.decision].label}</Badge></td>
                  <td>{r.reason.map(words).join(", ")}</td></tr>))}</tbody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

// DealerVault stores (20 Nov 2026): every DealerVault store ID that sends us files, the dealer it is linked to (the
// importer matches files by it) and, once linked, "Import stored files" for what arrived before. /api/admin/dms-feed/stores.
function StoresCard({ onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [pick, setPick] = useState({}); // dv -> dealer id
  const load = useCallback(async () => {
    setBusy(true);
    try { setData(await call("/api/admin/dms-feed/stores")); setMsg(null); } catch (e) { setMsg({ v: "danger", t: e.message }); }
    finally { setBusy(false); }
  }, []);
  const act = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); setMsg({ v: "success", t: ok(r) }); await load(); onChanged?.(); }
    catch (e) { setMsg({ v: "danger", t: e.message }); setBusy(false); }
  };
  const link = (dv, dealerId) => act(() => call("/api/admin/dms-feed/stores", { method: "PUT", body: JSON.stringify({ dealer_id: dealerId, dv }) }),
    () => (dv ? `${dv} linked.` : "Unlinked."));
  const importStored = (dv) => act(() => call("/api/admin/dms-feed/stores", { method: "POST", body: JSON.stringify({ dv, action: "import_stored" }) }),
    (r) => (r.queued ? `${n(r.queued)} files queued for import (about ${r.minutes} min).` : "Nothing new to import: every stored file is already imported."));
  useEffect(() => { load(); }, [load]);
  const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "-");
  return (
    <div className="w_card">
      <div className="d-flex align-items-center flex-wrap gap-2 mb-2">
        <h3 className="w_card_title mb-0 me-auto">DealerVault stores</h3>
        <Button size="sm" variant="outline-custom" onClick={load} disabled={busy}>{busy ? <Spinner size="sm" /> : "Refresh"}</Button>
      </div>
      <p className="small text-muted mb-2">Each DealerVault store ID that sends us files and the dealer it belongs to. Files of an unlinked
        store are held (below), never imported to the wrong dealer. &quot;Import N files&quot; imports a linked store&apos;s files that
        are in storage but were never imported (for example, the ones that arrived before it was linked). Discarded files stay discarded.</p>
      {msg && <Alert variant={msg.v} className="py-2 small">{msg.t}</Alert>}
      {data?.storage_error && <Alert variant="warning" className="py-2 small">Storage could not be listed ({data.storage_error}).</Alert>}
      {data && (
        <div className="table-responsive">
          <Table size="sm" className="small mb-0">
            <thead><tr><th>DealerVault ID</th><th className="num">Files</th><th>First / last file</th><th>Types</th><th>Dealer</th><th className="num">Imported</th><th className="num">Held</th><th /></tr></thead>
            <tbody>{data.stores.map((s) => {
              const stale = s.last && Date.now() - new Date(s.last).getTime() > 36 * 3600000;
              return (
                <tr key={s.dv}>
                  <td className="text-nowrap fw-semibold">{s.dv}</td>
                  <td className="num">{n(s.files)}</td>
                  <td className="text-nowrap">{day(s.first)} / <span className={stale ? "text-danger fw-semibold" : ""}>{day(s.last)}</span>
                    {stale && <div className="dmsf_sub text-danger">No new file for {Math.floor((Date.now() - new Date(s.last).getTime()) / 86400000)} days</div>}</td>
                  <td>{s.types.join(", ")}</td>
                  <td style={{ minWidth: 200 }}>{s.linked ? <>{s.linked.name} <Button size="sm" variant="link" className="p-0 ms-1"
                    disabled={busy} onClick={() => window.confirm(`Unlink ${s.dv} from ${s.linked.name}?`) && link("", s.linked.id)}>unlink</Button></> : (
                    <div className="d-flex gap-1">
                      <Form.Select size="sm" value={pick[s.dv] || ""} onChange={(e) => setPick({ ...pick, [s.dv]: e.target.value })} aria-label={`Dealer for ${s.dv}`}>
                        <option value="">Not linked - pick the dealer</option>
                        {data.dealers.filter((d) => !d.dv).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </Form.Select>
                      <Button size="sm" variant="custom" disabled={busy || !pick[s.dv]}
                        onClick={() => window.confirm(`Link ${s.dv} to ${data.dealers.find((d) => d.id === pick[s.dv])?.name}? Its files will be imported into that dealer.`) && link(s.dv, pick[s.dv])}>Link</Button>
                    </div>)}</td>
                  <td className="num">{n(s.imported)}</td>
                  <td className="num">{n(s.held)}</td>
                  <td className="text-end">{s.linked && s.not_imported > 0 && (
                    <Button size="sm" variant="outline-custom" disabled={busy} onClick={() => window.confirm(`Import ${s.not_imported} files of ${s.dv} into ${s.linked.name}? Oldest first, about 20 a minute.`) && importStored(s.dv)}>
                      Import {n(s.not_imported)} {s.not_imported === 1 ? "file" : "files"}</Button>)}</td>
                </tr>);
            })}</tbody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ImportDetails() {
  const [filters, setFilters] = useState({ dealer: "", type: "", days: "30", problems: false });
  const [page, setPage] = useState(1);
  const [held, setHeld] = useState({ page: 1, all: false });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState({});
  const [lookup, setLookup] = useState({ record: "", type: "SL", dealer: "" });
  const [history, setHistory] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams({ days: filters.days, page: String(page), limit: "20", held_page: String(held.page),
      ...(filters.dealer ? { dealer: filters.dealer } : {}), ...(filters.type ? { type: filters.type } : {}),
      ...(filters.problems ? { problems: "1" } : {}), ...(held.all ? { held_all: "1" } : {}) });
    try { setData(await call(`/api/admin/dms-feed?${q}`)); setError(null); } catch (e) { setError(e.message); }
    setLoading(false);
  }, [filters, page, held]);
  useEffect(() => { load(); }, [load]);

  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); setHeld((h) => ({ ...h, page: 1 })); setOpen({}); };
  const toggle = async (f) => {
    if (open[f.key]) { setOpen((o) => { const c = { ...o }; delete c[f.key]; return c; }); return; }
    setOpen((o) => ({ ...o, [f.key]: null }));
    try {
      const d = await call(`/api/admin/dms-feed?file=${encodeURIComponent(f.file)}&dealer=${encodeURIComponent(f.dealer_id)}`);
      setOpen((o) => (f.key in o ? { ...o, [f.key]: d } : o));
    } catch (e) { setOpen((o) => (f.key in o ? { ...o, [f.key]: { error: e.message } } : o)); }
  };
  const decide = async (f, action) => {
    if (!window.confirm(action === "release" ? `Import ${f.fileName} anyway?` : `Discard ${f.fileName}? It will never be imported.`)) return;
    try { await call(`/api/admin/dms-feed/held/${f._id}`, { method: "POST", body: JSON.stringify({ action }) }); await load(); }
    catch (e) { setError(e.message); }
  };
  const find = async () => {
    setHistory({ loading: true });
    const q = new URLSearchParams({ record: lookup.record.trim(), type: lookup.type, ...(lookup.dealer ? { dealer: lookup.dealer } : {}) });
    try { setHistory(await call(`/api/admin/dms-feed?${q}`)); } catch (e) { setHistory(null); setError(e.message); }
  };

  const s = data?.summary;
  const decided = s ? s.accept + s.retain + s.review + s.reject : 0;
  const files = data?.files;
  const dealers = data?.dealers || [];

  return (
    <div>
      <style>{CSS}</style>
      <div>
        {error && <Alert variant="danger" className="py-2" dismissible onClose={() => setError(null)}>{error}</Alert>}
        <div className="d-flex justify-content-end mb-2">{loading && <Spinner size="sm" />}</div>
        <p className="small text-muted mb-3">Each DealerVault file is checked before it&apos;s imported. A file that is broken
          or much smaller than usual is held, and nothing from it is written. An older file never overwrites newer data,
          and a blank field never wipes a value already on file.</p>

        <div className="dmsf_filters">
          <Form.Select size="sm" value={filters.dealer} onChange={(e) => setFilter("dealer", e.target.value)}>
            <option value="">All dealers</option>
            {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Form.Select>
          <Form.Select size="sm" value={filters.type} onChange={(e) => setFilter("type", e.target.value)}>
            <option value="">All file types</option>
            {Object.entries(TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Form.Select>
          <Form.Select size="sm" value={filters.days} onChange={(e) => setFilter("days", e.target.value)}>
            <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
          </Form.Select>
          <Form.Check type="switch" id="dmsf_problems" className="small ms-1" label="Only files with problems"
            checked={filters.problems} onChange={(e) => setFilter("problems", e.target.checked)} />
        </div>

        {data?.held?.waiting > 0 && (
          <Alert variant="warning" className="py-2 small">
            <strong>{n(data.held.waiting)} {data.held.waiting === 1 ? "file is" : "files are"} held</strong> and waiting for a
            decision. Nothing from {data.held.waiting === 1 ? "it" : "them"} has been imported. See &quot;Held files&quot; below.
          </Alert>
        )}

        <div className="dmsf_tiles">
          <Tile value={s ? n(s.files) : "…"} label="Files imported" sub={s ? `${n(s.problem_files)} with problems` : null} />
          <Tile value={s ? n(s.rows) : "…"} label="Rows read" sub={`Last ${data?.period_days || filters.days} days`} />
          {Object.entries(DECISION).map(([k, d]) => (
            // Before 18 Nov 2026 no row decisions were recorded: a dash, not a misleading 0.
            <Tile key={k} value={!s ? "…" : decided ? n(s[k.toLowerCase()]) : "–"} label={d.label} color={d.color}
              sub={!s ? null : decided ? `${Math.round((s[k.toLowerCase()] / decided) * 100)}% of decided rows` : "Not recorded yet"} />
          ))}
        </div>

        <StoresCard onChanged={load} />
        <FieldDecisionsCard dealers={dealers} />
        <SourcePrecedenceCard dealers={dealers} />

        <div className="w_card">
          <div className="d-flex align-items-center flex-wrap gap-2 mb-2">
            <h3 className="w_card_title mb-0 me-auto">Held files</h3>
            <Form.Check type="switch" id="dmsf_held_all" className="small" label="Show files already decided"
              checked={held.all} onChange={(e) => setHeld({ page: 1, all: e.target.checked })} />
          </div>
          {!data ? <Spinner size="sm" /> : !data.held.rows.length ? (
            <div className="dmsf_empty">{held.all ? "No file has ever been held." : "No files are held. Every file passed its checks."}</div>
          ) : (
            <>
              <Table responsive className="dmsf_tbl small mb-0">
                <thead><tr><th>Received</th><th>Dealer</th><th>Type</th><th className="num">Rows</th><th>Why it was held</th><th>Status</th><th /></tr></thead>
                <tbody>{data.held.rows.map((f) => {
                  const [label, bg] = HELD_STATUS[f.status] || [f.status, "secondary"];
                  return (
                    <tr key={f._id}>
                      <td className="text-nowrap">{utc(f.createdAt)}<div className="dmsf_sub">{dealerTime(f.createdAt, f.timezone)}</div></td>
                      <td>{f.dealer || <span className="text-muted">Store {f.dvDealerId}</span>}<div className="dmsf_sub">{f.fileName}</div></td>
                      <td className="text-nowrap">{TYPE[f.fileType] || f.fileType}</td>
                      <td className="num">{n(f.records)}{f.expected ? <div className="dmsf_sub">usually ~{n(Math.round(f.expected))}</div> : null}</td>
                      <td>{(f.reasons || []).map((r, i) => <div key={i}>{words(r)}</div>)}</td>
                      <td><Badge bg={bg} text={bg === "warning" ? "dark" : undefined}>{label}</Badge>
                        {f.decided_by_name && <div className="dmsf_sub">{f.decided_by_name}{f.decided_at ? `, ${utc(f.decided_at)}` : ""}</div>}</td>
                      <td className="text-nowrap text-end">{f.status === "held" && <>
                        <Button size="sm" variant="outline-custom" className="me-1" onClick={() => decide(f, "release")}>Import anyway</Button>
                        <Button size="sm" variant="outline-secondary" onClick={() => decide(f, "discard")}>Discard</Button></>}</td>
                    </tr>);
                })}</tbody>
              </Table>
              <Pager page={data.held.page} pages={data.held.pages} total={data.held.total} limit={10} noun="held files"
                onPage={(p) => setHeld((h) => ({ ...h, page: p }))} />
            </>
          )}
        </div>

        <div className="w_card">
          <div className="d-flex align-items-center flex-wrap gap-3 mb-2">
            <h3 className="w_card_title mb-0 me-auto">Imported files</h3>
            <div className="d-flex flex-wrap gap-3 small text-muted">
              {Object.values(DECISION).map((d) => <span key={d.label} className="d-flex align-items-center gap-1"><span className="dmsf_dot" style={{ background: d.color }} />{d.label}</span>)}
            </div>
          </div>
          {!files ? <Spinner size="sm" /> : !files.rows.length ? (
            <div className="dmsf_empty">{filters.problems ? "No file had problems in this period." : "No files were imported in this period."}</div>
          ) : (
            <>
              <Table responsive className="dmsf_tbl small mb-0">
                <thead><tr><th>File date</th><th>Dealer</th><th>Type</th><th className="num">Rows</th><th>Result</th>
                  <th className="num">Accepted</th><th className="num">Kept newer</th><th className="num">Review</th><th className="num">Rejected</th><th>Status</th></tr></thead>
                <tbody>{files.rows.map((f) => {
                  const date = stampDate(f.file_date) || (f.imported_at && new Date(f.imported_at));
                  const recorded = f.accept + f.retain + f.review + f.reject > 0;
                  const [label, bg] = fileStatus(f.statuses);
                  const isOpen = f.key in open;
                  return (
                    <Fragment key={f.key}>
                      <tr className={`dmsf_row ${isOpen ? "open" : ""}`} onClick={() => toggle(f)} title="Click for the reasons and the rows that need a look">
                        <td className="text-nowrap"><i className={`fa-solid fa-chevron-${isOpen ? "down" : "right"} me-2 text-muted`} style={{ fontSize: 10 }} />
                          {utc(date)}<div className="dmsf_sub ps-3">{dealerTime(date, f.timezone)}</div></td>
                        <td>{f.dealer || <span className="text-muted">Store {f.dv}</span>}<div className="dmsf_sub">{f.file}</div></td>
                        <td className="text-nowrap">{TYPE[f.type] || f.type}</td>
                        <td className="num">{n(f.rows)}</td>
                        {recorded ? <>
                          <td><DecisionBar f={f} /></td>
                          <Num v={f.accept} /><Num v={f.retain} /><Num v={f.review} strong="#b7791f" /><Num v={f.reject} strong="#c53030" />
                        </> : <>
                          {/* Files from before the decisions were recorded (18 Nov 2026): one short note, a dash per count. */}
                          <td className="text-nowrap dmsf_sub" title="Imported before 18 Nov 2026, when row decisions started being recorded">Not recorded</td>
                          <td className="num zero">–</td><td className="num zero">–</td><td className="num zero">–</td><td className="num zero">–</td>
                        </>}
                        <td className="text-nowrap"><Badge bg={bg} text={bg === "warning" ? "dark" : undefined}>{label}</Badge></td>
                      </tr>
                      {isOpen && <tr><td colSpan={10} className="dmsf_detail"><FileDetail f={f} detail={open[f.key]} /></td></tr>}
                    </Fragment>);
                })}</tbody>
              </Table>
              <Pager page={files.page} pages={files.pages} total={files.total} limit={files.limit} noun="files"
                onPage={(p) => { setPage(p); setOpen({}); }} />
            </>
          )}
        </div>

        <div className="w_card">
          <h3 className="w_card_title">One record&apos;s history</h3>
          <p className="small text-muted mb-2">Every file that carried one deal, RO, appointment or part, oldest first, and what was done with it each time.</p>
          <div className="dmsf_filters mb-2">
            <Form.Select size="sm" value={lookup.dealer} onChange={(e) => setLookup((l) => ({ ...l, dealer: e.target.value }))}>
              <option value="">All dealers</option>
              {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Form.Select>
            <Form.Select size="sm" value={lookup.type} onChange={(e) => setLookup((l) => ({ ...l, type: e.target.value }))}>
              {Object.entries(TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Form.Select>
            <Form.Control size="sm" style={{ maxWidth: 240 }} placeholder={`Type the ${KEY_NAME[lookup.type]}`} value={lookup.record}
              onChange={(e) => setLookup((l) => ({ ...l, record: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && lookup.record.trim() && find()} />
            <Button size="sm" variant="custom" disabled={!lookup.record.trim() || history?.loading} onClick={find}>Show history</Button>
          </div>
          {history?.loading && <Spinner size="sm" />}
          {history && !history.loading && (!history.history.length ? (
            <div className="dmsf_empty">No file carried {KEY_NAME[history.type]} {history.record}.</div>
          ) : (
            <Table responsive className="dmsf_tbl small mb-0">
              <thead><tr><th>File date</th><th>Dealer</th><th>Result</th><th>Why</th><th>Left blank in this file, kept as on file</th></tr></thead>
              <tbody>{history.history.map((h, i) => (
                <tr key={i}>
                  <td className="text-nowrap">{utc(stampDate(h.file_date)) || h.file_date}<div className="dmsf_sub">{h.file}</div></td>
                  <td>{h.dealer || "-"}</td>
                  <td>{h.decision ? <Badge bg={DECISION[h.decision].bg} text={h.decision === "REVIEW" ? "dark" : undefined}>{DECISION[h.decision].label}</Badge>
                    : <span className="text-muted">Not recorded</span>}</td>
                  <td>{words(h.reason)}{h.review?.length ? `: ${h.review.map(words).join(", ")}` : ""}</td>
                  <td>{h.retained_fields?.length ? h.retained_fields.map(field).join(", ") : <span className="text-muted">-</span>}</td>
                </tr>))}</tbody>
            </Table>
          ))}
        </div>
      </div>
    </div>
  );
}

// The page: the dealer's DMS first (./Mirror.js), then how the files were imported (opened on a click; its data loads then).
export default function DmsFeedPage() {
  const [round, setRound] = useState(0);
  const [details, setDetails] = useState(false);
  return (
    <div className="page_content">
      <div className="page_head d-flex align-items-center gap-2">
        <h3 className="page_title mb-0 me-auto">DMS feed</h3>
        <Button size="sm" variant="outline-secondary" onClick={() => setRound((r) => r + 1)}>Refresh</Button>
      </div>
      <div className="page_body">
        <DmsMirror key={`m${round}`} />
        <button type="button" className="dmsf_disclose" aria-expanded={details} onClick={() => setDetails((v) => !v)}>
          <i className={`fa-solid fa-chevron-${details ? "down" : "right"}`} aria-hidden="true" />
          <span><strong>How the files were imported</strong>
            <span className="d-block small text-muted">Stores and links, held files, every imported file and what happened to its rows,
              customer field decisions, source precedence, one record&apos;s history</span></span>
        </button>
        {details && <ImportDetails key={`d${round}`} />}
      </div>
    </div>
  );
}
