"use client";
// One report tab of the Dashboard (SOW 8 Deliverable F; P1 plan items 1, 4, 5), under the Dashboard's own date picker:
// the filter bar, the tab's numbers and its tables. A number tied to leads opens the Leads list with exactly those
// leads (/dealer/leads?report_kpi=<id>, same dates and filters; app/api/leads/route.js), like the Overview cards;
// that list's Export CSV is the list. Numbers come from GET /api/reports/kpis (app/lib/reporting/registry.js).
// Rendered only where the 'reports_page' feature is visible (reportsAccess.js); if the API answers 404 anyway, the
// tab says so. Stays mounted while the user moves between report tabs, so the filters are kept.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Spinner } from "react-bootstrap";
import moment from "moment-timezone";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import FilterBar from "./FilterBar";
import { Breakdown, GroupTable, KpiGrid } from "./KpiCards";
import Definitions from "./Definitions";
import { reportQuery, reportsGet } from "../reportsApi";

const ALL_TIME_FROM = "2015-01-01";
const NO_FILTERS = { source: "", lead_source: "", assigned_to: "", actor: "", appointment_type: "" };
const TREND_KPIS = [["exec.leads_received", "Leads", "#1a73e8"], ["exec.appointments_set", "Appointments set", "#34a853"],
  ["exec.customers_replied", "Customers replied", "#fbbc04"], ["exec.crm_sold", "CRM sold", "#ea4335"]];

// Cards left out of the report tabs because the Overview already shows the same number: Total Leads, Customer
// Replied (leads), Appointments Made, Appointments for These Dates, Appointments Showed. The only difference is
// that the reports leave duplicate bookings (same lead, day and time) out. They still feed the trend, the
// breakdowns and the lead-source table, which split them.
export const OVERVIEW_DUPLICATES = new Set([
  "exec.leads_received", "exec.appointments_set", "exec.appointments_scheduled", "exec.shown",
  "appointments.set", "appointments.scheduled", "appointments.shown",
  "source.leads", "source.replied_leads", "source.appointments", "source.shown",
]);

