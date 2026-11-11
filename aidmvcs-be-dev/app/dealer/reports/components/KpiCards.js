"use client";
// KPI cards in the Dashboard's card style (styles.css .w_card .d_counts_card). A number tied to leads opens the Leads
// list with that number's leads (/dealer/leads?report_kpi=..., linkFor), as the Dashboard's cards do: the whole card is
// the link (same <a className="d-block"> as dashboard/components/CountCard.js), and a rate card links its count and its
// "out of" number. Numbers not tied to leads, and blocked / needs-data KPIs, are plain.
import { Badge, Table } from "react-bootstrap";
import { rememberBack } from "../../components/backLink";

const ICONS = { lead: "fa-magnet", customer: "fa-users", booking: "fa-calendar-check", message: "fa-messages",
  call_task: "fa-phone", ai_touch: "fa-message-bot" };

export function formatValue(k) {
  if (k.value == null) return "–";
  if (k.kind === "rate") return `${k.value}%`;
  if (k.kind === "median") return `${k.value} min`;
  return Number(k.value).toLocaleString();
}

// Same tab, with a way back to the Dashboard (client, 11 Nov 2026).
const back = (link) => ({ onClick: () => rememberBack(link) });

export function KpiCard({ kpi, linkFor }) {
  const live = kpi.state === "live";
  const link = live && linkFor ? linkFor(kpi) : null;
  const rate = kpi.kind === "rate" && kpi.denominator;
  const denLink = rate && link ? linkFor(kpi, { part: "denominator" }) : null;
  const value = live ? formatValue(kpi) : kpi.state === "error" ? "!" : "–";
  const sub = rate ? (
    <>
      {kpi.numerator?.count ?? 0} of{" "}
      {denLink ? <a href={denLink} {...back(denLink)}>{kpi.denominator.count}</a> : kpi.denominator.count}
      {kpi.denominator_label ? ` ${kpi.denominator_label}` : ""}
    </>
  ) : kpi.kind === "median" ? `over ${kpi.count ?? 0}` : null;
  const content = (
    <div className="w_card d_counts_card h-100" style={live ? undefined : { opacity: 0.75 }}>
      <div className="d_counts_icon"><i className={`fa-regular ${ICONS[kpi.grain] || "fa-chart-column"}`}></i></div>
      <div className="d_counts_info">
        <h3>{rate && link ? <a href={link} {...back(link)}>{value}</a> : value}</h3>
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
      {link && !rate ? <a href={link} className="d-block h-100" {...back(link)}>{content}</a> : content}
    </div>
  );
}

export function KpiGrid({ kpis, linkFor }) {
  return <div className="row gx-2 gx-lg-4">{kpis.map((k) => <KpiCard key={k.id} kpi={k} linkFor={linkFor} />)}</div>;
}

// A count that opens its group's leads when the KPI is tied to leads; otherwise just the number.
function GroupCount({ kpi, by, group, count, linkFor }) {
  const link = count && linkFor ? linkFor(kpi, { by, group }) : null;
  return link ? <a href={link} {...back(link)}>{count}</a> : <>{count}</>;
}

// One breakdown of one KPI (e.g. appointments by creator).
export function Breakdown({ kpi, by, title, linkFor }) {
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
                  <GroupCount kpi={kpi} by={by} group={g.key} count={g.count} linkFor={linkFor} />
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
export function GroupTable({ kpis, by, title, firstColumn, linkFor }) {
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
                  {live.map((k) => (
                    <td key={k.id} className="text-end">
                      <GroupCount kpi={k} by={by} group={key} count={cell(k, key)} linkFor={linkFor} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : <small className="text-muted">Nothing in this range.</small>}
    </div>
  );
}
