"use client";
// Admin preview under the Dashboard cards: who set the appointments made in the range (AI / AI-assisted / human-only),
// shown only when /api/reports/reply-cohorts answers for this caller (admins first). The customer reply boxes it used
// to hold are now the Dashboard's "CUSTOMER REPLIES BY LEAD AGE" section (app/dealer/dashboard/page.js).
import { useEffect, useState } from "react";
import Link from "next/link";
import { rememberBack } from "../../components/backLink";

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
  const apptLink = (category, text, n) => (
    <Link href={leadsLink("appt_attribution", category)} onClick={() => rememberBack(leadsLink("appt_attribution", category))}
      title="Open these appointments' leads">{text} {n}</Link>
  );

  if (state.status === "needs_range") return null;

  // 13 Nov 2026 meeting: the reply boxes (today's / past / by lead age) are now the "CUSTOMER REPLIES BY LEAD AGE"
  // section of the Dashboard, built from the Customer Replied card's own leads so they add up to it; "Customers
  // Replied (distinct)" is not shown (Betsy: "we don't need to show them that"); the 7+/15+/30+/60+ boxes overlapped and
  // are gone. What stays here (admins): who set the appointments made in the range.
  const s = split?.totals;
  if (!s) return null;
  return (
    <div className="dashboard_counts">
      <div className="w_card">
        <small className="text-muted d-block">
          <strong>Appointments made:</strong> {apptLink("ai", "AI", s.ai)}
          {" / "}{apptLink("ai_assisted", "AI-assisted", s.ai_assisted)}
          {" / "}{apptLink("human_only", "Human-only", s.human_only)}
          {" / "}{apptLink("unknown", "Unknown", s.unknown)}
          <span className="ms-1">(total {s.total}; bookings created {rangeText}) · Admin preview</span>
        </small>
      </div>
    </div>
  );
}