function Trend({ kpis, from, to }) {
  const [grain, setGrain] = useState("day");
  const data = useMemo(() => {
    const byId = Object.fromEntries(kpis.map((k) => [k.id, k]));
    const buckets = new Map();
    const key = (d) => (grain === "day" ? d : grain === "week" ? moment(d).startOf("week").format("YYYY-MM-DD")
      : d.slice(0, 7));
    for (let d = moment(from); d.isSameOrBefore(to, "day") && buckets.size < 800; d.add(1, "day")) {
      const k = key(d.format("YYYY-MM-DD"));
      if (!buckets.has(k)) buckets.set(k, { date: k });
    }
    for (const [id, label] of TREND_KPIS) {
      for (const [day, n] of Object.entries(byId[id]?.trend || {})) {
        const b = buckets.get(key(day)) || { date: key(day) };
        b[label] = (b[label] || 0) + n;
        buckets.set(key(day), b);
      }
    }
    return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [kpis, from, to, grain]);
  return (
    <div className="w_card mb-3">
      <div className="d-flex align-items-center mb-2">
        <h3 className="w_card_title mb-0 me-auto">Trend</h3>
        {["day", "week", "month"].map((g) => (
          <Button key={g} size="sm" className="ms-1" variant={grain === g ? "dark" : "outline-dark"}
            onClick={() => setGrain(g)}>{g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}</Button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          {TREND_KPIS.map(([, label, color]) => <Bar key={label} dataKey={label} fill={color} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TabBody({ tab, report, linkFor }) {
  const kpis = report.kpis;
  const k = (id) => kpis.find((x) => x.id === id);
  const live = kpis.filter((x) => (x.state === "live" || x.state === "error") && !OVERVIEW_DUPLICATES.has(x.id));
  const notYet = kpis.filter((x) => x.state !== "live" && x.state !== "error");
  return (
    <>
      {tab === "sales" && (
        <Alert variant="info">
          The Sales / Desk Log report is available when the Desk Log is built (Priority 3). Until then these CRM
          status changes stand in for it (marked proxy).
        </Alert>
      )}
      <KpiGrid kpis={live} linkFor={linkFor} />
      {tab === "executive" && <Trend kpis={kpis} from={report.range.from} to={report.range.to} />}
      {tab === "appointments" && (
        <div className="row">
          <div className="col-md-4"><Breakdown kpi={k("appointments.set")} by="creator" title="Set, by who made it" linkFor={linkFor} /></div>
          <div className="col-md-4"><Breakdown kpi={k("appointments.set")} by="department" title="Set, sales / service" linkFor={linkFor} /></div>
          <div className="col-md-4"><Breakdown kpi={k("appointments.set")} by="lead_source" title="Set, by lead source" linkFor={linkFor} /></div>
        </div>
      )}
      {tab === "ai" && (
        <div className="row">
          <div className="col-md-6"><Breakdown kpi={k("ai.handoffs")} by="reason" title="Handoffs by reason" linkFor={linkFor} /></div>
          <div className="col-md-6"><Breakdown kpi={k("ai.messages_sent")} by="channel" title="AI messages by channel" linkFor={linkFor} /></div>
        </div>
      )}
      {tab === "lead_source" && (
        <GroupTable title="Funnel by lead source" firstColumn="Lead source" by="lead_source" linkFor={linkFor}
          kpis={["source.leads", "source.replied_leads", "source.appointments", "source.shown", "source.crm_sold"].map(k)} />
      )}
      {tab === "bdc" && (
        <GroupTable title="By staff member (current lead owner)" firstColumn="Staff" by="staff" linkFor={linkFor}
          kpis={["bdc.assigned_leads", "bdc.speed_to_lead", "bdc.staff_texts", "bdc.staff_emails",
            "bdc.call_tasks_completed", "bdc.meaningful_contacts", "bdc.call_tasks_missed", "bdc.call_tasks_overdue",
            "bdc.appointments_by_owner"].map(k)} />
      )}
      {notYet.length > 0 && (
        <div className="w_card mb-3">
          <h3 className="w_card_title">Not available yet</h3>
          <ul className="mb-0">
            {notYet.map((x) => (
              <li key={x.id}>
                <strong>{x.label}</strong>{" "}
                <small className="text-muted">({x.state === "blocked" ? "blocked" : "needs data"}: {x.reason})</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// range: the Dashboard's picked range ({startDate, endDate}, null dates = All time).
export default function ReportView({ tab, dealerId, tz, range }) {
  const [filters, setFilters] = useState(NO_FILTERS);
  const [options, setOptions] = useState({});
  const [report, setReport] = useState(null);
  const [definitions, setDefinitions] = useState(null);
  const [error, setError] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(false);

  const startKey = range?.startDate ? new Date(range.startDate).toISOString() : "";
  const endKey = range?.endDate ? new Date(range.endDate).toISOString() : "";
  const dates = useMemo(() => {
    const today = moment.tz(tz).format("YYYY-MM-DD");
    return {
      start_date: startKey ? moment.utc(startKey).tz(tz).format("YYYY-MM-DD") : ALL_TIME_FROM,
      end_date: endKey ? moment.utc(endKey).tz(tz).format("YYYY-MM-DD") : today,
    };
  }, [startKey, endKey, tz]);
  const params = useMemo(() => (dealerId ? { dealer_id: dealerId, ...dates, ...filters } : null),
    [dates, dealerId, filters]);

  // The Leads list for one number (or one breakdown group, or a rate's "out of" part): the picked dates as the
  // dealer-local days' instants (as the Overview's links send them) and the tab's filters.
  const linkFor = useCallback((kpi, { by, group, part } = {}) => {
    if (!kpi?.leads_link) return null;
    const q = new URLSearchParams({ report_kpi: kpi.id });
    q.set("startDate", moment.tz(dates.start_date, "YYYY-MM-DD", tz).startOf("day").toISOString());
    q.set("endDate", moment.tz(dates.end_date, "YYYY-MM-DD", tz).endOf("day").toISOString());
    if (part === "denominator") q.set("report_part", "denominator");
    if (by) {
      q.set("report_by", by);
      q.set("report_group", group);
    }
    const f = reportQuery(filters);
    if (f) q.set("report_filters", f);
    return `/dealer/leads?${q.toString()}`;
  }, [dates, tz, filters]);

  const fail = (e) => {
    if (e.status === 404) setHidden(true);
    else setError(e.message);
  };

  useEffect(() => {
    if (!dealerId) return;
    reportsGet({ dealer_id: dealerId, options: 1 }).then(setOptions).catch(fail);
  }, [dealerId]);

  const load = useCallback(() => {
    if (!params) return;
    setError(null);
    if (tab === "definitions") {
      if (!definitions) reportsGet({ dealer_id: params.dealer_id, definitions: 1 }).then(setDefinitions).catch(fail);
      return;
    }
    setLoading(true);
    reportsGet({ ...params, dashboard: tab })
      .then((data) => setReport(data))
      .catch(fail)
      .finally(() => setLoading(false));
  }, [params, tab, definitions]);
  useEffect(() => { load(); }, [load]);

  if (hidden) return <Alert variant="secondary">This report is not available.</Alert>;

  const shown = report && report.dashboard === tab ? report : null;
  return (
    <>
      {tab !== "definitions" && (
        <FilterBar filters={filters} onFilters={setFilters} options={options} />
      )}
      {shown && tab !== "definitions" && (
        <small className="text-muted d-block mb-2">
          Last updated {moment(shown.last_updated).tz(tz).format("MMM D, h:mm A")}
          {shown.cached ? " (refreshes every 5 minutes)" : ""}
        </small>
      )}
      {error && <Alert variant="danger">{error}</Alert>}
      {shown?.unsupported?.length > 0 && (
        <Alert variant="warning">Not applied: {shown.unsupported.map((u) => `${u.key} (${u.reason})`).join("; ")}</Alert>
      )}
      {tab === "definitions" ? (
        definitions ? <Definitions data={definitions} />
          : <div className="text-center py-5"><Spinner animation="border" variant="dark" /></div>
      ) : loading && !shown ? (
        <div className="text-center py-5"><Spinner animation="border" variant="dark" /></div>
      ) : shown ? <TabBody tab={tab} report={shown} linkFor={linkFor} /> : null}
    </>
  );
}
