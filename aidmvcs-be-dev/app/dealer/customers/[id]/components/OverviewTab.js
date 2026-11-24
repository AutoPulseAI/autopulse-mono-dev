"use client";

import { MEANING } from "../../../components/meaningColors";
import { useEffect, useMemo, useState } from "react";
import { Button, ButtonGroup, Form } from "react-bootstrap";
import moment from "moment-timezone";
import { ListPages } from "../../../leads/components/BulkAssign";
import { formatTimestamp } from "../../../../utils/dateUtils";
import { formatCurrency } from "../../../../utils/formatCurrency";
import { leadTypeName } from "../../../leads/components/LeadInfoCard";

function vehicleLabel(record) {
  const parts = [record["Year"], record["Make"], record["Model"]].filter(Boolean);
  return parts.length ? parts.join(" ") : record.vin || null;
}

const TYPE_META = {
  lead: { label: "Lead", variant: "info", icon: "fa-user-plus" },
  deal: { label: "Sale", variant: "success", icon: "fa-file-signature" },
  repair_order: { label: "Service visit", variant: "custom", icon: "fa-wrench" },
  appointment: { label: "Appointment", variant: "warning", icon: "fa-calendar-check" },
  assignment: { label: "Assignment", variant: "secondary", icon: "fa-user-check" },
};

// A lead on the timeline by its kind (19 Nov 2026, SOW reference B6 - "Web Lead", "Phone Up"): the Lead Type the lead
// card shows (LeadInfoCard leadTypeName), so the history reads what came in at a glance.
const LEAD_KIND = {
  Internet: { label: "Web Lead", variant: "info", icon: "fa-globe" },
  "Phone Up": { label: "Phone Up", variant: "info", icon: "fa-phone" },
  "Walk-In": { label: "Walk-In", variant: "info", icon: "fa-person-walking" },
  Campaign: { label: "Campaign Lead", variant: "info", icon: "fa-bullhorn" },
};
const leadMeta = (record) => LEAD_KIND[leadTypeName(record)] || TYPE_META.lead;

// Who did it, for the timeline entries (client, 10 Oct 2026: every staff and AI action is logged).
const ACTOR_META = {
  staff: { label: "Staff", variant: "dark", icon: "fa-user" },
  ai: { label: "AI", variant: "primary", icon: "fa-robot" },
  customer: { label: "Customer", variant: "success", icon: "fa-comment" },
  system: { label: "System", variant: "secondary", icon: "fa-gear" },
};
const FILTERS = [["all", "All"], ["staff", "Staff"], ["ai", "AI"], ["customer", "Customer"]];
const PAGE = 20;

function describeEntry(entry) {
  const { type, record } = entry;
  if (type === "lead") {
    // 19 Nov 2026 (SOW reference B6): what came in and from where - "Cars.com · Chat", the vehicle asked about.
    const from = [record.lead_source || record.source || "unknown source", record.sub_source].filter(Boolean).join(" · ");
    const car = [record.vehicle_year, record.vehicle_make, record.vehicle_model].filter(Boolean).join(" ");
    return `${record.name || "Unnamed lead"} via ${from}${car ? ` - ${car}` : ""}`;
  }
  if (type === "deal") {
    const price = record.computed_price;
    return `${vehicleLabel(record) || "Vehicle"}${price ? ` — ${formatCurrency(price)}` : ""}${record.computed_salesperson ? ` (${record.computed_salesperson})` : ""}`;
  }
  if (type === "repair_order") {
    const { total_sale } = record.computed_totals || {};
    return `${vehicleLabel(record) || "Vehicle"}${total_sale ? ` — ${formatCurrency(total_sale)}` : ""}${record["RO Status"] ? ` (${record["RO Status"]})` : ""}`;
  }
  if (type === "appointment") {
    return `${vehicleLabel(record) || "Vehicle"}${record["Service Advisor Name"] ? ` with ${record["Service Advisor Name"]}` : ""}`;
  }
  if (type === "assignment") {
    const by = record.assigned_by_name || "someone";
    return record.assigned_to_name
      ? `Assigned to ${record.assigned_to_name} by ${by}`
      : `Unassigned by ${by}`;
  }
  return "Activity";
}

