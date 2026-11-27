"use client";
// Open tasks at the top of the customer's profile (17 Nov 2026, BB's DealerSocket video: the appointment to confirm
// and the follow-up, each with who it is assigned to). From app/lib/customerTasks.js via the profile's data. Each row
// opens where it is worked: a call task on Call Tasks, an appointment on Appointments, the AI's message on the lead.
import { useState } from "react";
import Link from "next/link";
import { useCan } from "../../../../hooks/PermissionsContext";
import DismissTaskModal, { DISMISS_TASKS } from "../../../components/DismissTaskModal";
import AddTaskModal from "../../../components/AddTaskModal";
import { formatTimestamp } from "../../../../utils/dateUtils";
import AppIcon from "../../../components/AppIcon";
import CallOutcomeModal from "../../../ai/components/CallOutcomeModal";
import { aiFetch } from "../../../ai/components/aiShared";

const KIND = {
  call: { icon: "phone", href: (t) => `/dealer/ai/actions?tab=tasks${t.missed ? "&status=missed" : ""}` },
  appt: { icon: "appointment", href: () => "/dealer/booking" },
  followup: { icon: "ai", href: (t) => `/dealer/leads?lead=${t.lead_id}` },
  reminder: { icon: "task", href: (t) => `/dealer/leads?lead=${t.lead_id}` },
};

// dealerId / onChanged: for Dismiss (only people whose role has "Dismiss Tasks"); the profile reloads after it.
// Complete (Bibi, 26 Nov 2026: "I'm seeing the task but no where for me to complete it"): a call task records the call's
// outcome (the same prompt as Tasks / Call Tasks, which closes the task); a reminder is marked done. Shown where the
// profile can reload after it (onChanged).
export default function OpenTasks({ tasks, dealerId, onChanged, leads = [], staffList = [], customerName = "" }) {
  const canDismiss = useCan(DISMISS_TASKS);
  const [dismissing, setDismissing] = useState(null);
  const [calling, setCalling] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const complete = async (t) => {
    setError("");
    if (t.kind === "call") {
      setCalling({ id: t.id, lead_id: t.lead_id, phone: t.phone || "", customer_name: customerName, dealer_id: dealerId });
      return;
    }
    setBusy(t.id);
    try {
      await aiFetch(`/api/leads/${t.lead_id}/opportunity`, { method: "POST", body: JSON.stringify({ action: "reminder_done", reminder_id: t.id }) });
      onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const [adding, setAdding] = useState(false);
  const addButton = (
    <button type="button" className="btn btn-sm btn-custom ms-auto text-nowrap" style={{ textTransform: "none" }}
      onClick={() => setAdding(true)}><i className="fa-solid fa-plus me-1" />Add task</button>
  );
  const addModal = <AddTaskModal show={adding} leads={leads} staff={staffList} onHide={() => setAdding(false)}
    onDone={() => { setAdding(false); onChanged?.(); }} />;
  // Always shown, so "no tasks" is a clear answer rather than a missing box (25 Nov 2026).
  if (!tasks?.length) {
    return <div className="cp_card cp_tasks mb-3"><div className="cp_tasks_head"><AppIcon name="task" />Open tasks
      <span className="text-muted small fw-normal ms-2" style={{ textTransform: "none" }}>None - no calls, reminders or appointments waiting</span>
      {addButton}</div>{addModal}</div>;
  }
  return (
    <div className="cp_card cp_tasks mb-3">
      <div className="cp_tasks_head"><AppIcon name="task" />Open tasks <span className="cp_tab_count">{tasks.length}</span>{addButton}</div>
      {error && <div className="alert alert-danger py-1 px-2 small mb-2">{error}</div>}
      <ul className="list-unstyled mb-0">
        {tasks.map((t, i) => {
          const k = KIND[t.kind] || KIND.followup;
          return (
            <li key={`${t.kind}-${t.lead_id}-${i}`} className="cp_task">
              <AppIcon name={k.icon} />
              <span className="me-auto">{t.missed && <span className="badge bg-danger me-1">Missed</span>}{t.text}
                {t.who && <span className="text-muted"> · {t.kind === "call" || t.kind === "reminder" ? "Assigned to " : ""}{t.who}</span>}</span>
              {t.at && <span className="text-muted small text-nowrap">{t.kind === "call" ? (t.missed ? "was due " : "due ") : ""}{formatTimestamp(t.at)}</span>}
              <Link href={k.href(t)} className="small text-nowrap">Open</Link>
              {onChanged && t.id && (t.kind === "call" || t.kind === "reminder") && (
                <button type="button" className="btn btn-sm btn-success py-0 px-2 small text-nowrap" disabled={busy === t.id}
                  onClick={() => complete(t)} title={t.kind === "call" ? "Record how the call went; this completes the task" : "Mark this reminder done"}>
                  <i className="fa-solid fa-check me-1" />{t.kind === "call" ? "Complete call" : "Done"}</button>
              )}
              {canDismiss && t.id && (t.kind === "call" || t.kind === "reminder") && (
                <button type="button" className="btn btn-link btn-sm p-0 small text-danger text-nowrap" onClick={() => setDismissing(t)}
                  title="Close this task without doing it">Dismiss</button>
              )}
            </li>
          );
        })}
      </ul>
      {addModal}
      <DismissTaskModal task={dismissing} dealerId={dealerId} onHide={() => setDismissing(null)}
        onDone={() => { setDismissing(null); onChanged?.(); }} />
      <CallOutcomeModal show={Boolean(calling)} task={calling} dealerId={dealerId}
        onDone={() => { setCalling(null); onChanged?.(); }} onNotCalled={() => setCalling(null)} />
    </div>
  );
}
