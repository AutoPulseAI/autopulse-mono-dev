"use client";
// Actions (SOW Deliverables B b3 + D; approved by the user, 24 Nov 2026): the one place for work that needs a person.
//   Dealer Action Required   the AI's alerts (/api/dealer-ai/alerts)
//   Tasks                    AI call tasks + staff reminders, by status (/api/dealer-ai/call-tasks, actions?tab=reminders)
//   Stuck leads              open leads nobody is moving (actions?tab=stuck)
//   Team board               who is responsible for what (actions?tab=board)
// Same call outcome prompt, Mark handled and date picker as before. It never messages a customer.
import Link from "next/link";
import moment from "moment-timezone";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Badge, Button, ButtonGroup, Form, Modal, Spinner, Table } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import useLiveRefresh from "../../../hooks/useLiveRefresh";
import AppIcon, { Avatar, IconLabel, iconColor, statusIconName } from "../../components/AppIcon";
import DashboardDatePicker from "../../dashboard/components/DashboardDatePicker";
import { ListPages } from "../../leads/components/BulkAssign";
import { leadStatusLabelFrom } from "./labels";
import CallOutcomeModal from "../components/CallOutcomeModal";
import DismissTaskModal, { DISMISS_TASKS } from "../../components/DismissTaskModal";
import { useCan } from "../../../hooks/PermissionsContext";
import LeadAiDrawer from "../components/LeadAiDrawer";
import useIsMobile from "../../components/useIsMobile";
import { ALERTS_CHANGED_EVENT, aiFetch, alertKind, callOutcomeLabel, formatDateTime, fromNow, leadHref, personHref, telHref } from "../components/aiShared";
import { rememberBack } from "../../components/backLink";

const TABS = [
  { key: "dar", label: "Dealer Action Required", sub: "A customer is waiting on us", icon: "action" },
  { key: "tasks", label: "Tasks", sub: "Work due at a set time", icon: "task" },
  { key: "stuck", label: "Stuck leads", sub: "Nobody is moving these", icon: "stuck" },
  { key: "board", label: "Team board", sub: "Who is responsible for what", icon: "team" },
];
const TASK_STATUS = [
  ["open", "To call now", "phone", "primary"], ["overdue", "Overdue", "overdue", "danger"], ["waiting", "Waiting", "age", "info"],
  ["done", "Done", "done", "success"], ["missed", "Missed", "missed", "danger"], ["cancelled", "No longer needed", "cancelled", "secondary"],
];
const STATUS_META = Object.fromEntries(TASK_STATUS.map(([k, label, icon, bg]) => [k, { label, icon, bg }]));
const DEPT = { sales: "Sales", service: "Service", parts: "Parts" };
const DEPT_BUTTONS = [["", "All", "fa-layer-group"], ["sales", "Sales", "fa-car"], ["service", "Service", "fa-screwdriver-wrench"], ["parts", "Parts", "fa-gears"]];
const REASON_ICON = { "First response late": "overdue", "No owner": "noOwner", "No-show recovery": "missed", "Possible duplicate": "customers", "No next step": "stuck", "Unsold follow-up": "history" };
const REASON_BG = { "First response late": "danger", "No owner": "warning", "No-show recovery": "primary", "Possible duplicate": "info", "No next step": "secondary", "Unsold follow-up": "dark" };
const FIX_ICON = { Assign: "fa-user-plus", "Add task": "fa-plus", "Review merge": "fa-code-merge", "Open lead": "fa-arrow-up-right-from-square" };
const AGE = (at, now) => { const d = (now - new Date(at)) / 86400000; return d <= 7 ? "Up to 7 days" : d <= 30 ? "8-30 days" : "Over 30 days"; };
const PENDING_KEY = "aiPendingCallTask"; // shared with the call prompt, so a call survives a reload
const read = () => { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "null"); } catch { return null; } };
const write = (t) => { try { if (t) localStorage.setItem(PENDING_KEY, JSON.stringify(t)); else localStorage.removeItem(PENDING_KEY); } catch { /* the prompt still opens */ } };

const callWhy = (t) => (t.requested ? "Customer asked for a call" : t.source === "daily" ? `Day ${t.day} call` : "No reply to text or email");
const callStatus = (view, t, now) => (view === "open" ? (t.due_by && new Date(t.due_by) < now ? "overdue" : "open")
  : view === "upcoming" ? "waiting" : view);
const fromCall = (view, t, now) => {
  const status = callStatus(view, t, now);
  return { key: `call-${t.id}`, kind: "call", id: t.id, raw: t, lead_id: t.lead_id, customer_id: t.customer_id, name: t.customer_name || t.phone || "Unknown customer",
    vehicle: t.vehicle, phone: t.phone, why: callWhy(t), status, due: t.due_by || t.due_at || t.opened_at || t.closed_at,
    priority: status === "overdue" || t.requested ? "High" : "Normal", made: "AI", owner_id: t.assigned_to || null,
    done_at: t.closed_at, done_by: t.closed_by, outcome: callOutcomeLabel(t.outcome) || null, note: t.note || null };
};
const fromReminder = (r, now) => {
  const late = !r.done_at && new Date(r.due_at) < now;
  return { key: `rem-${r.id}`, kind: "reminder", id: r.id, raw: r, lead_id: r.lead_id, customer_id: r.customer_id, name: r.name, vehicle: r.vehicle, phone: r.phone,
    why: r.note, status: r.dismissed_at ? "cancelled" : r.done_at ? "done" : late ? "overdue" : "waiting", due: r.due_at, priority: r.escalated_at || late ? "High" : "Normal",
    made: r.created_by_name || "Staff", owner_id: r.owner_id, done_at: r.done_at, done_by: r.done_by_name,
    outcome: r.dismissed_at ? "Dismissed" : r.done_at ? "Completed" : null, note: r.dismiss_reason || null, escalated: !!r.escalated_at,
    dismissed: !!r.dismissed_at, department: r.department || null };
};