// Recent Activity, organized (approved 24 Nov 2026): grouped by day, one kind of thing per chip, one line per entry that
// opens for the detail, with pages.
const KINDS = {
  text: ["Texts", "fa-comment-sms", "#0f8f83"], email: ["Emails", "fa-envelope", "#6f42c1"], call: ["Calls", "fa-phone", "#0272b4"],
  note: ["Notes", "fa-note-sticky", "#d97706"], appointment: ["Appointments", "fa-calendar-check", MEANING.appointment],
  status: ["Status", "fa-circle-half-stroke", "#5f7890"], owner: ["Owner", "fa-user-tie", "#5f7890"], lead: ["Leads", "fa-user-plus", "#0272b4"],
  sale: ["Sales", "fa-handshake", "#2fb344"], service: ["Service", "fa-wrench", "#0f8f83"], other: ["Other", "fa-circle-info", "#5f7890"],
};
function kindOf(e) {
  if (e.type === "lead") return "lead";
  if (e.type === "deal") return "sale";
  if (e.type === "repair_order") return "service";
  if (e.type === "appointment") return "appointment";
  if (e.type === "assignment") return "owner";
  const k = String(e.kind || "");
  if (k === "note" || k === "note_removed") return "note";
  if (k === "message_in" || k === "message_out") return /(^|\] )Email/.test(e.text || "") ? "email" : "text";
  if (k === "lead_edited" || k === "hot_changed") return "lead";
  if (/call/.test(k)) return "call";
  if (/stage|status/.test(k)) return "status";
  if (/assign/.test(k)) return "owner";
  if (/appointment|booking/.test(k)) return "appointment";
  return "other";
}
const KIND_TITLE = { status_changed: "Status changed", lead_edited: "Lead edited", lead_reassigned: "Owner changed", reminder_set: "Task added", reminder_done: "Task done",
  reminder_updated: "Task changed", reminder_removed: "Task removed", note_removed: "Note removed", ai_stage: "Status changed", opt_out: "Opted out", opt_in: "Opted back in",
  customer_merged: "Customers merged", customer_merge_undone: "Merge undone", in_market_changed: "Market status changed", appointment_created: "Appointment set" };
const whoOf = (e) => {
  if (e.type === "activity") return e.who || (ACTOR_META[e.actor] || ACTOR_META.system).label;
  if (e.type === "assignment") return e.record?.assigned_by_name || "Staff";
  return e.type === "lead" ? "System" : "DMS";
};
const whoMeta = (e) => (e.type === "activity" ? (ACTOR_META[e.actor] || ACTOR_META.system) : e.type === "assignment" ? ACTOR_META.staff : ACTOR_META.system);
// One line = what happened (bold) + its detail.
function lineFor(e, text) {
  if (e.type === "lead") return [leadMeta(e.record).label === "Lead" ? "New lead" : `New ${leadMeta(e.record).label.toLowerCase()}`, [e.record.lead_source || e.record.source, e.record.sub_source].filter(Boolean).join(" · ") || text];
  if (e.type === "deal") return ["Sale", text];
  if (e.type === "repair_order") return ["Service visit", text];
  if (e.type === "appointment") return ["Service appointment", text];
  if (e.type === "assignment") return ["Owner changed", text];
  if (e.kind === "note") return ["Internal note", text.replace(/^Note:\s*/, "")];
  const m = /^(\[[^\]]+\] )?(Text|Email) (from the customer|sent[^:]*): (.*)$/s.exec(text);
  if (m) return [`${m[1] || ""}${m[2]} ${m[3] === "from the customer" ? "received" : m[3]}`, m[4]];
  const title = KIND_TITLE[e.kind] || String(e.kind || "Activity").replace(/^appointment_/, "Appointment ").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const who = e.who && text.startsWith(`${e.who} `) ? text.slice(e.who.length + 1) : text;
  return [title, who.replace(/^./, (c) => c.toUpperCase())];
}
const dayLabel = (at) => (at ? moment(at).format("ddd, MMM D, YYYY") : "Date unknown");

