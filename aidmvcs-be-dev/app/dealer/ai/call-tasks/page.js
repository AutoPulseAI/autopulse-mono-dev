"use client";
// Call Tasks: the calls the AI asks staff to make (a text and email went out over
// an hour ago with no reply). Click-to-call opens the phone; after the call staff
// must record the outcome (CallOutcomeModal) before the task closes.
//   /dealer/ai/call-tasks                  calls to make now
//   /dealer/ai/call-tasks?view=upcoming     timers still waiting for a reply
//   /dealer/ai/call-tasks?view=done         calls made
//   /dealer/ai/call-tasks?view=missed       not called by the end of their window
//   /dealer/ai/call-tasks?view=cancelled    no longer needed (the customer replied, staff took over...) or dismissed
// Betsy, 2 Nov 2026 meeting: "done is supposed to be when it's complete, not when it's missed or dismissed"; a
// calendar to pick a day and see how many there were and how many were missed; filters; "open lead" on the row.

import Link from "next/link";
import moment from "moment-timezone";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Badge, Button, Form, Nav, Pagination, Spinner, Table } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import CallOutcomeModal from "../components/CallOutcomeModal";
import LeadAiDrawer from "../components/LeadAiDrawer";
import { aiFetch, callOutcomeLabel, formatDateTime, fromNow, leadHref, stageVariant, telHref } from "../components/aiShared";

const VIEWS = [
  { key: "open", label: "To call now", icon: "fa-phone" },
  { key: "upcoming", label: "Waiting for a reply", icon: "fa-hourglass-half" },
  { key: "done", label: "Done", icon: "fa-check" },
  { key: "missed", label: "Missed", icon: "fa-circle-exclamation" },
  { key: "cancelled", label: "No longer needed", icon: "fa-ban" },
];
const FINISHED = new Set(["done", "missed", "cancelled"]);
const REASONS = [
  { key: "", label: "All reasons" },
  { key: "requested", label: "Customer asked for a call" },
  { key: "daily", label: "New lead (Days 1-7)" },
  { key: "no_reply", label: "No reply to a text or email" },
];
const reasonOf = (task) => (task.requested ? "requested" : task.source === "daily" ? "daily" : "no_reply");
const DONE_STATUS = {
  completed: { label: "Called", variant: "success" },
  dismissed: { label: "Dismissed", variant: "secondary" },
  cancelled: { label: "No longer needed", variant: "light" },
  // Stream T: not completed by the end of its window (or of the agent's day).
  missed: { label: "Missed", variant: "danger" },
};
const SLOT_LABELS = { morning: "Morning", afternoon: "Afternoon" };

// Stream T: the Days 1-7 morning / afternoon call task, or the customer's own request.
function WhyCell({ task }) {
  return (
    <td style={{ maxWidth: 260 }}>
      {task.requested && (
        <Badge bg="primary" className="d-inline-block mb-1">
          <i className="fa-solid fa-user me-1" />Customer asked for a call
        </Badge>
      )}
      {task.source === "daily" && (
        <Badge bg="info" text="dark" className="d-inline-block mb-1">
          Day {task.day} {(SLOT_LABELS[task.slot] || task.slot || "").toLowerCase()} call
        </Badge>
      )}
      <small className="d-block">{task.reason}</small>
    </td>
  );
}

