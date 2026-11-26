"use client";
// The picked day's appointments on the Desk Log (18 Nov 2026): who is expected, who is in, who didn't come. One click
// checks the customer in (their appointment is marked showed, the visit starts on the table below); "Status" changes
// the lead's status the same way as the Leads page (No Show, move the appointment, Visited with its outcome, ...), so
// the follow-ups that status starts run as usual.
import { useState } from "react";
import Link from "next/link";
import { Button } from "react-bootstrap";
import moment from "moment-timezone";
import { rememberBack } from "../../components/backLink";

const leadLink = (id) => `/dealer/leads?selectedLead=true&leadId=${id}`;
// The customer's name opens their profile (Bibi, 26 Nov 2026); a lead with no customer yet opens the lead.
const personLink = (a) => (a.customer_id ? `/dealer/customers/${a.customer_id}` : leadLink(a.lead_id));
const STATE = {
  waiting: { label: "Expected", cls: "bg-secondary" },
  checked_in: { label: "Checked in", cls: "bg-success" },
  showed: { label: "Showed", cls: "bg-success" },
  no_show: { label: "No show", cls: "bg-danger" },
};
const timeText = (t) => { const m = moment(String(t || ""), ["HH:mm", "H:mm", "h:mm A"], true); return m.isValid() ? m.format("h:mm A") : t || ""; };

// A busy day: the first SHOWN appointments, then "Show all".
const SHOWN = 10;

export default function AppointmentsToday({ day, items, tz, onCheckIn, onStatus, loading }) {
  const [all, setAll] = useState(false);
  if (!items) return null;
  const today = day === moment.tz(tz).format("YYYY-MM-DD");
  const counts = items.reduce((c, a) => ({ ...c, [a.status]: (c[a.status] || 0) + 1 }), {});
  return (
    <div className="w_card my-3 dl_appts">
      <div className="d-flex align-items-center flex-wrap gap-2 mb-2">
        <h3 className="w_card_title mb-0 me-auto">
          <i className="fa-regular fa-calendar-check me-2"></i>
          Appointments {today ? "today" : moment.tz(day, "YYYY-MM-DD", tz).format("MMM D")} ({items.length})
        </h3>
        {items.length > 0 && <small className="text-muted">
          {counts.waiting || 0} expected · {(counts.checked_in || 0) + (counts.showed || 0)} in · {counts.no_show || 0} no show
        </small>}
      </div>
      {!items.length ? (
        <p className="text-muted small mb-0">{loading ? "Loading…" : "No appointments for this day."}</p>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm align-middle mb-0 small">
            <thead><tr><th>Time</th><th>Customer</th><th>Type</th><th>Booked by</th><th>Lead status</th><th>Arrival</th><th /></tr></thead>
            <tbody>
              {(all ? items : items.slice(0, SHOWN)).map((a) => {
                const st = STATE[a.status] || STATE.waiting;
                return (
                  <tr key={a.booking_id}>
                    <td className="text-nowrap fw-semibold">{timeText(a.time)}</td>
                    <td>
                      <Link href={personLink(a)} className="fw-semibold"
                        onClick={() => rememberBack(personLink(a), "/dealer/desk-log", "Desk Log")}>{a.name || "No name"}</Link>
                      {a.phone && <small className="d-block text-muted">{a.phone}</small>}
                    </td>
                    <td><span className="dl_type">{a.type}</span></td>
                    <td>{a.booked_by || <span className="text-muted">-</span>}</td>
                    <td>{a.lead_status_label || a.lead_status || "-"}</td>
                    <td className="text-nowrap"><span className={`badge ${st.cls}`}>{st.label}</span>
                      {a.checked_in_at && <small className="d-block text-muted">{moment(a.checked_in_at).tz(tz).format("h:mm A")}</small>}</td>
                    <td className="text-end text-nowrap">
                      {a.status !== "checked_in" && (
                        <Button size="sm" variant="custom" className="me-1" onClick={() => onCheckIn(a)}>
                          <i className="fa-solid fa-right-to-bracket me-1"></i>Check in</Button>
                      )}
                      <Button size="sm" variant="outline-custom" onClick={() => onStatus({ leadId: a.lead_id, name: a.name, status: a.lead_status })}>
                        Status</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {items.length > SHOWN && (
            <button type="button" className="btn btn-link btn-sm p-0 mt-1" onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show all ${items.length} appointments`}</button>
          )}
        </div>
      )}
    </div>
  );
}
