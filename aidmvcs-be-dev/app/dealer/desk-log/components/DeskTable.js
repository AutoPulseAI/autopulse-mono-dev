"use client";
// The Desk Log table: checked in, customer (phone, lead type, source), vehicle (stock #, trade), stage, people
// (salesperson, sales manager, BDC agent), latest note, outcome, actions - Betsy's fields in 8 columns instead of 14
// (user, 13 Nov 2026: too wide and messy). Stage and people change in place; an
// outcome is confirmed first, because it changes the lead's status (OutcomeModal).
import { useState } from "react";
import Link from "next/link";
import { Form } from "react-bootstrap";
import moment from "moment-timezone";
import { STAGES, STALLED_MINUTES } from "../../../lib/deskLog/constants";
import { rememberBack } from "../../components/backLink";
import { deskLogUpdate } from "../deskLogApi";
import OutcomeModal from "./OutcomeModal";
import CallButton from "../../components/CallButton";
import { NO_OUTCOME_STYLE, NO_STAGE_STYLE, OUTCOME_CHOICES, STAGE_STYLE, TYPE_LABEL, ageText,
  choiceOf, vehicleText } from "./deskLogUi";

const leadLink = (id) => `/dealer/leads?selectedLead=true&leadId=${id}`;

const OWNER_LABEL = { salesperson: "salesperson", sales_manager: "sales manager", bdc_agent: "BDC agent" };

// What a saved outcome's rule did, in one line for the screen.
function appliedText(a, tz) {
  if (!a) return null;
  const parts = [];
  if (a.next_step_at) parts.push(`next step set for ${moment(a.next_step_at).tz(tz).format("MMM D, h:mm A")}`);
  if (a.checklist) parts.push(`delivery checklist added (${a.checklist} items)`);
  if (a.ai_paused) parts.push("the AI is off for this lead - staff follow up");
  if (a.managers_alerted) parts.push("managers alerted");
  return parts.length ? `Saved: ${parts.join(", ")}.` : null;
}

