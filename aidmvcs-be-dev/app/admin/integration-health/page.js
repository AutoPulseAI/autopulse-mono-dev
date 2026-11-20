"use client";
// Admin > Integration health (SOW G-058): every store and each connector - DMS feed, lead emails, texts, emails, the AI
// service, the inventory feed and the daily email - with its last good time, what went wrong and where to fix it.
// Read-only (api/admin/integration-health). Times in UTC with the dealer's time beside them. Stores with a problem first.
import { Fragment, useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Form, Spinner, Table } from "react-bootstrap";

const SOURCES = [["dms", "DMS feed"], ["leads", "Leads"], ["texts", "Texts"], ["emails", "Emails"], ["ai", "AI service"],
  ["inventory", "Inventory"], ["daily_email", "Daily email"]];
const STATE = { ok: ["OK", "success"], warn: ["Check", "warning"], error: ["Problem", "danger"], none: ["Not used", "light"] };
const fmt = (d, timeZone) => {
  try { return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d)); }
  catch { return ""; }
};

export default function IntegrationHealthPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/admin/integration-health", { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }, cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      setData(body);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = (data?.dealers || []).filter((d) => !onlyProblems || Object.values(d.checks).some((c) => c.state === "error" || c.state === "warn"));
  const t = data?.thresholds;
  return (
    <div className="p-3">
      <div className="d-flex align-items-center gap-2 mb-1">
        <h4 className="mb-0 me-auto">Integration health</h4>
        <Form.Check type="switch" id="only-problems" label="Only stores with a problem" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
        <Button size="sm" variant="outline-custom" onClick={load} disabled={busy}>{busy ? <Spinner size="sm" /> : "Refresh"}</Button>
      </div>
      <p className="text-muted small mb-3">
        What each connector last did, per store. Read-only: nothing is retried from here.
        {t && ` Flagged when: no DMS file, lead or inventory update for ${t.dms_quiet_hours} h; more than ${Math.round(t.failed_send_share * 100)}% of texts or emails failed in 24 h; AI events waiting over ${t.ai_backlog_minutes} min; the last daily email failed.`}
        {data && ` Checked ${fmt(data.generated_at, "UTC")} UTC.`}
      </p>
      {error && <Alert variant="danger" className="py-2">{error}</Alert>}
      {data?.schedulers?.length > 0 && (
        // 20 Nov 2026: the server's scheduled jobs - when each one's call last reached the CRM (lib/cronHeartbeat.js).
        <div className="mb-3">
          <div className="fw-semibold small mb-1">Scheduled jobs (server crontab)</div>
          <Table size="sm" className="small align-middle mb-1">
            <thead><tr><th>Job</th><th>Runs every</th><th>Last call reached the CRM</th><th>State</th><th>If it stops</th></tr></thead>
            <tbody>{data.schedulers.map((j) => {
              const [label, bg] = j.state === "ok" ? ["OK", "success"] : j.state === "late" ? ["Not running", "danger"] : ["No call yet", "warning"];
              return (
                <tr key={j.name}>
                  <td>{j.label}<div className="text-muted">{j.path}</div></td>
                  <td>{j.every_min >= 60 ? `${j.every_min / 60} h` : `${j.every_min} min`}</td>
                  <td>{j.last_at ? <>{fmt(j.last_at, "UTC")} UTC<div className="text-muted">{j.age_min} min ago</div></> : "-"}</td>
                  <td><Badge bg={bg} text={bg === "warning" ? "dark" : undefined}>{label}</Badge></td>
                  <td className="text-muted">{j.state === "ok" ? "" : j.stops}</td>
                </tr>);
            })}</tbody>
          </Table>
          {data.config?.some((c) => !c.set) && (
            <Alert variant="warning" className="py-2 small mb-0">Not set on the server: {data.config.filter((c) => !c.set).map((c) => `${c.key} (${c.used})`).join("; ")}</Alert>
          )}
        </div>
      )}
      {!data ? <Spinner size="sm" /> : (
        <Table size="sm" responsive hover className="small align-middle">
          <thead><tr><th>Store</th>{SOURCES.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
          <tbody>
            {rows.map((d) => (
              <Fragment key={d.id}>
                <tr style={{ cursor: "pointer" }} onClick={() => setOpen(open === d.id ? null : d.id)}>
                  <td className="fw-semibold">{d.name}</td>
                  {SOURCES.map(([k]) => {
                    const c = d.checks[k]; const [label, bg] = STATE[c.state];
                    return <td key={k}><Badge bg={bg} text={bg === "light" || bg === "warning" ? "dark" : undefined}>{label}</Badge></td>;
                  })}
                </tr>
                {open === d.id && (
                  <tr><td colSpan={SOURCES.length + 1} className="bg-light">
                    <ul className="mb-0">
                      {SOURCES.map(([k, l]) => {
                        const c = d.checks[k];
                        return (
                          <li key={k}><strong>{l}:</strong> {c.detail}
                            {c.last_ok && <span className="text-muted"> · last good {fmt(c.last_ok, "UTC")} UTC{d.timezone ? ` (${fmt(c.last_ok, d.timezone)} dealer time)` : ""}</span>}
                            {c.fix && <div className="text-danger">What to do: {c.fix}</div>}
                          </li>
                        );
                      })}
                    </ul>
                  </td></tr>
                )}
              </Fragment>
            ))}
            {!rows.length && <tr><td colSpan={SOURCES.length + 1} className="text-muted">No store has a problem right now.</td></tr>}
          </tbody>
        </Table>
      )}
    </div>
  );
}
