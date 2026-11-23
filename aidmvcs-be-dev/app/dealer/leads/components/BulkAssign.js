"use client";
// Bulk actions on the Leads list (SOW Deliverable B b5, gap G-010; the user's design of 24 Nov 2026):
//   Actions > Select leads  -> a tick column, the blue BulkBar (what can be done) and the BulkScope line (which leads:
//                              all matching the filters / this page / the first N or a page range / ticked one by one)
//   an action               -> BulkPanel, a side panel: the choice (owner, status, department cards, a searchable source
//                              or campaign list, a note with its live preview, a call task), counts, now -> after, the
//                              leads 25 at a time. Nothing is saved until its button. Saving sends 100 leads a call, all
//                              under one batch_id, so the change is one row in Bulk history.
//   after saving            -> BulkNotice at the top right: Undo for every action; when some leads failed, which ones
//                              and why, Retry only for those that can pass, and it stays until closed.
// Reassign needs "Assign Leads"; the other changes need "Manage Leads"; Export only needs the list.
import { statusLabel } from "@lib/statusLabels";
import moment from "moment-timezone";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Form, Nav, Offcanvas, Overlay, Pagination, Popover, Spinner, Table } from "react-bootstrap";

export const BULK_STATUSES = ["Lead Not Contacted", "Contacted - No Next Action", "DND", "Closed - Lost"];
const PREVIEW_CHUNK = 200; // the routes' own maximum per call
const SAVE_CHUNK = 100;
const PANEL_PAGE = 25;
const SELECT_MAX = 2000; // /api/leads?format=ids