const Person = ({ name }) => (name
  ? <span className="ap_label text-nowrap"><Avatar name={name} small />{name}</span>
  : <span className="ap_label text-danger text-nowrap"><AppIcon name="noOwner" />No owner</span>);
const Customer = ({ name, vehicle, href }) => (
  <div className="ap_person"><Avatar name={name} /><span><Link href={href} className="fw-semibold text-dark"
    onClick={() => rememberBack(href, window.location.pathname + window.location.search, "Tasks")}>{name}</Link>
    {vehicle && <small className="d-block text-muted"><AppIcon name="vehicle" className="me-1" />{vehicle}</small>}</span></div>
);
const Phone = ({ value }) => (value ? <span className="ap_label text-nowrap"><AppIcon name="phone" />{value}</span> : <span className="text-muted">-</span>);
const When = ({ at, name = "date" }) => (at ? <span className="ap_label text-nowrap" title={formatDateTime(at)}><AppIcon name={name} />{moment(at).format("MMM D, YYYY")}</span> : <span className="text-muted">-</span>);
const LeadStatus = ({ status }) => (status ? <span className="ap_label"><AppIcon name={statusIconName(status)} />{leadStatusLabelFrom(status)}</span> : <span className="text-muted">-</span>);
const Source = ({ value }) => (value ? <span className="ap_label"><AppIcon name="source" />{value}</span> : <span className="text-muted">-</span>);
const Priority = ({ value }) => <span className={`act_pri ${value.toLowerCase()}`}><i className={`fa-solid ${value === "High" ? "fa-angles-up" : "fa-equals"}`} aria-hidden="true" />{value}</span>;
const Icon = ({ title, name, variant = "outline-custom", ...rest }) => (
  <Button size="sm" variant={variant} className="act_btn" title={title} aria-label={title} {...rest}><AppIcon name={name} plain /></Button>
);

function GoToPage({ page, pages, onPage }) {
  const [value, setValue] = useState("");
  if (pages <= 1) return null;
  const go = () => { const n = parseInt(value, 10); if (n >= 1 && n <= pages) { onPage(n); setValue(""); } };
  return (
    <div className="d-md-flex justify-content-center mt-3">
      <ListPages current={page} total={pages} onPage={onPage} />
      <div className="d-flex align-items-center justify-content-center gap-1 ms-md-3 mt-1 mt-md-0">
        <span className="text-muted small">Go to page:</span>
        <input type="number" min="1" max={pages} value={value} aria-label="Go to page" placeholder="Page" style={{ width: 60 }}
          className="form-control form-control-sm text-center" onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
        <span className="text-muted small">of {pages}</span>
        <Button size="sm" variant="outline-custom" disabled={!value} onClick={go}>Go</Button>
      </div>
    </div>
  );
}

// Choices every list has, even before it has rows (25 Nov 2026: the filters looked empty on an empty list).
const FIXED_OPTIONS = {
  dar: { pri: ["Escalated", "Normal"] },
  tasks: { pri: ["High", "Normal"], made: ["AI"] },
};

function Select({ value, onChange, label, options }) {
  return (
    <Form.Select size="sm" className="act_filter" aria-label={label} value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{label}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
      {!options.length && <option disabled>None in this list yet</option>}
    </Form.Select>
  );
}

function ReminderModal({ item, staff, onHide, onSaved }) {
  const [due, setDue] = useState("");
  const [owner, setOwner] = useState("");
  const [escalate, setEscalate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!item) return;
    setDue(moment(item.due).format("YYYY-MM-DDTHH:mm")); setOwner(item.owner_id || ""); setEscalate(false); setError("");
  }, [item]);
  const save = async () => {
    setBusy(true); setError("");
    try {
      await aiFetch(`/api/leads/${item.lead_id}/opportunity`, { method: "POST", body: JSON.stringify({ action: "reminder_update",
        reminder_id: item.id, due_at: new Date(due).toISOString(), assigned_to: owner || null, escalate }) });
      onSaved("Task updated.");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal show={!!item} onHide={onHide} centered>
      <Modal.Header closeButton><Modal.Title as="h6">Change task</Modal.Title></Modal.Header>
      <Modal.Body className="small">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        <p className="fw-semibold mb-2">{item?.why}</p>
        <Form.Label>Due</Form.Label>
        <Form.Control size="sm" type="datetime-local" className="mb-2" value={due} onChange={(e) => setDue(e.target.value)} />
        <Form.Label>Assigned to</Form.Label>
        <Form.Select size="sm" className="mb-2" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Nobody</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Form.Select>
        {!item?.escalated && <Form.Check id="act-escalate" label="Escalate to a manager" checked={escalate} onChange={(e) => setEscalate(e.target.checked)} />}
      </Modal.Body>
      <Modal.Footer>
        <Button size="sm" variant="outline-custom" onClick={onHide}>Cancel</Button>
        <Button size="sm" variant="custom" disabled={busy || !due} onClick={save}>{busy ? <Spinner size="sm" /> : "Save"}</Button>
      </Modal.Footer>
    </Modal>
  );
}

