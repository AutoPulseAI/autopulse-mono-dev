"use client";
// Clickable charts for each report section of the Dashboard (Bibi, 11 Nov 2026: charts instead of number cards, like
// the DealerSocket dashboard). Every bar or slice opens the same Leads list its number opens (linkFor: /dealer/leads?
// report_kpi=..., same dates and filters), so a chart never shows a number the cards and tables don't. Only live
// counts are charted; rates, medians and numbers that are not available yet stay in the "All numbers" section.
// Colours: fixed categorical order (dataviz reference palette), one colour for single-series charts.
import { useMemo, useState } from "react";
import { Button } from "react-bootstrap";
import { openFromDashboard } from "../../components/backLink";
import moment from "moment-timezone";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis,
  YAxis } from "recharts";

export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const OTHER = "#8c8b84";
const TOP = 8;
const INK = "#3d3d3a";
// Text in ink, not the series colour (the coloured mark beside it carries the identity).
const legendText = (text) => <span style={{ color: INK }}>{text}</span>;
const hideZero = (v) => (v ? v : "");

const isCount = (k) => k && k.state === "live" && k.kind === "count";
// Opens the Leads list in this tab, with a way back to the Dashboard (../../components/backLink.js).
const go = (row) => openFromDashboard(row?.payload?.link ?? row?.link);

function ChartCard({ title, children, className = "col-lg-6 col-12" }) {
  return (
    <div className={`col ${className} mb-3`}>
      <div className="w_card h-100">
        <h3 className="w_card_title">{title}</h3>
        {children}
      </div>
    </div>
  );
}

const Empty = () => <small className="text-muted">Nothing in this range.</small>;

// Horizontal bars, one colour: rows [{ name, value, link }].
function HBars({ rows }) {
  if (!rows.some((r) => r.value > 0)) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 34 + 30)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 40 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 12 }} />
        <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        <Bar dataKey="value" name="Count" fill={SERIES[0]} radius={[0, 4, 4, 0]} barSize={18} onClick={go}>
          {rows.map((r) => <Cell key={r.name} fill={r.other ? OTHER : SERIES[0]}
            cursor={r.link ? "pointer" : "default"} />)}
          <LabelList dataKey="value" position="right" fontSize={12} fill={INK} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Donut, fixed colour order by the order the rows are given in.
function Donut({ rows }) {
  const shown = rows.filter((r) => r.value > 0);
  if (!shown.length) return <Empty />;
  const total = shown.reduce((s, r) => s + r.value, 0);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={shown} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={1}
          stroke="#fff" strokeWidth={2} onClick={go}>
          {shown.map((r) => <Cell key={r.name} fill={r.other ? OTHER : SERIES[rows.indexOf(r) % SERIES.length]}
            cursor={r.link ? "pointer" : "default"} />)}
        </Pie>
        <Tooltip formatter={(v) => [`${v} of ${total}`, null]} />
        <Legend formatter={(name, entry) => legendText(`${name} (${entry?.payload?.value ?? 0})`)} />
      </PieChart>
    </ResponsiveContainer>
  );
}

const draw = (type, rows) => (type === "donut" ? <Donut rows={rows} /> : <HBars rows={rows} />);

// One bar / slice per KPI (e.g. Leads -> Replied -> Appointments -> Shown -> Sold).
export function KpiChart({ kpis, title, linkFor, type = "bar", className }) {
  const live = kpis.filter(isCount);
  if (!live.length) return null;
  const rows = live.map((k) => ({ name: k.label, value: Number(k.value) || 0, link: linkFor?.(k) || null }));
  return <ChartCard title={title} className={className}>{draw(type, rows)}</ChartCard>;
}

