"use client";

import { useState } from "react";
import { Badge, Button, ButtonGroup, Form, ListGroup } from "react-bootstrap";
import { formatTimestamp } from "../../../../utils/dateUtils";
import { formatCurrency } from "../../../../utils/formatCurrency";

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

// Who did it, for the timeline entries (client, 10 Oct 2026: every staff and AI action is logged).
const ACTOR_META = {
  staff: { label: "Staff", variant: "dark", icon: "fa-user" },
  ai: { label: "AI", variant: "primary", icon: "fa-robot" },
  customer: { label: "Customer", variant: "success", icon: "fa-comment" },
  system: { label: "System", variant: "secondary", icon: "fa-gear" },
};
const FILTERS = [["all", "All"], ["staff", "Staff"], ["ai", "AI"], ["customer", "Customer"]];
const PAGE = 50;

function describeEntry(entry) {
  const { type, record } = entry;
  if (type === "lead") {
    return `${record.name || "Unnamed lead"} via ${record.source || record.lead_source || "unknown source"}`;
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

export default function OverviewTab({ overview, activity = [] }) {
  const [filter, setFilter] = useState("all");
  const [shown, setShown] = useState(PAGE);
  // G-026: narrow the timeline to one lead and / or a recent period; open a long message in full.
  const [leadFilter, setLeadFilter] = useState("");
  const [days, setDays] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const leadOptions = overview.filter((e) => e.type === "lead" && e.record?._id)
    .map((e) => ({ id: String(e.record._id), label: `${e.record.source || e.record.lead_source || "Lead"}${e.at ? ` · ${new Date(e.at).toLocaleDateString()}` : ""}` }));
  const leadOf = (e) => String(e.type === "lead" ? e.record?._id : e.lead_id || "");
  const since = days ? Date.now() - Number(days) * 864e5 : null;
  const merged = [...overview, ...activity]
    .filter((e) => filter === "all" || (e.type === "activity" ? e.actor === filter : filter === "staff" && e.type === "assignment"))
    .filter((e) => !leadFilter || leadOf(e) === leadFilter)
    .filter((e) => !since || (e.at && new Date(e.at).getTime() >= since))
    .sort((a, b) => (a.at && b.at ? new Date(b.at) - new Date(a.at) : a.at ? -1 : b.at ? 1 : 0));
  const visible = merged.slice(0, shown);
  return (
    <div className="w_card">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <h3 className="w_card_title mb-0 me-auto">Recent Activity</h3>
        {leadOptions.length > 1 && (
          <Form.Select size="sm" className="w-auto" value={leadFilter} aria-label="Show one lead"
            onChange={(e) => { setLeadFilter(e.target.value); setShown(PAGE); }}>
            <option value="">All leads</option>
            {leadOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Form.Select>
        )}
        <Form.Select size="sm" className="w-auto" value={days} aria-label="Period"
          onChange={(e) => { setDays(e.target.value); setShown(PAGE); }}>
          <option value="">All time</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </Form.Select>
        <ButtonGroup size="sm">
          {FILTERS.map(([key, label]) => (
            <Button key={key} variant={filter === key ? "custom" : "outline-custom"}
              onClick={() => { setFilter(key); setShown(PAGE); }}>{label}</Button>
          ))}
        </ButtonGroup>
      </div>
      {merged.length === 0 ? (
        <div className="text-center py-4 text-muted">{leadFilter || days ? "Nothing for this lead or period." : "No activity found for this customer yet."}</div>
      ) : (
        <ListGroup variant="flush">
          {visible.map((entry, index) => {
            const meta = entry.type === "activity"
              ? (ACTOR_META[entry.actor] || ACTOR_META.system)
              : TYPE_META[entry.type] || { label: entry.type, variant: "secondary", icon: "fa-circle" };
            return (
              <ListGroup.Item key={`${entry.type}-${entry.record?._id || entry.kind || ""}-${index}`} className="px-0">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                  <div>
                    <Badge bg={meta.variant} className="me-2">
                      <i className={`fa-solid ${meta.icon} me-1`} />{meta.label}
                    </Badge>
                    {entry.type === "activity" ? (open.has(index) && entry.full ? entry.full : entry.text) : describeEntry(entry)}
                    {entry.full && (
                      <Button variant="link" size="sm" className="p-0 ms-1 align-baseline"
                        onClick={() => setOpen((cur) => { const next = new Set(cur); next.has(index) ? next.delete(index) : next.add(index); return next; })}>
                        {open.has(index) ? "less" : "more"}
                      </Button>
                    )}
                  </div>
                  <small className="text-muted">{entry.at ? formatTimestamp(entry.at) : "Date unknown"}</small>
                </div>
              </ListGroup.Item>
            );
          })}
        </ListGroup>
      )}
      {merged.length > shown && (
        <div className="text-center mt-3 mb-2">
          <Button size="sm" variant="outline-custom" onClick={() => setShown(shown + PAGE)}>
            Show more ({merged.length - shown} older)
          </Button>
        </div>
      )}
    </div>
  );
}
