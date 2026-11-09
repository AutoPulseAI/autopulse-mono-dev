"use client";
// KPI cards in the Dashboard's card style (styles.css .w_card .d_counts_card). Every live number opens its
// drill-down; blocked / needs-data KPIs show why there is no number yet.
import { Badge, Table } from "react-bootstrap";

const ICONS = { lead: "fa-magnet", customer: "fa-users", booking: "fa-calendar-check", message: "fa-messages",
  call_task: "fa-phone", ai_touch: "fa-message-bot" };

export function formatValue(k) {
  if (k.value == null) return "–";
  if (k.kind === "rate") return `${k.value}%`;
  if (k.kind === "median") return `${k.value} min`;
  return Number(k.value).toLocaleString();
}

export function KpiCard({ kpi, onOpen }) {
  const live = kpi.state === "live";
  const sub = kpi.kind === "rate" && kpi.denominator ? `${kpi.numerator?.count ?? 0} of ${kpi.denominator.count}`
    : kpi.kind === "median" ? `over ${kpi.count ?? 0}` : null;
  const content = (
    <div className="w_card d_counts_card h-100" style={live ? { cursor: "pointer" } : { opacity: 0.75 }}>
      <div className="d_counts_icon"><i className={`fa-regular ${ICONS[kpi.grain] || "fa-chart-column"}`}></i></div>
      <div className="d_counts_info">
        <h3>{live ? formatValue(kpi) : kpi.state === "error" ? "!" : "–"}</h3>
        <p>
          {kpi.label}
          {kpi.proxy && <Badge bg="secondary" className="ms-1">proxy</Badge>}
        </p>
        {sub && live && <small className="text-muted d-block">{sub}</small>}
        {!live && (
          <small className="text-muted d-block">
            {kpi.state === "error" ? kpi.error : kpi.state === "blocked" ? `Blocked: ${kpi.reason}`
              : `Needs data: ${kpi.reason}`}
          </small>
        )}
        {live && kpi.ignored_filters?.length > 0 && (
          <small className="text-warning d-block">Not filtered by: {kpi.ignored_filters.join(", ")}</small>
        )}
      </div>
    </div>
  );
  return (
    <div className="col col-lg-3 col-md-6 col-12 mb-3">
      {live ? (
        <div role="button" tabIndex={0} onClick={() => onOpen(kpi)}
          onKeyDown={(e) => { if (e.key === "Enter") onOpen(kpi); }} title="Show the records behind this number">
          {content}
        </div>
      ) : content}
    </div>
  );
}

export function KpiGrid({ kpis, onOpen }) {
  return <div className="row gx-2 gx-lg-4">{kpis.map((k) => <KpiCard key={k.id} kpi={k} onOpen={onOpen} />)}</div>;
}

// One breakdown of one KPI (e.g. appointments by creator); every count opens that group's records.
export function Breakdown({ kpi, by, title, onOpen }) {
  const groups = kpi?.breakdowns?.[by] || [];
  if (!kpi || kpi.state !== "live") return null;
  return (
    <div className="w_card mb-3">
      <h3 className="w_card_title">{title}</h3>
      {groups.length ? (
        <Table size="sm" className="align-middle mb-0">
          <tbody>
            {groups.map((g) => (
              <tr key={g.key}>
                <td>{g.key}</td>
                <td className="text-end">
                  <button type="button" className="btn btn-link btn-sm p-0" onClick={() => onOpen(kpi, { by, group: g.key })}>
                    {g.count}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <small className="text-muted">Nothing in this range.</small>}
    </div>
  );
}

// A grouped table: one row per group, one column per KPI (the lead-source funnel, the BDC per-staff table).
export function GroupTable({ kpis, by, title, firstColumn, onOpen }) {
  const live = kpis.filter((k) => k && k.state === "live" && k.breakdowns?.[by]);
  const keys = [...new Set(live.flatMap((k) => k.breakdowns[by].map((g) => g.key)))];
  const cell = (k, key) => k.breakdowns[by].find((g) => g.key === key)?.count || 0;
  keys.sort((a, b) => cell(live[0], b) - cell(live[0], a) || String(a).localeCompare(String(b)));
  return (
    <div className="w_card mb-3">
      <h3 className="w_card_title">{title}</h3>
      {keys.length ? (
        <div className="table-responsive">
          <Table size="sm" className="align-middle mb-0">
            <thead>
              <tr><th>{firstColumn}</th>{live.map((k) => <th key={k.id} className="text-end">{k.label}</th>)}</tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key}>
                  <td>{key}</td>
                  {live.map((k) => {
                    const n = cell(k, key);
                    return (
                      <td key={k.id} className="text-end">
                        {n ? (
                          <button type="button" className="btn btn-link btn-sm p-0"
                            onClick={() => onOpen(k, { by, group: key })}>{n}</button>
                        ) : 0}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : <small className="text-muted">Nothing in this range.</small>}
    </div>
  );
}