// Stuck leads: assign an owner, or add the next step, without leaving the list. No customer is messaged.
function FixModal({ item, staff, dealerId, onHide, onSaved }) {
  const [owner, setOwner] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!item) return;
    setOwner(item.owner_id || ""); setNote(item.reason === "No-show recovery" ? "Call to rebook the missed visit" : item.reason === "Unsold follow-up" ? "Unsold showroom follow-up" : "");
    setDue(moment().add(1, "hour").format("YYYY-MM-DDTHH:mm")); setError("");
  }, [item]);
  const assign = item?.fix === "Assign";
  const save = async () => {
    setBusy(true); setError("");
    try {
      if (assign) {
        const r = await aiFetch("/api/leads/bulk-assign", { method: "POST", body: JSON.stringify({ dealer_id: dealerId, lead_ids: [item.lead_id], assigned_to: owner, confirm: true,
          batch_id: `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}` }) });
        if (r.failed?.length) throw new Error(r.failed[0].reason || "Could not assign this lead");
        onSaved(`${item.name} assigned.`);
      } else {
        await aiFetch(`/api/leads/${item.lead_id}/opportunity`, { method: "POST", body: JSON.stringify({ action: "reminder", note, due_at: new Date(due).toISOString(), assigned_to: owner || undefined }) });
        onSaved(`Task added for ${item.name}.`);
      }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal show={!!item} onHide={onHide} centered>
      <Modal.Header closeButton><Modal.Title as="h6">{assign ? "Assign an owner" : "Add the next step"} · {item?.name}</Modal.Title></Modal.Header>
      <Modal.Body className="small">
        {error && <Alert variant="danger" className="py-2">{error}</Alert>}
        {!assign && <><Form.Label>What needs doing</Form.Label><Form.Control size="sm" className="mb-2" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          <Form.Label>Due</Form.Label><Form.Control size="sm" type="datetime-local" className="mb-2" value={due} onChange={(e) => setDue(e.target.value)} /></>}
        <Form.Label>{assign ? "Owner" : "Assigned to"}</Form.Label>
        <Form.Select size="sm" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">{assign ? "Pick a person" : "Lead owner"}</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Form.Select>
      </Modal.Body>
      <Modal.Footer>
        <Button size="sm" variant="outline-custom" onClick={onHide}>Cancel</Button>
        <Button size="sm" variant="custom" disabled={busy || (assign ? !owner : !note.trim() || !due)} onClick={save}>{busy ? <Spinner size="sm" /> : assign ? "Assign" : "Add task"}</Button>
      </Modal.Footer>
    </Modal>
  );
}

