"use client";
// How each number is counted, generated from the registry (app/lib/reporting/registry.js listKpis): the field
// dictionary the client signs off (SOW 3 Deliverable A). One line per number (name + what it counts); a click opens
// the details. Filter by report, search, 15 per page (user, 13 Nov 2026: the 10-column table was unreadable).
import { useMemo, useState } from "react";
import { Badge, Form, Pagination } from "react-bootstrap";

const STATE_BADGE = { live: ["success", "Live"], blocked: ["secondary", "Not available yet"], needs_data: ["warning", "Needs data"] };
const PAGE = 15;

function Detail({ label, children }) {
  if (!children) return null;
  return (
    <div className="mb-1">
      <span className="text-muted">{label}: </span>{children}
    </div>
  );
}

export default function Definitions({ data }) {
  const [q, setQ] = useState("");
  const [report, setReport] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const dashboards = data?.dashboards || [];
  const labels = useMemo(() => Object.fromEntries(dashboards.map((d) => [d.id, d.label])), [dashboards]);
  if (!data) return null;
  const needle = q.trim().toLowerCase();
  const rows = data.kpis.filter((k) => (!report || k.dashboard === report) && (!needle
    || [k.label, k.numerator, k.dateBasis, k.basedOn].some((v) => String(v || "").toLowerCase().includes(needle))));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PAGE, current * PAGE);
  const go = (p) => { setPage(p); setOpen(null); };

  return (
    <div className="w_card">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <h3 className="w_card_title mb-0 me-auto">How each number is counted</h3>
        <Form.Select size="sm" className="w-auto" value={report} aria-label="Report"
          onChange={(e) => { setReport(e.target.value); go(1); }}>
          <option value="">All reports ({data.kpis.length})</option>
          {dashboards.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </Form.Select>
        <Form.Control size="sm" style={{ maxWidth: 240 }} placeholder="Search a number" value={q}
          onChange={(e) => { setQ(e.target.value); go(1); }} />
      </div>

      {!shown.length && <div className="text-muted small py-3">No numbers match.</div>}
      <ul className="list-unstyled mb-0">
        {shown.map((k) => {
          const [bg, text] = STATE_BADGE[k.state] || ["light", k.state];
          const isOpen = open === k.id;
          return (
            <li key={k.id} className="border-bottom py-2">
              <button type="button" className="btn btn-link p-0 text-start text-decoration-none w-100 text-body"
                onClick={() => setOpen(isOpen ? null : k.id)} aria-expanded={isOpen}>
                <div className="d-flex align-items-start gap-2">
                  <i className={`fa-solid fa-chevron-${isOpen ? "down" : "right"} small mt-1 text-muted`} />
                  <div className="flex-grow-1" style={{ minWidth: 0 }}>
                    <div className="d-flex flex-wrap align-items-center gap-2">
                      <strong>{k.label}</strong>
                      <small className="text-muted">{labels[k.dashboard] || "Dashboard"}</small>
                      {k.state !== "live" && <Badge bg={bg}>{text}</Badge>}
                    </div>
                    <small className="text-muted d-block text-break">{k.numerator}</small>
                  </div>
                </div>
              </button>
              {isOpen && (
                <div className="small ms-4 mt-2 text-break">
                  <Detail label="Out of">{k.denominator}</Detail>
                  <Detail label="Which date">{k.dateBasis}</Detail>
                  <Detail label="Included">{k.inclusions}</Detail>
                  <Detail label="Left out">{k.exclusions}</Detail>
                  <Detail label="Based on">{k.basedOn}</Detail>
                  <Detail label="Counted per">{k.grain}</Detail>
                  {k.reason && <Detail label="Why not available">{k.reason}</Detail>}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {pages > 1 && (
        <div className="d-flex flex-wrap align-items-center justify-content-between mt-3 gap-2">
          <small className="text-muted">{rows.length} numbers · page {current} of {pages}</small>
          <Pagination size="sm" className="mb-0">
            <Pagination.Prev disabled={current === 1} onClick={() => go(current - 1)} />
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
              <Pagination.Item key={p} active={p === current} onClick={() => go(p)}>{p}</Pagination.Item>
            ))}
            <Pagination.Next disabled={current === pages} onClick={() => go(current + 1)} />
          </Pagination>
        </div>
      )}
      <small className="text-muted d-block mt-2">{data.kpis[0]?.timezone}</small>
    </div>
  );
}
