"use client";
// Admin > Contact compliance (SOW Deliverable L, G-068 to G-071; 18 Nov 2026, log-only). Per dealer: the policy (log-only
// or enforce, contact hours), what the check decided for every text / email to a customer (allowed / would block /
// needs review, with reasons), and the dealer's own Do-Not-Contact list (add, remove, download).
// The national / state Do Not Call registry and the FCC reassigned-numbers check need a vendor: shown as not connected.
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Form, Spinner, Table } from "react-bootstrap";

const call = async (url, options = {}) => {
  const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("token")}`, ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
};
const DECISION = { allow: ["Allowed", "success"], block: ["Would block", "danger"], review: ["Needs review", "warning"] };
const fmt = (d, timeZone) => {
  try { return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d)); }
  catch { return ""; }
};

export default function ContactCompliancePage() {
  const [dealers, setDealers] = useState([]);
  const [dealer, setDealer] = useState("");
  const [filter, setFilter] = useState({ decision: "", days: 7, page: 1 });
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState({ kind: "phone", value: "", reason: "" });

  useEffect(() => { call("/api/admin/contact-compliance").then((d) => setDealers(d.dealers || [])).catch((e) => setError(e.message)); }, []);
  const load = useCallback(async () => {
    if (!dealer) { setData(null); return; }
    setBusy(true); setError(null);
    try {
      const q = new URLSearchParams({ dealer, days: String(filter.days), page: String(filter.page), ...(filter.decision ? { decision: filter.decision } : {}) });
      setData(await call(`/api/admin/contact-compliance?${q}`));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }, [dealer, filter]);
  useEffect(() => { load(); }, [load]);

  const act = async (method, body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return false;
    setBusy(true); setError(null);
    try { await call("/api/admin/contact-compliance", { method, body: JSON.stringify({ dealer, ...body }) }); await load(); return true; }
    catch (e) { setError(e.message); setBusy(false); return false; }
  };
  const tz = dealers.find((d) => d.id === dealer)?.timezone;
  const p = data?.policy;

  return (
    <div className="p-3">
      <h4 className="mb-1">Contact compliance</h4>
      <p className="text-muted small mb-3">
        Every text and email to a customer is checked before it goes: the customer&apos;s opt-outs and DND, an SMS
        opt-in &quot;no&quot;, the dealership&apos;s Do-Not-Contact list and its contact hours. In <strong>log only</strong> mode
        nothing is stopped - each decision is recorded here. <strong>Enforce</strong> stops blocked sends; switch it on only
        after the dealer&apos;s compliance owner approves the policy.
      </p>
      {error && <Alert variant="danger" className="py-2">{error}</Alert>}
      <Form.Select className="mb-3" style={{ maxWidth: 360 }} value={dealer} onChange={(e) => { setDealer(e.target.value); setFilter({ decision: "", days: 7, page: 1 }); }}>
        <option value="">Choose a dealer...</option>
        {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </Form.Select>
      {busy && !data && <Spinner size="sm" />}
      {data && (
        <>
          <div className="w_card mb-3">
            <h6>Policy</h6>
            <div className="d-flex flex-wrap align-items-center gap-3 small">
              <span>Mode: <Badge bg={p.mode === "enforce" ? "danger" : "secondary"}>{p.mode === "enforce" ? "Enforce (blocked sends are stopped)" : "Log only"}</Badge></span>
              <Button size="sm" variant="outline-custom" disabled={busy}
                onClick={() => act("PUT", { mode: p.mode === "enforce" ? "log_only" : "enforce" }, p.mode === "enforce"
                  ? "Back to log only? Nothing will be stopped." : "Enforce: texts and emails that fail a check will NOT be sent. Only after the dealer's compliance owner approved the policy. Continue?")}>
                {p.mode === "enforce" ? "Switch to log only" : "Switch to enforce"}</Button>
              <span>Contact hours (dealer time):</span>
              <Form.Control size="sm" type="time" style={{ width: 110 }} defaultValue={p.window_start} key={`s${p.window_start}`}
                onBlur={(e) => e.target.value !== p.window_start && act("PUT", { window_start: e.target.value })} />
              <span>to</span>
              <Form.Control size="sm" type="time" style={{ width: 110 }} defaultValue={p.window_end} key={`e${p.window_end}`}
                onBlur={(e) => e.target.value !== p.window_end && act("PUT", { window_end: e.target.value })} />
              <span className="text-muted">Replies to a customer&apos;s own message are not held.</span>
            </div>
            <div className="small mt-2">
              Do Not Call registry: <Badge bg="light" text="dark">Not connected - needs a vendor</Badge>{" "}
              FCC reassigned numbers: <Badge bg="light" text="dark">Not connected - needs an RND account</Badge>
            </div>
          </div>

          <div className="w_card mb-3">
            <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
              <h6 className="mb-0 me-auto">Decisions</h6>
              {Object.entries(DECISION).map(([k, [label, bg]]) => (
                <Button key={k} size="sm" variant={filter.decision === k ? bg : `outline-${bg}`}
                  onClick={() => setFilter({ ...filter, decision: filter.decision === k ? "" : k, page: 1 })}>
                  {label} {data.summary[k] || 0}</Button>
              ))}
              <Form.Select size="sm" style={{ width: "auto" }} value={filter.days} onChange={(e) => setFilter({ ...filter, days: Number(e.target.value), page: 1 })}>
                {[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
              </Form.Select>
            </div>
            {data.summary.by_reason.length > 0 && (
              <p className="small text-muted mb-2">{data.summary.by_reason.map((r) => `${r.text}: ${r.n}`).join(" · ")}</p>
            )}
            {!data.decisions.rows.length ? <p className="small text-muted mb-0">No checks in this period.</p> : (
              <Table size="sm" responsive className="small mb-1">
                <thead><tr><th>When (UTC)</th><th>Dealer time</th><th>Channel</th><th>To</th><th>From</th><th>Decision</th><th>Why</th></tr></thead>
                <tbody>
                  {data.decisions.rows.map((r) => (
                    <tr key={r._id}>
                      <td className="text-nowrap">{fmt(r.at, "UTC")}</td><td className="text-nowrap">{tz ? fmt(r.at, tz) : ""}</td>
                      <td>{r.channel === "sms" ? "Text" : r.channel === "email" ? "Email" : "Call"}</td><td>{r.to}</td>
                      <td>{{ ai: "AI", staff: "Staff", automation: "Automation" }[r.origin] || "-"}{r.reply ? " (reply)" : ""}</td>
                      <td><Badge bg={DECISION[r.decision][1]}>{DECISION[r.decision][0]}</Badge>{r.enforced && <Badge bg="dark" className="ms-1">Stopped</Badge>}</td>
                      <td>{r.reason_text.join("; ") || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {data.decisions.pages > 1 && (
              <div className="d-flex align-items-center gap-2 small">
                <Button size="sm" variant="link" disabled={filter.page <= 1} onClick={() => setFilter({ ...filter, page: filter.page - 1 })}>Previous</Button>
                <span>Page {data.decisions.page} of {data.decisions.pages} ({data.decisions.total})</span>
                <Button size="sm" variant="link" disabled={filter.page >= data.decisions.pages} onClick={() => setFilter({ ...filter, page: filter.page + 1 })}>Next</Button>
              </div>
            )}
          </div>

          <div className="w_card">
            <div className="d-flex align-items-center mb-2">
              <h6 className="mb-0 me-auto">Do-Not-Contact list ({data.suppressions.length})</h6>
              <Button size="sm" variant="link" onClick={async () => {
                const res = await fetch(`/api/admin/contact-compliance?dealer=${dealer}&export=suppressions`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
                const url = URL.createObjectURL(await res.blob()); const a = document.createElement("a"); a.href = url; a.download = "do-not-contact.csv"; a.click(); URL.revokeObjectURL(url);
              }}>Download CSV</Button>
            </div>
            <div className="d-flex flex-wrap gap-1 mb-2">
              <Form.Select size="sm" style={{ width: "auto" }} value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })}>
                <option value="phone">Phone (calls and texts)</option><option value="email">Email</option>
              </Form.Select>
              <Form.Control size="sm" style={{ maxWidth: 220 }} placeholder={adding.kind === "phone" ? "10-digit phone" : "name@example.com"}
                value={adding.value} onChange={(e) => setAdding({ ...adding, value: e.target.value })} />
              <Form.Control size="sm" style={{ maxWidth: 240 }} placeholder="Reason (optional)" value={adding.reason} maxLength={200}
                onChange={(e) => setAdding({ ...adding, reason: e.target.value })} />
              <Button size="sm" variant="custom" disabled={busy || !adding.value.trim()}
                onClick={async () => { if (await act("POST", adding)) setAdding({ ...adding, value: "", reason: "" }); }}>Add</Button>
            </div>
            {!data.suppressions.length ? <p className="small text-muted mb-0">Nobody on the list.</p> : (
              <Table size="sm" className="small mb-0">
                <thead><tr><th>Phone / email</th><th>Reason</th><th>Added by</th><th>Added (UTC)</th><th /></tr></thead>
                <tbody>
                  {data.suppressions.map((s) => (
                    <tr key={s.id}>
                      <td>{s.value}</td><td>{s.reason || "-"}</td><td>{s.added_by_name || "-"}</td><td>{fmt(s.added_at, "UTC")}</td>
                      <td className="text-end"><Button size="sm" variant="link" className="text-danger p-0" disabled={busy}
                        onClick={() => act("DELETE", { id: s.id }, `Remove ${s.value} from the list?`)}>Remove</Button></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
