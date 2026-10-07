"use client";
// Call Tasks: the calls the AI asks staff to make (a text and email went out over
// an hour ago with no reply). Click-to-call opens the phone; after the call staff
// must record the outcome (CallOutcomeModal) before the task closes.
//   /dealer/ai/call-tasks            calls to make now
//   /dealer/ai/call-tasks?view=upcoming   timers still waiting for a reply
//   /dealer/ai/call-tasks?view=done       finished tasks

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Badge, Button, Nav, Spinner, Table } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import CallOutcomeModal from "../components/CallOutcomeModal";
import LeadAiDrawer from "../components/LeadAiDrawer";
import { aiFetch, callOutcomeLabel, formatDateTime, fromNow, stageVariant, telHref } from "../components/aiShared";

const VIEWS = [
  { key: "open", label: "To call now", icon: "fa-phone" },
  { key: "upcoming", label: "Waiting for a reply", icon: "fa-hourglass-half" },
  { key: "done", label: "Done", icon: "fa-check" },
];
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
      <strong>{task.customer_name || "Unknown customer"}</strong>
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

  const [tasks, setTasks] = useState([]);
  const [missed, setMissed] = useState(null); // stream T: per-agent missed counts (Done tab)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, setPending] = useState(null); // task whose outcome must be recorded
  const [drawer, setDrawer] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await aiFetch(`/api/dealer-ai/call-tasks?view=${view}`);
      setTasks(data.tasks || []);
      setMissed(data.missed_by_agent || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [view]);

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
        {view === "done" && <MissedCounts missed={missed} />}

        <div className="w_card">
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
          ) : !tasks.length ? (
            <p className="text-secondary-light text-center py-4 mb-0">
              {view === "open" ? "No calls to make right now." : view === "upcoming" ? "Nothing waiting." : "No finished call tasks yet."}
            </p>
          ) : (
            <div className="table-responsive">
              <Table bordered hover className="mb-0 align-middle">
                <thead className="table-light">
                  {view === "done" ? (
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
                  {tasks.map((task) => view === "done" ? (
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
                        <Button size="sm" variant="outline-secondary" onClick={() => setDrawer(task)}>AI details</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
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