export default function OverviewTab({ overview, activity = [] }) {
  const [filter, setFilter] = useState("all");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(1);
  const [leadFilter, setLeadFilter] = useState("");
  const [days, setDays] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null);
  const leadOptions = overview.filter((e) => e.type === "lead" && e.record?._id)
    .map((e) => ({ id: String(e.record._id), label: `${e.record.lead_source || e.record.source || "Lead"}${e.at ? ` · ${moment(e.at).format("MMM D, YYYY")}` : ""}` }));
  const leadOf = (e) => String(e.type === "lead" ? e.record?._id : e.lead_id || "");
  const textOf = (e) => (e.type === "activity" ? e.text : describeEntry(e));
  // Which opportunity a line belongs to: its vehicle, else its source.
  const oppNames = new Map(overview.filter((e) => e.type === "lead" && e.record?._id).map((e) => [String(e.record._id),
    [e.record.vehicle_year, e.record.vehicle_make, e.record.vehicle_model].filter(Boolean).join(" ") || e.record.lead_source || e.record.source || "Lead"]));
  const oppOf = (e) => oppNames.get(leadOf(e)) || "";
  const all = useMemo(() => [...overview, ...activity].map((e, i) => ({ ...e, _key: `${e.type}-${e.record?._id || e.kind || ""}-${i}`, _kind: kindOf(e) }))
    .sort((a, b) => (a.at && b.at ? new Date(b.at) - new Date(a.at) : a.at ? -1 : b.at ? 1 : 0)), [overview, activity]);
  const since = days ? Date.now() - Number(days) * 864e5 : null;
  const needle = query.trim().toLowerCase();
  const base = all
    .filter((e) => filter === "all" || (e.type === "activity" ? e.actor === filter : filter === "staff" && e.type === "assignment"))
    .filter((e) => !leadFilter || leadOf(e) === leadFilter)
    .filter((e) => !since || (e.at && new Date(e.at).getTime() >= since))
    .filter((e) => !needle || String(e.full || textOf(e)).toLowerCase().includes(needle));
  const rows = base.filter((e) => kind === "all" || e._kind === kind);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const visible = rows.slice((current - 1) * PAGE, current * PAGE);
  useEffect(() => { setPage(1); setOpen(null); }, [filter, kind, leadFilter, days, needle]);
  const present = Object.keys(KINDS).filter((k) => base.some((e) => e._kind === k));
  let lastDay = null;
  return (
    <div className="w_card">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <h3 className="w_card_title mb-0 me-auto"><i className="fa-solid fa-clock-rotate-left me-2" style={{ color: "#5f7890" }} aria-hidden="true" />Recent Activity</h3>
        <Form.Control size="sm" style={{ width: 220 }} placeholder="Search recent activity" aria-label="Search recent activity" value={query} onChange={(e) => setQuery(e.target.value)} />
        {leadOptions.length > 1 && (
          <Form.Select size="sm" className="w-auto" value={leadFilter} aria-label="Show one lead" onChange={(e) => setLeadFilter(e.target.value)}>
            <option value="">All opportunities</option>
            {leadOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Form.Select>
        )}
        <Form.Select size="sm" className="w-auto" value={days} aria-label="Period" onChange={(e) => setDays(e.target.value)}>
          <option value="">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
        </Form.Select>
        <ButtonGroup size="sm">
          {FILTERS.map(([key, label]) => <Button key={key} variant={filter === key ? "custom" : "outline-custom"} onClick={() => setFilter(key)}>{label}</Button>)}
        </ButtonGroup>
      </div>
      <div className="ra_types">
        <button type="button" className={kind === "all" ? "on" : ""} onClick={() => setKind("all")}>All <b>{base.length}</b></button>
        {present.map((k) => (
          <button type="button" key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
            <i className={`fa-solid ${KINDS[k][1]} me-1`} style={{ color: KINDS[k][2] }} aria-hidden="true" />{KINDS[k][0]} <b>{base.filter((e) => e._kind === k).length}</b>
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="text-center py-4 text-muted">{all.length ? "No activity matches these filters." : "No activity found."}</div>
      ) : visible.map((entry) => {
        const day = dayLabel(entry.at);
        const showDay = day !== lastDay;
        lastDay = day;
        const k = KINDS[entry._kind];
        const who = whoOf(entry);
        const meta = whoMeta(entry);
        const isOpen = open === entry._key;
        const [title, line] = lineFor(entry, textOf(entry));
        const opp = oppOf(entry);
        return (
          <div key={entry._key}>
            {showDay && <div className="ra_day">{day}</div>}
            <button type="button" className={`ra_row${isOpen ? " on" : ""}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : entry._key)}>
              <span className="ra_icon" style={{ background: k[2] }}><i className={`fa-solid ${k[1]}`} aria-hidden="true" /></span>
              <span className="ra_main"><b>{title}</b><span>{line}</span></span>
              <span className="ra_opp" title={opp}>{opp}</span>
              <span className="ra_who" title={who}><i className={`fa-solid ${meta.icon} me-1`} aria-hidden="true" />{who}</span>
              <span className="ra_time">{entry.at ? moment(entry.at).format("h:mm A") : ""}</span>
              <i className={`fa-solid fa-chevron-${isOpen ? "up" : "down"} text-muted`} aria-hidden="true" />
            </button>
            {isOpen && <div className="ra_detail"><b>Details:</b> {entry.full || entry.detail || line}<br />{opp && <><b>Opportunity:</b> {opp} · </>}<b>By:</b> {who}{entry.at ? ` · ${formatTimestamp(entry.at)}` : ""}</div>}
          </div>
        );
      })}
      {pages > 1 && <div className="mt-3"><ListPages current={current} total={pages} onPage={setPage} /></div>}
    </div>
  );
}
