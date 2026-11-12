"use client";
// The reports on the Dashboard (SOW 8 Deliverable F): one row of tags under the Dashboard's headline cards. Nothing
// is shown or loaded until a tag is picked (11 Nov 2026: keep the Dashboard as clean as before, no extra server load);
// a tag shows that one report with its filter bar and clickable charts (Bibi), and loads only that report. Every SOW
// dashboard is behind one tag:
//   Lead sources = Lead source / ROI; Leads & appointments = Executive + Appointments;
//   AI & staff = AI operations + BDC productivity; Sales & profit = Sales / Desk Log;
//   Service = Service retention; Data health = Data quality / compliance.
// Every bar or slice opens the Leads list with exactly those leads (/dealer/leads?report_kpi=<id>, same dates and
// filters; app/api/leads/route.js), whose Export CSV is the list. "Show all numbers" has every number with its
// definition, the tables and what is not available yet. Numbers come from GET /api/reports/kpis
// (app/lib/reporting/registry.js); a 404 hides the whole thing.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Dropdown, Spinner } from "react-bootstrap";
import moment from "moment-timezone";
import FilterBar from "./FilterBar";
import { Breakdown, GroupTable, KpiGrid } from "./KpiCards";
import Definitions from "./Definitions";
import { SectionCharts } from "./Charts";
import { downloadSourceReport, reportQuery, reportsGet } from "../reportsApi";

const ALL_TIME_FROM = "2015-01-01";
const NO_FILTERS = { source: "", lead_source: "", assigned_to: "", actor: "", appointment_type: "" };
const ACTIVE_KEY = "dashboard_report_tag";

// own: the reports whose numbers the section lists under "Show all numbers". uses: also read for its charts.
export const SECTIONS = Object.freeze([
  { key: "sources", tag: "Lead sources", title: "Where leads come from", own: ["lead_source"], uses: [] },
  { key: "outcomes", tag: "Leads & appointments", title: "What happened to the leads", own: ["executive", "appointments"],
    uses: [] },
  { key: "work", tag: "AI & staff", title: "Who did the work: AI and staff", own: ["ai", "bdc"], uses: ["appointments"] },
  { key: "sales", tag: "Sales & profit", title: "Sales & profit", own: ["sales"], uses: ["executive"] },
  { key: "service", tag: "Service", title: "Service", own: ["service"], uses: [] },
  { key: "health", tag: "Data health", title: "Data health", own: ["data_quality"], uses: [] },
]);
const DEFINITIONS = "definitions";

// Cards left out of "Show all numbers" because the headline cards above already show the same number (the reports
// leave duplicate bookings - same lead, day and time - out). They still feed the charts and tables, which split them.
export const OVERVIEW_DUPLICATES = new Set([
  "exec.leads_received", "exec.appointments_set", "exec.appointments_scheduled", "exec.shown",
  "appointments.set", "appointments.scheduled", "appointments.shown",
  "source.leads", "source.replied_leads", "source.appointments", "source.shown",
]);

// The picked tag, kept for this browser tab so Back from a Leads list returns to the same report. None = nothing shown.
function readActive() {
  try {
    const v = sessionStorage.getItem(ACTIVE_KEY);
    return SECTIONS.some((s) => s.key === v) || v === DEFINITIONS ? v : null;
  } catch {
    return null;
  }
}

