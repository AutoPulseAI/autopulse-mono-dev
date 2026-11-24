"use client";
// Open tasks at the top of the customer's profile (17 Nov 2026, BB's DealerSocket video: the appointment to confirm
// and the follow-up, each with who it is assigned to). From app/lib/customerTasks.js via the profile's data. Each row
// opens where it is worked: a call task on Call Tasks, an appointment on Appointments, the AI's message on the lead.
import Link from "next/link";
import { formatTimestamp } from "../../../../utils/dateUtils";
import AppIcon from "../../../components/AppIcon";

const KIND = {
  call: { icon: "phone", href: (t) => `/dealer/ai/actions?tab=tasks${t.missed ? "&status=missed" : ""}` },
  appt: { icon: "appointment", href: () => "/dealer/booking" },
  followup: { icon: "ai", href: (t) => `/dealer/leads?lead=${t.lead_id}` },
  reminder: { icon: "task", href: (t) => `/dealer/leads?lead=${t.lead_id}` },
};

export default function OpenTasks({ tasks }) {
  // Always shown, so "no tasks" is a clear answer rather than a missing box (25 Nov 2026).
  if (!tasks?.length) {
    return <div className="cp_card cp_tasks mb-3"><div className="cp_tasks_head"><AppIcon name="task" />Open tasks
      <span className="text-muted small fw-normal ms-2" style={{ textTransform: "none" }}>None - no calls, reminders or appointments waiting</span></div></div>;
  }
  return (
    <div className="cp_card cp_tasks mb-3">
      <div className="cp_tasks_head"><AppIcon name="task" />Open tasks <span className="cp_tab_count">{tasks.length}</span></div>
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
