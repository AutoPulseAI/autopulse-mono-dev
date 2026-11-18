"use client";
// The Desk Log table, column for column as Betsy's design (SOW v6 Appendix B1; 13 Nov 2026 meeting: "I don't see the
// source or the type"): select | Date / Time | Customer | Stock # | Year / Make / Model | Trade | Lead Type | Lead
// Source | Current Stage | Salesperson | Sales Manager | BDC Agent | Notes | Actions | Outcome, with her colour coding
// (deskLogUi.js) and a coloured strip on each row. Stage and people change in place; selected rows can be given a
// salesperson / manager / BDC agent at once; an outcome is confirmed first, because it changes the lead's status
// (OutcomeModal). The table scrolls sideways on smaller screens.
import { useState } from "react";
import Link from "next/link";
import { Form } from "react-bootstrap";
import moment from "moment-timezone";
import { STAGES, STALLED_MINUTES } from "../../../lib/deskLog/constants";
import { rememberBack } from "../../components/backLink";
import { deskLogUpdate } from "../deskLogApi";
import OutcomeModal from "./OutcomeModal";
import CallButton from "../../components/CallButton";
import { NO_OUTCOME_STYLE, NO_STAGE_STYLE, OUTCOME_CHOICES, STAGE_STYLE, TYPE_LABEL, TYPE_STYLE, ageText,
  avatarColor, choiceOf, initials, rowStripColor, sourceLogo, vehicleText } from "./deskLogUi";

const leadLink = (id) => `/dealer/leads?selectedLead=true&leadId=${id}`;

// What a saved outcome's rule did, in one line for the screen.
function appliedText(a) {
  if (!a) return null;
  const parts = [];
  if (a.checklist) parts.push(`delivery checklist added (${a.checklist} items)`);
  if (a.managers_alerted) parts.push("managers alerted");
  return parts.length ? `Saved: ${parts.join(", ")}.` : null;
}

