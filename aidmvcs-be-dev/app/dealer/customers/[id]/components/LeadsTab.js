"use client";

import { useEffect, useState } from "react";
import { Alert, Button } from "react-bootstrap";
import { formatTimestamp } from "../../../../utils/dateUtils";
import ViewConversations from "../../../leads/components/viewConversations";
import ViewAdfModal, { isAdfLead } from "../../../leads/components/ViewAdfModal";
import OpportunityActions from "./OpportunityActions";

// Each lead's funnel times (SOW B b4, G-009), from /api/leads/milestones. A step not reached yet shows "-".
const MILESTONES = [
  ["received", "Received"], ["first_response", "First response"], ["first_reply", "Customer replied"],
  ["appointment", "Appointment set"], ["visit", "Showroom visit"], ["sold", "Sold"], ["lost", "Closed - lost"],
];

// The lead's milestones as step tiles (the user, 28 Nov 2026: not circles like the journey above): each step its own
// icon and colour, filled with its date once reached, and how long it took from the step before (response time).
const STEP_LOOK = {
  received: ["fa-inbox", "#2563eb"], first_response: ["fa-reply", "#7c3aed"], first_reply: ["fa-comments", "#0d9488"],
  appointment: ["fa-calendar-check", "#16a34a"], visit: ["fa-store", "#ea580c"], sold: ["fa-key", "#ca8a04"], lost: ["fa-circle-xmark", "#dc2626"],
};
const shortWhen = (t) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function gapLabel(from, to) {
  const m = Math.round((new Date(to) - new Date(from)) / 60000);
  if (!(m >= 0)) return null;
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
  const d = Math.floor(m / 1440); const h = Math.floor((m % 1440) / 60);
  return `${d}d${h ? ` ${h}h` : ""}`;
}
function Milestones({ times }) {
  const steps = MILESTONES.filter(([key]) => key !== "lost" || times?.lost);
  let prevAt = null;
  return (
    <ol className="ms_row" aria-label="Lead milestones">
      {steps.map(([key, label], i) => {
        const at = times?.[key];
        const [icon, color] = STEP_LOOK[key];
        const gap = at && prevAt ? gapLabel(prevAt, at) : null;
        if (at) prevAt = at;
        return (
          <li key={key} className="ms_cell">
            {i > 0 && <span className={`ms_gap${gap ? " on" : ""}`} title={gap ? `${gap} after the step before` : undefined}>
              <i className="fa-solid fa-angle-right" aria-hidden="true" />{gap && <small>{gap}</small>}</span>}
            <span className={`ms_tile${at ? " done" : ""}`} style={{ "--c": color }} title={at ? `${label}: ${formatTimestamp(at)}` : `${label}: not yet`}>
              <span className="ms_text"><b><i className={`fa-solid ${icon}`} aria-hidden="true" style={{ color: at ? color : undefined }} />{label}</b>
                <small>{at ? shortWhen(at) : "Not yet"}</small></span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// The lead (opportunity) at a glance above its conversation (13 Nov 2026 meeting 10.13, DealerSocket's opportunity
// header): its number, department, owner, how old it is against the 90-day follow-up period, and Hot (10.11).
const FOLLOW_UP_DAYS = 90;
function OpportunityHeader({ lead, owner, onHot, children }) {
  const days = lead.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(lead.createdAt)) / 86400000)) : 0;
  const pct = Math.min(100, Math.round((days / FOLLOW_UP_DAYS) * 100));
  return (
    <div className="cp_opp">
      <span className="fw-semibold">Opportunity #{String(lead._id).slice(-6).toUpperCase()}</span>
      {owner && <span className="small"><i className="fa-solid fa-user-tie me-1" />{owner}</span>}
      <button type="button" className={`cp_hot${lead.hot ? " on" : ""}`} onClick={() => onHot(!lead.hot)}
        title={lead.hot ? "Marked hot - click to unmark" : "Mark this lead hot"}>
        <i className="fa-solid fa-fire me-1" />{lead.hot ? "HOT" : "Mark hot"}</button>
      <span className="cp_age ms-auto" title={`${days} of ${FOLLOW_UP_DAYS} follow-up days`}>
        <span className="cp_age_bar"><span style={{ width: `${pct}%` }} /></span>{days === 1 ? "1 day old" : `${days} days old`}</span>
      {children}
    </div>
  );
}

// One lead of the customer, opened from the list on the left (28 Nov 2026): the Leads page's lead screen (top band,
// actions, journey, Lead settings, conversation and message box) with the opportunity under its actions - number,
// owner, Hot, age, milestones, showroom visits, vehicles of interest, reminders, Active, View ADF.
export default function LeadsTab({ lead, leads = [], onShow, onChanged }) {
  const [milestones, setMilestones] = useState(null);
  const [details, setDetails] = useState({});
  const [hot, setHotState] = useState(lead.hot === true);
  const [error, setError] = useState(null);
  const [adfModalLeadId, setAdfModalLeadId] = useState(null);
  // The slot in the lead's actions bar where the opportunity's Reminder / Appt. / Log call / Other task go.
  const [actionsEl, setActionsEl] = useState(null);
  // The opportunity now opens in its own slide-out (Opportunity in the actions bar), so everything in it shows.
  const open = true;

  useEffect(() => {
    setHotState(lead.hot === true);
    setMilestones(null); setDetails({});
    // Not fatal: the lead still shows without its milestones.
    fetch(`/api/leads/milestones?lead_ids=${lead._id}`, { headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (b) { setMilestones(b.milestones?.[lead._id] || null); setDetails(b.details?.[lead._id] || {}); } })
      .catch(() => {});
  }, [lead._id, lead.hot]);

  const setHot = async (value) => {
    try {
      const res = await fetch(`/api/leads/${lead._id}/details`, { method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
        body: JSON.stringify({ changes: { hot: { from: lead.hot ?? null, to: String(value) } } }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save");
      setHotState(value);
      onChanged?.();
    } catch (e) { setError(e.message); }
  };

  const at = leads.findIndex((l) => String(l._id) === String(lead._id));
  const visits = details.visits || [];

  const opportunity = (
    <div className="cp_opp_panel">
      {error && <Alert variant="danger" dismissible onClose={() => setError(null)} className="py-1 small">{error}</Alert>}
      <OpportunityHeader lead={{ ...lead, hot }} owner={details.owner} onHot={setHot} />
      {open && (
        <div className="opp_details">
          <div className="small mb-2 d-flex flex-wrap align-items-center gap-2">
            <strong className="me-1"><i className="fa-solid fa-store me-1" />Showroom visits</strong>
            {visits.length === 0 && <span className="text-muted">none yet</span>}
            {isAdfLead(lead) && (
              <Button variant="outline-custom" size="sm" className="ms-auto" onClick={() => setAdfModalLeadId(lead._id)}>
                <i className="fa-solid fa-file-code me-1" />View ADF
              </Button>
            )}
          </div>
          {visits.length > 0 && (
            <ul className="small list-unstyled mb-2 ps-3">
              {visits.map((v) => (
                <li key={v.id} className="mb-1">
                  {formatTimestamp(v.at)} · {v.department === "service" ? "Service" : "Sales"}
                  {v.stage ? ` · ${v.stage}` : ""}{v.salesperson ? ` · ${v.salesperson}` : ""}
                  {" · "}<strong>{v.outcome || "still open"}</strong>
                  {v.note && <span className="text-muted"> · {v.note}</span>}
                  {" "}<a href={`/dealer/desk-log?visit=${v.id}`}>open in Desk Log</a>
                </li>
              ))}
            </ul>
          )}
          {details.ai === "linked" && (
            <Alert variant="light" className="border py-2 small mb-2">
              <i className="fa-solid fa-link me-1" />
              Its own lead (status, owner, source, appointments). The AI talks to this customer in one
              conversation, on their lead for {details.ai_lead_label?.[0] || "an earlier vehicle"}
              {details.ai_lead_label?.[1] ? ` from ${formatTimestamp(details.ai_lead_label[1])}` : ""}
              ; it is shown below too.
            </Alert>
          )}
        </div>
      )}
      {/* Always there: it puts More (Reminder, Appointment, Log a call, Other task) in the actions bar; its reminders,
          vehicles of interest and Active switch show with the Details. */}
      <OpportunityActions key={lead._id} lead={lead} onChanged={onChanged} toolsTarget={actionsEl} showDetails={open} />
    </div>
  );

  return (
    <>
      <ViewConversations key={lead._id} lead={lead} embedded profileMode onLeadSaved={onChanged}
        onPrevLead={at > 0 ? () => onShow(`lead:${leads[at - 1]._id}`) : null}
        onNextLead={at >= 0 && at < leads.length - 1 ? () => onShow(`lead:${leads[at + 1]._id}`) : null}
        navLabel={at >= 0 ? `Lead ${at + 1} of ${leads.length}` : ""}
        onActionsSlot={setActionsEl}
        headerExtra={opportunity}
        // Received, First response, Customer replied, Appointment set, Showroom visit, Sold - always on screen
        // (Betsy's SOW, funnel timestamps per lead).
        headerTrack={<Milestones times={milestones} />} />
      <ViewAdfModal show={!!adfModalLeadId} onHide={() => setAdfModalLeadId(null)} leadId={adfModalLeadId} />
    </>
  );
}
