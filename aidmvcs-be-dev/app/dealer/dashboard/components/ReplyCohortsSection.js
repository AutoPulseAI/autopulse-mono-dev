"use client";
// "Customer replies by lead age" (P1 plan item 2, G-043..G-047) and the appointment split (item 3), under the
// dashboard's card row. Shown only when /api/reports/reply-cohorts answers (the feature is visible to this caller -
// admins first); otherwise nothing is rendered and the dashboard is exactly as before. Counts distinct customers per
// dealer-local day (app/lib/reporting/replyCohorts.js), unlike the lead-based "Customer Replied" card above it.
import { useEffect, useState } from "react";
import { Button, Modal, Spinner, Table } from "react-bootstrap";
import moment from "moment-timezone";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import CountCard from "./CountCard";

const BUCKET_BARS = [
  ["d0", "0 (today)"], ["d1_6", "1-6"], ["d7_14", "7-14"], ["d15_29", "15-29"], ["d30_59", "30-59"],
  ["d60_plus", "60+"], ["needs_review", "Needs review"],
];
// Each bar's /dealer/leads?reply_cohort= value (app/lib/reporting/drillLeads.js). Needs review has no single lead: it
// opens the "View customers" table instead.
const BAR_COHORT = { d0: "b0", d1_6: "b1_6", d7_14: "b7_14", d15_29: "b15_29", d30_59: "b30_59", d60_plus: "b60" };
const HANDLER_LABELS = { ai: "AI", staff: "Staff", automatic: "Automatic", unanswered: "Not answered", unknown: "Unknown" };
const BUCKET_LABELS = Object.fromEntries(BUCKET_BARS);

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

// Spreadsheet-safe CSV cell (quotes, and no formula start from customer-entered names).
function csvCell(value) {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function ReplyCohortsSection({ dealerId, startDate, endDate, timezone, rangeText }) {
  const [state, setState] = useState({ status: "loading", data: null });
  const [split, setSplit] = useState(null);
  const [showRows, setShowRows] = useState(false);
  const [rows, setRows] = useState(null);
  const [rowsError, setRowsError] = useState(null);

  const startKey = startDate ? new Date(startDate).toISOString() : "";
  const endKey = endDate ? new Date(endDate).toISOString() : "";

  useEffect(() => {
    if (!dealerId) return undefined;
    let cancelled = false;
    setState({ status: "loading", data: null });
    setSplit(null);
    setRows(null);
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

  const openRows = () => {
    setShowRows(true);
    if (rows) return;
    setRowsError(null);
    const q = rangeQuery(dealerId, startKey || null, endKey || null);
    q.set("rows", "1");
    fetch(`/api/reports/reply-cohorts?${q}`, { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setRows((await res.json()).rows || []);
      })
      .catch(() => setRowsError("Could not load the customers."));
  };

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
    if (key === "needs_review") openRows();
    else if (BAR_COHORT[key]) openLeads("reply_cohort", BAR_COHORT[key]);
  };
  const apptLink = (category, text, n) => (
    <a href={leadsLink("appt_attribution", category)} target="_blank" rel="noopener noreferrer"
      title="Open these appointments' leads">{text} {n}</a>
  );

  const fmt = (at) => (at ? moment.utc(at).tz(timezone).format("MM/DD/YYYY h:mm A") : "");
  const fmtDay = (at) => (at ? moment.utc(at).tz(timezone).format("MM/DD/YYYY") : "");
  const appointmentText = (r) => (r.has_appointment ? (r.booked_after_reply ? "Yes (booked after reply)" : "Yes") : "No");
  const tableRows = (rows || []).map((r) => ({
    customer: r.customer_name || "Unknown",
    lead: r.lead_name || (r.lead_id ? "Lead" : "No lead linked"),
    lead_id: r.lead_id,
    lead_date: fmtDay(r.lead_received_at),
    reply_time: fmt(r.reply_at),
    age: r.age_days ?? "Needs review",
    group: BUCKET_LABELS[r.bucket] || r.bucket,
    channel: r.channel === "sms" ? "Text" : "Email",
    handled_by: HANDLER_LABELS[r.handler] || r.handler || "",
    appointment: appointmentText(r),
  }));

  const downloadCsv = () => {
    // The table's columns and rows, as shown.
    const header = ["Customer", "Lead", "Lead Date", "Reply Time", "Age (days)", "Channel", "Handled By", "Appointment"];
    const lines = [header, ...tableRows.map((r) => [r.customer, r.lead, r.lead_date, r.reply_time, r.age, r.channel,
      r.handled_by, r.appointment])].map((line) => line.map(csvCell).join(","));
    const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const from = state.data?.range?.from || "";
    const to = state.data?.range?.to || "";
    a.download = `customer-replies-${from}${to && to !== from ? `_${to}` : ""}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

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
        <Button size="sm" className="btn-custom" onClick={openRows}>
          <i className="fa-regular fa-users me-1"></i>View customers
        </Button>
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
                <Bar dataKey="value" name="Customers" onClick={onBarClick} style={{ cursor: "pointer" }}>
                  {chartData.map((entry) => (
                    <Cell key={entry.key} fill={entry.key === "needs_review" ? "#adb5bd" : "var(--primary)"}
                      style={{ cursor: "pointer" }} />
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

      <Modal show={showRows} onHide={() => setShowRows(false)} size="xl" scrollable>
        <Modal.Header closeButton>
          <Modal.Title>Customers who replied · {rangeText}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {rowsError && <div className="text-danger">{rowsError}</div>}
          {!rows && !rowsError && <div className="text-center py-4"><Spinner animation="border" variant="dark" /></div>}
          {rows && (
            tableRows.length === 0 ? <p className="text-muted mb-0">No customer replies on these dates.</p> : (
              <Table responsive hover size="sm" className="mb-0">
                <thead>
                  <tr>
                    <th>Customer</th><th>Lead</th><th>Lead Date</th><th>Reply Time</th><th>Age (days)</th>
                    <th>Channel</th><th>Handled By</th><th>Appointment</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r, i) => (
                    <tr key={`${r.lead_id || "x"}-${i}`}>
                      <td>{r.customer}</td>
                      <td>
                        {r.lead_id
                          ? <a href={`/dealer/leads?selectedLead=true&leadId=${r.lead_id}`} target="_blank" rel="noopener noreferrer">{r.lead}</a>
                          : r.lead}
                      </td>
                      <td>{r.lead_date}</td>
                      <td>{r.reply_time}</td>
                      <td title={r.group}>{r.age}</td>
                      <td>{r.channel}</td>
                      <td>{r.handled_by}</td>
                      <td>{r.appointment}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )
          )}
        </Modal.Body>
        <Modal.Footer>
          <small className="text-muted me-auto">Times in {timezone}</small>
          <Button size="sm" className="btn-custom" disabled={!rows || !tableRows.length} onClick={downloadCsv}>
            <i className="fa-regular fa-download me-1"></i>Download CSV
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
