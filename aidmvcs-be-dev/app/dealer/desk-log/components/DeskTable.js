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

export default function DeskTable({ rows, staff, tz, onChanged, onOpen, empty, dealerId }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null); // { row, choice }

  const save = async (row, body) => {
    setBusy(row.id);
    setError(null);
    try {
      await deskLogUpdate(row.id, body);
      await onChanged();
    } catch (e) {
      setError(`${row.customer || "Visit"}: ${e.message}`);
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
              return (
                <tr key={row.id}>
                  <td className="text-nowrap">{at.format("h:mm A")}<small className="d-block text-muted">{at.format("MMM D")}</small></td>
                  <td className="dl_customer">
                    <Link href={leadLink(row.lead_id)} onClick={() => rememberBack(leadLink(row.lead_id), "/dealer/desk-log",
                      "Desk Log")} className="fw-semibold">{row.customer || "No name"}</Link>
                    {row.phone && <small className="d-block text-muted">{row.phone}</small>}
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
                      <small className="d-block text-muted">Next step: {moment(row.next_step_at).tz(tz).format("MMM D, h:mm A")}</small>
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
                  </td>
                  <td className="dl_actions">
                    {row.phone && <CallButton phone={row.phone} leadId={row.lead_id} dealerId={dealerId}
                      variant="link" size="sm" className="p-0" iconOnly />}
                    <Link href={leadLink(row.lead_id)} title="Text / email (opens the conversation)" aria-label="Message"
                      onClick={() => rememberBack(leadLink(row.lead_id), "/dealer/desk-log", "Desk Log")}>
                      <i className="fa-regular fa-comment-dots"></i></Link>
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
        <OutcomeModal row={pending.row} choice={pending.choice} tz={tz} onHide={() => setPending(null)}
          onSave={async (body) => { await deskLogUpdate(pending.row.id, body); setPending(null); await onChanged(); }} />
      )}
    </>
  );
}
