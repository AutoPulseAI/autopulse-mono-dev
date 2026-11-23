"use client";
// Bulk actions on the Leads list (SOW Deliverable B b5, gap G-010; the user's design of 24 Nov 2026):
//   Actions > Select leads  -> a tick column, the blue BulkBar (what can be done) and the BulkScope line (which leads:
//                              all matching the filters / this page / the first N / ticked one by one; Review)
//   Reassign / Change status -> BulkPanel, a side panel: counts, what changes (now -> after), the leads in three tabs,
//                              25 at a time. Nothing is saved until its button. Saving sends 100 leads a call, all
//                              calls under one batch_id, so the change is one row in Bulk history.
//   After saving             -> BulkNotice at the top right: 10 s (kept while the mouse is on it, kept until closed
//                              when anything failed), with Undo (reassignments), the failed leads and Retry.
// Reassign needs "Assign Leads" (/api/leads/bulk-assign); Change status needs "Manage Leads" (/api/leads/bulk-status,
// the same status change as one lead, only for statuses that need nothing more and send the customer nothing).
import { statusLabel } from "@lib/statusLabels";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Form, Nav, Offcanvas, Overlay, Pagination, Popover, Spinner, Table } from "react-bootstrap";

export const BULK_STATUSES = ["Lead Not Contacted", "Contacted - No Next Action", "DND", "Closed - Lost"];
const PREVIEW_CHUNK = 200; // the routes' own maximum per call
const SAVE_CHUNK = 100;
const PANEL_PAGE = 25;

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
const routeOf = (kind) => (kind === "status" ? "/api/leads/bulk-status" : "/api/leads/bulk-assign");

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