function MissedCounts({ missed }) {
  if (!missed) return null;
  return (
    <div className="w_card">
      <h3 className="w_card_title mb-0">Missed call tasks</h3>
      <p className="text-secondary-light small">
        Call tasks not completed by the end of their window, last {missed.days} days, by assigned salesperson.
      </p>
      {!missed.agents.length ? (
        <p className="text-secondary-light mb-0">None missed.</p>
      ) : (
        <Table bordered size="sm" className="mb-0" style={{ maxWidth: 420 }}>
          <tbody>
            {missed.agents.map((row) => (
              <tr key={row.agent_id || "none"}>
                <td>{row.agent}</td>
                <td className="text-end" style={{ width: 80 }}><Badge bg="danger">{row.missed}</Badge></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
// Calls started from this browser whose outcome isn't recorded yet survive a reload.
const PENDING_KEY = "aiPendingCallTask";
const REFRESH_MS = 60_000;

function readPending() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
  } catch {
    return null;
  }
}
function writePending(task) {
  try {
    if (task) localStorage.setItem(PENDING_KEY, JSON.stringify(task));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // storage unavailable: the prompt still opens, it just won't survive a reload
  }
}

function CustomerCell({ task }) {
  return (
    <>
      {/* Betsy, 2 Nov 2026 meeting: "this customer's details were not provided" - the phone when there's no name. */}
      <strong>{task.customer_name || task.lead?.name || task.phone || "Unknown customer"}</strong>
      {task.vehicle && <small className="d-block text-secondary-light">{task.vehicle}</small>}
    </>
  );
}

function StageCell({ task }) {
  if (!task.stage_label) return <span className="text-secondary-light">-</span>;
  return <Badge bg={stageVariant(task.stage)}>{task.stage_label}</Badge>;
}

function CallTasksContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = VIEWS.some((v) => v.key === searchParams.get("view")) ? searchParams.get("view") : "open";
  const { dealerParent } = useUser();
  const dealerTimezone = dealerParent?.dealer_account_information?.time_zone || "America/New_York";
  const tzOffset = moment.tz(dealerTimezone).utcOffset();
  const [dateFrom, setDateFrom] = useState(searchParams.get("from") || "");
  const [dateTo, setDateTo] = useState(searchParams.get("to") || "");
  const [stage, setStage] = useState("");
  const [reason, setReason] = useState("");
  const [byDay, setByDay] = useState([]);

  const [tasks, setTasks] = useState([]);
  const [missed, setMissed] = useState(null); // stream T: per-agent missed counts (Done tab)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState(null); // task whose outcome must be recorded
  const [drawer, setDrawer] = useState(null);
  // Client, 10 Oct 2026: a long list needs search and pages.
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ view, tz_offset_minutes: String(tzOffset) });
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const [data, days] = await Promise.all([
        aiFetch(`/api/dealer-ai/call-tasks?${params.toString()}`),
        aiFetch(`/api/dealer-ai/call-tasks/by-day?days=14&tz_offset_minutes=${tzOffset}`).catch(() => ({ days: [] })),
      ]);
      setTasks(data.tasks || []);
      setMissed(data.missed_by_agent || null);
      setByDay(days.days || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [view, dateFrom, dateTo, tzOffset]);

  const needle = query.trim().toLowerCase();
  const stages = [...new Set(tasks.map((t) => t.stage_label).filter(Boolean))].sort();
  const filtered = tasks.filter((t) => (!needle || [t.name, t.customer_name, t.lead?.name, t.phone, t.email, t.vehicle,
    t.reason, t.why, t.outcome, t.notes].some((v) => String(v || "").toLowerCase().includes(needle)))
    && (!stage || t.stage_label === stage) && (!reason || reasonOf(t) === reason));
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * perPage, current * perPage);
  useEffect(() => setPage(1), [view, needle, perPage, stage, reason, dateFrom, dateTo]);
  const pickDay = (day) => {
    const same = dateFrom === day && dateTo === day;
    setDateFrom(same ? "" : day);
    setDateTo(same ? "" : day);
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    setPending(readPending());
  }, []);

  const changeView = (key) => {
    const params = new URLSearchParams(searchParams);
    if (key === "open") params.delete("view");
    else params.set("view", key);
    router.push(`/dealer/ai/call-tasks?${params.toString()}`, { scroll: false });
  };

  const startCall = (task) => {
    writePending(task);
    setPending(task);
    const href = telHref(task.phone);
    if (href) window.location.href = href;
  };

  const recordOutcome = (task) => {
    writePending(task);
    setPending(task);
  };

  const finished = () => {
    const name = pending?.customer_name || "the customer";
    writePending(null);
    setPending(null);
    setSuccess(`Saved the call outcome for ${name}.`);
    load();
  };

  const notCalled = () => {
    writePending(null);
    setPending(null);
  };

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center">
              <h3 className="page_title mb-0 me-auto">Call Tasks</h3>
              <Button variant="outline-custom" size="sm" onClick={load} disabled={loading}>
                <i className={`fa-solid fa-rotate-right me-1 ${loading ? "fa-spin" : ""}`} />Refresh
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        <Nav variant="pills" className="mb-2" activeKey={view} onSelect={changeView}>
          {VIEWS.map((v) => (
            <Nav.Item key={v.key}>
              <Nav.Link eventKey={v.key}>
                <i className={`fa-regular ${v.icon} me-2`} />{v.label}
                {v.key === view && !loading && <Badge className="ms-2">{tasks.length}</Badge>}
              </Nav.Link>
            </Nav.Item>
          ))}
        </Nav>

        {error && <Alert variant="danger">{error}</Alert>}
        {success && <Alert variant="success" dismissible onClose={() => setSuccess("")}>{success}</Alert>}
        {view === "missed" && <MissedCounts missed={missed} />}

        {byDay.length > 0 && (
          <div className="d-flex flex-wrap gap-2 mb-2">
            {byDay.map((d) => (
              <Button key={d.day} size="sm" variant={dateFrom === d.day && dateTo === d.day ? "custom" : "outline-secondary"}
                onClick={() => pickDay(d.day)} title={`${d.opened} call tasks: ${d.called} called, ${d.missed} missed, ${d.open} open`}>
                <span className="d-block">{moment(d.day).format("ddd MMM D")}</span>
                <small>{d.opened} · <span className="text-success">{d.called} called</span> · <span className="text-danger">{d.missed} missed</span></small>
              </Button>
            ))}
          </div>
        )}

        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <Form.Control size="sm" style={{ maxWidth: 280 }} placeholder="Search name, phone, vehicle or reason"
            value={query} onChange={(e) => setQuery(e.target.value)} />
          <Form.Control size="sm" type="date" style={{ width: 150 }} value={dateFrom} title="From"
            onChange={(e) => setDateFrom(e.target.value)} />
          <Form.Control size="sm" type="date" style={{ width: 150 }} value={dateTo} title="To"
            onChange={(e) => setDateTo(e.target.value)} />
          <Form.Select size="sm" style={{ width: 170 }} value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">All stages</option>
            {stages.map((s) => <option key={s} value={s}>{s}</option>)}
          </Form.Select>
          <Form.Select size="sm" style={{ width: 210 }} value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </Form.Select>
          {(dateFrom || dateTo || stage || reason || needle) && (
            <Button size="sm" variant="link" onClick={() => { setDateFrom(""); setDateTo(""); setStage(""); setReason(""); setQuery(""); }}>
              Clear filters
            </Button>
          )}
          <small className="text-secondary-light ms-auto">{filtered.length} task{filtered.length === 1 ? "" : "s"}</small>
          <Form.Select size="sm" style={{ width: 100 }} value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}>
            {[10, 25, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </Form.Select>
        </div>

        <div className="w_card mb-5">
          {view === "open" && (
            <p className="text-secondary-light small">
              The AI opens a call task when its text and email got no reply within an hour, and (if turned on in AI
              Settings) a morning and an afternoon call for a new lead&apos;s first seven days. Call the customer,
              then record how it went. A call not recorded by the end of its window is marked missed.
            </p>
          )}
          {view === "upcoming" && (
            <p className="text-secondary-light small">
              A text or email just went out, or the next daily call is coming up. If the customer doesn&apos;t reply
              by the time shown, the call moves to &quot;To call now&quot;. A reply cancels it.
            </p>
          )}

          {loading && !tasks.length ? (
            <div className="text-center py-5"><Spinner animation="border" variant="dark" /></div>
          ) : !filtered.length ? (
            <p className="text-secondary-light text-center py-4 mb-0">
              {needle || stage || reason || dateFrom || dateTo ? "No call tasks match these filters."
                : view === "open" ? "No calls to make right now." : view === "upcoming" ? "Nothing waiting."
                  : view === "done" ? "No calls made yet." : view === "missed" ? "No missed calls."
                    : "Nothing here."}
            </p>
          ) : (
            <div className="table-responsive">
              <Table bordered hover className="mb-0 align-middle">
                <thead className="table-light">
                  {FINISHED.has(view) ? (
                    <tr>
                      <th>Customer</th><th>Result</th><th>Call outcome</th><th>Notes</th><th>By</th><th>When</th><th />
                    </tr>
                  ) : (
                    <tr>
                      <th>Customer</th><th>Phone</th><th>Stage</th><th>Last AI touch</th>
                      <th>{view === "open" ? "Opened" : "Opens"}</th><th>Why</th><th />
                    </tr>
                  )}
                </thead>
                <tbody>
                  {shown.map((task) => FINISHED.has(view) ? (
                    <tr key={task.id}>
                      <td><CustomerCell task={task} /></td>
                      <td>
                        <Badge bg={(DONE_STATUS[task.status] || {}).variant || "secondary"}
                          text={task.status === "cancelled" ? "dark" : undefined}>
                          {(DONE_STATUS[task.status] || {}).label || task.status}
                        </Badge>
                        {task.status === "cancelled" && task.closed_reason && (
                          <small className="d-block text-secondary-light">{task.closed_reason}</small>
                        )}
                        {task.missed_at && (
                          <small className="d-block text-danger">
                            {task.status === "missed" ? "Not called" : "Missed"} by {formatDateTime(task.due_by || task.missed_at)}
                          </small>
                        )}
                      </td>
                      <td>{callOutcomeLabel(task.outcome) || "-"}</td>
                      <td style={{ maxWidth: 320 }}><small>{task.note || "-"}</small></td>
                      <td>
                        {task.closed_by || (task.status === "cancelled" ? "AI" : "-")}
                        {task.status === "missed" && task.assigned_to && (
                          <small className="d-block text-secondary-light">
                            Assigned: {missed?.agents?.find((a) => a.agent_id === task.assigned_to)?.agent || "salesperson"}
                          </small>
                        )}
                      </td>
                      <td className="text-nowrap">{formatDateTime(task.closed_at)}</td>
                      <td className="text-nowrap">
                        {task.status === "missed" && (
                          <Button size="sm" variant="outline-custom" className="me-1" onClick={() => recordOutcome(task)}>
                            Record late call
                          </Button>
                        )}
                        <Button size="sm" variant="outline-custom" className="me-1" as={Link} href={leadHref(task.lead_id)}>
                          Open lead
                        </Button>
                        <Button size="sm" variant="outline-secondary" onClick={() => setDrawer(task)}>AI details</Button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={task.id}>
                      <td><CustomerCell task={task} /></td>
                      <td className="text-nowrap">{task.phone || "-"}</td>
                      <td><StageCell task={task} /></td>
                      <td className="text-nowrap">
                        {task.last_ai_touch_at ? (
                          <span title={formatDateTime(task.last_ai_touch_at)}>{fromNow(task.last_ai_touch_at)}</span>
                        ) : "-"}
                      </td>
                      <td className="text-nowrap">
                        {view === "open"
                          ? <span title={formatDateTime(task.opened_at)}>{fromNow(task.opened_at)}</span>
                          : <span title={formatDateTime(task.due_at)}>{fromNow(task.due_at)}</span>}
                      </td>
                      <WhyCell task={task} />
                      <td className="text-nowrap">
                        {view === "open" && (
                          <>
                            <Button size="sm" variant="custom" className="me-1" disabled={!telHref(task.phone)}
                              onClick={() => startCall(task)}>
                              <i className="fa-solid fa-phone me-1" />Call
                            </Button>
                            <Button size="sm" variant="outline-custom" className="me-1" onClick={() => recordOutcome(task)}>
                              Record outcome
                            </Button>
                          </>
                        )}
                        <Button size="sm" variant="outline-custom" className="me-1" as={Link} href={leadHref(task.lead_id)}>
                          Open lead
                        </Button>
                        <Button size="sm" variant="outline-secondary" onClick={() => setDrawer(task)}>AI details</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {pages > 1 && (
                <Pagination size="sm" className="justify-content-center mt-3 mb-4 pb-2">
                  <Pagination.Prev disabled={current === 1} onClick={() => setPage(current - 1)} />
                  {Array.from({ length: pages }, (_, i) => i + 1)
                    .filter((n) => n === 1 || n === pages || Math.abs(n - current) <= 2)
                    .map((n, i, arr) => (
                      <span key={n} className="d-flex">
                        {i > 0 && n - arr[i - 1] > 1 && <Pagination.Ellipsis disabled />}
                        <Pagination.Item active={n === current} onClick={() => setPage(n)}>{n}</Pagination.Item>
                      </span>
                    ))}
                  <Pagination.Next disabled={current === pages} onClick={() => setPage(current + 1)} />
                </Pagination>
              )}
            </div>
          )}
        </div>
      </div>

      <CallOutcomeModal
        show={Boolean(pending)}
        task={pending}
        dealerId={dealerParent?.id}
        onDone={finished}
        onNotCalled={notCalled}
      />
      <LeadAiDrawer
        show={Boolean(drawer)}
        onHide={() => setDrawer(null)}
        leadId={drawer?.lead_id}
        customerId={drawer?.customer_id}
        title={drawer?.customer_name || "Lead"}
      />
    </div>
  );
}

export default function CallTasksPage() {
  return (
    <Suspense fallback={
      <div className="page_content">
        <div className="d-flex justify-content-center align-items-center" style={{ height: "300px" }}>
          <div className="spinner-border text-dark" role="status"><span className="visually-hidden">Loading...</span></div>
        </div>
      </div>
    }>
      <CallTasksContent />
    </Suspense>
  );
}
