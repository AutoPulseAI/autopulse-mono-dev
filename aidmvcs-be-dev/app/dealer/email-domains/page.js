"use client";
// Email domain validation (19 Nov 2026, SOW reference B9 "Email Domain Validation Setup"): the dealership's email
// domains with their MX, SPF and DMARC records (and Amazon SES status where the CRM sends through SES), what is
// missing and what to add. Read-only; the records are changed at the domain's DNS provider. /api/email-domain-check.
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Form, InputGroup, Spinner } from "react-bootstrap";
import { useUser } from "../context/UserContext";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dealertoken")}` });
const Mark = ({ ok, children }) => <Badge bg={ok ? "success" : "danger"} className="me-1">{ok ? "✓" : "✗"} {children}</Badge>;

export default function EmailDomainsPage() {
  const { dealerParent, user } = useUser();
  const dealerId = dealerParent?.id || user?.id;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [extra, setExtra] = useState("");

  const load = useCallback(async (domain = "") => {
    if (!dealerId) return;
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/email-domain-check?${new URLSearchParams({ dealer_id: dealerId, ...(domain ? { domain } : {}) })}`, { headers: auth() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not check the domains");
      setData(body);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }, [dealerId]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="page_content">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <h2 className="fs-4 mb-0 me-auto">Email domain validation</h2>
        <Button size="sm" variant="outline-custom" onClick={() => load(extra)} disabled={busy}>
          {busy ? <Spinner size="sm" /> : <><i className="fa-regular fa-rotate me-1" />Check again</>}</Button>
      </div>
      <div className="w_card mb-3">
        <p className="small text-muted mb-2">
          The domains of your website and email accounts, checked live: a mail server (MX) to receive replies and lead
          emails, SPF and DMARC so the dealership&apos;s emails are trusted and stay out of spam. Missing records are added
          at the company that hosts the domain&apos;s DNS.
        </p>
        <Form onSubmit={(e) => { e.preventDefault(); load(extra); }}>
          <InputGroup size="sm" style={{ maxWidth: 420 }}>
            <Form.Control placeholder="Check another domain, e.g. mydealer.com" value={extra} onChange={(e) => setExtra(e.target.value)}
              aria-label="Another domain" />
            <Button type="submit" variant="custom" disabled={busy || !extra.trim()}>Check</Button>
          </InputGroup>
        </Form>
      </div>
      {error && <Alert variant="danger" className="small">{error}</Alert>}
      {data && !data.domains.length && <Alert variant="light" className="small">No email domain on file yet: add the website in Dealer Setup or an email account.</Alert>}
      {(data?.domains || []).map((d) => (
        <div key={d.domain} className="w_card mb-3">
          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
            <strong className="me-auto">{d.domain}</strong>
            <Badge bg={d.ok ? "success" : "warning"} text={d.ok ? undefined : "dark"}>{d.ok ? "All good" : `${d.problems.length} to fix`}</Badge>
          </div>
          <div className="small text-muted mb-2">Used for: {d.used_for.join(" · ")}</div>
          <div className="mb-2">
            <Mark ok={d.mx.length > 0}>MX</Mark><Mark ok={!!d.spf}>SPF</Mark><Mark ok={!!d.dmarc}>DMARC{d.dmarc?.policy ? ` (${d.dmarc.policy})` : ""}</Mark>
            {d.ses && (d.ses.error ? <Badge bg="secondary">Amazon SES {d.ses.error}</Badge>
              : <><Mark ok={d.ses.verification === "Success"}>SES domain</Mark><Mark ok={d.ses.dkim === "Success"}>DKIM</Mark></>)}
          </div>
          <div className="small">
            {d.mx.length > 0 && <div><span className="text-muted">Mail servers:</span> {d.mx.join(", ")}</div>}
            {d.spf && <div className="text-break"><span className="text-muted">SPF:</span> <code>{d.spf}</code></div>}
            {d.dmarc && <div className="text-break"><span className="text-muted">DMARC:</span> <code>{d.dmarc.record}</code></div>}
          </div>
          {d.problems.length > 0 && <ul className="small text-danger mb-0 mt-2 ps-3">{d.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      ))}
      {data?.checked_at && <p className="small text-muted">Checked {new Date(data.checked_at).toLocaleString()}</p>}
    </div>
  );
}