export default function DeskTable({ rows, staff, tz, onChanged, onOpen, empty, dealerId, rules }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null); // { row, choice }

  // Every change carries the visit as this screen read it: someone else's newer change is never overwritten (409 ->
  // reloaded, made again).
  const save = async (row, body) => {
    setBusy(row.id);
    setError(null); setNotice(null);
    try {
      const res = await deskLogUpdate(row.id, { ...body, if_updated_at: row.updated_at });
      setNotice(appliedText(res.applied, tz));
      await onChanged();
    } catch (e) {
      setError(`${row.customer || "Visit"}: ${e.message}`);
      if (e.status === 409) await onChanged();
    } finally {
      setBusy(null);
    }
  };

  const PERSON_LABEL = { salesperson_id: "Sales", sales_manager_id: "Manager", bdc_agent_id: "BDC" };
  const person = (row, field) => (
    <div className="dl_person"><span>{PERSON_LABEL[field]}</span>
    <Form.Select size="sm" className="dl_staff" value={row[field] || ""} disabled={busy === row.id}
      onChange={(e) => save(row, { [field]: e.target.value || null })} aria-label={PERSON_LABEL[field]}>
      <option value="">-</option>
      {staff.map((s) => <option key={s._id} value={s._id}>{s.name || s.email}</option>)}
      {row[field] && !staff.some((s) => String(s._id) === row[field]) && (
        <option value={row[field]}>{row[field.replace("_id", "")] || "Former staff"}</option>
      )}
    </Form.Select></div>
  );

  if (!rows.length) return <div className="dl_table_wrap p-4 text-center text-muted">{empty}</div>;

  return (
    <>
      {error && <div className="alert alert-danger py-2">{error}</div>}
      {notice && <div className="alert alert-success py-2">{notice}</div>}
      <div className="dl_table_wrap">
        <table className="dl_table">
          <thead>
            <tr>
              <th>Checked in</th><th>Customer</th><th>Vehicle</th><th>Stage</th><th>People</th><th>Latest note</th>
              <th>Outcome</th><th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const at = moment(row.checked_in_at).tz(tz);
              const choice = choiceOf(row);
              const stalled = row.minutes_in_stage != null && row.minutes_in_stage >= STALLED_MINUTES;
              const vehicle = vehicleText(row.vehicle);
              const trade = vehicleText(row.trade);
              // G-024: a DND customer is not contacted - no Call / Message from here, and the row says so.
              const dnd = row.lead_status === "DND";
              return (
                <tr key={row.id}>
                  <td className="text-nowrap">{at.format("h:mm A")}<small className="d-block text-muted">{at.format("MMM D")}</small></td>
                  <td className="dl_customer">
                    <Link href={leadLink(row.lead_id)} onClick={() => rememberBack(leadLink(row.lead_id), "/dealer/desk-log",
                      "Desk Log")} className="fw-semibold">{row.customer || "No name"}</Link>
                    {row.phone && <small className="d-block text-muted">{row.phone}</small>}
                    {dnd && <small className="d-block fw-semibold text-danger">Do not contact (DND)</small>}
                    {row.handoff && <small className="d-block fw-semibold text-warning" title={row.handoff.reason}>
                      <i className="fa-solid fa-hand me-1" />Handed to a manager</small>}
                    {row.car_finder_matches > 0 && <small className="d-block fw-semibold text-success">
                      <i className="fa-solid fa-car me-1" />Car found ({row.car_finder_matches}) - see details</small>}
                    {row.lead_status === "Opted Out" && <small className="d-block text-muted">Opted out (see the lead for which channel)</small>}
                    <small className="d-block">
                      <span className="dl_type">{TYPE_LABEL[row.lead_type] || row.lead_type}</span>
                      <span className="text-muted ms-1">{row.source}{row.sub_source ? ` · ${row.sub_source}` : ""}</span>
                      {row.department === "service" && <span className="dl_type ms-1">Service</span>}
                    </small>
                  </td>
                  <td className="dl_vehicle">
                    {vehicle || <span className="text-muted">-</span>}
                    {row.stock_number && <small className="d-block text-muted">Stock #{row.stock_number}</small>}
                    {trade && <small className="d-block text-muted">Trade: {trade}</small>}
                  </td>
                  <td>
                    <Form.Select size="sm" className="dl_pill" value={row.stage || ""} disabled={busy === row.id}
                      style={row.stage ? STAGE_STYLE[row.stage] : NO_STAGE_STYLE} aria-label="Current stage"
                      onChange={(e) => save(row, { stage: e.target.value || null })}>
                      <option value="">No stage</option>
                      {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Form.Select>
                    {row.minutes_in_stage != null && (
                      <span className={`dl_age${stalled ? " stalled" : ""}`}>{ageText(row.minutes_in_stage)}</span>
                    )}
                  </td>
                  <td className="dl_people">
                    {person(row, "salesperson_id")}
                    {person(row, "sales_manager_id")}
                    {person(row, "bdc_agent_id")}
                  </td>
                  <td className="dl_note">{row.latest_note?.text || <span className="text-muted">-</span>}
                    {row.next_step_at && (
                      <small className="d-block text-muted">Next step: {moment(row.next_step_at).tz(tz).format("MMM D, h:mm A")}
                        {row.next_step_owner ? ` (${OWNER_LABEL[row.next_step_owner]})` : ""}</small>
                    )}
                  </td>
                  <td>
                    <Form.Select size="sm" className="dl_pill dl_outcome" value={choice?.value || ""} disabled={busy === row.id}
                      style={choice ? choice.style : NO_OUTCOME_STYLE} aria-label="Outcome"
                      onChange={(e) => {
                        const next = OUTCOME_CHOICES.find((c) => c.value === e.target.value);
                        if (next) setPending({ row, choice: next });
                      }}>
                      {!choice && <option value="">Pick outcome</option>}
                      {OUTCOME_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </Form.Select>
                    {/* G-016: the sale checked against the dealer's DMS (DealerVault). */}
                    {row.dms?.flag === "not_in_dms" && <small className="d-block text-danger">Not in the DMS yet</small>}
                    {row.dms?.flag === "dms_delivered" && (
                      <small className="d-block text-danger">DMS shows delivered {moment(row.dms.date).tz(tz).format("MMM D")}</small>
                    )}
                    {row.checklist && (
                      <small className={`d-block ${row.checklist.done === row.checklist.total ? "text-success" : "text-muted"}`}>
                        Delivery checklist {row.checklist.done}/{row.checklist.total}</small>
                    )}
                    {row.dms?.found && !row.dms.flag && (
                      <small className="d-block text-muted">DMS: {row.dms.delivered ? "delivered" : "contract"}{" "}
                        {moment(row.dms.date).tz(tz).format("MMM D")}{row.dms.deal_number ? ` · deal ${row.dms.deal_number}` : ""}</small>
                    )}
                  </td>
                  <td className="dl_actions">
                    {!dnd && row.phone && <CallButton phone={row.phone} leadId={row.lead_id} dealerId={dealerId}
                      variant="link" size="sm" className="p-0" iconOnly />}
                    {!dnd && (
                      <Link href={leadLink(row.lead_id)} title="Text / email (opens the conversation)" aria-label="Message"
                        onClick={() => rememberBack(leadLink(row.lead_id), "/dealer/desk-log", "Desk Log")}>
                        <i className="fa-regular fa-comment-dots"></i></Link>
                    )}
                    <button type="button" title="Details, notes and history" aria-label="Details"
                      onClick={() => onOpen({ id: row.id, name: row.customer })}><i className="fa-solid fa-ellipsis-vertical"></i></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pending && (
        <OutcomeModal row={pending.row} choice={pending.choice} tz={tz} rules={rules} onHide={() => setPending(null)}
          onSave={async (body) => {
            const res = await deskLogUpdate(pending.row.id, { ...body, if_updated_at: pending.row.updated_at });
            setPending(null); setNotice(appliedText(res.applied, tz)); await onChanged();
          }} />
      )}
    </>
  );
}