// The line under the bar: what is selected, the scope switch, How many, Review.
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
  const maxPages = Math.max(1, Math.ceil(matching / perPage));
  const pagesCount = (() => {
    const a = Math.max(1, parseInt(fromPage, 10) || 1);
    const b = Math.min(maxPages, parseInt(toPage, 10) || 0);
    return b >= a ? Math.min(matching, b * perPage) - (a - 1) * perPage : 0;
  })();
  const firstN = Math.min(matching, Math.max(0, parseInt(first, 10) || 0));
  const reviewPages = Math.max(1, Math.ceil(selected.length / PANEL_PAGE));
  const reviewRows = selected.slice((reviewPage - 1) * PANEL_PAGE, reviewPage * PANEL_PAGE);
  useEffect(() => { if (reviewPage > reviewPages) setReviewPage(reviewPages); }, [reviewPage, reviewPages]);

  const what = {
    all: "all leads matching your filters",
    page: "the leads on this page",
    first: "the first leads in the list's order",
    pages: "the leads on the pages you picked",
    manual: "ticked one by one",
  }[scope];

  return (
    <div className="bulk_scope d-flex flex-wrap align-items-center gap-2 mb-2">
      {loading ? <Spinner size="sm" /> : <i className="fa-solid fa-square-check text-custom"></i>}
      <Button ref={reviewRef} variant="link" className="p-0 fw-semibold text-custom bulk_scope_count"
        disabled={!count} onClick={() => setShowReview((v) => !v)}>
        {count.toLocaleString()} {count === 1 ? "lead" : "leads"} selected
      </Button>
      <span className="text-muted">— {what}{unticked ? ` (${unticked} unticked)` : ""}</span>
      <div className="btn-group bulk_scope_switch" role="group" aria-label="Which leads">
        <Button size="sm" variant={scope === "all" ? "custom" : "outline-custom"} onClick={() => onScope("all")}>
          All matching · {matching.toLocaleString()}{capped ? "+" : ""}
        </Button>
        <Button size="sm" variant={scope === "page" ? "custom" : "outline-custom"} onClick={() => onScope("page")}>
          This page · {pageCount}
        </Button>
        <Button ref={howRef} size="sm" variant={scope === "first" || scope === "pages" ? "custom" : "outline-custom"}
          onClick={() => setShowHow((v) => !v)}>
          How many… <i className="fa-solid fa-caret-down ms-1"></i>
        </Button>
      </div>
      <span className="text-muted small">Untick any row to leave it out</span>
      <Button variant="link" className="p-0 ms-auto text-custom small" disabled={!count} onClick={() => setShowReview(true)}>
        Review the {count.toLocaleString()}
      </Button>
      {capped && <small className="text-danger w-100">At most 2,000 leads at a time: narrow the filters to reach the rest.</small>}

      <Overlay target={howRef.current} show={showHow} placement="bottom-start" rootClose onHide={() => setShowHow(false)}>
        <Popover className="bulk_popover">
          <Popover.Body>
            <div className="fw-semibold mb-2">How many?</div>
            <div className="d-flex align-items-center gap-2 mb-2">
              First <Form.Control size="sm" type="number" min="1" style={{ width: 80 }} value={first}
                onChange={(e) => setFirst(e.target.value)} placeholder="82" /> leads
              <small className="text-muted">(in the list&apos;s order)</small>
            </div>
            <div className="d-flex gap-1 mb-2">
              {[50, 100, 200].map((n) => (
                <Button key={n} size="sm" variant="outline-custom" className="rounded-pill py-0" onClick={() => setFirst(String(n))}>{n}</Button>
              ))}
            </div>
            <Button size="sm" variant="custom" className="w-100 mb-3" disabled={!firstN}
              onClick={() => { onFirst(firstN); setShowHow(false); }}>
              Select first {firstN.toLocaleString()} {firstN === 1 ? "lead" : "leads"}
            </Button>
            <div className="small text-muted mb-1 border-top pt-2">or by pages</div>
            <div className="d-flex align-items-center gap-2 mb-2">
              Pages <Form.Control size="sm" type="number" min="1" style={{ width: 64 }} value={fromPage}
                onChange={(e) => setFromPage(e.target.value)} />
              to <Form.Control size="sm" type="number" min="1" style={{ width: 64 }} value={toPage}
                onChange={(e) => setToPage(e.target.value)} placeholder={String(maxPages)} />
              <small className="text-muted">= {pagesCount.toLocaleString()} leads</small>
            </div>
            <Button size="sm" variant="outline-custom" className="w-100" disabled={!pagesCount}
              onClick={() => { onPages(Math.max(1, parseInt(fromPage, 10) || 1), Math.min(maxPages, parseInt(toPage, 10) || 0)); setShowHow(false); }}>
              Select {pagesCount.toLocaleString()} leads
            </Button>
          </Popover.Body>
        </Popover>
      </Overlay>

      <Overlay target={reviewRef.current} show={showReview && count > 0} placement="bottom-start" rootClose
        onHide={() => setShowReview(false)}>
        <Popover className="bulk_popover bulk_popover_wide">
          <Popover.Body>
            <div className="d-flex mb-2"><strong>{count.toLocaleString()} leads selected</strong>
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

// The side panel: check before saving, then save in calls of 100 (one batch id, one Bulk history row).
//   reassign / status: the routes' own preview (what each lead is now, what can't change and why).
//   department / source / campaign: compared here with what each selected lead holds now.
//   note / task: added to every selected lead.
const FIELD_OF = { department: "department", lead_source: "lead_source", campaign: "campaign" };
const DEPARTMENTS = [["sales", "Sales"], ["service", "Service"], ["parts", "Parts"]];
const deptName = (v) => (DEPARTMENTS.find(([k]) => k === (v || "sales")) || [null, "Sales"])[1];
const TITLES = { reassign: "Reassign", status: "Change status of", department: "Move to a department", source: "Set source / campaign of",
  note: "Add a note to", task: "Add a call task to" };

export function BulkPanel({ kind, show, dealerId, leads, staffList, onHide, onSaved }) {
  const isStatus = kind === "status";
  const serverPreview = kind === "reassign" || kind === "status";
  const [to, setTo] = useState("");
  const [status, setStatus] = useState(BULK_STATUSES[0]);
  const [dept, setDept] = useState("service");
  const [field, setField] = useState("lead_source"); // source panel: lead_source | campaign
  const [fieldValue, setFieldValue] = useState("");
  const [options, setOptions] = useState(null); // { sources, campaigns }
  const [note, setNote] = useState("");
  const [internal, setInternal] = useState(true);
  const [dueAt, setDueAt] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000); d.setMinutes(0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [taskFor, setTaskFor] = useState("");
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

  const targetName = isStatus ? statusLabel(status)
    : kind === "reassign" ? ((to ? staffList.find((s) => String(s._id) === String(to))?.name : "Unassigned") || "Unassigned")
      : kind === "department" ? deptName(dept)
        : kind === "source" ? (fieldValue || "None")
          : note.trim().slice(0, 60);

  // The source panel's choices: the dealer's lead sources and campaigns (Leads > Lead source > Edit list).
  useEffect(() => {
    if (!show || kind !== "source" || options) return;
    fetch(`/api/lead-sources?dealer_id=${encodeURIComponent(dealerId)}`, { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setOptions({
        sources: [...new Set([...(d?.sources || []).map((x) => x.name), ...(d?.used || []).map((x) => x.name)])],
        campaigns: (d?.campaigns || []).filter((c) => c.active !== false).map((c) => c.name),
      }))
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
      return { lead_id: id, name: l.name, current: kind === "task" ? (l.owner || "Unassigned") : "—", will_be: kind === "note" ? "+ note" : "+ task", change: true };
    });
  }, [serverPreview, serverRows, ids, byId, editField, dept, fieldValue, kind]);

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
  const needsText = (kind === "note" || kind === "task") && !note.trim();
  const ready = rows && groups.change.length && !needsText && !(kind === "task" && !dueAt);

  const bodyFor = (part, batchId, before) => {
    if (kind === "status") return { dealer_id: dealerId, lead_ids: part, status, confirm: true, batch_id: batchId,
      expected: Object.fromEntries(part.map((id) => [id, before.get(id) ?? null])) };
    if (kind === "reassign") return { dealer_id: dealerId, lead_ids: part, assigned_to: to || null, confirm: true, batch_id: batchId };
    const base = { dealer_id: dealerId, lead_ids: part, confirm: true, batch_id: batchId };
    if (kind === "department") return { ...base, action: "department", value: dept };
    if (kind === "source") return { ...base, action: field, value: fieldValue };
    if (kind === "note") return { ...base, action: "note", note, internal };
    return { ...base, action: "task", note, due_at: new Date(dueAt).toISOString(), assigned_to: taskFor || undefined };
  };

  const save = async () => {
    setSaving(true); setError(null);
    const batchId = newBatchId();
    const total = { updated: 0, unchanged: 0, failed: [] };
    // Reassign / status / fields: every selected lead is sent (the route reports unchanged ones), so Bulk history
    // counts the whole selection. Note / task: every lead gets one.
    const sendIds = (rows || []).map((r) => r.lead_id);
    const names = new Map((rows || []).map((r) => [r.lead_id, r.name]));
    const before = new Map((rows || []).map((r) => [r.lead_id, r.current ?? null]));
    const url = serverPreview ? routeOf(kind) : "/api/leads/bulk-edit";
    try {
      for (const part of chunks(sendIds, SAVE_CHUNK)) {
        try {
          const res = await post(url, bodyFor(part, batchId, before));
          total.updated += res.updated || 0;
          total.unchanged += res.unchanged || 0;
          total.failed.push(...(res.failed || []).map((f) => ({ ...f, name: f.name || names.get(f.lead_id) || null })));
        } catch (e) {
          // One call refused: its leads are reported as failed; the other calls still run.
          total.failed.push(...part.map((id) => ({ lead_id: id, name: names.get(id) || null, reason: e.message })));
        }
      }
      // Retry only what failed for a reason that can pass next time (not "Not a lead of this dealership").
      const cant = new Set(groups.cant.map((r) => r.lead_id));
      onSaved({ kind, batchId, targetName, updated: total.updated, unchanged: total.unchanged, failed: total.failed,
        retryIds: total.failed.map((f) => f.lead_id).filter((id) => !cant.has(id)) });
    } finally { setSaving(false); }
  };

  const verb = { reassign: "Reassign", status: "Change", department: "Move", source: "Set", note: "Add note to", task: "Add task to" }[kind];
  const sourceChoices = field === "campaign" ? (options?.campaigns || []) : (options?.sources || []);

  return (
    <Offcanvas show={show} onHide={saving ? undefined : onHide} placement="end" className="bulk_panel">
      <Offcanvas.Header closeButton={!saving}>
        <Offcanvas.Title>{TITLES[kind]} {ids.length.toLocaleString()} {ids.length === 1 ? "lead" : "leads"}</Offcanvas.Title>
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
            <Form.Label className="fw-semibold">Department</Form.Label>
            <Form.Select size="sm" className="mb-1" value={dept} onChange={(e) => setDept(e.target.value)} disabled={saving}>
              {DEPARTMENTS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </Form.Select>
            <small className="text-muted d-block mb-2">The department&apos;s staff get one email listing the leads moved.</small>
          </>
        )}
        {kind === "source" && (
          <>
            <div className="btn-group mb-2" role="group" aria-label="What to set">
              <Button size="sm" variant={field === "lead_source" ? "custom" : "outline-custom"} onClick={() => { setField("lead_source"); setFieldValue(""); }}>Lead source</Button>
              <Button size="sm" variant={field === "campaign" ? "custom" : "outline-custom"} onClick={() => { setField("campaign"); setFieldValue(""); }}>Campaign</Button>
            </div>
            {!options ? <SkeletonRows rows={1} cols={1} /> : (
              <Form.Select size="sm" className="mb-1" value={fieldValue} onChange={(e) => setFieldValue(e.target.value)} disabled={saving}>
                <option value="">{field === "campaign" ? "No campaign" : "Pick a lead source"}</option>
                {sourceChoices.map((n) => <option key={n} value={n}>{n}</option>)}
              </Form.Select>
            )}
            {options && !sourceChoices.length && <small className="text-muted d-block mb-2">None on the list yet (Leads &gt; Add lead &gt; Lead source &gt; Edit list).</small>}
          </>
        )}
        {(kind === "note" || kind === "task") && (
          <>
            <Form.Label className="fw-semibold">{kind === "note" ? "Note" : "What the call is for"}</Form.Label>
            <Form.Control as="textarea" rows={kind === "note" ? 4 : 2} size="sm" className="mb-2" value={note} maxLength={kind === "task" ? 300 : 2000}
              onChange={(e) => setNote(e.target.value)} disabled={saving} placeholder={kind === "note" ? "Write the note" : "e.g. Call about the new inventory"} />
            {kind === "note" ? (
              <Form.Check type="switch" id="bulk-note-internal" className="mb-2 small" checked={internal} onChange={(e) => setInternal(e.target.checked)}
                label="For internal use only (the AI does not read it)" />
            ) : (
              <div className="d-flex gap-2 mb-2">
                <div className="flex-fill"><Form.Label className="small mb-1">Due</Form.Label>
                  <Form.Control type="datetime-local" size="sm" value={dueAt} onChange={(e) => setDueAt(e.target.value)} disabled={saving} /></div>
                <div className="flex-fill"><Form.Label className="small mb-1">For</Form.Label>
                  <Form.Select size="sm" value={taskFor} onChange={(e) => setTaskFor(e.target.value)} disabled={saving}>
                    <option value="">Each lead&apos;s owner / anyone</option>
                    {staffList.map((st) => <option key={st._id} value={st._id}>{st.name}</option>)}
                  </Form.Select></div>
              </div>
            )}
          </>
        )}

        {busy && !rows ? <><div className="d-flex gap-2 my-2">{[0, 1, 2].map((i) => <div key={i} className="bulk_count placeholder-glow flex-fill"><span className="placeholder col-6"></span></div>)}</div><SkeletonRows rows={8} /></> : rows && (
          <>
            <div className="d-flex gap-2 my-2 bulk_counts">
              <div className="bulk_count ok"><b>{groups.change.length.toLocaleString()}</b>{kind === "note" || kind === "task" ? "will get one" : "will change"}</div>
              {!(kind === "note" || kind === "task") && (
                <>
                  <div className="bulk_count same"><b>{groups.already.length.toLocaleString()}</b>already {kind === "reassign" ? `${targetName}'s` : "so"}</div>
                  <div className="bulk_count bad"><b>{groups.cant.length.toLocaleString()}</b>can&apos;t change</div>
                </>
              )}
            </div>

            <div className="fw-semibold mt-3 mb-1">What changes</div>
            <Table bordered size="sm" className="small mb-3">
              <thead><tr><th style={{ width: "26%" }}></th><th>Now</th><th>After</th></tr></thead>
              <tbody>
                {(kind === "note" || kind === "task") ? (
                  <tr><td className="fw-semibold">{kind === "note" ? "Conversation" : "Open tasks"}</td><td>—</td>
                    <td>+ {kind === "note" ? `${internal ? "internal " : ""}note` : "call task"}{note.trim() ? `: "${note.trim().slice(0, 60)}${note.trim().length > 60 ? "…" : ""}"` : ""}</td></tr>
                ) : (
                  <tr><td className="fw-semibold">{{ reassign: "Owner", status: "Status", department: "Department", source: field === "campaign" ? "Campaign" : "Lead source" }[kind]}</td>
                    <td>{nowBreakdown.length ? nowBreakdown.slice(0, 6).map(([k, n]) => <div key={k}>{n.toLocaleString()} · {k}</div>) : "—"}
                      {nowBreakdown.length > 6 && <div className="text-muted">+ {nowBreakdown.length - 6} more</div>}</td>
                    <td>→ {targetName}</td></tr>
                )}
                {isStatus && <tr><td className="fw-semibold">Workflows</td><td colSpan={2}>The same as changing one lead: the AI is told, follow-ups follow the new status. Nothing is sent to the customer.</td></tr>}
                {kind === "reassign" && <tr><td className="fw-semibold">Conversation</td><td>—</td><td>+ internal note &quot;Reassigned from … to {targetName}&quot; (the customer never sees it)</td></tr>}
                {kind !== "status" && <tr><td className="fw-semibold">Customer</td><td colSpan={2} className="text-muted">Nothing is sent to the customer</td></tr>}
              </tbody>
            </Table>

            <Nav variant="pills" className="mb-2 small" activeKey={tab} onSelect={(k) => { setTab(k); setPage(1); }}>
              <Nav.Item><Nav.Link eventKey="change" className="py-1">{kind === "note" || kind === "task" ? "Leads" : "Will change"} {groups.change.length}</Nav.Link></Nav.Item>
              {!(kind === "note" || kind === "task") && (
                <>
                  <Nav.Item><Nav.Link eventKey="already" className="py-1">Already {groups.already.length}</Nav.Link></Nav.Item>
                  <Nav.Item><Nav.Link eventKey="cant" className="py-1">Can&apos;t {groups.cant.length}</Nav.Link></Nav.Item>
                </>
              )}
            </Nav>
            {shown.length ? (
              <Table size="sm" className="small mb-2">
                <thead><tr><th>Lead</th><th>{kind === "task" ? "Owner" : "Now"}</th><th>{tab === "cant" ? "Why" : "After"}</th></tr></thead>
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
          {saving ? <><Spinner size="sm" className="me-1" />Saving…</> : `${verb} ${groups.change.length.toLocaleString()} ${groups.change.length === 1 ? "lead" : "leads"}`}
        </Button>
      </div>
    </Offcanvas>
  );
}

// The notice at the top right after saving.
export function BulkNotice({ result, onClose, onUndo, onRetry }) {
  const [hover, setHover] = useState(false);
  const [showFailed, setShowFailed] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(null);
  const failed = result?.failed || [];
  const sticky = failed.length > 0 || showFailed || undoing || undone;
  useEffect(() => {
    if (!result || sticky || hover) return undefined;
    const t = setTimeout(onClose, 10000);
    return () => clearTimeout(t);
  }, [result, sticky, hover, onClose]);
  if (!result) return null;
  const canUndoKind = result.kind === "reassign";
  const undo = async () => {
    setUndoing(true);
    try { setUndone(await onUndo(result.batchId)); } catch (e) { setUndone({ error: e.message }); } finally { setUndoing(false); }
  };
  return (
    <div className={`bulk_notice ${failed.length ? "has_failed" : ""}`} role="status" onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <div className="d-flex">
        <i className={`fa-solid ${failed.length && !result.updated ? "fa-circle-exclamation text-danger" : "fa-circle-check text-success"} me-2 mt-1`}></i>
        <div>
          <strong>{result.updated.toLocaleString()} {result.updated === 1 ? "lead" : "leads"} {{
            reassign: `reassigned to ${result.targetName}`, status: `set to ${result.targetName}`, department: `moved to ${result.targetName}`,
            source: `set to ${result.targetName}`, note: "got the note", task: "got the call task",
          }[result.kind] || "changed"}</strong>
          <div className="text-muted small">
            {result.unchanged ? `${result.unchanged.toLocaleString()} unchanged` : ""}
            {result.unchanged && failed.length ? " · " : ""}
            {failed.length ? <span className="text-danger">{failed.length} failed</span> : null}
          </div>
        </div>
        <Button size="sm" variant="link" className="ms-auto p-0 text-muted" aria-label="Close" onClick={onClose}>
          <i className="fa-solid fa-xmark"></i>
        </Button>
      </div>
      {undone ? (
        <div className={`small mt-2 ${undone.error ? "text-danger" : ""}`}>
          {undone.error || `Undone: ${undone.restored} back to their earlier owner${undone.changed_since ? `, ${undone.changed_since} changed since (left alone)` : ""}.`}
        </div>
      ) : (
        <div className="d-flex flex-wrap gap-3 mt-2 small">
          {canUndoKind && result.updated > 0 && (
            <Button variant="link" className="p-0 text-custom fw-semibold small" disabled={undoing} onClick={undo}>
              {undoing ? "Undoing…" : "Undo"}
            </Button>
          )}
          {failed.length > 0 && (
            <Button variant="link" className="p-0 text-custom fw-semibold small" onClick={() => setShowFailed((v) => !v)}>
              {showFailed ? "Hide" : "Show"} the {failed.length} failed
            </Button>
          )}
          {result.retryIds?.length > 0 && (
            <Button variant="link" className="p-0 text-custom fw-semibold small" onClick={() => onRetry(result)}>Retry</Button>
          )}
        </div>
      )}
      {showFailed && (
        <ul className="small mt-2 mb-0 ps-3 bulk_failed">
          {failed.map((f) => <li key={f.lead_id}>{f.name || f.lead_id}: <span className="text-danger">{f.reason}</span></li>)}
        </ul>
      )}
      {!sticky && <div className={`bulk_notice_timer ${hover ? "paused" : ""}`}></div>}
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
