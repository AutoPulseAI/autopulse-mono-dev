"use client";
// Clickable charts on top of each report tab (Bibi, 11 Nov 2026: charts instead of number cards, like the
// DealerSocket dashboard). Every bar or slice opens the same Leads list its number opens (linkFor: /dealer/leads?
// report_kpi=..., same dates and filters), so a chart never shows a number the cards and tables don't. Only live
// counts are charted; rates, medians and numbers that are not available yet stay in the "All numbers" section.
// Colours: fixed categorical order (dataviz reference palette), one colour for single-series charts.
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
const go = (row) => {
  const link = row?.payload?.link ?? row?.link;
  if (link) window.location.assign(link);
};

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

// The charts for each tab. `k(id)` returns the tab's KPI by id (undefined when missing).
export function TabCharts({ tab, k, kpis, linkFor }) {
  const ids = (list) => list.map(k);
  let charts = null;
  if (tab === "executive") {
    charts = (
      <>
        <KpiChart title="Leads to sale" linkFor={linkFor}
          kpis={ids(["exec.leads_received", "exec.customers_replied", "exec.appointments_set", "exec.shown",
            "exec.crm_sold"])} />
        <BreakdownChart title="Appointments set, by who made them" kpi={k("exec.appointments_set")} by="creator"
          type="donut" linkFor={linkFor} />
        <BreakdownChart title="Leads by source" kpi={k("exec.leads_received")} by="lead_source" linkFor={linkFor} />
        <BreakdownChart title="CRM sold, by source" kpi={k("exec.crm_sold")} by="lead_source" linkFor={linkFor} />
      </>
    );
  } else if (tab === "appointments") {
    charts = (
      <>
        <KpiChart title="What happened to them" type="donut" linkFor={linkFor}
          kpis={ids(["appointments.shown", "appointments.no_show", "appointments.not_recorded",
            "appointments.upcoming"])} />
        <KpiChart title="Who made them" type="donut" linkFor={linkFor}
          kpis={ids(["appointments.by_ai", "appointments.ai_assisted", "appointments.human_only",
            "appointments.unknown_creator"])} />
        <KpiChart title="Sales / service" type="donut" linkFor={linkFor}
          kpis={ids(["appointments.sales", "appointments.service"])} />
        <BreakdownChart title="Appointments set, by lead source" kpi={k("appointments.set")} by="lead_source"
          linkFor={linkFor} />
      </>
    );
  } else if (tab === "ai") {
    charts = (
      <>
        <KpiChart title="Appointments from the AI" linkFor={linkFor}
          kpis={ids(["ai.appointments_ai", "ai.appointments_assisted"])} />
        <BreakdownChart title="AI messages, by channel" kpi={k("ai.messages_sent")} by="channel" type="donut"
          linkFor={linkFor} />
        <BreakdownChart title="Handoffs to staff, by reason" kpi={k("ai.handoffs")} by="reason" linkFor={linkFor} />
        <BreakdownChart title="AI conversations, by lead source" kpi={k("ai.conversations")} by="lead_source"
          linkFor={linkFor} />
      </>
    );
  } else if (tab === "lead_source") {
    charts = (
      <>
        <GroupBars title="Top sources: leads, appointments, shown, sold" by="lead_source" linkFor={linkFor}
          kpis={ids(["source.leads", "source.appointments", "source.shown", "source.crm_sold"])} />
        <BreakdownChart title="Leads by source" kpi={k("source.leads")} by="lead_source" type="donut"
          linkFor={linkFor} />
        <BreakdownChart title="Campaign leads" kpi={k("source.campaign_leads")} by="campaign" linkFor={linkFor} />
      </>
    );
  } else if (tab === "bdc") {
    charts = (
      <>
        <GroupBars title="By staff member" by="staff" linkFor={linkFor}
          kpis={ids(["bdc.staff_texts", "bdc.staff_emails", "bdc.call_tasks_completed",
            "bdc.appointments_by_owner"])} />
        <KpiChart title="Call tasks" linkFor={linkFor}
          kpis={ids(["bdc.call_tasks_completed", "bdc.meaningful_contacts", "bdc.call_tasks_missed",
            "bdc.call_tasks_overdue"])} />
        <BreakdownChart title="Leads with no response yet, by source" kpi={k("bdc.no_response")} by="lead_source"
          linkFor={linkFor} />
      </>
    );
  } else if (tab === "service") {
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
  } else {
    // Data quality, Sales / Desk Log: one bar per number.
    charts = <KpiChart title="Numbers in this range" kpis={kpis} linkFor={linkFor} className="col-12" />;
  }
  return <div className="row gx-2 gx-lg-4">{charts}</div>;
}
