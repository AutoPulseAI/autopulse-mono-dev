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

// The blue bar that takes the filter row's place while selecting.
export function BulkBar({ count, canAssign, canChangeStatus, onAction, onClose, busy }) {
  return (
    <div className="bulk_bar d-flex flex-wrap align-items-center gap-2 mb-2">
      <strong className="me-2">{count.toLocaleString()} selected</strong>
      {canAssign && (
        <Button size="sm" variant="light" disabled={!count || busy} onClick={() => onAction("reassign")}>
          <i className="fa-solid fa-user-pen me-1"></i>Reassign
        </Button>
      )}
      {canChangeStatus && (
        <Button size="sm" variant="light" disabled={!count || busy} onClick={() => onAction("status")}>
          <i className="fa-solid fa-flag me-1"></i>Change status
        </Button>
      )}
      <Button size="sm" variant="link" className="text-white ms-auto" title="Stop selecting" aria-label="Stop selecting"
        onClick={onClose}>
        <i className="fa-solid fa-xmark"></i>
      </Button>
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

// The side panel: check before saving, then save in calls of 100.
export function BulkPanel({ kind, show, dealerId, leads, staffList, onHide, onSaved }) {
  const isStatus = kind === "status";
  const [to, setTo] = useState("");
  const [status, setStatus] = useState(BULK_STATUSES[0]);
  const [rows, setRows] = useState(null);
  const [tab, setTab] = useState("change");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Keyed on the ids themselves: a new array with the same leads (a parent re-render) never re-runs the preview.
  const idsKey = leads.map((l) => l._id).join(",");
  const ids = useMemo(() => (idsKey ? idsKey.split(",") : []), [idsKey]);
  const target = isStatus ? status : to;
  const targetName = isStatus ? statusLabel(status)
    : (to ? staffList.find((s) => String(s._id) === String(to))?.name : "Unassigned") || "Unassigned";

  // Preview: nothing is written. In calls of 200 (the routes' maximum), merged.
  useEffect(() => {
    if (!show || !ids.length) return undefined;
    let gone = false;
    setBusy(true); setError(null); setRows(null); setPage(1);
    (async () => {
      try {
        const parts = [];
        for (const part of chunks(ids, PREVIEW_CHUNK)) {
          const body = isStatus ? { dealer_id: dealerId, lead_ids: part, status } : { dealer_id: dealerId, lead_ids: part, assigned_to: to || null };
          parts.push(...(await post(routeOf(kind), { ...body, confirm: false })).rows);
          if (gone) return;
        }
        if (!gone) setRows(parts);
      } catch (e) { if (!gone) setError(e.message); } finally { if (!gone) setBusy(false); }
    })();
    return () => { gone = true; };
  }, [show, ids, kind, isStatus, dealerId, target]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const save = async () => {
    setBusy(true); setError(null);
    const batchId = newBatchId();
    const total = { updated: 0, unchanged: 0, failed: [] };
    // Every selected lead is sent (the route leaves unchanged ones alone and reports why one can't change), so Bulk
    // history counts the whole selection.
    const sendIds = (rows || []).map((r) => r.lead_id);
    const names = new Map((rows || []).map((r) => [r.lead_id, r.name]));
    const before = new Map((rows || []).map((r) => [r.lead_id, r.current ?? null]));
    try {
      for (const part of chunks(sendIds, SAVE_CHUNK)) {
        const body = isStatus
          ? { dealer_id: dealerId, lead_ids: part, status, confirm: true, batch_id: batchId,
            expected: Object.fromEntries(part.map((id) => [id, before.get(id) ?? null])) }
          : { dealer_id: dealerId, lead_ids: part, assigned_to: to || null, confirm: true, batch_id: batchId };
        try {
          const res = await post(routeOf(kind), body);
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
        retryIds: total.failed.map((f) => f.lead_id).filter((id) => !cant.has(id)), target: isStatus ? status : (to || null) });
    } finally { setBusy(false); }
  };

  return (
    <Offcanvas show={show} onHide={busy ? undefined : onHide} placement="end" className="bulk_panel">
      <Offcanvas.Header closeButton={!busy}>
        <Offcanvas.Title>{isStatus ? "Change status of" : "Reassign"} {ids.length.toLocaleString()} {ids.length === 1 ? "lead" : "leads"}</Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        {error && <Alert variant="danger" className="py-2 small">{error}</Alert>}
        <Form.Label className="fw-semibold">{isStatus ? "New status" : "New owner"}</Form.Label>
        {isStatus ? (
          <Form.Select size="sm" className="mb-1" value={status} onChange={(e) => setStatus(e.target.value)} disabled={busy}>
            {BULK_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </Form.Select>
        ) : (
          <Form.Select size="sm" className="mb-1" value={to} onChange={(e) => setTo(e.target.value)} disabled={busy}>
            <option value="">Unassigned</option>
            {staffList.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </Form.Select>
        )}
        {isStatus && <small className="text-muted d-block mb-2">Other statuses (appointments, sold, no show) are set one lead at a time.</small>}

        {busy && !rows ? <div className="text-center py-4"><Spinner size="sm" /> Checking {ids.length.toLocaleString()} leads…</div> : rows && (
          <>
            <div className="d-flex gap-2 my-2 bulk_counts">
              <div className="bulk_count ok"><b>{groups.change.length.toLocaleString()}</b>will change</div>
              <div className="bulk_count same"><b>{groups.already.length.toLocaleString()}</b>already {isStatus ? "that status" : `${targetName}'s`}</div>
              <div className="bulk_count bad"><b>{groups.cant.length.toLocaleString()}</b>can&apos;t change</div>
            </div>

            <div className="fw-semibold mt-3 mb-1">What changes</div>
            <Table bordered size="sm" className="small mb-3">
              <thead><tr><th style={{ width: "26%" }}></th><th>Now</th><th>After</th></tr></thead>
              <tbody>
                <tr><td className="fw-semibold">{isStatus ? "Status" : "Owner"}</td>
                  <td>{nowBreakdown.length ? nowBreakdown.map(([k, n]) => <div key={k}>{n.toLocaleString()} · {k}</div>) : "—"}</td>
                  <td>→ {targetName}</td></tr>
                {isStatus ? (
                  <tr><td className="fw-semibold">Workflows</td><td colSpan={2}>The same as changing one lead: the AI is told, follow-ups follow the new status. Nothing is sent to the customer.</td></tr>
                ) : (
                  <>
                    <tr><td className="fw-semibold">Conversation</td><td>—</td><td>+ internal note &quot;Reassigned from … to {targetName}&quot; (the customer never sees it)</td></tr>
                    <tr><td className="fw-semibold">AI follow-ups</td><td colSpan={2} className="text-muted">No change</td></tr>
                  </>
                )}
              </tbody>
            </Table>

            <Nav variant="pills" className="mb-2 small" activeKey={tab} onSelect={(k) => { setTab(k); setPage(1); }}>
              <Nav.Item><Nav.Link eventKey="change" className="py-1">Will change {groups.change.length}</Nav.Link></Nav.Item>
              <Nav.Item><Nav.Link eventKey="already" className="py-1">Already {groups.already.length}</Nav.Link></Nav.Item>
              <Nav.Item><Nav.Link eventKey="cant" className="py-1">Can&apos;t {groups.cant.length}</Nav.Link></Nav.Item>
            </Nav>
            {shown.length ? (
              <Table size="sm" className="small mb-2">
                <thead><tr><th>Lead</th><th>Now</th><th>{tab === "cant" ? "Why" : "After"}</th></tr></thead>
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
        <Button size="sm" variant="secondary" disabled={busy} onClick={onHide}>Cancel</Button>
        <Button size="sm" variant="custom" disabled={busy || !rows || !groups.change.length} onClick={save}>
          {busy && rows ? <><Spinner size="sm" className="me-1" />Saving…</> : `${isStatus ? "Change" : "Reassign"} ${groups.change.length.toLocaleString()} ${groups.change.length === 1 ? "lead" : "leads"}`}
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
  const isStatus = result.kind === "status";
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
          <strong>{result.updated.toLocaleString()} {result.updated === 1 ? "lead" : "leads"} {isStatus ? `set to ${result.targetName}` : `reassigned to ${result.targetName}`}</strong>
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
          {!isStatus && result.updated > 0 && (
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