export default function DeskTable({ rows, staff, tz, onChanged, onOpen, empty, dealerId, rules, onStatus = null }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null); // { row, choice }
  const [selected, setSelected] = useState(() => new Set());
  const [bulk, setBulk] = useState({ field: "salesperson_id", value: "" });
  const [sort, setSort] = useState({ key: null, dir: 1 }); // the sortable columns of the design (click again = reverse)

  // Every change carries the visit as this screen read it: someone else's newer change is never overwritten (409 ->
  // reloaded, made again).
  const save = async (row, body) => {
    setBusy(row.id);
    setError(null); setNotice(null);
    try {
      const res = await deskLogUpdate(row.id, { ...body, if_updated_at: row.updated_at });
      setNotice(appliedText(res.applied));
      await onChanged();
    } catch (e) {
      setError(`${row.customer || "Visit"}: ${e.message}`);
      if (e.status === 409) await onChanged();
    } finally {
      setBusy(null);
    }
  };

  const PERSON_LABEL = { salesperson_id: "Salesperson", sales_manager_id: "Sales manager", bdc_agent_id: "BDC agent" };
  const person = (row, field) => {
    const id = row[field];
    const name = id ? (staff.find((x) => String(x._id) === id)?.name || row[field.replace("_id", "")] || "") : "";
    return (
      <div className="dl_staff_cell">
        {id ? <span className="dl_avatar" style={{ background: avatarColor(id) }} title={name}>{initials(name)}</span> : null}
        <Form.Select size="sm" className="dl_staff" value={id || ""} disabled={busy === row.id}
          onChange={(e) => save(row, { [field]: e.target.value || null })} aria-label={PERSON_LABEL[field]}>
          <option value="">-</option>
          {staff.map((x) => <option key={x._id} value={x._id}>{x.name || x.email}</option>)}
          {id && !staff.some((x) => String(x._id) === id) && <option value={id}>{name || "Former staff"}</option>}
        </Form.Select>
      </div>
    );
  };

  const SORTS = {
    at: (r) => new Date(r.checked_in_at).getTime(), customer: (r) => (r.customer || "").toLowerCase(),
    stock: (r) => (r.stock_number || "").toLowerCase(), vehicle: (r) => vehicleText(r.vehicle).toLowerCase(),
    stage: (r) => (r.stage ? STAGES.indexOf(r.stage) : 99), salesperson: (r) => (r.salesperson || "").toLowerCase(),
    bdc: (r) => (r.bdc_agent || "").toLowerCase(),
  };
  const shown = sort.key ? [...rows].sort((a, b) => {
    const x = SORTS[sort.key](a); const y = SORTS[sort.key](b);
    return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
  }) : rows;
  const th = (key, label) => (
    <th className={`dl_sort${sort.key === key ? " on" : ""}`} onClick={() => setSort((cur) => ({ key, dir: cur.key === key ? -cur.dir : 1 }))}
      aria-sort={sort.key === key ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
      {label}<i className={`fa-solid ${sort.key !== key ? "fa-sort" : sort.dir > 0 ? "fa-sort-up" : "fa-sort-down"}`}></i></th>
  );

  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Selected rows get the same salesperson / manager / BDC agent, one visit at a time (each keeps its own history).
  const applyBulk = async () => {
    const chosen = rows.filter((r) => selected.has(r.id));
    setBusy("bulk"); setError(null); setNotice(null);
    let done = 0; const failed = [];
    for (const r of chosen) {
      try { await deskLogUpdate(r.id, { [bulk.field]: bulk.value || null, if_updated_at: r.updated_at }); done += 1; }
      catch (e) { failed.push(`${r.customer || "Visit"}: ${e.message}`); }
    }
    setBusy(null); setSelected(new Set());
    setNotice(`${PERSON_LABEL[bulk.field]} set on ${done} visit${done === 1 ? "" : "s"}.`);
    if (failed.length) setError(failed.join(" · "));
    await onChanged();
  };

  return (
    <>
      {error && <div className="alert alert-danger py-2">{error}</div>}
      {notice && <div className="alert alert-success py-2">{notice}</div>}
      {selected.size > 0 && (
        <div className="dl_bulk">
          <strong>{selected.size} selected</strong>
          <Form.Select size="sm" style={{ width: 160 }} value={bulk.field} onChange={(e) => setBulk({ ...bulk, field: e.target.value })}
            aria-label="Set">
            {Object.entries(PERSON_LABEL).map(([k, l]) => <option key={k} value={k}>Set {l.toLowerCase()}</option>)}
          </Form.Select>
          <Form.Select size="sm" style={{ width: 200 }} value={bulk.value} onChange={(e) => setBulk({ ...bulk, value: e.target.value })}
            aria-label="To">
            <option value="">- nobody -</option>
            {staff.map((x) => <option key={x._id} value={x._id}>{x.name || x.email}</option>)}
          </Form.Select>
          <button type="button" className="btn btn-custom btn-sm" disabled={busy === "bulk"} onClick={applyBulk}>Apply</button>
          <button type="button" className="btn btn-link btn-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}
      <div className="dl_table_wrap">
        <table className="dl_table">
          <thead>
            <tr>
              <th className="dl_strip" aria-hidden="true" />
              <th><Form.Check aria-label="Select all" checked={allOn}
                onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              {th("at", "Date / Time")}{th("customer", "Customer")}{th("stock", "Stock #")}{th("vehicle", "Year / Make / Model")}
              <th>Trade<br />Year / Make / Model</th>
              <th>Lead Type</th><th>Lead Source</th>{th("stage", "Current Stage")}{th("salesperson", "Salesperson")}
              <th>Sales Manager</th>{th("bdc", "BDC Agent")}<th>Notes (Latest)</th><th>Actions</th><th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {/* 18 Nov 2026: the columns always show, also before anyone is checked in for these dates. */}
            {!rows.length && <tr><td colSpan={16} className="p-4 text-center text-muted">{empty}</td></tr>}
            {shown.map((row) => {
              const at = moment(row.checked_in_at).tz(tz);
              const choice = choiceOf(row);
              const stalled = row.minutes_in_stage != null && row.minutes_in_stage >= STALLED_MINUTES;
              const vehicle = vehicleText(row.vehicle);
              const trade = vehicleText(row.trade);
              // G-024: a DND customer is not contacted - no Call / Message from here, and the row says so.
              const dnd = row.lead_status === "DND";
              const typeStyle = TYPE_STYLE[row.lead_type];
              return (
                <tr key={row.id}>
                  <td className="dl_strip" style={{ background: rowStripColor(row, choice) }} aria-hidden="true" />
                  <td><Form.Check aria-label={`Select ${row.customer || "visit"}`} checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)} /></td>
                  <td className="text-nowrap">{at.format("MM/DD")}<small className="d-block text-muted">{at.format("h:mm A")}</small></td>
                  <td className="dl_customer">
                    <Link href={leadLink(row.lead_id)} onClick={() => rememberBack(leadLink(row.lead_id), "/dealer/desk-log",
                      "Desk Log")} className="fw-semibold">{row.customer || "No name"}</Link>
                    {row.phone && <small className="d-block text-muted">{row.phone}</small>}
                    {/* The lead's own status, as everywhere else in the CRM (changes made on the Leads page show here too). */}
                    {row.lead_status_label && <small className={`d-block ${row.lead_status_label === "Appointment Showed" ? "text-success" : "text-muted"}`}>
                      Lead: {row.lead_status_label}</small>}
                    {dnd && <small className="d-block fw-semibold text-danger">Do not contact (DND)</small>}
                    {row.handoff && <small className="d-block fw-semibold text-warning" title={row.handoff.reason}>
                      <i className="fa-solid fa-hand me-1" />Handed to a manager</small>}
                    {row.car_finder_matches > 0 && <small className="d-block fw-semibold text-success">
                      <i className="fa-solid fa-car me-1" />Car found ({row.car_finder_matches}) - see details</small>}
                    {row.lead_status === "Opted Out" && <small className="d-block text-muted">Opted out (see the lead for which channel)</small>}
                    {row.department === "service" && <span className="dl_type mt-1">Service</span>}
                    {row.created_via === "leads_page" && <small className="d-block text-muted">Recorded on the Leads page</small>}
                    {row.created_via === "appointments" && <small className="d-block text-muted">Marked showed on Appointments</small>}
                  </td>
                  <td className="text-nowrap">{row.stock_number || <span className="text-muted">-</span>}</td>
                  <td className="dl_vehicle">{vehicle || <span className="text-muted">-</span>}</td>
                  <td className="dl_vehicle">{trade || <span className="text-muted">-</span>}</td>
                  <td><span className="dl_type" style={typeStyle}>{TYPE_LABEL[row.lead_type] || row.lead_type || "-"}</span></td>
                  <td>
                    {row.source ? (
                      <div className="dl_source" title={row.sub_source ? `${row.source} · ${row.sub_source}` : row.source}>
                        {(() => { const logo = sourceLogo(row.source); return (
                          <span className="dl_source_logo" style={{ background: logo.bg }} aria-hidden="true">
                            {logo.icon ? <i className={logo.icon}></i> : logo.letter}</span>); })()}
                        <span>{row.source}{row.sub_source ? <small className="d-block text-muted">{row.sub_source}</small> : null}</span>
                      </div>
                    ) : <span className="text-muted">-</span>}
                  </td>
                  <td>
                    <Form.Select size="sm" className="dl_pill" value={row.stage || ""} disabled={busy === row.id}
                      style={row.stage ? STAGE_STYLE[row.stage] : NO_STAGE_STYLE} aria-label="Current stage"
                      onChange={(e) => save(row, { stage: e.target.value || null })}>
                      <option value="">No stage</option>
                      {STAGES.map((st) => <option key={st} value={st}>{st}</option>)}
                    </Form.Select>
                    {row.minutes_in_stage != null && (
                      <span className={`dl_age${stalled ? " stalled" : ""}`}>{ageText(row.minutes_in_stage)}</span>
                    )}
                  </td>
                  <td>{person(row, "salesperson_id")}</td>
                  <td>{person(row, "sales_manager_id")}</td>
                  <td>{person(row, "bdc_agent_id")}</td>
                  <td className="dl_note">{row.latest_note?.text || <span className="text-muted">-</span>}
                    {row.latest_note?.from_lead && <small className="d-block text-muted">Note on the lead{row.latest_note.by ? ` - ${row.latest_note.by}` : ""}</small>}
                    {row.next_step_at && (
                      <small className="d-block text-muted">Next step: {moment(row.next_step_at).tz(tz).format("MMM D, h:mm A")}</small>
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
                    {/* 18 Nov 2026: book an appointment (or any status) right here, through the Leads page's status window. */}
                    {!dnd && onStatus && (
                      <button type="button" title="Book an appointment / change the lead's status" aria-label="Appointment"
                        onClick={() => onStatus({ leadId: row.lead_id, name: row.customer, status: row.lead_status })}>
                        <i className="fa-regular fa-calendar-plus"></i></button>
                    )}
                    <button type="button" title="Details, notes and history" aria-label="Details"
                      onClick={() => onOpen({ id: row.id, name: row.customer })}><i className="fa-solid fa-ellipsis-vertical"></i></button>
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
                    {row.outcome_from_lead && <small className="d-block text-muted">Set on the Leads page</small>}
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
            setPending(null); setNotice(appliedText(res.applied)); await onChanged();
          }} />
      )}
    </>
  );
}
