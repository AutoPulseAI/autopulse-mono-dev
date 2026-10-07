"use client";
// AI Alerts: what the AI needs the team to know or do - handoffs, call requests,
// service requests, wrong numbers / bad contact details, possible opt-outs,
// "not interested" reasons, bookings it made. Staff mark each one handled.
//   /dealer/ai/alerts              open alerts
//   /dealer/ai/alerts?all=1        including handled ones

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Badge, Button, Form, Spinner } from "react-bootstrap";
import LeadAiDrawer from "../components/LeadAiDrawer";
import { ALERTS_CHANGED_EVENT, aiFetch, alertKind, formatDateTime, fromNow, leadHref, stageVariant } from "../components/aiShared";

// Extra fields an alert can carry, shown under its text when present.
const DETAIL_FIELDS = [
  ["preferred_time", "Preferred time"],
  ["notes", "Notes"],
  ["reason", "Reason"],
  ["handoff_reason", "Why it was handed over"],
  ["channel", "Channel"],
  ["address", "Contact"],
];

function AlertsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showHandled = searchParams.get("all") === "1";

  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [busy, setBusy] = useState(null);
  const [drawer, setDrawer] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await aiFetch(`/api/dealer-ai/alerts${showHandled ? "?include_handled=1" : ""}`);
      setAlerts(data.alerts || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [showHandled]);

  useEffect(() => {
    load();
  }, [load]);

  const kinds = useMemo(() => [...new Set(alerts.map((a) => a.kind))], [alerts]);
  const shown = kindFilter ? alerts.filter((a) => a.kind === kindFilter) : alerts;

  const toggleHandled = (checked) => {
    router.push(checked ? "/dealer/ai/alerts?all=1" : "/dealer/ai/alerts", { scroll: false });
  };

  const markHandled = async (item) => {
    setBusy(item.id);
    setError("");
    try {
      await aiFetch("/api/dealer-ai/alerts/handled", {
        method: "POST",
        body: JSON.stringify({ lead_id: item.lead_id, source: item.source }),
      });
      window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT)); // the sidebar count
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center">
              <h3 className="page_title mb-0 me-auto">AI Alerts</h3>
              <Button variant="outline-custom" size="sm" onClick={load} disabled={loading}>
                <i className={`fa-solid fa-rotate-right me-1 ${loading ? "fa-spin" : ""}`} />Refresh
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        <div className="d-flex flex-wrap align-items-center gap-3 mb-2">
          <Form.Select size="sm" style={{ maxWidth: 260 }} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="">All types</option>
            {kinds.map((k) => <option key={k} value={k}>{alertKind(k).label}</option>)}
          </Form.Select>
          <Form.Check type="switch" id="alerts-show-handled" label="Show handled alerts"
            checked={showHandled} onChange={(e) => toggleHandled(e.target.checked)} />
        </div>

        {error && <Alert variant="danger">{error}</Alert>}

        {loading && !alerts.length ? (
          <div className="w_card text-center py-5"><Spinner animation="border" variant="dark" /></div>
        ) : !shown.length ? (
          <div className="w_card">
            <p className="text-secondary-light text-center py-4 mb-0">
              {showHandled ? "No alerts." : "Nothing needs your attention right now."}
            </p>
          </div>
        ) : shown.map((item) => {
          const kind = alertKind(item.kind);
          const details = DETAIL_FIELDS.filter(([key]) => item[key] && !(key === "reason" && item.kind === "not_interested"));
          return (
            <div key={item.id} className={`w_card mb-2 ${item.handled ? "opacity-75" : ""}`}>
              <div className="d-flex flex-wrap align-items-start gap-2">
                <div className="me-auto" style={{ minWidth: 0, flex: "1 1 300px" }}>
                  <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
                    <Badge bg={kind.variant}><i className={`fa-regular ${kind.icon} me-1`} />{kind.label}</Badge>
                    <strong>{item.lead?.name || "Unknown customer"}</strong>
                    {item.lead?.vehicle && <small className="text-secondary-light">{item.lead.vehicle}</small>}
                    {item.stage_label && <Badge bg={stageVariant(item.stage)} className="fw-normal">{item.stage_label}</Badge>}
                  </div>
                  {item.text && <p className="mb-1">{item.text}</p>}
                  {details.map(([key, label]) => (
                    <p key={key} className="mb-1 small"><strong>{label}:</strong> {String(item[key])}</p>
                  ))}
                  <small className="text-secondary-light">
                    <span title={formatDateTime(item.at)}>{fromNow(item.at)}</span>
                    {item.lead?.phone && <> &middot; {item.lead.phone}</>}
                    {item.handled && <> &middot; Handled by {item.handled_by || "staff"} {fromNow(item.handled_at)}</>}
                  </small>
                </div>
                <div className="d-flex flex-wrap gap-1">
                  <Button size="sm" variant="outline-secondary" onClick={() => setDrawer(item)}>AI details</Button>
                  <Button size="sm" variant="outline-custom" as={Link} href={leadHref(item.lead_id)}>Open lead</Button>
                  {!item.handled && (
                    <Button size="sm" variant="custom" onClick={() => markHandled(item)} disabled={busy === item.id}>
                      {busy === item.id ? <Spinner animation="border" size="sm" /> : <><i className="fa-solid fa-check me-1" />Mark handled</>}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <LeadAiDrawer
        show={Boolean(drawer)}
        onHide={() => setDrawer(null)}
        leadId={drawer?.lead_id}
        customerId={drawer?.customer_id}
        title={drawer?.lead?.name || "Lead"}
      />
    </div>
  );
}

export default function AiAlertsPage() {
  return (
    <Suspense fallback={
      <div className="page_content">
        <div className="d-flex justify-content-center align-items-center" style={{ height: "300px" }}>
          <div className="spinner-border text-dark" role="status"><span className="visually-hidden">Loading...</span></div>
        </div>
      </div>
    }>
      <AlertsContent />
    </Suspense>
  );
}