// Every number of a section with its definition, the section's tables and what is not available yet.
function AllNumbers({ section, kpis, k, linkFor }) {
  const [open, setOpen] = useState(false);
  const live = kpis.filter((x) => (x.state === "live" || x.state === "error") && !OVERVIEW_DUPLICATES.has(x.id));
  const notYet = kpis.filter((x) => x.state !== "live" && x.state !== "error");
  if (!live.length && !notYet.length) return null;
  return (
    <>
      <div className="mb-3">
        <Button size="sm" variant="outline-dark" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Hide all numbers" : `Show all numbers (${live.length + notYet.length})`}
        </Button>
      </div>
      {open && (
        <>
          {section === "sources" && (
            <GroupTable title="Funnel by lead source" firstColumn="Lead source" by="lead_source" linkFor={linkFor}
              kpis={["source.leads", "source.replied_leads", "source.appointments", "source.shown",
                "source.crm_sold"].map(k)} />
          )}
          {section === "work" && (
            <GroupTable title="By staff member (current lead owner)" firstColumn="Staff" by="staff" linkFor={linkFor}
              kpis={["bdc.assigned_leads", "bdc.speed_to_lead", "bdc.staff_texts", "bdc.staff_emails",
                "bdc.call_tasks_completed", "bdc.meaningful_contacts", "bdc.call_tasks_missed",
                "bdc.call_tasks_overdue", "bdc.appointments_by_owner"].map(k)} />
          )}
          <KpiGrid kpis={live} linkFor={linkFor} />
          {section === "outcomes" && (
            <div className="row">
              <div className="col-md-4"><Breakdown kpi={k("appointments.set")} by="creator" title="Set, by who made it" linkFor={linkFor} /></div>
              <div className="col-md-4"><Breakdown kpi={k("appointments.set")} by="department" title="Set, sales / service" linkFor={linkFor} /></div>
              <div className="col-md-4"><Breakdown kpi={k("appointments.set")} by="lead_source" title="Set, by lead source" linkFor={linkFor} /></div>
            </div>
          )}
          {section === "sales" && (
            <div className="row">
              <div className="col-md-6"><Breakdown kpi={k("sales.unsold_reasons")} by="reason" title="Unsold, by reason" linkFor={linkFor} /></div>
              <div className="col-md-6"><Breakdown kpi={k("sales.stage_aging")} by="aging" title="Open visits, time in stage" linkFor={linkFor} /></div>
            </div>
          )}
          {section === "work" && (
            <div className="row">
              <div className="col-md-6"><Breakdown kpi={k("ai.handoffs")} by="reason" title="Handoffs by reason" linkFor={linkFor} /></div>
              <div className="col-md-6"><Breakdown kpi={k("ai.messages_sent")} by="channel" title="AI messages by channel" linkFor={linkFor} /></div>
            </div>
          )}
          {notYet.length > 0 && (
            <div className="w_card mb-3">
              <h3 className="w_card_title">Not available yet</h3>
              <ul className="mb-0">
                {notYet.map((x) => (
                  <li key={x.id}>
                    <strong>{x.label}</strong>{" "}
                    <small className="text-muted">({x.state === "blocked" ? "blocked" : "needs data"}: {x.reason})</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  );
}

// Betsy's source / sub-source report as a PDF or CSV (app/lib/reporting/sourcePerformance.js): same dates and filters as the
// screen; "In timeframe" counts everything in the range, "From current leads" only what belongs to leads received in it.
function SourceReportDownload({ params }) {
  const [basis, setBasis] = useState("timeframe");
  const [busy, setBusy] = useState(null); // "csv" | "pdf" while that file is being prepared
  const [error, setError] = useState(null);
  const download = async (format) => {
    setBusy(format);
    setError(null);
    try {
      await downloadSourceReport({ ...params, basis }, format);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
      <div className="btn-group btn-group-sm" role="group" aria-label="How to count">
        {[["timeframe", "In timeframe"], ["current", "From current leads"]].map(([key, label]) => (
          <Button key={key} size="sm" variant={basis === key ? "dark" : "outline-dark"} onClick={() => setBasis(key)}
            aria-pressed={basis === key}>{label}</Button>
        ))}
      </div>
      {/* Betsy, 12 Nov 2026: "Dealers need pretty reports to present" - PDF or CSV from one button (user, 13 Nov). */}
      <Dropdown>
        <Dropdown.Toggle size="sm" variant="outline-dark" disabled={Boolean(busy) || !params}>
          <i className="fa-regular fa-download me-1"></i>{busy ? `Preparing ${busy.toUpperCase()}...` : "Download"}
        </Dropdown.Toggle>
        <Dropdown.Menu>
          <Dropdown.Item onClick={() => download("pdf")}><i className="fa-regular fa-file-pdf me-2"></i>PDF</Dropdown.Item>
          <Dropdown.Item onClick={() => download("csv")}><i className="fa-regular fa-file-csv me-2"></i>CSV (Excel)</Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>
      {error && <small className="text-danger">{error}</small>}
    </div>
  );
}

function Section({ def, reports, linkFor, tz, params }) {
  const all = [...def.own, ...def.uses];
  const loaded = all.map((d) => reports[d]).filter(Boolean);
  const byId = new Map(loaded.flatMap((r) => r.kpis.map((x) => [x.id, x])));
  const k = (id) => byId.get(id);
  const kpisOf = (d) => reports[d]?.kpis || [];
  const ownKpis = def.own.flatMap(kpisOf);
  const loading = loaded.length < all.length;
  const first = loaded[0];
  return (
    <div className="mb-3">
      <div className="d-flex align-items-center mb-2">
        <h3 className="w_card_title mb-0 me-auto">{def.title}</h3>
        {first && (
          <small className="text-muted">Updated {moment(first.last_updated).tz(tz).format("MMM D, h:mm A")}</small>
        )}
      </div>
      {loading ? (
        <div className="text-center py-4"><Spinner animation="border" variant="dark" size="sm" /></div>
      ) : (
        <>
          {def.key === "sales" && (
            <Alert variant="info" className="py-2">
              Showroom visits, stages and unsold reasons come from the Desk Log. Numbers marked proxy are CRM status
              changes, kept until the Desk Log is in daily use. Gross profit by source from DealerVault is being added.
            </Alert>
          )}
          {loaded.flatMap((r) => r.unsupported || []).length > 0 && (
            <Alert variant="warning" className="py-2">
              Not applied: {[...new Set(loaded.flatMap((r) => (r.unsupported || []).map((u) => `${u.key} (${u.reason})`)))]
                .join("; ")}
            </Alert>
          )}
          {def.key === "sources" && <SourceReportDownload params={params} />}
          <SectionCharts section={def.key} k={k} kpisOf={kpisOf} range={first?.range} linkFor={linkFor} />
          <AllNumbers section={def.key} kpis={ownKpis} k={k} linkFor={linkFor} />
        </>
      )}
    </div>
  );
}

// range: the Dashboard's picked range ({startDate, endDate}, null dates = All time).
export default function ReportSections({ dealerId, tz, range }) {
  const [filters, setFilters] = useState(NO_FILTERS);
  const [options, setOptions] = useState({});
  const [active, setActive] = useState(readActive);
  // dashboard id -> { key, report }; key is the query it answers, so a changed range or filter refetches.
  const [store, setStore] = useState({});
  const [definitions, setDefinitions] = useState(null);
  const [error, setError] = useState(null);
  const [hidden, setHidden] = useState(false);

  const startKey = range?.startDate ? new Date(range.startDate).toISOString() : "";
  const endKey = range?.endDate ? new Date(range.endDate).toISOString() : "";
  const dates = useMemo(() => {
    const today = moment.tz(tz).format("YYYY-MM-DD");
    return {
      start_date: startKey ? moment.utc(startKey).tz(tz).format("YYYY-MM-DD") : ALL_TIME_FROM,
      end_date: endKey ? moment.utc(endKey).tz(tz).format("YYYY-MM-DD") : today,
    };
  }, [startKey, endKey, tz]);
  const params = useMemo(() => (dealerId ? { dealer_id: dealerId, ...dates, ...filters } : null),
    [dates, dealerId, filters]);
  const queryKey = params ? JSON.stringify(params) : "";

  // The Leads list for one number (or one breakdown group, or a rate's "out of" part): the picked dates as the
  // dealer-local days' instants (as the headline cards' links send them) and the filters.
  const linkFor = useCallback((kpi, { by, group, part, from, to } = {}) => {
    if (!kpi?.leads_link) return null;
    const q = new URLSearchParams({ report_kpi: kpi.id });
    q.set("startDate", moment.tz(from || dates.start_date, "YYYY-MM-DD", tz).startOf("day").toISOString());
    q.set("endDate", moment.tz(to || dates.end_date, "YYYY-MM-DD", tz).endOf("day").toISOString());
    if (part === "denominator") q.set("report_part", "denominator");
    if (by) {
      q.set("report_by", by);
      q.set("report_group", group);
    }
    const f = reportQuery(filters);
    if (f) q.set("report_filters", f);
    return `/dealer/leads?${q.toString()}`;
  }, [dates, tz, filters]);

  const fail = useCallback((e) => {
    if (e.status === 404) setHidden(true);
    else setError(e.message);
  }, []);

  const section = SECTIONS.find((s) => s.key === active) || null;
  // The filter bar's choices, once, only after a report is picked.
  const needOptions = Boolean(section) && !options.loaded;
  useEffect(() => {
    if (!dealerId || !needOptions) return;
    reportsGet({ dealer_id: dealerId, options: 1 }).then((o) => setOptions({ ...o, loaded: true })).catch(fail);
  }, [dealerId, needOptions, fail]);

  // Only the picked report's data, each fetched once per query (and cached by the server for five minutes).
  const wanted = useMemo(() => (section ? [...section.own, ...section.uses] : []), [section]);
  useEffect(() => {
    if (!params) return undefined;
    let live = true;
    setError(null);
    for (const dashboard of wanted) {
      if (store[dashboard]?.key === queryKey) continue;
      reportsGet({ ...params, dashboard })
        .then((report) => { if (live) setStore((s) => ({ ...s, [dashboard]: { key: queryKey, report } })); })
        .catch(fail);
    }
    return () => { live = false; };
    // store is left out on purpose: a finished fetch must not start the others again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, wanted, fail]);

  useEffect(() => {
    if (active !== DEFINITIONS || definitions || !dealerId) return;
    reportsGet({ dealer_id: dealerId, definitions: 1 }).then(setDefinitions).catch(fail);
  }, [active, definitions, dealerId, fail]);

  // Click a tag to show its report; click it again to hide it.
  const pick = (key) => {
    const next = active === key ? null : key;
    setActive(next);
    try {
      if (next) sessionStorage.setItem(ACTIVE_KEY, next);
      else sessionStorage.removeItem(ACTIVE_KEY);
    } catch { /* not kept; fine */ }
  };
  const tags = [...SECTIONS.map((s) => [s.key, s.tag]), [DEFINITIONS, "How numbers are counted"]];

  if (hidden) return null;
  // Only answers to the current query are shown; older ones wait behind the spinner.
  const reports = Object.fromEntries(Object.entries(store).filter(([, v]) => v.key === queryKey)
    .map(([d, v]) => [d, v.report]));

  return (
    <div className="mt-2 mb-3">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <span className="text-muted small me-1">Reports:</span>
        {tags.map(([key, label]) => (
          <Button key={key} size="sm" className="rounded-pill" variant={active === key ? "dark" : "outline-dark"}
            onClick={() => pick(key)} aria-pressed={active === key}>{label}</Button>
        ))}
        {active && (
          <Button size="sm" variant="link" className="text-muted" onClick={() => pick(active)}>Hide</Button>
        )}
      </div>
      {error && <Alert variant="danger">{error}</Alert>}
      {section && (
        <>
          <FilterBar filters={filters} onFilters={setFilters} options={options} />
          <Section def={section} reports={reports} linkFor={linkFor} tz={tz} params={params} />
        </>
      )}
      {active === DEFINITIONS && (definitions ? <Definitions data={definitions} />
        : <div className="text-center py-4"><Spinner animation="border" variant="dark" size="sm" /></div>)}
    </div>
  );
}
