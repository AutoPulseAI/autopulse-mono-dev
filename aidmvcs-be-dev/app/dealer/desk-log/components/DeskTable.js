"use client";
// The Desk Log table, column for column as Betsy's design (SOW v6 Appendix B1; 13 Nov 2026 meeting: "I don't see the
// source or the type"): select | Date / Time | Customer | Stock # | Year / Make / Model | Trade | Lead Type | Lead
// Source | Current Stage | Salesperson | Sales Manager | BDC Agent | Notes | Actions | Outcome, with her colour coding
// (deskLogUi.js) and a coloured strip on each row. Stage and people change in place; selected rows can be given a
// salesperson / manager / BDC agent at once; an outcome is confirmed first, because it changes the lead's status
// (OutcomeModal). The table scrolls sideways on smaller screens.
// 18 Nov 2026 (after go-live): fixed column widths with a line between columns; text that doesn't fit is cut with "..."
// and shows in full on hover (notes: two lines, click opens the visit); people as avatar + "Jessica S."; the four
// actions (call, message, appointment, more) always in the same place (greyed when they can't be used); stage and
// outcome as coloured menus with their arrow, as in the design.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Form } from "react-bootstrap";
import moment from "moment-timezone";
import { STAGES, STALLED_MINUTES } from "../../../lib/deskLog/constants";
import { rememberBack } from "../../components/backLink";
import { deskLogUpdate } from "../deskLogApi";
import OutcomeModal from "./OutcomeModal";
import ColorPick from "./ColorPick";
import CallButton from "../../components/CallButton";
import Customer360Panel from "../../components/Customer360Panel";
import { NO_OUTCOME_STYLE, NO_STAGE_STYLE, OUTCOME_CHOICES, STAGE_STYLE, TYPE_LABEL, TYPE_STYLE, ageText,
  avatarColor, choiceOf, darkPill, initials, rowStripColor, shortName, sourceLogo, vehicleText, STAGE_ICON, OUTCOME_ICON } from "./deskLogUi";

// Column widths (px), in the order of the columns. The table is laid out fixed, so a long value never pushes the
// next column over: it is cut and shows in full on hover.
// 24 Nov 2026: tightened to the design so the whole row fits a laptop screen; Actions and Outcome stay pinned right.
const COLS = [4, 30, 60, 124, 68, 112, 108, 86, 116, 112, 114, 114, 114, 140, 112, 156];
const TABLE_WIDTH = COLS.reduce((a, b) => a + b, 0);
// 24 Nov 2026 (responsive): each column is its share of the table, so the table fills a big screen and shrinks with
// zoom; below TABLE_WIDTH it scrolls sideways instead of crushing, with Actions and Outcome pinned.
const SHARE = COLS.map((w) => `${((w / TABLE_WIDTH) * 100).toFixed(3)}%`);

