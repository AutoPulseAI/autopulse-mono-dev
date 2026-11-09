"use client";
// One filter bar for every Reports tab. Only the filters app/lib/reporting/filters.js supports for the Reports page
// (REPORTS.KPI_REPORTS): date range (dealer time zone, the Dashboard's picker), source, lead source, assigned staff,
// AI / human and sales / service. Campaign and new / used are not offered: the data isn't there yet.
import { Button, Form } from "react-bootstrap";
import DashboardDatePicker from "../../dashboard/components/DashboardDatePicker";

export default function FilterBar({ range, onRange, timezone, filters, onFilters, options }) {
  const set = (key) => (e) => onFilters({ ...filters, [key]: e.target.value });
  const any = Object.values(filters).some(Boolean);
  return (
    <div className="w_card mb-3">
      <div className="d-flex flex-wrap align-items-center gap-2">
        <DashboardDatePicker value={range} onChange={onRange} timezone={timezone} />
        <small className="text-muted" title={`All dates are your business days in ${timezone}`}>
          <i className="fa-solid fa-clock me-1"></i>{timezone.split("/").pop()}
        </small>
        <Form.Select size="sm" style={{ width: "auto" }} value={filters.source} onChange={set("source")}
          aria-label="Source">
          <option value="">All sources</option>
          {(options.sources || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </Form.Select>
        <Form.Select size="sm" style={{ width: "auto" }} value={filters.lead_source} onChange={set("lead_source")}
          aria-label="Lead source">
          <option value="">All lead sources</option>
          {(options.lead_sources || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </Form.Select>
        <Form.Select size="sm" style={{ width: "auto" }} value={filters.assigned_to} onChange={set("assigned_to")}
          aria-label="Assigned staff">
          <option value="">All staff</option>
          {(options.staff || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Form.Select>
        <Form.Select size="sm" style={{ width: "auto" }} value={filters.actor} onChange={set("actor")}
          aria-label="AI or human">
          <option value="">AI and human</option>
          <option value="ai">AI</option>
          <option value="human">Human</option>
        </Form.Select>
        <Form.Select size="sm" style={{ width: "auto" }} value={filters.appointment_type}
          onChange={set("appointment_type")} aria-label="Sales or service">
          <option value="">Sales and service</option>
          <option value="sales">Sales</option>
          <option value="service">Service</option>
        </Form.Select>
        {any && (
          <Button size="sm" variant="link" onClick={() => onFilters({ source: "", lead_source: "", assigned_to: "",
            actor: "", appointment_type: "" })}>Clear filters</Button>
        )}
      </div>
    </div>
  );
}
