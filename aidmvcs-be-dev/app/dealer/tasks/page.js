"use client";
// Tasks: one list of what staff should do now (SOW Deliverable D, gaps G-025 one task queue / G-028 exception lists).
// Each view comes from where the work is already recorded - nothing is copied or scheduled here (G-029: no second
// automation engine):
//   Calls to make       the AI's open call tasks           /api/dealer-ai/call-tasks?view=open
//   Need a person       open AI alerts (handoffs, ...)     /api/dealer-ai/alerts
//   Unconfirmed today   today's appointments not confirmed /api/tasks
//   No-shows            No Show in the last 14 days         /api/tasks
//   No next action      Contacted - No Next Action          /api/tasks
// Salespeople with "View Assigned Leads" only see their own leads (each API filters). Rows open the lead, same tab.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Form, Spinner, Table } from "react-bootstrap";
import { useUser } from "../context/UserContext";
import { aiFetch, alertKind, formatDateTime, fromNow, leadHref, telHref } from "../ai/components/aiShared";

const VIEWS = [
  { key: "calls", label: "Calls to make", icon: "fa-phone", more: "/dealer/ai/call-tasks" },
  { key: "alerts", label: "Need a person", icon: "fa-bell", more: "/dealer/ai/alerts" },
  { key: "unconfirmed", label: "Unconfirmed today", icon: "fa-calendar-xmark", more: "/dealer/booking" },
  { key: "no_shows", label: "No-shows to win back", icon: "fa-user-clock" },
  { key: "no_next_action", label: "No next action", icon: "fa-hourglass-half" },
];

const Phone = ({ phone }) => (phone ? <a href={telHref(phone)} onClick={(e) => e.stopPropagation()}>{phone}</a> : "-");