function ActionsContent() {
  const params = useSearchParams();
  const { dealerParent } = useUser();
  const timezone = dealerParent?.dealer_account_information?.time_zone || "America/New_York";
  const tzOffset = moment.tz(timezone).utcOffset();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "dar";

  const [alerts, setAlerts] = useState([]);
  const [calls, setCalls] = useState({});
  const [reminders, setReminders] = useState([]);
  const [stuck, setStuck] = useState({ rows: [], capped: false });
  const [board, setBoard] = useState([]);
  const [facts, setFacts] = useState({});
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [problems, setProblems] = useState([]);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const [pending, setPending] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [editing, setEditing] = useState(null);
  const [fixing, setFixing] = useState(null);

  const [scope, setScope] = useState("all");
  const [ownerF, setOwnerF] = useState("");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState({ startDate: null, endDate: null, preset: "all_time" });
  const [status, setStatus] = useState({ dar: "open", tasks: params.get("status") || "open", stuck: "open" });
  const [f, setF] = useState({});
  const [dept, setDept] = useState(DEPT[params.get("dept")] ? params.get("dept") : "");
  const [sort, setSort] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  // "Dismiss Tasks" (app/lib/taskPermission.js): only these people see Dismiss and Undo dismiss.
  const canDismiss = useCan(DISMISS_TASKS);
  const [dismissing, setDismissing] = useState(null);
  // Below a tablet's width each table row is a card with its column names (from the colleague's phone layouts, 25 Nov 2026).
  const phone = useIsMobile(992);
  useEffect(() => {
    document.querySelectorAll(".act_table table").forEach((t) => {
      const heads = [...t.querySelectorAll("thead th")].map((h) => h.textContent.trim());
      t.querySelectorAll("tbody tr").forEach((row) => [...row.children].forEach((td, i) => { if (heads[i]) td.setAttribute("data-label", heads[i]); }));
    });
  });
  const [moreFilters, setMoreFilters] = useState(false); // phones: the filters fold away so the list stays in view

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    const views = ["open", "upcoming", "done", "missed", "cancelled"];
    const [a, r, s, b, ...c] = await Promise.allSettled([
      aiFetch("/api/dealer-ai/alerts?include_handled=1"), aiFetch("/api/dealer-ai/actions?tab=reminders"),
      aiFetch("/api/dealer-ai/actions?tab=stuck"), aiFetch("/api/dealer-ai/actions?tab=board"),
      ...views.map((v) => aiFetch(`/api/dealer-ai/call-tasks?view=${v}&tz_offset_minutes=${tzOffset}`)),
    ]);
    const issues = [];
    const alertRows = a.status === "fulfilled" ? a.value.alerts || [] : (issues.push("AI alerts"), null);
    if (alertRows) setAlerts(alertRows);
    if (r.status === "fulfilled") { setReminders(r.value.rows || []); setMe(r.value.me); } else issues.push("staff tasks");
    if (s.status === "fulfilled") setStuck({ rows: s.value.rows || [], capped: !!s.value.capped }); else issues.push("stuck leads");
    if (b.status === "fulfilled") setBoard(b.value.rows || []); else issues.push("team board");
    const next = {};
    c.forEach((x, i) => { if (x.status === "fulfilled") next[views[i]] = x.value.tasks || []; });
    if (c.some((x) => x.status !== "fulfilled")) issues.push("AI call tasks");
    setCalls((old) => ({ ...old, ...next }));
    setProblems(issues);
    const ids = [...new Set([...(alertRows || []).map((x) => x.lead_id), ...Object.values(next).flat().map((x) => x.lead_id)])].filter(Boolean);
    if (ids.length) {
      aiFetch("/api/dealer-ai/actions", { method: "POST", body: JSON.stringify({ lead_ids: ids.slice(0, 1000) }) })
        .then((d) => setFacts((old) => ({ ...old, ...(d.facts || {}) }))).catch(() => {});
    }
    setLoading(false);
  }, [tzOffset]);

  useEffect(() => { load(); }, [load]);
  // Refreshes every 2 minutes while the tab is in view (not in a hidden tab), and at once when it comes back.
  useLiveRefresh(() => load({ silent: true }), { everyMs: 120000, paused: loading || !!pending || !!editing || !!fixing });
  useEffect(() => { setPending(read()); }, []);
  useEffect(() => { setPage(1); }, [tab, scope, ownerF, query, range, status, f, perPage, sort]);

  const now = new Date();
  const staffNames = useMemo(() => Object.fromEntries(board.map((p) => [p.id, p.name])), [board]);
  const staff = useMemo(() => board.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)), [board]);
  const teamSet = useMemo(() => new Set(me?.team || []), [me]);
  const inScope = (r) => {
    if (!me) return true;
    if (scope === "mine") return r.owner_id === me.id;
    if (me.role === "admin") return scope === "all" || !!r.owner_id;
    if (me.role === "staff") return r.owner_id === me.id;
    const dept = !me.departments.length || me.departments.includes(r.department);
    return scope === "team" ? teamSet.has(r.owner_id) : dept;
  };
  const inDate = (at) => (!range.startDate || new Date(at) >= range.startDate) && (!range.endDate || new Date(at) <= range.endDate);
  const has = (...v) => { const q = query.trim().toLowerCase(); return !q || v.some((x) => String(x || "").toLowerCase().includes(q)); };
  const withFacts = (r) => { const x = facts[r.lead_id] || {}; return { ...r, owner_id: r.owner_id || x.owner_id || null, owner: staffNames[r.owner_id] || x.owner || r.owner || null,
    lead_status: x.status || r.lead_status || r.status_raw || null, source: r.source || x.source || null, department: r.department || x.department || "sales" }; };

  const alertRows = useMemo(() => alerts.map((a) => ({ ...withFacts({ ...a, owner_id: facts[a.lead_id]?.owner_id }), kindLabel: alertKind(a.kind).label, name: a.lead?.name || "Unknown customer",
    // A customer asking for service is Service work, whatever department their lead is in (e.g. a sold car's first service).
    ...(a.kind === "service_request" ? { department: "service" } : {}),
    vehicle: a.lead?.vehicle, escalated: a.still_no_reply || ["handoff", "no_staff_response", "person_requested"].includes(a.kind) })), [alerts, facts, staffNames]); // eslint-disable-line react-hooks/exhaustive-deps
  const taskRows = useMemo(() => [
    ...Object.entries(calls).flatMap(([v, list]) => list.map((t) => withFacts(fromCall(v, t, now)))),
    ...reminders.map((r) => withFacts(fromReminder(r, now))),
  ], [calls, reminders, facts, staffNames]); // eslint-disable-line react-hooks/exhaustive-deps
  const stuckRows = useMemo(() => stuck.rows.map((r) => ({ ...r, lead_status: r.status })), [stuck]);

  // Sales / Service / Parts (25 Nov 2026: "how does this page tell sales and service tasks apart"): the lead's
  // department, as on the Leads page. Applies to every list and every count on the tab.
  const deptName = (r) => DEPT[r.department] || "Sales";
  const inDept = (r) => !dept || deptName(r) === DEPT[dept];
  const preDept = {
    dar: alertRows.filter(inScope).filter((a) => inDate(a.at)).filter((a) => has(a.name, a.lead?.phone, a.vehicle, a.text)),
    tasks: taskRows.filter(inScope).filter((t) => inDate(t.due)).filter((t) => has(t.name, t.phone, t.vehicle, t.why, t.note)),
    stuck: stuckRows.filter(inScope).filter((x) => inDate(x.since)).filter((x) => has(x.name, x.phone, x.vehicle, x.detail)),
  };
  const baseAlerts = preDept.dar.filter(inDept);
  const baseTasks = preDept.tasks.filter(inDept);
  const baseStuck = preDept.stuck.filter(inDept);
  // How many items each department has in the list shown (this tab and status) - the department buttons' numbers.
  const inStatus = { dar: (a) => (status.dar === "handled" ? a.handled : !a.handled), tasks: (t) => t.status === status.tasks, stuck: () => true };
  const deptCount = (d) => (preDept[tab] || []).filter(inStatus[tab] || (() => true)).filter((r) => !d || deptName(r) === DEPT[d]).length;
  const match = (r, keys) => keys.every(([k, get]) => !f[`${tab}.${k}`] || get(r) === f[`${tab}.${k}`]);
  const owned = (r) => !ownerF || (ownerF === "none" ? !r.owner_id : r.owner_id === ownerF);
  const deptOf = (r) => DEPT[r.department] || "Sales";
  const lsOf = (r) => leadStatusLabelFrom(r.lead_status);
  const FILTERS = {
    dar: [["kind", "All types", (r) => r.kindLabel], ["src", "All lead sources", (r) => r.source], ["ls", "All lead statuses", lsOf], ["pri", "All priorities", (r) => (r.escalated ? "Escalated" : "Normal")]],
    tasks: [["why", "All task types", (r) => r.why], ["pri", "All priorities", (r) => r.priority], ["made", "Made by: anyone", (r) => r.made], ["src", "All lead sources", (r) => r.source], ["ls", "All lead statuses", lsOf], ...(status.tasks === "done" ? [["out", "All outcomes", (r) => r.outcome]] : [])],
    stuck: [["why", "All reasons", (r) => r.reason], ["src", "All lead sources", (r) => r.source], ["ls", "All lead statuses", lsOf], ["age", "Any age", (r) => AGE(r.since, now)]],
  };
  const keys = FILTERS[tab] || [];
  const statusOK = { dar: (a) => (status.dar === "handled" ? a.handled : !a.handled), tasks: (t) => t.status === status.tasks, stuck: () => true };
  const pool = tab === "dar" ? baseAlerts.filter(statusOK.dar) : tab === "tasks" ? baseTasks.filter(statusOK.tasks) : tab === "stuck" ? baseStuck : [];
  const rows = pool.filter(owned).filter((r) => match(r, keys));
  const sorted = [...rows].sort((a, b) => {
    if (sort === "name") return String(a.name).localeCompare(String(b.name));
    if (sort === "priority") return (b.priority === "High") - (a.priority === "High") || new Date(a.due) - new Date(b.due);
    if (tab === "dar") return new Date(b.at) - new Date(a.at);
    if (tab === "stuck") return new Date(a.since) - new Date(b.since);
    return status.tasks === "done" ? new Date(b.done_at) - new Date(a.done_at) : new Date(a.due) - new Date(b.due);
  });
  const boardAlerts = alertRows.filter((a) => !a.handled).reduce((m, a) => { if (a.owner_id) m[a.owner_id] = (m[a.owner_id] || 0) + 1; return m; }, {});
  const boardRows = board.filter((p) => !query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const total = tab === "board" ? boardRows.length : sorted.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(page, pages);
  const shown = (tab === "board" ? boardRows : sorted).slice((current - 1) * perPage, current * perPage);
  const counts = { dar: alertRows.filter(inScope).filter((a) => !a.handled).length,
    tasks: taskRows.filter(inScope).filter((t) => ["open", "overdue"].includes(t.status)).length,
    stuck: stuckRows.filter(inScope).length, board: board.length };
  const taskCount = (k) => baseTasks.filter((t) => t.status === k).length;
  const scopes = !me || me.role === "admin" ? [["mine", "Mine", "customer"], ["team", "Team", "team"], ["all", "Everyone", "customers"]]
    : me.role === "manager" ? [["mine", "Mine", "customer"], ["team", "My team", "team"], ["all", "All my department", "department"]]
      : [["mine", "Mine", "customer"]];
  useEffect(() => { if (me?.role === "staff") setScope("mine"); }, [me?.role]);

  // The tab lives in the URL (Back works); no server round trip is needed to change it.
  const showTab = (key) => window.history.pushState(null, "", `/dealer/ai/actions?tab=${key}`);
  const pickTab = (key) => { setSort(""); setOwnerF(""); showTab(key); };
  const openFromBoard = (id, key, st) => {
    setScope("all"); setOwnerF(id); if (st) setStatus((s) => ({ ...s, tasks: st })); setSort("");
    showTab(key);
  };
  const done = (message) => { setSuccess(message); setEditing(null); setFixing(null); setDismissing(null); load({ silent: true }); };
  const markHandled = async (item) => {
    setBusy(item.id); setError("");
    try {
      await aiFetch("/api/dealer-ai/alerts/handled", { method: "POST", body: JSON.stringify({ lead_id: item.lead_id, source: item.source }) });
      window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT));
      done("Marked handled.");
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const finishReminder = async (t) => {
    setBusy(t.key); setError("");
    try {
      await aiFetch(`/api/leads/${t.lead_id}/opportunity`, { method: "POST", body: JSON.stringify({ action: "reminder_done", reminder_id: t.id }) });
      done("Task done.");
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const undismissReminder = async (t) => {
    setError("");
    try {
      await aiFetch(`/api/leads/${t.lead_id}/opportunity`, { method: "POST", body: JSON.stringify({ action: "reminder_undismiss", reminder_id: t.id }) });
      done("The task is open again.");
    } catch (e) { setError(e.message); }
  };
  const bringBack = async (t) => {
    setError("");
    try {
      await aiFetch(`/api/dealer-ai/call-tasks/${t.id}`, { method: "POST", body: JSON.stringify({ action: "reopen", dealer_id: dealerParent?.id }) });
      done("The call task is open again.");
    } catch (e) { setError(e.message); }
  };
  const startCall = (t) => { write(t.raw); setPending(t.raw); const h = telHref(t.phone); if (h) window.location.href = h; };
  const recordOutcome = (t) => { write(t.raw); setPending(t.raw); };
  const clearFilters = () => { setF({}); setOwnerF(""); setQuery(""); setRange({ startDate: null, endDate: null, preset: "all_time" }); };
  const filtered = Object.keys(f).some((k) => k.startsWith(`${tab}.`) && f[k]) || ownerF || query || range.startDate;
  const fixHref = (x) => (x.reason === "Possible duplicate" ? "/dealer/customers/duplicates" : leadHref(x.lead_id));

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="d-flex align-items-center flex-wrap gap-2">
          <h3 className="page_title mb-0 me-auto">Tasks</h3>
          <DashboardDatePicker value={range} onChange={(r) => setRange({ startDate: r?.startDate || null, endDate: r?.endDate || null, preset: r?.preset || "custom" })} timezone={timezone} />
        </div>
      </div>
      <div className="page_body">
        <div className="act_kpis">
          {TABS.map((t) => (
            <button key={t.key} type="button" className={`act_kpi${tab === t.key ? " on" : ""}`} style={{ "--k": iconColor(t.icon) }} onClick={() => pickTab(t.key)} aria-pressed={tab === t.key}>
              <span className="act_kpi_icon"><AppIcon name={t.icon} /></span>
              <span className="act_kpi_text"><span className="fw-semibold">{t.label}</span><b>{counts[t.key]}</b><small>{t.sub}</small></span>
            </button>
          ))}
        </div>
        {problems.length > 0 && <Alert variant="warning" className="py-2 small">Could not load: {problems.join(", ")}. The rest of the page is current.</Alert>}
        {error && <Alert variant="danger" className="py-2" dismissible onClose={() => setError("")}>{error}</Alert>}
        {success && <Alert variant="success" className="py-2" dismissible onClose={() => setSuccess("")}>{success}</Alert>}
        {stuck.capped && tab === "stuck" && <Alert variant="info" className="py-2 small">Showing the newest 1,500 open leads from the last 90 days.</Alert>}

        {tab !== "board" && (
          <div className="w_card act_bar">
            <ButtonGroup size="sm">
              {scopes.map(([k, label, icon]) => <Button key={k} variant={scope === k ? "custom" : "outline-custom"} onClick={() => setScope(k)}><AppIcon name={icon} plain className="me-1" />{label}</Button>)}
            </ButtonGroup>
            <ButtonGroup size="sm" aria-label="Department">
              {DEPT_BUTTONS.map(([k, label, icon]) => (
                <Button key={k || "all"} variant={dept === k ? "custom" : "outline-custom"} onClick={() => setDept(k)}>
                  <i className={`fa-regular ${icon} me-1`} aria-hidden="true" />{label} ({deptCount(k)})
                </Button>
              ))}
            </ButtonGroup>
            {me?.role !== "staff" && (
              <Form.Select size="sm" className="act_filter" aria-label="Owner" value={ownerF} onChange={(e) => setOwnerF(e.target.value)}>
                <option value="">All owners</option><option value="none">No owner</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Form.Select>
            )}
            <Form.Control size="sm" className="act_search" placeholder="Search name, phone, vehicle or text" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button size="sm" variant="outline-custom" className="act_more" aria-expanded={moreFilters} onClick={() => setMoreFilters(!moreFilters)}>
              <i className="fa-solid fa-sliders me-1" aria-hidden="true" />{moreFilters ? "Hide filters" : "Filters"}
            </Button>
            <div className={`act_folded${moreFilters ? " open" : ""}`}>
            {tab === "tasks" && (
              <Form.Select size="sm" className="act_filter act_status" aria-label="Status" value={status.tasks} onChange={(e) => setStatus({ ...status, tasks: e.target.value })}>
                {TASK_STATUS.map(([k, label]) => <option key={k} value={k}>Status: {label} ({taskCount(k)})</option>)}
              </Form.Select>
            )}
            {tab === "dar" && (
              <Form.Select size="sm" className="act_filter act_status" aria-label="Status" value={status.dar} onChange={(e) => setStatus({ ...status, dar: e.target.value })}>
                <option value="open">Status: Open ({baseAlerts.filter((a) => !a.handled).length})</option>
                <option value="handled">Status: Handled ({baseAlerts.filter((a) => a.handled).length})</option>
              </Form.Select>
            )}
            {keys.map(([k, label, get]) => (
              <Select key={k} label={label} value={f[`${tab}.${k}`]} onChange={(v) => setF({ ...f, [`${tab}.${k}`]: v })}
                options={[...new Set([...(FIXED_OPTIONS[tab]?.[k] || []), ...pool.map(get).filter(Boolean)])].sort()} />
            ))}
            {filtered && <Button size="sm" variant="link" onClick={clearFilters}>Clear filters</Button>}
            </div>
          </div>
        )}

        <div className="w_card">
          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
            <small className="text-muted me-auto">{total.toLocaleString()} {tab === "dar" ? (total === 1 ? "alert" : "alerts") : tab === "tasks" ? (total === 1 ? "task" : "tasks") : tab === "stuck" ? (total === 1 ? "stuck lead" : "stuck leads") : (total === 1 ? "person" : "people")}</small>
            {tab !== "board" && (
              <Form.Select size="sm" className="act_filter" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="">{tab === "dar" ? "Sort: Newest first" : tab === "stuck" ? "Sort: Longest stuck first" : "Sort: Due first"}</option>
                {tab === "tasks" && <option value="priority">Sort: Priority</option>}
                <option value="name">Sort: Customer</option>
              </Form.Select>
            )}
            <Form.Select size="sm" className="act_per" aria-label="Rows per page" value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </Form.Select>
          </div>
          {loading ? <div className="text-center py-5"><Spinner animation="border" variant="dark" /></div>
            : !shown.length ? <p className="text-muted text-center py-4 mb-0">{tab === "board" ? "Nobody to show." : "Nothing matches these filters."}</p> : (
            <div className={`table-responsive act_table${phone ? " act_cards" : ""}`}>
              <Table hover size="sm" className="mb-0 align-middle">
                {tab === "dar" && <>
                  <thead><tr><th><IconLabel name="type">Type</IconLabel></th><th><IconLabel name="customer">Customer</IconLabel></th><th><IconLabel name="info">What is needed</IconLabel></th><th><IconLabel name="status">Lead status</IconLabel></th><th><IconLabel name="source">Source</IconLabel></th><th><IconLabel name="owner">Owner</IconLabel></th><th><IconLabel name="time">Raised</IconLabel></th><th><IconLabel name="status">Status</IconLabel></th><th /></tr></thead>
                  <tbody>{shown.map((a) => { const k = alertKind(a.kind); return (
                    <tr key={a.id}>
                      <td><Badge bg={k.variant} className="act_badge"><i className={`fa-solid ${k.icon}`} aria-hidden="true" />{k.label}</Badge>{a.escalated && <div className="mt-1"><Badge bg="danger" className="act_badge"><AppIcon name="escalated" plain />Escalated</Badge></div>}</td>
                      <td><Customer name={a.name} vehicle={a.vehicle} href={personHref(a.lead?.customer_id, a.lead_id)} /></td>
                      <td className="act_wide small">{a.text}</td><td><LeadStatus status={a.lead_status} /></td><td><Source value={a.source} /></td>
                      <td><Person name={a.owner} /></td><td><When at={a.at} /></td>
                      <td>{a.handled ? <><Badge bg="success" className="act_badge"><AppIcon name="done" plain />Handled</Badge><small className="d-block text-muted">{a.handled_by || "staff"} {fromNow(a.handled_at)}</small></> : <Badge bg="warning" text="dark" className="act_badge"><AppIcon name="open" plain />Open</Badge>}</td>
                      <td className="act_row_btns"><Icon title="AI details" name="ai" variant="outline-secondary" onClick={() => setDrawer({ ...a, customer_name: a.name })} />
                        <Button as={Link} size="sm" variant="outline-custom" className="act_btn" title="Open lead" aria-label="Open lead" href={leadHref(a.lead_id)}><i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" /></Button>
                        {!a.handled && <Icon title="Mark handled" name="done" variant="custom" disabled={busy === a.id} onClick={() => markHandled(a)} />}</td>
                    </tr>); })}</tbody>
                </>}
                {tab === "tasks" && ["done", "missed", "cancelled"].includes(status.tasks) && <>
                  <thead><tr><th><IconLabel name={status.tasks === "done" ? "done" : "overdue"}>{status.tasks === "done" ? "Completed" : status.tasks === "missed" ? "Was due" : "Closed"}</IconLabel></th><th><IconLabel name="customer">Customer</IconLabel></th><th><IconLabel name="task">Task</IconLabel></th><th><IconLabel name="outcome">{status.tasks === "done" ? "Outcome" : status.tasks === "missed" ? "Why missed" : "Why closed"}</IconLabel></th><th><IconLabel name="done">{status.tasks === "done" ? "Completed by" : "Closed by"}</IconLabel></th><th><IconLabel name="owner">Owner</IconLabel></th><th><IconLabel name="ai">Made by</IconLabel></th><th><IconLabel name="note">Note</IconLabel></th><th /></tr></thead>
                  <tbody>{shown.map((t) => (
                    <tr key={t.key}>
                      <td><When at={status.tasks === "missed" ? t.due : t.done_at} name={status.tasks === "done" ? "done" : "overdue"} /></td>
                      <td><Customer name={t.name} vehicle={t.vehicle} href={personHref(t.customer_id, t.lead_id)} /></td>
                      <td className="act_wide"><span className="ap_label"><AppIcon name={t.kind === "call" ? "phone" : "note"} />{t.why}</span></td>
                      <td>{status.tasks === "done" ? <Badge bg="success" className="act_badge"><AppIcon name="done" plain />{t.outcome || "Completed"}</Badge> : <span className="ap_label"><AppIcon name="info" />{t.raw.closed_reason || (status.tasks === "missed" ? "Not called in time" : t.raw.status === "dismissed" || t.dismissed ? "Dismissed" : "No longer needed")}</span>}</td>
                      <td><Person name={t.done_by || (status.tasks === "cancelled" ? "AI" : null)} /></td><td><Person name={t.owner} /></td>
                      <td><span className="ap_label"><AppIcon name={t.made === "AI" ? "ai" : "staff"} />{t.made}</span></td>
                      <td className="act_wide small">{t.note ? <span className="ap_label"><AppIcon name="note" />{t.note}</span> : <span className="text-muted">-</span>}</td>
                      <td className="act_row_btns">
                        {t.kind === "call" && t.status === "missed" && <Icon title="Record late call" name="outcome" onClick={() => recordOutcome(t)} />}
                        {canDismiss && t.kind === "call" && t.raw.status === "dismissed" && <Icon title="Undo dismiss" name="history" onClick={() => bringBack(t)} />}
                        {canDismiss && t.kind === "reminder" && t.dismissed && <Icon title="Undo dismiss" name="history" onClick={() => undismissReminder(t)} />}
                        <Button as={Link} size="sm" variant="outline-custom" className="act_btn" title="Open lead" aria-label="Open lead" href={leadHref(t.lead_id)}><i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" /></Button>
                      </td>
                    </tr>))}</tbody>
                </>}
                {tab === "tasks" && !["done", "missed", "cancelled"].includes(status.tasks) && <>
                  <thead><tr><th><IconLabel name="status">Status</IconLabel></th><th><IconLabel name="priority">Priority</IconLabel></th><th><IconLabel name="date">Due</IconLabel></th><th><IconLabel name="customer">Customer</IconLabel></th><th><IconLabel name="phone">Phone</IconLabel></th><th><IconLabel name="task">Task</IconLabel></th><th><IconLabel name="status">Lead status</IconLabel></th><th><IconLabel name="owner">Owner</IconLabel></th><th><IconLabel name="ai">Made by</IconLabel></th><th /></tr></thead>
                  <tbody>{shown.map((t) => { const m = STATUS_META[t.status]; return (
                    <tr key={t.key}>
                      <td><Badge bg={m.bg} className="act_badge"><AppIcon name={m.icon} plain />{m.label}</Badge>{t.escalated && <div className="mt-1"><Badge bg="danger" className="act_badge"><AppIcon name="escalated" plain />Escalated</Badge></div>}</td>
                      <td><Priority value={t.priority} /></td><td><When at={t.due} /></td>
                      <td><Customer name={t.name} vehicle={t.vehicle} href={personHref(t.customer_id, t.lead_id)} /></td><td><Phone value={t.phone} /></td>
                      <td className="act_wide"><span className="ap_label"><AppIcon name={t.kind === "call" ? "phone" : "note"} />{t.why}</span>{t.note && <small className="d-block text-muted">{t.note}</small>}</td>
                      <td><LeadStatus status={t.lead_status} /></td><td><Person name={t.owner} /></td>
                      <td><span className="ap_label"><AppIcon name={t.made === "AI" ? "ai" : "staff"} />{t.made}</span></td>
                      <td className="act_row_btns">
                        {t.kind === "call" && ["open", "overdue"].includes(t.status) && <><Icon title="Call" name="phone" variant="custom" disabled={!telHref(t.phone)} onClick={() => startCall(t)} /><Icon title="Record outcome" name="outcome" onClick={() => recordOutcome(t)} /></>}
                        {t.kind === "call" && t.status === "missed" && <Icon title="Record late call" name="outcome" onClick={() => recordOutcome(t)} />}
                        {canDismiss && t.kind === "call" && t.raw.status === "dismissed" && <Icon title="Undo dismiss" name="history" onClick={() => bringBack(t)} />}
                        {canDismiss && t.kind === "reminder" && t.dismissed && <Icon title="Undo dismiss" name="history" onClick={() => undismissReminder(t)} />}
                        {t.kind === "reminder" && t.status !== "done" && <><Icon title="Mark done" name="done" variant="custom" disabled={busy === t.key} onClick={() => finishReminder(t)} /><Icon title="Reschedule, reassign or escalate" name="date" onClick={() => setEditing(t)} />{canDismiss && <Icon title="Dismiss (close without doing it)" name="cancelled" onClick={() => setDismissing(t)} />}</>}
                        <Button as={Link} size="sm" variant="outline-custom" className="act_btn" title="Open lead" aria-label="Open lead" href={leadHref(t.lead_id)}><i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" /></Button>
                      </td>
                    </tr>); })}</tbody>
                </>}
                {tab === "stuck" && <>
                  <thead><tr><th><IconLabel name="type">Reason</IconLabel></th><th><IconLabel name="customer">Customer</IconLabel></th><th><IconLabel name="info">Why it is stuck</IconLabel></th><th><IconLabel name="status">Lead status</IconLabel></th><th><IconLabel name="source">Source</IconLabel></th><th><IconLabel name="department">Department</IconLabel></th><th><IconLabel name="owner">Owner</IconLabel></th><th><IconLabel name="age">Since</IconLabel></th><th /></tr></thead>
                  <tbody>{shown.map((x) => (
                    <tr key={x.id}>
                      <td><Badge bg={REASON_BG[x.reason]} text={["warning", "info"].includes(REASON_BG[x.reason]) ? "dark" : undefined} className="act_badge"><AppIcon name={REASON_ICON[x.reason]} plain />{x.reason}</Badge></td>
                      <td><Customer name={x.name} vehicle={x.vehicle} href={personHref(x.customer_id, x.lead_id)} /></td><td className="act_wide small">{x.detail}</td>
                      <td><LeadStatus status={x.lead_status} /></td><td><Source value={x.source} /></td>
                      <td><span className="ap_label"><AppIcon name="department" />{deptOf(x)}</span></td><td><Person name={x.owner} /></td><td><When at={x.since} name="age" /></td>
                      <td className="act_row_btns">
                        {x.fix === "Assign" || x.fix === "Add task"
                          ? <Button size="sm" variant="custom" className="act_btn" title={x.fix} aria-label={x.fix} onClick={() => setFixing(x)}><i className={`fa-solid ${FIX_ICON[x.fix]}`} aria-hidden="true" /></Button>
                          : <Button as={Link} size="sm" variant="custom" className="act_btn" title={x.fix} aria-label={x.fix} href={fixHref(x)}><i className={`fa-solid ${FIX_ICON[x.fix]}`} aria-hidden="true" /></Button>}
                        {x.fix !== "Open lead" && <Button as={Link} size="sm" variant="outline-custom" className="act_btn" title="Open lead" aria-label="Open lead" href={leadHref(x.lead_id)}><i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" /></Button>}
                      </td>
                    </tr>))}</tbody>
                </>}
                {tab === "board" && <>
                  <thead><tr><th><IconLabel name="customer">Person</IconLabel></th><th><IconLabel name="role">Role</IconLabel></th><th><IconLabel name="department">Department</IconLabel></th><th><IconLabel name="action">Needs a person</IconLabel></th><th><IconLabel name="phone">Calls to make</IconLabel></th><th><IconLabel name="overdue">Overdue</IconLabel></th><th><IconLabel name="missed">Missed</IconLabel></th><th><IconLabel name="stuck">Stuck leads</IconLabel></th><th><IconLabel name="history">Last action</IconLabel></th></tr></thead>
                  <tbody>{shown.map((p) => (
                    <tr key={p.id}>
                      <td><div className="ap_person"><Avatar name={p.name} /><b>{p.name}</b></div></td><td><span className="ap_label"><AppIcon name="role" />{p.role}</span></td><td><span className="ap_label"><AppIcon name="department" />{p.department}</span></td>
                      <td><button type="button" className="act_num" onClick={() => openFromBoard(p.id, "dar")}>{boardAlerts[p.id] || 0}</button></td>
                      <td><button type="button" className="act_num" onClick={() => openFromBoard(p.id, "tasks", "open")}>{p.calls}</button></td>
                      <td><button type="button" className="act_num" onClick={() => openFromBoard(p.id, "tasks", "overdue")}>{p.overdue}</button></td>
                      <td><button type="button" className="act_num" onClick={() => openFromBoard(p.id, "tasks", "missed")}>{p.missed}</button></td>
                      <td><button type="button" className="act_num" onClick={() => openFromBoard(p.id, "stuck")}>{p.stuck}</button></td>
                      <td className="small text-muted text-nowrap">{p.last_action ? fromNow(p.last_action) : "None in 30 days"}</td>
                    </tr>))}</tbody>
                </>}
              </Table>
            </div>
          )}
          <GoToPage page={current} pages={pages} onPage={setPage} />
        </div>
      </div>
      <ReminderModal item={editing} staff={staff} onHide={() => setEditing(null)} onSaved={done} />
      <FixModal item={fixing} staff={staff} dealerId={dealerParent?.id} onHide={() => setFixing(null)} onSaved={done} />
      <CallOutcomeModal show={Boolean(pending)} task={pending} dealerId={dealerParent?.id}
        onDone={() => { const n = pending?.customer_name || "the customer"; write(null); setPending(null); done(`Saved the call outcome for ${n}.`); }}
        onNotCalled={() => { write(null); setPending(null); }} />
      <DismissTaskModal task={dismissing} dealerId={dealerParent?.id} onHide={() => setDismissing(null)}
        onDone={() => done("Task dismissed.")} />
      <LeadAiDrawer show={Boolean(drawer)} onHide={() => setDrawer(null)} leadId={drawer?.lead_id} customerId={drawer?.customer_id} title={drawer?.customer_name || "Lead"} />
    </div>
  );
}

export default function ActionsPage() {
  return (
    <Suspense fallback={<div className="page_content"><div className="text-center py-5"><Spinner animation="border" variant="dark" /></div></div>}>
      <ActionsContent />
    </Suspense>
  );
}
