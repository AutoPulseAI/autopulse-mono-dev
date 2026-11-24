"use client";
// How far the customer is on the way to their car (19 Nov 2026, SOW reference B5 - DealerSocket's progress bar with a
// person running to a car). The steps are the lead's own funnel times (SOW B b4, G-009; app/lib/leadMilestones.js,
// /api/leads/milestones) - nothing new is counted: received, we responded, the customer replied, appointment set,
// showroom visit, sold. The runner stands at the furthest step reached; at Sold they are at the car. A closed-lost lead
// shows the runner stopped, greyed. Hover a step for its date.
import { useEffect, useState } from "react";
import { formatTimestamp } from "../../utils/dateUtils";
import "./opportunity.css";

export const JOURNEY_STEPS = [
  ["received", "Lead in"], ["first_response", "Responded"], ["first_reply", "Customer replied"],
  ["appointment", "Appointment"], ["visit", "Showroom visit"], ["sold", "Sold"],
];

/** The furthest step reached (-1: none) and whether the lead was lost. Pure. */
export function journeyPosition(times = {}) {
  let at = -1;
  JOURNEY_STEPS.forEach(([key], i) => { if (times?.[key]) at = i; });
  return { at, lost: Boolean(times?.lost) && !times?.sold };
}

export default function LeadJourney({ leadId, times: given = null, timezone }) {
  const [times, setTimes] = useState(given);

  useEffect(() => {
    if (given) { setTimes(given); return undefined; }
    if (!leadId) return undefined;
    let gone = false;
    fetch(`/api/leads/milestones?lead_ids=${leadId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!gone && data) setTimes(data.milestones?.[leadId] || {}); })
      .catch(() => {});
    return () => { gone = true; };
  }, [leadId, given]);

  if (!times) return null;
  const { at, lost } = journeyPosition(times);
  const last = JOURNEY_STEPS.length - 1;
  const pct = at < 0 ? 0 : (at / last) * 100;
  const sold = at === last;
  const label = lost ? "Closed - lost" : at < 0 ? "Not started" : JOURNEY_STEPS[at][1];

  return (
    <div className={`lj ${lost ? "lj_lost" : ""} ${sold ? "lj_sold" : ""}`}
      aria-label={`Customer journey: ${label}`} role="img">
      <div className="lj_track">
        <div className="lj_fill" style={{ width: `${pct}%` }} />
        {JOURNEY_STEPS.map(([key, name], i) => (
          <span key={key} className={`lj_dot ${times[key] ? "on" : ""}`} style={{ left: `${(i / last) * 100}%` }}
            title={`${name}: ${times[key] ? formatTimestamp(times[key], timezone) : "not yet"}`} />
        ))}
        <i className={`fa-solid ${sold ? "fa-person-circle-check" : "fa-person-running"} lj_runner`}
          style={{ left: `${pct}%` }} title={label} />
        <i className="fa-regular fa-car-side lj_car" title="The car" />
      </div>
      <div className="lj_label">{label}</div>
    </div>
  );
}
