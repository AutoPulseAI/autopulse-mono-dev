"use client";
// AI Insights: what the AI's messages achieve and what it has learned (agentic-upsell
// PLAN_4 stream L, blueprint box 5 "AI Learning & Optimization Engine"): response and
// appointment rates overall and by bucket, lead source, new/used, follow-up angle,
// wording, send time and time of day; each A/B test's current leader with its sample
// sizes; the verified price drops the follow-ups may announce.
//   /dealer/ai/insights

import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Col, Form, Row, Spinner, Table } from "react-bootstrap";
import { aiFetch, formatDateTime } from "../components/aiShared";
import {
  DEFAULT_INSIGHTS_DAYS, INSIGHTS_PERIODS, MIN_ROW_SAMPLE, percent, rateTone,
} from "@lib/ai/aiInsights";

const GROUPS = [
  ["by_kind", "Type of message"],
  ["by_bucket", "Lead bucket"],
  ["by_original_bucket", "Bucket the lead came in as"],
  ["by_source", "Lead source"],
  ["by_vehicle_type", "New or used"],
  ["by_original_vehicle_type", "New or used, as the lead came in"],
  ["by_angle", "Follow-up angle"],
  ["by_variant", "Follow-up wording"],
  ["by_send_time", "Follow-up send time"],
  ["by_time_band", "Time of day sent"],
  ["by_weekday", "Day of the week sent"],
  ["by_channels", "Channels"],
];

const TONE_BADGE = { better: ["success", "Above average"], worse: ["warning", "Below average"] };

function Stat({ label, value, help }) {
  return (
    <Col xs={6} md={4} xl={2} className="mb-3">
      <div className="w_card h-100 mb-0">
        <div className="text-secondary-light"><small>{label}</small></div>
        <div className="fs-4 fw-semibold">{value}</div>
        {help && <div className="text-secondary-light"><small>{help}</small></div>}
      </div>
    </Col>
  );
}

