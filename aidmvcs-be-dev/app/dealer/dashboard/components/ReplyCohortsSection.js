"use client";
// "Customer replies by lead age" (P1 plan item 2, G-043..G-047) and the appointment split (item 3), under the
// dashboard's card row. Shown only when /api/reports/reply-cohorts answers (the feature is visible to this caller -
// admins first); otherwise nothing is rendered and the dashboard is exactly as before. Counts distinct customers per
// dealer-local day (app/lib/reporting/replyCohorts.js), unlike the lead-based "Customer Replied" card above it.
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import CountCard from "./CountCard";

const BUCKET_BARS = [
  ["d0", "0 (today)"], ["d1_6", "1-6"], ["d7_14", "7-14"], ["d15_29", "15-29"], ["d30_59", "30-59"],
  ["d60_plus", "60+"], ["needs_review", "Needs review"],
];
// Each bar's /dealer/leads?reply_cohort= value (app/lib/reporting/drillLeads.js). Needs review has no single lead: its
// bar is not clickable.
const BAR_COHORT = { d0: "b0", d1_6: "b1_6", d7_14: "b7_14", d15_29: "b15_29", d30_59: "b30_59", d60_plus: "b60" };

function authHeaders() {
  try {
    return { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` };
  } catch {
    return {};
  }
}

function rangeQuery(dealerId, startDate, endDate) {
  const q = new URLSearchParams({ dealer_id: dealerId });
  if (startDate && endDate) {
    q.set("start_date", new Date(startDate).toISOString());
    q.set("end_date", new Date(endDate).toISOString());
  }
  return q;
}

export default function ReplyCohortsSection({ dealerId, startDate, endDate, rangeText }) {
  const [state, setState] = useState({ status: "loading", data: null });
  const [split, setSplit] = useState(null);

  const startKey = startDate ? new Date(startDate).toISOString() : "";
  const endKey = endDate ? new Date(endDate).toISOString() : "";

  useEffect(() => {
    if (!dealerId) return undefined;
    let cancelled = false;
    setState({ status: "loading", data: null });
    setSplit(null);
    const q = rangeQuery(dealerId, startKey || null, endKey || null).toString();
    fetch(`/api/reports/reply-cohorts?${q}`, { headers: authHeaders() })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) setState({ status: "ok", data: await res.json() });
        else if (res.status === 400) setState({ status: "needs_range", data: null }); // visible, but All time
        else setState({ status: "hidden", data: null });
      })
      .catch(() => { if (!cancelled) setState({ status: "hidden", data: null }); });
    fetch(`/api/reports/appointment-split?${q}`, { headers: authHeaders() })
      .then(async (res) => { if (!cancelled && res.ok) setSplit(await res.json()); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dealerId, startKey, endKey]);

  if (state.status === "hidden" || state.status === "loading") return null;

  // Like every other dashboard card: the leads list with this card's filter and the picked dates (the same
  // startDate/endDate params the cards above send).
  const leadsLink = (param, value) => {
    const q = new URLSearchParams({ [param]: value });
    if (startKey && endKey) {
      q.set("startDate", startKey);
      q.set("endDate", endKey);
    }
    return `/dealer/leads?${q.toString()}`;
  };
  const openLeads = (param, value) => window.open(leadsLink(param, value), "_blank", "noopener,noreferrer");
  const onBarClick = (entry) => {
    const key = entry?.key ?? entry?.payload?.key;
    if (BAR_COHORT[key]) openLeads("reply_cohort", BAR_COHORT[key]);
  };
  const apptLink = (category, text, n) => (
    <a href={leadsLink("appt_attribution", category)} target="_blank" rel="noopener noreferrer"
      title="Open these appointments' leads">{text} {n}</a>
  );

  if (state.status === "needs_range") {
    return (
      <div className="dashboard_counts">
        <div className="w_card">
          <h3 className="w_card_title mb-1">Customer replies by lead age</h3>
          <small className="text-muted">Pick a date range (up to a year) to see customer replies by lead age.</small>
        </div>
      </div>
    );
  }

  const d = state.data;
  const t = d.totals || {};
  const c = d.cumulative || {};
  const days = d.range?.from && d.range?.to && d.range.from !== d.range.to;
  const basisNote = days ? " · a customer replying on several days counts once per day" : "";
  const chartData = BUCKET_BARS.map(([key, name]) => ({ key, name, value: d.buckets?.[key] || 0 }));
  const s = split?.totals;

  return (
    <div className="dashboard_counts">
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
        <h3 className="w_card_title mb-0">
          Customer replies by lead age
          <small className="text-muted ms-2" style={{ fontSize: "0.75rem" }}>Admin preview · {rangeText}</small>
        </h3>
      </div>

      <div className="row gx-2 gx-lg-4">
        <CountCard iconClass="fa-light fa-calendar-day" count={t.todays_leads_replied ?? 0}
          label="Replied from Today's Leads" link={leadsLink("reply_cohort", "today")} description={`Lead received the same day as the reply${basisNote}`} />
        <CountCard iconClass="fa-light fa-clock-rotate-left" count={t.past_leads_replied ?? 0}
          label="Replied from Past Leads" link={leadsLink("reply_cohort", "past")} description="Lead received 1 or more days before the reply" />
        <CountCard iconClass="fa-light fa-users" count={t.customers_replied ?? 0} label="Total Customers Replied"
          link={leadsLink("reply_cohort", "all")}
          description={`Today's + past + needs review (${t.needs_review ?? 0}) · ${t.inbound_messages ?? 0} messages`} />
      </div>

      <small className="text-muted d-block mb-2">
        <i className="fa-regular fa-circle-info me-1"></i>
        These overlap — don&apos;t add them up (a 60+ day customer is also in 7+, 15+ and 30+).
      </small>
      <div className="row gx-2 gx-lg-4">
        <CountCard iconClass="fa-light fa-hourglass-start" count={c.d7 ?? 0} label="Replied, lead 7+ days old"
          link={leadsLink("reply_cohort", "d7")} />
        <CountCard iconClass="fa-light fa-hourglass-half" count={c.d15 ?? 0} label="Replied, lead 15+ days old"
          link={leadsLink("reply_cohort", "d15")} />
        <CountCard iconClass="fa-light fa-hourglass-end" count={c.d30 ?? 0} label="Replied, lead 30+ days old"
          link={leadsLink("reply_cohort", "d30")} />
        <CountCard iconClass="fa-light fa-hourglass" count={c.d60 ?? 0} label="Replied, lead 60+ days old"
          link={leadsLink("reply_cohort", "d60")} />
      </div>

      <div className="row gx-2 gx-xl-3">
        <div className="col col-lg-12 col-12">
          <div className="w_card">
            <h3 className="w_card_title">
              Customers replied by lead age (days)
              <small className="text-muted ms-2">each customer in exactly one group</small>
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" interval={0} fontSize={12} />
                <YAxis allowDecimals={false} />
                <Tooltip cursor={{ fill: "rgba(0, 0, 0, 0.1)" }} />
                <Bar dataKey="value" name="Customers" onClick={onBarClick}>
                  {chartData.map((entry) => (
                    <Cell key={entry.key} fill={entry.key === "needs_review" ? "#adb5bd" : "var(--primary)"}
                      style={{ cursor: BAR_COHORT[entry.key] ? "pointer" : "default" }} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {s && (
              <small className="text-muted d-block mt-2">
                <strong>Appointments made:</strong> {apptLink("ai", "AI", s.ai)}
                {" / "}{apptLink("ai_assisted", "AI-assisted", s.ai_assisted)}
                {" / "}{apptLink("human_only", "Human-only", s.human_only)}
                {" / "}{apptLink("unknown", "Unknown", s.unknown)}
                <span className="ms-1">(total {s.total}; bookings created {rangeText})</span>
              </small>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