const token = () => (typeof window !== "undefined" ? localStorage.getItem("dealertoken") : null);
const post = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data;
};
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const newBatchId = () => `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const routeOf = (kind) => (kind === "status" ? "/api/leads/bulk-status" : kind === "reassign" ? "/api/leads/bulk-assign" : "/api/leads/bulk-edit");
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
// 28,668 -> "28.7k" on a small chip; the exact number is in its tooltip.
export const compact = (n) => (n >= 10000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n) : n.toLocaleString());
// Failures worth a second try (not "not this dealership's", not "changed by someone else", not a refused value).
export const retryable = (reason = "") => !/not a lead of this dealership|changed by someone else|refused|cannot|can only|not one of|must be|permission|no longer/i.test(String(reason));

// The Leads list's page numbers (LeadList.js createPaginationItems): first two, the current page's neighbours, last
// two, with Prev / Next. Same react-bootstrap Pagination, so it looks like the list's own.
export function pageItems(current, total) {
  const items = [1];
  if (total >= 2) items.push(2);
  if (current > 3) items.push("start-ellipsis");
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 2, current + 1); i++) if (i > 2 && i < total - 1) items.push(i);
  if (current < total - 3) items.push("end-ellipsis");
  if (total > 3) items.push(total - 1);
  if (total > 2) items.push(total);
  return items;
}

export function ListPages({ current, total, onPage, size }) {
  if (total <= 1) return null;
  return (
    <Pagination size={size} className="mb-0 justify-content-center flex-wrap">
      <Pagination.Prev disabled={current === 1} onClick={() => onPage(current - 1)} />
      {pageItems(current, total).map((p) => (typeof p === "number"
        ? <Pagination.Item key={p} active={p === current} onClick={() => onPage(p)}>{p}</Pagination.Item>
        : <Pagination.Item key={p} disabled className="disabled">&hellip;</Pagination.Item>))}
      <Pagination.Next disabled={current === total} onClick={() => onPage(current + 1)} />
    </Pagination>
  );
}

// The blue bar that takes the filter row's place while selecting. Each button only for staff allowed to do it.
export const BULK_ACTIONS = [
  { kind: "reassign", label: "Reassign", icon: "fa-user-pen", needs: "assign" },
  { kind: "status", label: "Change status", icon: "fa-flag", needs: "manage" },
  { kind: "department", label: "Department", icon: "fa-building", needs: "manage" },
  { kind: "source", label: "Source / Campaign", icon: "fa-tag", needs: "manage" },
  { kind: "note", label: "Add note", icon: "fa-note-sticky", needs: "manage" },
  { kind: "task", label: "Call task", icon: "fa-phone", needs: "manage" },
  { kind: "export", label: "Export", icon: "fa-file-csv", needs: null },
];

export function BulkBar({ count, canAssign, canChangeStatus, onAction, onClose, busy, exporting }) {
  const allowed = (needs) => (needs === "assign" ? canAssign : needs === "manage" ? canChangeStatus : true);
  return (
    <div className="bulk_bar d-flex flex-wrap align-items-center gap-2 mb-2">
      <strong className="me-2">{count.toLocaleString()} selected</strong>
      {BULK_ACTIONS.filter((a) => allowed(a.needs)).map((a) => (
        <Button key={a.kind} size="sm" variant="light" disabled={!count || busy || (a.kind === "export" && exporting)}
          onClick={() => onAction(a.kind)}>
          {a.kind === "export" && exporting ? <Spinner size="sm" className="me-1" /> : <i className={`fa-solid ${a.icon} me-1`}></i>}
          {a.label}
        </Button>
      ))}
      <Button size="sm" variant="link" className="text-white ms-auto" title="Stop selecting" aria-label="Stop selecting"
        onClick={onClose}>
        <i className="fa-solid fa-xmark"></i>
      </Button>
    </div>
  );
}

// Grey placeholder rows while something loads (Bootstrap placeholders, the app's own CSS).
export function SkeletonRows({ rows = 5, cols = 3 }) {
  return (
    <div className="placeholder-glow bulk_skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="d-flex gap-2 mb-2">
          {Array.from({ length: cols }, (_, c) => <span key={c} className={`placeholder col-${c === 0 ? 4 : 3} rounded`}></span>)}
        </div>
      ))}
    </div>
  );
}

// The selection line under the bar. Two rows: what is selected (big, clear) and Review; then the scope switch as
// chips whose counts never stretch the line (28,668 shows as 28.7k, the exact number on hover).
export function BulkScope({ scope, count, pageCount, matching, capped, loading, selected, onScope, onFirst, onPages,
  onDrop, unticked, perPage }) {
  const howRef = useRef(null);
  const reviewRef = useRef(null);
  const [showHow, setShowHow] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [first, setFirst] = useState("");
  const [fromPage, setFromPage] = useState("1");
  const [toPage, setToPage] = useState("");
  const [reviewPage, setReviewPage] = useState(1);
  const reachable = Math.min(matching, SELECT_MAX);
  const maxPages = Math.max(1, Math.ceil(reachable / perPage));
  const pagesCount = (() => {
    const a = Math.max(1, parseInt(fromPage, 10) || 1);
    const b = Math.min(maxPages, parseInt(toPage, 10) || 0);
    return b >= a ? Math.min(reachable, b * perPage) - (a - 1) * perPage : 0;
  })();
  const firstN = Math.min(reachable, Math.max(0, parseInt(first, 10) || 0));
  const reviewPages = Math.max(1, Math.ceil(selected.length / PANEL_PAGE));
  const reviewRows = selected.slice((reviewPage - 1) * PANEL_PAGE, reviewPage * PANEL_PAGE);
  useEffect(() => { if (reviewPage > reviewPages) setReviewPage(reviewPages); }, [reviewPage, reviewPages]);

  const what = {
    all: capped ? `the first ${SELECT_MAX.toLocaleString()} of ${matching.toLocaleString()} matching your filters` : "all leads matching your filters",
    page: "the leads on this page",
    first: "the first leads in the list's order",
    pages: "the leads on the pages you picked",
    manual: "ticked one by one",
  }[scope];
  const chip = (key, label, n, onClick, ref, caret) => (
    <button ref={ref} type="button" className={`bulk_chip ${scope === key || (key === "how" && (scope === "first" || scope === "pages")) ? "on" : ""}`}
      onClick={onClick} title={n != null ? `${n.toLocaleString()} leads` : undefined}>
      <span>{label}</span>
      {n != null && <span className="bulk_chip_n">{compact(n)}</span>}
      {caret && <i className="fa-solid fa-chevron-down"></i>}
    </button>
  );

  return (
    <div className="bulk_scope mb-2">
      <div className="bulk_scope_top">
        <span className="bulk_scope_icon">{loading ? <Spinner size="sm" /> : <i className="fa-solid fa-square-check"></i>}</span>
        <div className="bulk_scope_what">
          <button ref={reviewRef} type="button" className="bulk_scope_count" disabled={!count} onClick={() => setShowReview((v) => !v)}>
            {count.toLocaleString()} <span>{count === 1 ? "lead" : "leads"} selected</span>
          </button>
          <small className="text-muted d-block">{what}{unticked ? ` · ${unticked} unticked` : ""}</small>
        </div>
        <Button variant="link" className="p-0 ms-auto text-custom small text-nowrap" disabled={!count} onClick={() => setShowReview(true)}>
          <i className="fa-solid fa-list me-1"></i>Review
        </Button>
      </div>
      <div className="bulk_scope_chips">
        <small className="text-muted me-1">Select:</small>
        {chip("all", "All matching", matching, () => onScope("all"))}
        {chip("page", "This page", pageCount, () => onScope("page"))}
        {chip("how", "How many", null, () => setShowHow((v) => !v), howRef, true)}
        <small className="text-muted ms-md-auto bulk_scope_hint">Untick any row to leave it out</small>
      </div>
      {capped && scope === "all" && (
        <div className="bulk_scope_cap"><i className="fa-solid fa-circle-info me-1"></i>At most {SELECT_MAX.toLocaleString()} leads at a time.
          Narrow the filters (for example a date range) to reach the rest.</div>
      )}

      <Overlay target={howRef.current} show={showHow} placement="bottom-start" rootClose onHide={() => setShowHow(false)}>
        <Popover className="bulk_popover">
          <Popover.Body>
            <div className="fw-semibold mb-2">How many?</div>
            <div className="d-flex align-items-center gap-2 mb-2">
              First <Form.Control size="sm" type="number" min="1" max={reachable} style={{ width: 84 }} value={first}
                onChange={(e) => setFirst(e.target.value)} placeholder="82" /> leads
              <small className="text-muted">(in the list&apos;s order)</small>
            </div>
            <div className="d-flex gap-1 mb-2">
              {[50, 100, 200, 500].filter((n) => n <= reachable || n === 50).map((n) => (
                <Button key={n} size="sm" variant="outline-custom" className="rounded-pill py-0" onClick={() => setFirst(String(n))}>{n}</Button>
              ))}
            </div>
            <Button size="sm" variant="custom" className="w-100 mb-3" disabled={!firstN}
              onClick={() => { onFirst(firstN); setShowHow(false); }}>
              Select first {plural(firstN, "lead")}
            </Button>
            <div className="small text-muted mb-1 border-top pt-2">or by pages</div>
            <div className="d-flex align-items-center gap-2 mb-2">
              Pages <Form.Control size="sm" type="number" min="1" style={{ width: 64 }} value={fromPage}
                onChange={(e) => setFromPage(e.target.value)} />
              to <Form.Control size="sm" type="number" min="1" style={{ width: 64 }} value={toPage}
                onChange={(e) => setToPage(e.target.value)} placeholder={String(maxPages)} />
              <small className="text-muted">= {plural(pagesCount, "lead")}</small>
            </div>
            <Button size="sm" variant="outline-custom" className="w-100" disabled={!pagesCount}
              onClick={() => { onPages(Math.max(1, parseInt(fromPage, 10) || 1), Math.min(maxPages, parseInt(toPage, 10) || 0)); setShowHow(false); }}>
              Select {plural(pagesCount, "lead")}
            </Button>
            {matching > SELECT_MAX && <small className="text-muted d-block mt-2">At most {SELECT_MAX.toLocaleString()} leads at a time.</small>}
          </Popover.Body>
        </Popover>
      </Overlay>

      <Overlay target={reviewRef.current} show={showReview && count > 0} placement="bottom-start" rootClose
        onHide={() => setShowReview(false)}>
        <Popover className="bulk_popover bulk_popover_wide">
          <Popover.Body>
            <div className="d-flex mb-2"><strong>{plural(count, "lead")} selected</strong>
              {unticked ? <span className="ms-auto text-muted small">{unticked} unticked</span> : null}</div>
            <Table size="sm" className="mb-2">
              <thead><tr><th>Lead</th><th>Owner</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {reviewRows.map((l) => (
                  <tr key={l._id}>
                    <td>{l.name || "N/A"}</td>
                    <td className={l.owner ? "" : "text-muted"}>{l.owner || "Unassigned"}</td>
                    <td>{statusLabel(l.status) || "—"}</td>
                    <td className="text-end">
                      <Button size="sm" variant="link" className="p-0 text-muted" title="Leave this lead out"
                        aria-label={`Leave ${l.name || "this lead"} out`} onClick={() => onDrop(l._id)}>
                        <i className="fa-solid fa-xmark"></i>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <ListPages current={reviewPage} total={reviewPages} onPage={setReviewPage} size="sm" />
          </Popover.Body>
        </Popover>
      </Overlay>
    </div>
  );
}

// ---- the side panel ----
const FIELD_OF = { department: "department", lead_source: "lead_source", campaign: "campaign" };
const DEPARTMENTS = [
  { key: "sales", name: "Sales", icon: "fa-car", hint: "Buying a vehicle" },
  { key: "service", name: "Service", icon: "fa-screwdriver-wrench", hint: "Repairs, maintenance" },
  { key: "parts", name: "Parts", icon: "fa-gears", hint: "Parts orders" },
];
const deptName = (v) => (DEPARTMENTS.find((d) => d.key === (v || "sales")) || DEPARTMENTS[0]).name;
const TITLES = { reassign: "Reassign", status: "Change status of", source: "Set the source of", note: "Add a note to",
  task: "Add a call task to" };

// Quick due times in the dealer's time zone: in 1 hour, today 4 PM (while it is still ahead), tomorrow 9 AM.
function dueChoices(tz) {
  const now = moment().tz(tz);
  const list = [{ key: "hour", label: "In 1 hour", at: now.clone().add(1, "hour").startOf("minute") }];
  const four = now.clone().hour(16).minute(0).second(0);
  if (four.isAfter(now.clone().add(30, "minutes"))) list.push({ key: "today", label: "Today 4:00 PM", at: four });
  list.push({ key: "tomorrow", label: "Tomorrow 9:00 AM", at: now.clone().add(1, "day").hour(9).minute(0).second(0) });
  return list;
}

// A searchable, scrollable radio list (lead sources can run to hundreds).
function PickList({ items, value, onChange, placeholder, empty, noneLabel }) {
  const [q, setQ] = useState("");
  const shown = items.filter((it) => it.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <div className="bulk_search mb-2">
        <i className="fa-solid fa-magnifying-glass"></i>
        <Form.Control size="sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      </div>
      <div className="bulk_picklist" role="radiogroup">
        {noneLabel && !q && (
          <label className={`bulk_pick ${value === "" ? "on" : ""}`}>
            <input type="radio" checked={value === ""} onChange={() => onChange("")} /><span>{noneLabel}</span>
          </label>
        )}
        {shown.map((it) => (
          <label key={it.name} className={`bulk_pick ${value === it.name ? "on" : ""}`}>
            <input type="radio" checked={value === it.name} onChange={() => onChange(it.name)} />
            <span>{it.name}</span>
            {it.meta && <small>{it.meta}</small>}
          </label>
        ))}
        {!shown.length && <div className="text-muted small p-2">{q ? `Nothing matches "${q}"` : empty}</div>}
      </div>
      <small className="text-muted d-block mt-1">{q ? `${shown.length} of ${items.length}` : `${items.length}`} · most used first</small>
    </>
  );
}

export function BulkPanel({ kind, show, dealerId, leads, staffList, timezone = "America/New_York", userName, onHide, onSaved }) {
  const isStatus = kind === "status";
  const isAdd = kind === "note" || kind === "task";
  const serverPreview = kind === "reassign" || kind === "status";
  const [to, setTo] = useState("");
  const [status, setStatus] = useState(BULK_STATUSES[0]);
  const [dept, setDept] = useState("service");
  const [field, setField] = useState("lead_source"); // source panel: lead_source | campaign
  const [fieldValue, setFieldValue] = useState("");
  const [options, setOptions] = useState(null); // { sources: [{name, meta}], campaigns: [{name, meta}] }
  const [note, setNote] = useState("");
  const [internal, setInternal] = useState(true);
  const choices = useMemo(() => dueChoices(timezone), [timezone]);
  const [dueKey, setDueKey] = useState(choices[1]?.key || "hour");
  const [dueCustom, setDueCustom] = useState("");
  const [taskFor, setTaskFor] = useState("owner");
  const [serverRows, setServerRows] = useState(null);
  const [tab, setTab] = useState("change");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Keyed on the ids themselves: a new array with the same leads (a parent re-render) never re-runs the preview.
  const idsKey = leads.map((l) => l._id).join(",");
  const ids = useMemo(() => (idsKey ? idsKey.split(",") : []), [idsKey]);
  const byId = useMemo(() => new Map(leads.map((l) => [l._id, l])), [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dueAt = dueKey === "custom" ? (dueCustom ? moment.tz(dueCustom, timezone) : null) : choices.find((c) => c.key === dueKey)?.at;
  const targetName = isStatus ? statusLabel(status)
    : kind === "reassign" ? ((to ? staffList.find((s) => String(s._id) === String(to))?.name : "Unassigned") || "Unassigned")
      : kind === "department" ? deptName(dept)
        : kind === "source" ? (fieldValue || (field === "campaign" ? "No campaign" : "None"))
          : note.trim().slice(0, 60);

  // The source panel's choices: the dealer's lead sources and campaigns (Leads > Lead source > Edit list), most used first.
  useEffect(() => {
    if (!show || kind !== "source" || options) return;
    fetch(`/api/lead-sources?dealer_id=${encodeURIComponent(dealerId)}`, { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const seen = new Set();
        const sources = [...(d?.sources || []), ...(d?.used || [])]
          .filter((x) => x?.name && !seen.has(x.name.toLowerCase()) && seen.add(x.name.toLowerCase()))
          .sort((a, b) => (b.leads || 0) - (a.leads || 0))
          .map((x) => ({ name: x.name, meta: plural(x.leads || 0, "lead") }));
        const campaigns = (d?.campaigns || []).filter((c) => c.active !== false).sort((a, b) => (b.leads || 0) - (a.leads || 0))
          .map((c) => ({ name: c.name, meta: `${c.code ? `${c.code} · ` : ""}${plural(c.leads || 0, "lead")}` }));
        setOptions({ sources, campaigns });
      })
      .catch(() => setOptions({ sources: [], campaigns: [] }));
  }, [show, kind, dealerId, options]);

  // Reassign / status preview: nothing is written. In calls of 200 (the routes' maximum), merged.
  useEffect(() => {
    if (!show || !serverPreview || !ids.length) return undefined;
    let gone = false;
    setBusy(true); setError(null); setServerRows(null); setPage(1);
    (async () => {
      try {
        const parts = [];
        for (const part of chunks(ids, PREVIEW_CHUNK)) {
          const body = isStatus ? { dealer_id: dealerId, lead_ids: part, status } : { dealer_id: dealerId, lead_ids: part, assigned_to: to || null };
          parts.push(...(await post(routeOf(kind), { ...body, confirm: false })).rows);
          if (gone) return;
        }
        if (!gone) setServerRows(parts);
      } catch (e) { if (!gone) setError(e.message); } finally { if (!gone) setBusy(false); }
    })();
    return () => { gone = true; };
  }, [show, ids, kind, isStatus, dealerId, status, to]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every kind as the same rows: { lead_id, name, current, will_be, change, error }
  const editField = kind === "department" ? "department" : kind === "source" ? field : null;
  const rows = useMemo(() => {
    if (serverPreview) return serverRows;
    return ids.map((id) => {
      const l = byId.get(id) || { _id: id };
      if (editField) {
        const now = editField === "department" ? deptName(l.department) : (l[FIELD_OF[editField]] || "None");
        const next = editField === "department" ? deptName(dept) : (fieldValue || "None");
        return { lead_id: id, name: l.name, current: now, will_be: next, change: now.toLowerCase() !== next.toLowerCase() };
      }
      const owner = l.owner || "Unassigned";
      const caller = taskFor === "owner" ? (l.owner || userName || "You") : (staffList.find((s) => String(s._id) === taskFor)?.name || "");
      return { lead_id: id, name: l.name, current: owner, will_be: kind === "note" ? "+ note" : `+ call for ${caller}`, change: true };
    });
  }, [serverPreview, serverRows, ids, byId, editField, dept, fieldValue, kind, taskFor, staffList, userName]);

  const groups = useMemo(() => {
    const g = { change: [], already: [], cant: [] };
    for (const r of rows || []) {
      if (r.error) g.cant.push(r);
      else if (r.change) g.change.push(r);
      else g.already.push(r);
    }
    return g;
  }, [rows]);
  const nowBreakdown = useMemo(() => {
    const m = new Map();
    for (const r of groups.change) {
      const k = isStatus ? (statusLabel(r.current) || "No status") : r.current;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [groups, isStatus]);
  const list = groups[tab];
  const pages = Math.max(1, Math.ceil(list.length / PANEL_PAGE));
  const shown = list.slice((page - 1) * PANEL_PAGE, page * PANEL_PAGE);
  const ready = rows && groups.change.length && !(isAdd && !note.trim()) && !(kind === "task" && !dueAt)
    && !(kind === "source" && field === "lead_source" && !fieldValue);

  const bodyFor = (part, batchId, before) => {
    if (kind === "status") return { dealer_id: dealerId, lead_ids: part, status, confirm: true, batch_id: batchId,
      expected: Object.fromEntries(part.map((id) => [id, before.get(id) ?? null])) };
    if (kind === "reassign") return { dealer_id: dealerId, lead_ids: part, assigned_to: to || null, confirm: true, batch_id: batchId };
    const base = { dealer_id: dealerId, lead_ids: part, confirm: true, batch_id: batchId };
    if (kind === "department") return { ...base, action: "department", value: dept };
    if (kind === "source") return { ...base, action: field, value: fieldValue };
    if (kind === "note") return { ...base, action: "note", note, internal };
    return { ...base, action: "task", note, due_at: dueAt.toISOString(),
      ...(taskFor === "owner" ? { assign: "owner" } : { assigned_to: taskFor }) };
  };

  const save = async () => {
    setSaving(true); setError(null);
    const batchId = newBatchId();
    const total = { updated: 0, unchanged: 0, failed: [] };
    // Every selected lead is sent (the route reports unchanged ones), so Bulk history counts the whole selection.
    const sendIds = (rows || []).map((r) => r.lead_id);
    const names = new Map((rows || []).map((r) => [r.lead_id, r.name]));
    const before = new Map((rows || []).map((r) => [r.lead_id, r.current ?? null]));
    try {
      for (const part of chunks(sendIds, SAVE_CHUNK)) {
        try {
          const res = await post(routeOf(kind), bodyFor(part, batchId, before));
          total.updated += res.updated || 0;
          total.unchanged += res.unchanged || 0;
          total.failed.push(...(res.failed || []).map((f) => ({ ...f, name: f.name || names.get(f.lead_id) || null })));
        } catch (e) {
          // One call refused (e.g. the connection dropped): its leads are reported as failed; the other calls still run.
          total.failed.push(...part.map((id) => ({ lead_id: id, name: names.get(id) || null, reason: e.message || "The server did not answer" })));
        }
      }
      onSaved({ kind, batchId, targetName, total: sendIds.length, updated: total.updated, unchanged: total.unchanged,
        failed: total.failed, retryIds: total.failed.filter((f) => retryable(f.reason)).map((f) => f.lead_id) });
    } finally { setSaving(false); }
  };

  const verb = { reassign: "Reassign", status: "Change", department: "Move", source: "Set", note: "Add note to", task: "Add task to" }[kind];
  const title = kind === "department" ? `Move ${plural(ids.length, "lead")} to a department` : `${TITLES[kind]} ${plural(ids.length, "lead")}`;

  return (
    <Offcanvas show={show} onHide={saving ? undefined : onHide} placement="end" className="bulk_panel">
      <Offcanvas.Header closeButton={!saving}>
        <Offcanvas.Title>{title}</Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        {error && <Alert variant="danger" className="py-2 small">{error}</Alert>}

        {kind === "reassign" && (
          <>
            <Form.Label className="fw-semibold">New owner</Form.Label>
            <Form.Select size="sm" className="mb-1" value={to} onChange={(e) => setTo(e.target.value)} disabled={saving}>
              <option value="">Unassigned</option>
              {staffList.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
            </Form.Select>
          </>
        )}
        {isStatus && (
          <>
            <Form.Label className="fw-semibold">New status</Form.Label>
            <Form.Select size="sm" className="mb-1" value={status} onChange={(e) => setStatus(e.target.value)} disabled={saving}>
              {BULK_STATUSES.map((st) => <option key={st} value={st}>{statusLabel(st)}</option>)}
            </Form.Select>
            <small className="text-muted d-block mb-2">Other statuses (appointments, sold, no show) are set one lead at a time.</small>
          </>
        )}
        {kind === "department" && (
          <>
            <div className="fw-semibold mb-2">Which department?</div>
            <div className="bulk_deptcards mb-2" role="radiogroup">
              {DEPARTMENTS.map((d) => (
                <button key={d.key} type="button" role="radio" aria-checked={dept === d.key} disabled={saving}
                  className={`bulk_deptcard ${dept === d.key ? "on" : ""}`} onClick={() => { setDept(d.key); setPage(1); }}>
                  <i className={`fa-solid ${d.icon}`}></i><b>{d.name}</b><small>{d.hint}</small>
                </button>
              ))}
            </div>
            <div className="bulk_info"><i className="fa-solid fa-envelope me-1"></i>The <b>{deptName(dept)}</b> team gets <b>one email</b> listing
              these leads. Each lead gets a timeline entry. Nothing is sent to the customer.</div>
          </>
        )}
        {kind === "source" && (
          <>
            <div className="btn-group w-100 mb-2" role="group" aria-label="What to set">
              <Button size="sm" variant={field === "lead_source" ? "custom" : "outline-custom"} onClick={() => { setField("lead_source"); setFieldValue(""); setPage(1); }}>Lead source</Button>
              <Button size="sm" variant={field === "campaign" ? "custom" : "outline-custom"} onClick={() => { setField("campaign"); setFieldValue(""); setPage(1); }}>Campaign</Button>
            </div>
            {!options ? <SkeletonRows rows={6} cols={2} /> : (
              <PickList key={field} items={field === "campaign" ? options.campaigns : options.sources} value={fieldValue}
                onChange={(v) => { setFieldValue(v); setPage(1); }}
                placeholder={field === "campaign" ? `Search ${options.campaigns.length} campaigns` : `Search ${options.sources.length} lead sources`}
                empty={field === "campaign" ? "No campaigns yet (Leads > Add lead > Lead source > Edit list > Campaigns)." : "No lead sources yet."}
                noneLabel={field === "campaign" ? "No campaign" : null} />
            )}
          </>
        )}
        {kind === "note" && (
          <>
            <div className="btn-group w-100 mb-1" role="group" aria-label="Who sees the note">
              <Button size="sm" variant={internal ? "custom" : "outline-custom"} onClick={() => setInternal(true)}><i className="fa-solid fa-lock me-1"></i>Internal only</Button>
              <Button size="sm" variant={!internal ? "custom" : "outline-custom"} onClick={() => setInternal(false)}><i className="fa-solid fa-sticky-note me-1"></i>Lead note</Button>
            </div>
            <small className="text-muted d-block mb-2">{internal ? "Only staff see it. The AI never reads it." : "Staff see it, and the AI reads it as context. Never sent to the customer."}</small>
            <Form.Control as="textarea" rows={5} className="mb-1" value={note} maxLength={2000} disabled={saving}
              onChange={(e) => setNote(e.target.value)} placeholder="Write the note…" />
            <div className="d-flex small text-muted mb-3"><span>Goes on each lead&apos;s conversation, with your name and the time.</span><span className="ms-auto">{note.length} / 2000</span></div>
            <div className="fw-semibold mb-1">How it will look on each lead</div>
            <div className="w_card mb-2 conversation-item note-item"
              style={{ borderLeft: "4px solid #ffc107", backgroundColor: "#fff8e1", border: "1px solid #ffc107" }}>
              <div className="d-flex justify-content-between align-items-start">
                <h6 className="w_card_title mb-1 fw-bold"><i className={`fa-solid fa-sticky-note me-2 ${internal ? "text-info" : "text-warning"}`}></i>{internal ? "Note for Internal Use Only" : "Lead Note"}</h6>
                <span className="badge bg-warning">Note</span>
              </div>
              <div className="small" style={{ whiteSpace: "pre-wrap" }}>{note || "…"}</div>
              <div className="text-muted small mt-1">{moment().tz(timezone).format("MMM D, h:mm A")} · <span className="badge bg-warning text-dark">{userName || "You"}</span></div>
            </div>
          </>
        )}
        {kind === "task" && (
          <>
            <Form.Label className="fw-semibold">What the call is for</Form.Label>
            <Form.Control size="sm" className="mb-3" value={note} maxLength={300} disabled={saving}
              onChange={(e) => setNote(e.target.value)} placeholder="e.g. Call about Black Friday" />
            <Form.Label className="fw-semibold d-block">Due</Form.Label>
            <div className="d-flex gap-1 flex-wrap mb-1">
              {choices.map((c) => (
                <Button key={c.key} size="sm" variant={dueKey === c.key ? "custom" : "outline-custom"} onClick={() => setDueKey(c.key)}>{c.label}</Button>
              ))}
              <Button size="sm" variant={dueKey === "custom" ? "custom" : "outline-custom"} onClick={() => setDueKey("custom")}>Pick date…</Button>
            </div>
            {dueKey === "custom" && (
              <Form.Control type="datetime-local" size="sm" className="mb-1" value={dueCustom} onChange={(e) => setDueCustom(e.target.value)} />
            )}
            <small className="text-muted d-block mb-3">Dealer time ({timezone}){dueAt ? ` · ${dueAt.format("ddd MMM D, h:mm A")}` : ""}</small>
            <Form.Label className="fw-semibold">Who calls</Form.Label>
            <div className="bulk_picklist mb-1" style={{ maxHeight: 190 }} role="radiogroup">
              <label className={`bulk_pick ${taskFor === "owner" ? "on" : ""}`}>
                <input type="radio" checked={taskFor === "owner"} onChange={() => setTaskFor("owner")} /><span>Each lead&apos;s owner</span>
                <small>no owner → you</small>
              </label>
              {staffList.map((s) => (
                <label key={s._id} className={`bulk_pick ${taskFor === String(s._id) ? "on" : ""}`}>
                  <input type="radio" checked={taskFor === String(s._id)} onChange={() => setTaskFor(String(s._id))} /><span>{s.name}</span>
                </label>
              ))}
            </div>
            <small className="text-muted d-block mb-2">Shows in Open tasks on each customer&apos;s profile. Nothing is sent to the customer.</small>
          </>
        )}

        {busy && !rows ? <><div className="d-flex gap-2 my-2">{[0, 1, 2].map((i) => <div key={i} className="bulk_count placeholder-glow flex-fill"><span className="placeholder col-6"></span></div>)}</div><SkeletonRows rows={8} /></> : rows && (
          <>
            <div className="d-flex gap-2 my-2 bulk_counts">
              <div className="bulk_count ok"><b>{groups.change.length.toLocaleString()}</b>{isAdd ? "will get one" : kind === "department" ? "will move" : "will change"}</div>
              {!isAdd && (
                <>
                  <div className="bulk_count same"><b>{groups.already.length.toLocaleString()}</b>{kind === "reassign" ? `already ${targetName}'s` : `already ${targetName}`}</div>
                  <div className="bulk_count bad"><b>{groups.cant.length.toLocaleString()}</b>can&apos;t change</div>
                </>
              )}
            </div>

            {(kind === "reassign" || isStatus) && (
              <>
                <div className="fw-semibold mt-3 mb-1">What changes</div>
                <Table bordered size="sm" className="small mb-3">
                  <thead><tr><th style={{ width: "26%" }}></th><th>Now</th><th>After</th></tr></thead>
                  <tbody>
                    <tr><td className="fw-semibold">{isStatus ? "Status" : "Owner"}</td>
                      <td>{nowBreakdown.length ? nowBreakdown.slice(0, 6).map(([k, n]) => <div key={k}>{n.toLocaleString()} · {k}</div>) : "—"}
                        {nowBreakdown.length > 6 && <div className="text-muted">+ {nowBreakdown.length - 6} more</div>}</td>
                      <td>→ {targetName}</td></tr>
                    {isStatus
                      ? <tr><td className="fw-semibold">Workflows</td><td colSpan={2}>The same as changing one lead: the AI is told, follow-ups follow the new status. Nothing is sent to the customer.</td></tr>
                      : <tr><td className="fw-semibold">Conversation</td><td>—</td><td>+ internal note &quot;Reassigned from … to {targetName}&quot; (the customer never sees it)</td></tr>}
                  </tbody>
                </Table>
              </>
            )}

            <div className="fw-semibold mt-3 mb-1">The leads</div>
            {!isAdd && (
              <Nav variant="pills" className="mb-2 small" activeKey={tab} onSelect={(k) => { setTab(k); setPage(1); }}>
                <Nav.Item><Nav.Link eventKey="change" className="py-1">Will change {groups.change.length}</Nav.Link></Nav.Item>
                <Nav.Item><Nav.Link eventKey="already" className="py-1">Already {groups.already.length}</Nav.Link></Nav.Item>
                <Nav.Item><Nav.Link eventKey="cant" className="py-1">Can&apos;t {groups.cant.length}</Nav.Link></Nav.Item>
              </Nav>
            )}
            {shown.length ? (
              <Table size="sm" className="small mb-2">
                <thead><tr><th>Lead</th><th>{isAdd ? "Owner" : "Now"}</th><th>{tab === "cant" ? "Why" : "After"}</th></tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.lead_id}>
                      <td>{r.name || "N/A"}</td>
                      <td>{isStatus ? (statusLabel(r.current) || "No status") : (r.current || "—")}</td>
                      <td className={tab === "cant" ? "text-danger" : ""}>{tab === "cant" ? r.error : (isStatus ? statusLabel(r.will_be) : r.will_be)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <p className="text-muted small">None.</p>}
            <ListPages current={page} total={pages} onPage={setPage} size="sm" />
          </>
        )}
      </Offcanvas.Body>
      <div className="d-flex gap-2 justify-content-end p-3 border-top">
        <Button size="sm" variant="secondary" disabled={saving} onClick={onHide}>Cancel</Button>
        <Button size="sm" variant="custom" disabled={saving || busy || !ready} onClick={save}>
          {saving ? <><Spinner size="sm" className="me-1" />Saving…</>
            : `${verb} ${plural(groups.change.length, "lead")}${kind === "department" ? ` to ${deptName(dept)}` : kind === "source" && fieldValue ? ` to ${fieldValue}` : ""}`}
        </Button>
      </div>
    </Offcanvas>
  );
}