function BreakdownTable({ rows, overall }) {
  if (!rows?.length) return <p className="text-secondary-light mb-0">No messages in this period yet.</p>;
  return (
    <div className="table-responsive">
      <Table hover size="sm" className="align-middle mb-0">
        <thead>
          <tr>
            <th>Group</th>
            <th className="text-end">Messages</th>
            <th className="text-end">Replied in 3 days</th>
            <th className="text-end">Replied in 24h</th>
            <th className="text-end">Appointment in 7 days</th>
            <th className="text-end">Opted out</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tone = rateTone(row.response_rate, overall, row.settled);
            return (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td className="text-end">{row.touches}</td>
                <td className="text-end">
                  {percent(row.response_rate)} <small className="text-secondary-light">({row.replied}/{row.settled})</small>
                </td>
                <td className="text-end">{percent(row.response_rate_24h)}</td>
                <td className="text-end">
                  {percent(row.appointment_rate)} <small className="text-secondary-light">({row.appointments}/{row.settled_7d})</small>
                </td>
                <td className="text-end">{row.opted_out}</td>
                <td className="text-end">
                  {tone && <Badge bg={TONE_BADGE[tone][0]}>{TONE_BADGE[tone][1]}</Badge>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

export default function AiInsightsPage() {
  const [days, setDays] = useState(DEFAULT_INSIGHTS_DAYS);
  const [group, setGroup] = useState("by_angle");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setReport(await aiFetch(`/api/dealer-ai/insights?days=${days}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = report?.totals || {};
  const groupLabel = (GROUPS.find(([key]) => key === group) || [])[1];

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col">
            <h3 className="page_title mb-0">AI Insights</h3>
          </div>
          <div className="col-auto">
            <Form.Select size="sm" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
              {INSIGHTS_PERIODS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
            </Form.Select>
          </div>
        </div>
      </div>

      <div className="page_body">
        {error && <Alert variant="danger">{error}</Alert>}
        {loading && !report && (
          <div className="d-flex justify-content-center align-items-center flex-column" style={{ height: "300px" }}>
            <Spinner animation="border" variant="dark" />
            <p className="mt-3">Loading AI insights...</p>
          </div>
        )}

        {report && (
          <>
            <Row>
              <Stat label="AI messages sent" value={totals.touches ?? 0} help="first replies, follow-ups, reminders" />
              <Stat label="Replied within 3 days" value={percent(totals.response_rate)}
                help={`${totals.replied ?? 0} of ${totals.settled ?? 0}`} />
              <Stat label="Replied within 24 hours" value={percent(totals.response_rate_24h)}
                help={`${totals.replied_24h ?? 0} of ${totals.settled_24h ?? 0}`} />
              <Stat label="Real replies" value={percent(totals.meaningful_rate)} help="not just an emoji or STOP" />
              <Stat label="Appointment within 7 days" value={percent(totals.appointment_rate)}
                help={`${totals.appointments ?? 0} set, ${totals.showed ?? 0} showed`} />
              <Stat label="Opted out" value={percent(totals.opt_out_rate)} help={`${totals.opted_out ?? 0} customers`} />
            </Row>
            <p className="text-secondary-light">
              <small>
                Rates only count messages old enough to have had their chance (a day, three days, or a week).
                Newer messages are in the totals but not the rates yet.
              </small>
            </p>

            <div className="w_card">
              <h3 className="w_card_title">What the AI is testing</h3>
              <p className="text-secondary-light"><small>{report.learning?.method}</small></p>
              {report.winners?.length ? (
                <div className="table-responsive">
                  <Table size="sm" className="align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Test</th>
                        <th>Leading</th>
                        <th>Options (replied in 3 days)</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.winners.map((w) => (
                        <tr key={w.test}>
                          <td>{w.label}</td>
                          <td><strong>{w.leader_label}</strong></td>
                          <td>
                            {w.options.map((o) => (
                              <div key={o.option}>
                                <small>{o.label}: {percent(o.response_rate)} of {o.touches}</small>
                              </div>
                            ))}
                          </td>
                          <td>
                            <Badge bg={w.enough_data ? "success" : "secondary"}>
                              {w.enough_data ? "Winning" : "Still testing"}
                            </Badge>
                            <div><small className="text-secondary-light">{w.status}</small></div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              ) : (
                <p className="mb-0 text-secondary-light">
                  No follow-up has had three days to get a reply yet. {report.learning?.until_ready}
                </p>
              )}
            </div>

            <div className="w_card">
              <div className="d-flex align-items-center flex-wrap gap-2 mb-2">
                <h3 className="w_card_title mb-0 me-auto">Results by {groupLabel?.toLowerCase()}</h3>
                <Form.Select size="sm" style={{ maxWidth: 320 }} value={group} onChange={(e) => setGroup(e.target.value)}
                  aria-label="Group results by">
                  {GROUPS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </Form.Select>
              </div>
              <BreakdownTable rows={report[group]} overall={totals.response_rate} />
              <p className="text-secondary-light mt-2 mb-0">
                <small>
                  &quot;Above / below average&quot; compares a group&apos;s 3-day reply rate with the overall one
                  (shown once a group has {MIN_ROW_SAMPLE} or more settled messages).
                </small>
              </p>
            </div>

            <div className="w_card">
              <h3 className="w_card_title">Verified price drops</h3>
              <p className="text-secondary-light">
                <small>
                  Vehicles in stock now priced lower than before. A follow-up may tell a customer interested in
                  one of these about its new price - the only time the AI states a price. Direct price questions
                  still go to your team.
                </small>
              </p>
              {report.price_drops?.length ? (
                <div className="table-responsive">
                  <Table size="sm" className="align-middle mb-0">
                    <thead>
                      <tr><th>Vehicle</th><th>VIN</th><th className="text-end">Was</th><th className="text-end">Now</th><th>Since</th></tr>
                    </thead>
                    <tbody>
                      {report.price_drops.map((d) => (
                        <tr key={d.vin}>
                          <td>{d.title || "—"}</td>
                          <td><code>{d.vin}</code></td>
                          <td className="text-end">${Number(d.previous_price).toLocaleString()}</td>
                          <td className="text-end"><strong>${Number(d.price).toLocaleString()}</strong></td>
                          <td>{formatDateTime(d.dropped_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              ) : <p className="mb-0 text-secondary-light">No verified price drops right now.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