// One KPI split by a breakdown (e.g. appointments set, by lead source). Past the top 8, groups fold into "Other".
export function BreakdownChart({ kpi, by, title, linkFor, type = "bar", className }) {
  if (!isCount(kpi) || !kpi.breakdowns?.[by]) return null;
  const groups = [...kpi.breakdowns[by]].sort((a, b) => b.count - a.count);
  const rows = groups.slice(0, TOP).map((g) => ({ name: String(g.key), value: g.count,
    link: g.count ? linkFor?.(kpi, { by, group: g.key }) || null : null }));
  const rest = groups.slice(TOP).reduce((s, g) => s + g.count, 0);
  if (rest) rows.push({ name: "Other", value: rest, link: null, other: true });
  return <ChartCard title={title} className={className}>{draw(type, rows)}</ChartCard>;
}

// Several KPIs side by side for each group (e.g. per lead source: leads, appointments, shown, sold). Groups are the
// top 8 by the first KPI; each bar opens that KPI's leads for that group.
export function GroupBars({ kpis, by, title, linkFor, className = "col-12" }) {
  const live = kpis.filter((k) => isCount(k) && k.breakdowns?.[by]);
  if (!live.length) return null;
  const count = (k, key) => k.breakdowns[by].find((g) => g.key === key)?.count || 0;
  const keys = [...new Set(live.flatMap((k) => k.breakdowns[by].map((g) => g.key)))]
    .sort((a, b) => count(live[0], b) - count(live[0], a)).slice(0, TOP);
  const data = keys.map((key) => Object.fromEntries([["name", String(key)],
    ...live.map((k) => [k.label, count(k, key)])]));
  return (
    <ChartCard title={title} className={className}>
      {keys.length ? (
        <ResponsiveContainer width="100%" height={Math.max(160, keys.length * (live.length * 12 + 20) + 60)}>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 40 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 12 }} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Legend formatter={legendText} />
            {live.map((k, i) => (
              <Bar key={k.id} dataKey={k.label} fill={SERIES[i % SERIES.length]} radius={[0, 4, 4, 0]} barSize={10}
                cursor="pointer"
                onClick={(row) => {
                  const group = keys.find((key) => String(key) === row?.payload?.name);
                  if (group != null && count(k, group)) go({ link: linkFor?.(k, { by, group }) });
                }}>
                <LabelList dataKey={k.label} position="right" fontSize={11} fill={INK} formatter={hideZero} />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : <Empty />}
    </ChartCard>
  );
}

const TREND_KPIS = [["exec.leads_received", "Leads"], ["exec.appointments_set", "Appointments set"],
  ["exec.customers_replied", "Customers replied"], ["exec.crm_sold", "CRM sold"]];

// Leads, replies, appointments and sales per day / week / month. A bar opens that day's (week's, month's) leads.
export function Trend({ kpis, from, to, linkFor }) {
  const [grain, setGrain] = useState("day");
  const byId = useMemo(() => Object.fromEntries(kpis.filter(Boolean).map((k) => [k.id, k])), [kpis]);
  const data = useMemo(() => {
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
    const rows = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
    // Start at the first day with anything (All time would otherwise begin in 2015).
    const first = rows.findIndex((r) => Object.keys(r).length > 1);
    return first > 0 ? rows.slice(first) : rows;
  }, [byId, from, to, grain]);
  if (!TREND_KPIS.some(([id]) => byId[id])) return null;
  return (
    <div className="col col-12 mb-3">
      <div className="w_card">
        <div className="d-flex align-items-center mb-2">
          <h3 className="w_card_title mb-0 me-auto">Over time</h3>
          {["day", "week", "month"].map((g) => (
            <Button key={g} size="sm" className="ms-1" variant={grain === g ? "dark" : "outline-dark"}
              onClick={() => setGrain(g)}>{g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}</Button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" />
            <YAxis allowDecimals={false} />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Legend formatter={legendText} />
            {TREND_KPIS.map(([id, label], i) => (
              <Bar key={label} dataKey={label} fill={SERIES[i]} radius={[4, 4, 0, 0]} cursor="pointer"
                onClick={(row) => {
                  const day = row?.payload?.date;
                  const kpi = byId[id];
                  if (!day || !kpi || !row?.payload?.[label]) return;
                  const start = moment(day).startOf(grain).format("YYYY-MM-DD");
                  const end = moment(day).endOf(grain).format("YYYY-MM-DD");
                  go({ link: linkFor?.(kpi, { from: start < from ? from : start, to: end > to ? to : end }) });
                }} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// The charts of one Dashboard section (ReportSections.js). `k(id)` returns a KPI by id from the section's reports
// (undefined while loading or missing), `kpisOf(dashboard)` all of one report's KPIs, `range` the report's dates.
export function SectionCharts({ section, k, kpisOf, range, linkFor }) {
  const ids = (list) => list.map(k);
  let charts = null;
  if (section === "sources") {
    charts = (
      <>
        <GroupBars title="Top sources: leads, appointments, shown, sold" by="lead_source" linkFor={linkFor}
          kpis={ids(["source.leads", "source.appointments", "source.shown", "source.crm_sold"])} />
        <BreakdownChart title="Leads by source" kpi={k("source.leads")} by="lead_source" type="donut"
          linkFor={linkFor} />
        <BreakdownChart title="Campaign leads" kpi={k("source.campaign_leads")} by="campaign" linkFor={linkFor} />
      </>
    );
  } else if (section === "outcomes") {
    charts = (
      <>
        <KpiChart title="Leads to sale" linkFor={linkFor}
          kpis={ids(["exec.leads_received", "exec.customers_replied", "exec.appointments_set", "exec.shown",
            "exec.crm_sold"])} />
        <KpiChart title="What happened to the appointments" type="donut" linkFor={linkFor}
          kpis={ids(["appointments.shown", "appointments.no_show", "appointments.not_recorded",
            "appointments.upcoming"])} />
        <KpiChart title="Appointments: sales / service" type="donut" linkFor={linkFor}
          kpis={ids(["appointments.sales", "appointments.service"])} />
        {range && <Trend kpis={ids(TREND_KPIS.map(([id]) => id))} from={range.from} to={range.to}
          linkFor={linkFor} />}
      </>
    );
  } else if (section === "work") {
    charts = (
      <>
        <KpiChart title="Appointments: who made them" type="donut" linkFor={linkFor}
          kpis={ids(["appointments.by_ai", "appointments.ai_assisted", "appointments.human_only",
            "appointments.unknown_creator"])} />
        <BreakdownChart title="AI handoffs to staff, by reason" kpi={k("ai.handoffs")} by="reason"
          linkFor={linkFor} />
        <GroupBars title="By staff member" by="staff" linkFor={linkFor}
          kpis={ids(["bdc.staff_texts", "bdc.staff_emails", "bdc.call_tasks_completed",
            "bdc.appointments_by_owner"])} />
        <KpiChart title="Call tasks" linkFor={linkFor}
          kpis={ids(["bdc.call_tasks_completed", "bdc.meaningful_contacts", "bdc.call_tasks_missed",
            "bdc.call_tasks_overdue"])} />
      </>
    );
  } else if (section === "sales") {
    charts = (
      <>
        <BreakdownChart title="CRM sold, by source" kpi={k("exec.crm_sold")} by="lead_source" linkFor={linkFor} />
        <KpiChart title="Sales status changes" kpis={kpisOf("sales")} linkFor={linkFor} />
      </>
    );
  } else if (section === "service") {
    charts = (
      <>
        <KpiChart title="Service customers" linkFor={linkFor}
          kpis={ids(["service.active_customers", "service.inactive_customers", "service.vehicles_on_file"])} />
        <BreakdownChart title="Service outreach, by type" kpi={k("service.reminders_sent")} by="event_type"
          type="donut" linkFor={linkFor} />
        <BreakdownChart title="Service appointments, by who made them" kpi={k("service.appointments_set")}
          by="creator" type="donut" linkFor={linkFor} />
      </>
    );
  } else if (section === "health") {
    charts = <KpiChart title="Data health" kpis={kpisOf("data_quality")} linkFor={linkFor} className="col-12" />;
  }
  return <div className="row gx-2 gx-lg-4">{charts}</div>;
}