// ---- the notice at the top right ----
const DONE_TEXT = {
  reassign: (r) => `reassigned to ${r.targetName}`, status: (r) => `set to ${r.targetName}`, department: (r) => `moved to ${r.targetName}`,
  source: (r) => `set to ${r.targetName}`, note: () => "got the note", task: () => "got the call task",
};

export function BulkNotice({ result, onClose, onUndo, onRetry }) {
  const [hover, setHover] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState(null);
  // The undo's answer lives on the result itself (the parent keeps it), so a list reload never loses it.
  const undone = result?.undone || (undoError ? { error: undoError } : null);
  const failed = result?.failed || [];
  const sticky = failed.length > 0 || undoing || Boolean(undone?.failed) || Boolean(undone?.error);
  useEffect(() => { setUndoError(null); setShowAll(false); }, [result?.batchId]);
  useEffect(() => {
    if (!result || sticky || hover) return undefined;
    const t = setTimeout(onClose, undone ? 6000 : 10000);
    return () => clearTimeout(t);
  }, [result, sticky, hover, onClose, undone]);
  if (!result) return null;
  const text = (DONE_TEXT[result.kind] || (() => "changed"))(result);
  const partial = failed.length > 0;
  const retryIds = result.retryIds || [];
  const undo = async () => {
    setUndoing(true);
    try { await onUndo(result.batchId); } catch (e) { setUndoError(e.message); } finally { setUndoing(false); }
  };
  const visibleFailed = showAll ? failed : failed.slice(0, 4);

  if (undone) {
    return (
      <div className={`bulk_notice undone ${undone.error || undone.failed ? "has_failed" : ""}`} role="status"
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <div className="d-flex">
          <i className={`fa-solid ${undone.error ? "fa-circle-exclamation text-danger" : "fa-rotate-left text-secondary"} me-2 mt-1`}></i>
          <div>
            <strong>{undone.error ? "Could not undo" : `Undone: ${plural(undone.restored || 0, "lead")} back as before`}</strong>
            <div className="text-muted small">
              {undone.error || [undone.changed_since ? `${undone.changed_since} changed since (left alone)` : null,
                undone.failed ? `${undone.failed} couldn't be undone` : null].filter(Boolean).join(" · ") || "Nothing else changed."}
            </div>
          </div>
          <Button size="sm" variant="link" className="ms-auto p-0 text-muted" aria-label="Close" onClick={onClose}><i className="fa-solid fa-xmark"></i></Button>
        </div>
        {undone.reasons?.length > 0 && (
          <ul className="small mt-2 mb-0 ps-3 bulk_failed">{undone.reasons.map((f) => <li key={f.lead_id}><b>{f.name || "A lead"}</b> – {f.reason}</li>)}</ul>
        )}
      </div>
    );
  }

  return (
    <div className={`bulk_notice ${partial ? (result.updated ? "warn" : "has_failed") : ""}`} role="status"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="d-flex">
        <i className={`fa-solid ${!partial ? "fa-circle-check text-success" : result.updated ? "fa-triangle-exclamation text-warning" : "fa-circle-exclamation text-danger"} me-2 mt-1`}></i>
        <div>
          <strong>{partial ? `${result.updated.toLocaleString()} of ${plural(result.total || result.updated + failed.length, "lead")} ${text}` : `${plural(result.updated, "lead")} ${text}`}</strong>
          <div className="text-muted small">
            {partial ? <span className="text-danger">{plural(failed.length, "lead")} didn&apos;t:</span>
              : result.unchanged ? `${result.unchanged.toLocaleString()} ${result.unchanged === 1 ? "was" : "were"} already so` : "Done."}
          </div>
        </div>
        <Button size="sm" variant="link" className="ms-auto p-0 text-muted" aria-label="Close" onClick={onClose}><i className="fa-solid fa-xmark"></i></Button>
      </div>
      {partial && (
        <ul className="small mt-1 mb-1 ps-3 bulk_failed">
          {visibleFailed.map((f) => <li key={f.lead_id}><b>{f.name || "A lead"}</b> – {f.reason}</li>)}
          {failed.length > 4 && (
            <li className="list-unstyled"><Button variant="link" className="p-0 small text-custom" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${failed.length}`}</Button></li>
          )}
        </ul>
      )}
      <div className="d-flex flex-wrap gap-3 mt-1 small">
        {result.updated > 0 && (
          <Button variant="link" className="p-0 text-custom fw-semibold small" disabled={undoing} onClick={undo}>
            {undoing ? "Undoing…" : partial ? `Undo the ${result.updated.toLocaleString()}` : "Undo"}
          </Button>
        )}
        {retryIds.length > 0 && (
          <Button variant="link" className="p-0 text-custom fw-semibold small" onClick={() => onRetry(result)}>
            {retryIds.length === failed.length ? `Retry ${plural(retryIds.length, "lead")}` : `Retry the ${retryIds.length} that can pass`}
          </Button>
        )}
      </div>
      {partial ? <small className="text-muted d-block mt-2">Stays until you close it.</small>
        : <div className={`bulk_notice_timer ${hover ? "paused" : ""}`}></div>}
    </div>
  );
}

export async function undoBulk(batchId) {
  return post(`/api/leads/bulk-history/${encodeURIComponent(batchId)}/undo`, {});
}

// Export on the bulk bar: the chosen leads as the Leads list's CSV.
export async function exportBulk(dealerId, ids) {
  const res = await fetch("/api/leads/bulk-export", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ dealer_id: dealerId, lead_ids: ids }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || data.message || `Export failed (${res.status})`);
  }
  const blob = new Blob([await res.text()], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leads_selected_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