export default function TasksPage() {
  const { user, dealerParent } = useUser();
  const dealerId = (dealerParent || user)?.id;
  const [view, setView] = useState("calls");
  const [owner, setOwner] = useState("");
  const [data, setData] = useState({ calls: null, alerts: null, queues: null, staff: {} });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!dealerId) return;
    setLoading(true);
    const q = `dealer_id=${dealerId}`;
    const [calls, alerts, queues, staff] = await Promise.allSettled([
      aiFetch(`/api/dealer-ai/call-tasks?view=open&${q}`),
      aiFetch(`/api/dealer-ai/alerts?${q}`),
      aiFetch(`/api/tasks?${q}`),
      aiFetch(`/api/staff/list?${q}`),
    ]);
    setData({
      calls: calls.status === "fulfilled" ? calls.value.tasks || [] : null,
      alerts: alerts.status === "fulfilled" ? (alerts.value.alerts || []).filter((a) => !a.handled) : null,
      queues: queues.status === "fulfilled" ? queues.value : null,
      // Call tasks carry the salesperson's id; their names come from the staff list (not fatal if it fails).
      staff: staff.status === "fulfilled"
        ? Object.fromEntries((staff.value.staff || []).map((u) => [String(u._id), u.name])) : {},
    });
    setErrors({
      calls: calls.status === "rejected" ? calls.reason?.message : null,
      alerts: alerts.status === "rejected" ? alerts.reason?.message : null,
      queues: queues.status === "rejected" ? queues.reason?.message : null,
    });
    setLoading(false);
  }, [dealerId]);
  useEffect(() => { load(); }, [load]);

  // One row shape for every view: who, why, owner, when, overdue.
  const rows = useMemo(() => {
    const q = data.queues || {};
    if (view === "calls") return (data.calls || []).map((t) => ({
      id: `c${t.id}`, lead_id: t.lead_id, name: t.customer_name, phone: t.phone,
      owner: t.assigned_to ? data.staff[String(t.assigned_to)] || null : null,
      why: t.requested ? "Customer asked for a call" : t.reason || "Call the customer",
      when: t.due_at || t.opened_at, overdue: t.due_at && new Date(t.due_at) < new Date() }));
    if (view === "alerts") {
      const seen = new Set();
      return (data.alerts || []).filter((a) => !seen.has(a.lead_id) && seen.add(a.lead_id)).map((a) => ({
        id: `a${a.lead_id}${a.kind}`, lead_id: a.lead_id, name: a.lead?.name, phone: a.lead?.phone, owner: null,
        why: `${alertKind(a.kind).label}${a.text ? `: ${a.text}` : ""}`, when: a.at, overdue: false }));
    }
    if (view === "unconfirmed") return (q.unconfirmed || []).map((r) => ({
      id: r.lead_id, lead_id: r.lead_id, name: r.name, phone: r.phone, owner: r.owner,
      why: `Appointment ${r.appointment_time || "today"} - ${r.confirmation === "tentative" ? "tentative" : "not confirmed"}`,
      when: null, whenText: r.appointment_time || "Today", overdue: r.overdue }));
    if (view === "no_shows") return (q.no_shows || []).map((r) => ({
      id: r.lead_id, lead_id: r.lead_id, name: r.name, phone: r.phone, owner: r.owner,
      why: `No show${r.vehicle ? ` - ${r.vehicle}` : ""}${r.ai === "handoff" ? " · staff have it" : ""}`,
      when: r.since, overdue: false }));
    return (q.no_next_action || []).map((r) => ({
      id: r.lead_id, lead_id: r.lead_id, name: r.name, phone: r.phone, owner: r.owner,
      why: r.quiet_days == null ? "No messages yet" : `Quiet for ${r.quiet_days} day${r.quiet_days === 1 ? "" : "s"}`,
      when: r.last_message_at, overdue: (r.quiet_days ?? 0) >= 3 }));
  }, [view, data]);

  const counts = {
    calls: data.calls?.length, alerts: data.alerts ? new Set(data.alerts.map((a) => a.lead_id)).size : undefined,
    unconfirmed: data.queues?.unconfirmed?.length, no_shows: data.queues?.no_shows?.length,
    no_next_action: data.queues?.no_next_action_total,
  };
  const owners = [...new Set(rows.map((r) => r.owner).filter(Boolean))].sort();
  const shown = owner ? rows.filter((r) => (owner === "-" ? !r.owner : r.owner === owner)) : rows;
  const current = VIEWS.find((v) => v.key === view);
  const error = errors[view === "calls" ? "calls" : view === "alerts" ? "alerts" : "queues"];

  return (
    <div className="page_content">
      <div className="page_head d-flex align-items-center">
        <h3 className="page_title mb-0 me-auto">Tasks</h3>
        <Button size="sm" variant="outline-custom" onClick={load} disabled={loading}>
          <i className="fa-regular fa-rotate me-1" />Refresh
        </Button>
      </div>
      <div className="page_body">
        <div className="w_card">
          <div className="d-flex flex-wrap gap-2 mb-3">
            {VIEWS.map((v) => (
              <Button key={v.key} size="sm" variant={view === v.key ? "custom" : "outline-custom"}
                onClick={() => { setView(v.key); setOwner(""); }}>
                <i className={`fa-regular ${v.icon} me-1`} />{v.label}
                <Badge bg={view === v.key ? "light" : "secondary"} text={view === v.key ? "dark" : undefined} className="ms-2">
                  {counts[v.key] ?? "…"}
                </Badge>
              </Button>
            ))}
          </div>

          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
            {owners.length > 0 && (
              <Form.Select size="sm" className="w-auto" value={owner} onChange={(e) => setOwner(e.target.value)}
                aria-label="Filter by salesperson">
                <option value="">Everyone</option>
                {owners.map((o) => <option key={o} value={o}>{o}</option>)}
                <option value="-">Unassigned</option>
              </Form.Select>
            )}
            {data.queues?.mine_only && <small className="text-muted">Your leads only</small>}
            {current?.more && <Link href={current.more} className="small ms-auto">Open the full {current.label} page</Link>}
          </div>

          {error && <Alert variant="danger" className="small">{error}</Alert>}
          {loading ? (
            <div className="text-center py-4"><Spinner size="sm" /></div>
          ) : !shown.length ? (
            <div className="text-muted small py-3">Nothing here right now.</div>
          ) : (
            <Table hover responsive size="sm" className="small mb-0">
              <thead><tr><th>Customer</th><th>Phone</th><th>Why</th><th>Salesperson</th><th>When</th><th /></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className="fw-semibold">{r.name || "-"}</td>
                    <td><Phone phone={r.phone} /></td>
                    <td>{r.why}</td>
                    <td>{r.owner || <span className="text-muted">{view === "alerts" ? "-" : "Unassigned"}</span>}</td>
                    <td className="text-nowrap">
                      {r.whenText || (r.when ? <span title={formatDateTime(r.when)}>{fromNow(r.when)}</span> : "-")}
                      {r.overdue && <Badge bg="danger" className="ms-1">Overdue</Badge>}
                    </td>
                    <td className="text-end">
                      {r.lead_id && <Link href={leadHref(r.lead_id)} className="btn btn-sm btn-outline-custom">Open lead</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