// One line, cut with "...", the whole text on hover.
const Clip = ({ text, className = "", children }) => (
  <span className={`dl_clip ${className}`} title={text || undefined}>{children ?? text}</span>
);

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
  const [panel360, setPanel360] = useState(null); // the 360 View side panel (19 Nov 2026)
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null); // { row, choice }
  const [selected, setSelected] = useState(() => new Set());
  const [bulk, setBulk] = useState({ field: "salesperson_id", value: "" });
  const [sort, setSort] = useState({ key: null, dir: 1 });
  // Pinned Actions sit right next to Outcome, whose width now follows the screen.
  const wrapRef = useRef(null);
  useEffect(() => {
    const wrap = wrapRef.current;
    const out = wrap?.querySelector("thead th.dl_pin_out");
    if (!wrap || !out || typeof ResizeObserver === "undefined") return undefined;
    const set = () => wrap.style.setProperty("--dl-out-w", `${out.getBoundingClientRect().width}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(out);
    return () => ro.disconnect();
  }, []); // the sortable columns of the design (click again = reverse)

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
    const name = id ? (staff.find((x) => String(x._id) === id)?.name || row[field.replace("_id", "")] || "Former staff") : "";
    // The avatar and short name show; the menu sits on top of them (invisible), so a click opens the staff list.
    return (
      <div className={`dl_staff_cell${busy === row.id ? " busy" : ""}`} title={name ? `${PERSON_LABEL[field]}: ${name}` : `Pick ${PERSON_LABEL[field].toLowerCase()}`}>
        {id ? <span className="dl_avatar" style={{ background: avatarColor(id) }}>{initials(name)}</span>
          : <span className="dl_avatar dl_avatar_empty"><i className="fa-solid fa-plus"></i></span>}
        <span className="dl_staff_name">{id ? shortName(name) : <span className="text-muted">-</span>}</span>
        <i className="fa-solid fa-chevron-down dl_staff_caret" aria-hidden="true"></i>
        <select className="dl_staff_select" value={id || ""} disabled={busy === row.id}
          onChange={(e) => save(row, { [field]: e.target.value || null })} aria-label={PERSON_LABEL[field]}>
          <option value="">- nobody -</option>
          {staff.map((x) => <option key={x._id} value={x._id}>{x.name || x.email}</option>)}
          {id && !staff.some((x) => String(x._id) === id) && <option value={id}>{name}</option>}
        </select>
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
      <div className="dl_table_wrap" ref={wrapRef}>
        <table className="dl_table" style={{ width: "100%", minWidth: TABLE_WIDTH }}>
          <colgroup>{SHARE.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead>
            <tr>
              <th className="dl_strip" aria-hidden="true" />
              <th><Form.Check aria-label="Select all" checked={allOn}
                onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              {th("at", "Date / Time")}{th("customer", "Customer")}{th("stock", "Stock #")}{th("vehicle", "Year / Make / Model")}
              <th>Trade<br />Year / Make / Model</th>
              <th>Lead Type</th><th>Lead Source</th>{th("stage", "Current Stage")}{th("salesperson", "Salesperson")}
              <th>Sales Manager</th>{th("bdc", "BDC Agent")}<th>Notes (Latest)</th><th className="dl_pin dl_pin_act">Actions</th><th className="dl_pin dl_pin_out">Outcome</th>
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
                    {/* The design: the customer's name, blue and clickable. Everything else is one small icon with its
                        meaning on hover (24 Nov 2026), so every row stays one height. */}
                    <div className="dl_cust_line">
                      <Link href={leadLink(row.lead_id)} onClick={() => rememberBack(leadLink(row.lead_id), "/dealer/desk-log", "Desk Log")}
                        className="dl_cust_name" title={[row.customer || "No name", row.phone, row.lead_status_label && `Lead: ${row.lead_status_label}`].filter(Boolean).join(" · ")}>
                        {row.customer || "No name"}</Link>
                      <button type="button" className="dl_360" title="360 View: history, tasks, call / text without leaving the Desk Log" aria-label="360 View"
                        onClick={() => setPanel360({ customerId: row.customer_id, leadId: row.lead_id, name: row.customer, dnd })}>
                        <i className="fa-regular fa-id-card" /></button>
                    </div>
                    <div className="dl_flags">
                      {dnd && <i className="fa-solid fa-ban text-danger" title="Do not contact (DND)" aria-label="Do not contact (DND)" />}
                      {row.lead_status === "Opted Out" && <i className="fa-solid fa-comment-slash text-muted" title="Opted out (see the lead for which channel)" aria-label="Opted out" />}
                      {row.handoff && <i className="fa-solid fa-hand text-warning" title={`Handed to a manager${row.handoff.reason ? `: ${row.handoff.reason}` : ""}`} aria-label="Handed to a manager" />}
                      {row.car_finder_matches > 0 && <i className="fa-solid fa-car text-success" title={`Car found (${row.car_finder_matches}) - see details`} aria-label="Car found" />}
                      {row.department === "service" && <i className="fa-solid fa-screwdriver-wrench" style={{ color: "#0ea5a5" }} title="Service" aria-label="Service" />}
                      {row.created_via === "leads_page" && <i className="fa-solid fa-list text-muted" title="Recorded on the Leads page" aria-label="Recorded on the Leads page" />}
                      {row.created_via === "appointments" && <i className="fa-regular fa-calendar-check text-muted" title="Marked showed on Appointments" aria-label="Marked showed on Appointments" />}
                    </div>
                  </td>
                  <td><Clip text={row.stock_number}>{row.stock_number || <span className="text-muted">-</span>}</Clip></td>
                  <td><span className="dl_clamp2" title={vehicle || undefined}>{vehicle || <span className="text-muted">-</span>}</span></td>
                  <td><span className="dl_clamp2" title={trade || undefined}>{trade || <span className="text-muted">-</span>}</span></td>
                  <td><span className="dl_type" style={typeStyle}>{TYPE_LABEL[row.lead_type] || row.lead_type || "-"}</span></td>
                  <td>
                    {row.source ? (
                      <div className="dl_source" title={row.sub_source ? `${row.source} · ${row.sub_source}` : row.source}>
                        {(() => { const logo = sourceLogo(row.source); return (
                          <span className="dl_source_logo" style={{ background: logo.bg }} aria-hidden="true">
                            {logo.icon ? <i className={logo.icon}></i> : logo.letter}</span>); })()}
                        <span className="dl_source_text"><span className="dl_clip">{row.source}</span>
                          {row.sub_source ? <span className="dl_clip small text-muted">{row.sub_source}</span> : null}</span>
                      </div>
                    ) : <span className="text-muted">-</span>}
                  </td>
                  <td>
                    <ColorPick value={row.stage || ""} disabled={busy === row.id} label="Current stage" empty="No stage"
                      style={row.stage ? STAGE_STYLE[row.stage] : NO_STAGE_STYLE} dark={row.stage && darkPill(STAGE_STYLE[row.stage])}
                      options={[{ value: "", label: "No stage" }, ...STAGES.map((st) => ({ value: st, label: st, dot: STAGE_STYLE[st]?.backgroundColor, icon: STAGE_ICON[st], ink: st === "PROPOSAL" ? "#9a7b00" : undefined }))]}
                      onPick={(v) => save(row, { stage: v || null })} />
                    {row.minutes_in_stage != null && (
                      <span className={`dl_age${stalled ? " stalled" : ""}`}>{ageText(row.minutes_in_stage)}</span>
                    )}
                  </td>
                  <td>{person(row, "salesperson_id")}</td>
                  <td>{person(row, "sales_manager_id")}</td>
                  <td>{person(row, "bdc_agent_id")}</td>
                  <td className="dl_note">
                    {/* Two lines; the whole note on hover, and a click opens the visit (all notes and the history). */}
                    {row.latest_note?.text ? (
                      <button type="button" className="dl_note_text" title={row.latest_note.text}
                        onClick={() => onOpen({ id: row.id, name: row.customer })}>{row.latest_note.text}</button>
                    ) : <span className="text-muted">-</span>}
                    {row.latest_note?.from_lead && <Clip className="small text-muted"
                      text={`Note on the lead${row.latest_note.by ? ` - ${row.latest_note.by}` : ""}`} />}
                    {row.next_step_at && (
                      <Clip className="small text-muted" text={`Next step: ${moment(row.next_step_at).tz(tz).format("MMM D, h:mm A")}`} />
                    )}
                  </td>
                  <td className="dl_pin dl_pin_act">
                    {/* Always the same four, in the same place; greyed with the reason when one can't be used. */}
                    <div className="dl_actions">
                      {!dnd && row.phone ? <CallButton phone={row.phone} leadId={row.lead_id} dealerId={dealerId}
                        variant="link" size="sm" className="dl_act" iconOnly />
                        : <span className="dl_act off" title={dnd ? "Do not contact (DND)" : "No phone number"}><i className="fa-solid fa-phone"></i></span>}
                      {!dnd ? (
                        <Link href={leadLink(row.lead_id)} className="dl_act" title="Text / email (opens the conversation)" aria-label="Message"
                          onClick={() => rememberBack(leadLink(row.lead_id), "/dealer/desk-log", "Desk Log")}>
                          <i className="fa-regular fa-comment-dots"></i></Link>
                      ) : <span className="dl_act off" title="Do not contact (DND)"><i className="fa-regular fa-comment-dots"></i></span>}
                      {/* 18 Nov 2026: book an appointment (or any status) right here, through the Leads page's status window. */}
                      {!dnd && onStatus ? (
                        <button type="button" className="dl_act" title="Book an appointment / change the lead's status" aria-label="Appointment"
                          onClick={() => onStatus({ leadId: row.lead_id, name: row.customer, status: row.lead_status })}>
                          <i className="fa-regular fa-calendar-plus"></i></button>
                      ) : <span className="dl_act off" title="Do not contact (DND)"><i className="fa-regular fa-calendar-plus"></i></span>}
                      <button type="button" className="dl_act" title="Details, notes and history" aria-label="Details"
                        onClick={() => onOpen({ id: row.id, name: row.customer })}><i className="fa-solid fa-ellipsis-vertical"></i></button>
                    </div>
                  </td>
                  <td className="dl_pin dl_pin_out">
                    <ColorPick value={choice?.value || ""} disabled={busy === row.id} label="Outcome" empty="Pick outcome"
                      style={choice ? choice.style : NO_OUTCOME_STYLE} dark={darkPill(choice?.style)}
                      options={OUTCOME_CHOICES.map((c) => ({ value: c.value, label: c.label, dot: c.style.backgroundColor, icon: OUTCOME_ICON[c.value], ink: c.style.color === "#fff" ? undefined : c.style.color }))}
                      onPick={(v) => { const next = OUTCOME_CHOICES.find((c) => c.value === v); if (next) setPending({ row, choice: next }); }} />
                    {row.outcome_from_lead && <Clip className="small text-muted" text="Set on the Leads page" />}
                    {/* G-016: the sale checked against the dealer's DMS (DealerVault). */}
                    {row.dms?.flag === "not_in_dms" && <Clip className="small text-danger" text="Not in the DMS yet" />}
                    {row.dms?.flag === "dms_delivered" && (
                      <Clip className="small text-danger" text={`DMS shows delivered ${moment(row.dms.date).tz(tz).format("MMM D")}`} />
                    )}
                    {row.checklist && (
                      <Clip className={`small ${row.checklist.done === row.checklist.total ? "text-success" : "text-muted"}`}
                        text={`Delivery checklist ${row.checklist.done}/${row.checklist.total}`} />
                    )}
                    {row.dms?.found && !row.dms.flag && (
                      <Clip className="small text-muted" text={`DMS: ${row.dms.delivered ? "delivered" : "contract"} ${moment(row.dms.date).tz(tz).format("MMM D")}${row.dms.deal_number ? ` · deal ${row.dms.deal_number}` : ""}`} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Customer360Panel show={!!panel360} onHide={() => setPanel360(null)} customerId={panel360?.customerId}
        leadId={panel360?.leadId} name={panel360?.name} dnd={panel360?.dnd} />
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
