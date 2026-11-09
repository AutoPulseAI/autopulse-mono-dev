"use client";
// Every KPI with its written definition, generated from the registry (app/lib/reporting/registry.js listKpis):
// the field dictionary the client signs off (SOW 3 Deliverable A).
import { useMemo, useState } from "react";
import { Badge, Form, Table } from "react-bootstrap";

const STATE_BADGE = { live: ["success", "Live"], blocked: ["secondary", "Blocked"], needs_data: ["warning", "Needs data"] };

export default function Definitions({ data }) {
  const [q, setQ] = useState("");
  const labels = useMemo(() => Object.fromEntries((data?.dashboards || []).map((d) => [d.id, d.label])), [data]);
  if (!data) return null;
  const needle = q.trim().toLowerCase();
  const rows = data.kpis.filter((k) => !needle || [k.id, k.label, k.numerator, k.dateBasis]
    .some((v) => String(v || "").toLowerCase().includes(needle)));
  return (
    <div className="w_card">
      <div className="d-flex align-items-center mb-2">
        <h3 className="w_card_title mb-0 me-auto">Definitions ({data.kpis.length} KPIs)</h3>
        <Form.Control size="sm" style={{ maxWidth: 260 }} placeholder="Search" value={q}
          onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-responsive">
        <Table size="sm" className="align-top mb-0">
          <thead>
            <tr>
              <th>KPI</th><th>Report</th><th>Counts</th><th>Numerator</th><th>Denominator</th><th>Date basis</th>
              <th>Included</th><th>Excluded</th><th>Source</th><th>State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => {
              const [bg, text] = STATE_BADGE[k.state] || ["light", k.state];
              return (
                <tr key={k.id}>
                  <td><strong>{k.label}</strong><br /><small className="text-muted">{k.id}</small></td>
                  <td>{labels[k.dashboard] || "Dashboard"}</td>
                  <td>{k.grain}</td>
                  <td><small>{k.numerator}</small></td>
                  <td><small>{k.denominator || "–"}</small></td>
                  <td><small>{k.dateBasis}</small></td>
                  <td><small>{k.inclusions || "–"}</small></td>
                  <td><small>{k.exclusions}</small></td>
                  <td><small>{(k.source || []).join(", ")}</small></td>
                  <td>
                    <Badge bg={bg}>{text}</Badge>
                    {k.reason && <div><small className="text-muted">{k.reason}</small></div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
      <small className="text-muted d-block mt-2">{data.kpis[0]?.timezone}</small>
    </div>
  );
}
