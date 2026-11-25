"use client";
// Open tasks at the top of the customer's profile (17 Nov 2026, BB's DealerSocket video: the appointment to confirm
// and the follow-up, each with who it is assigned to). From app/lib/customerTasks.js via the profile's data. Each row
// opens where it is worked: a call task on Call Tasks, an appointment on Appointments, the AI's message on the lead.
import { useState } from "react";
import Link from "next/link";
import { useCan } from "../../../../hooks/PermissionsContext";
import DismissTaskModal, { DISMISS_TASKS } from "../../../components/DismissTaskModal";
import AddTaskModal from "../../../components/AddTaskModal";
import { aiFetch } from "../../../ai/components/aiShared";
import { formatTimestamp } from "../../../../utils/dateUtils";
import AppIcon from "../../../components/AppIcon";

const KIND = {
  call: { icon: "phone", href: (t) => `/dealer/ai/actions?tab=tasks${t.missed ? "&status=missed" : ""}` },
  appt: { icon: "appointment", href: () => "/dealer/booking" },
  followup: { icon: "ai", href: (t) => `/dealer/leads?lead=${t.lead_id}` },
  reminder: { icon: "task", href: (t) => `/dealer/leads?lead=${t.lead_id}` },
};

// dealerId / onChanged: for Dismiss (only people whose role has "Dismiss Tasks"); the profile reloads after it.
export default function OpenTasks({ tasks, dealerId, onChanged, leads = [], staffList = [] }) {
  const canDismiss = useCan(DISMISS_TASKS);
  const [dismissing, setDismissing] = useState(null);
  const [adding, setAdding] = useState(false);
  const markDone = async (t) => {
    try {
      await aiFetch(`/api/leads/${t.lead_id}/opportunity`, { method: "POST", body: JSON.stringify({ action: "reminder_done", reminder_id: t.id }) });
      onChanged?.();
    } catch (e) { window.alert(e.message); }
  };
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
              {t.kind === "reminder" && t.id && (
                <button type="button" className="btn btn-link btn-sm p-0 small text-nowrap" onClick={() => markDone(t)}>Done</button>
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
    </div>
  );
}
