"use client";
// Desk Log (Betsy's Priority 3; SOW v6 Deliverable C, design: "AutoPulse AI Desk Log Dashboard"). Every customer
// checked in at the showroom, who works the deal, its stage and its outcome. Today / month-to-date cards, the
// design's filter row, manager views (still open, stalled, no next step, unsold to follow up), and the visits table
// with stage, people and outcome changed in place. While the 'desk_log' feature is at level 'admin', only a super
// admin (also through "login as") can open it.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Dropdown, Form, Spinner } from "react-bootstrap";
import moment from "moment-timezone";
import { useUser } from "../context/UserContext";
import DashboardDatePicker, { presetRange } from "../dashboard/components/DashboardDatePicker";
import { reportDates } from "../reports/components/DownloadReport";
import { changeLeadStatus, deskLogAppointments, deskLogGet, deskLogRules, staffList } from "./deskLogApi";
import AppointmentsToday from "./components/AppointmentsToday";
import StatusModal from "../leads/components/StatusModal";
import DeskCards from "./components/DeskCards";
import DeskTable from "./components/DeskTable";
import CheckInModal from "./components/CheckInModal";
import VisitModal from "./components/VisitModal";
import RulesModal from "./components/RulesModal";
import useLiveRefresh from "../../hooks/useLiveRefresh";
import { aiFetch } from "../ai/components/aiShared";
import "./deskLog.css";

const EMPTY_FILTERS = { department: "", lead_type: "", source: "", stage: "", outcome: "", salesperson_id: "",
  sales_manager_id: "", bdc_agent_id: "", dnd: "" };
const STAGE_OPTIONS = ["QUALIFY", "TEST DRIVE", "APPRAISAL", "PROPOSAL", "T.O.", "VERBAL AGREEMENT"];
const OUTCOME_OPTIONS = [["none", "Still open (no outcome)"], ["SOLD PENDING", "Sold Pending"],
  ["SOLD DELIVERED", "Sold Delivered"], ["UNSOLD", "Unsold (any reason)"],
  ...["Negative Equity", "Price/Payment", "Credit", "Hot", "Future Follow-Up", "Car Finder", "DND"]
    .map((r) => [`UNSOLD|${r}`, `Unsold - ${r}`])];
const LEAD_TYPES = [["Internet", "Internet"], ["Phone", "Phone Up"], ["Walk-in", "Walk-In"], ["Campaign", "Campaign"],
  ["Other", "Other"]];

export default function DeskLogPage() {
  const { dealerParent, loadingParent } = useUser();
  const dealerId = dealerParent?.id || dealerParent?._id || null;
  const tz = dealerParent?.dealer_account_information?.time_zone || "America/New_York";
  const [range, setRange] = useState(null);
  const [view, setView] = useState("all");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [notice, setNotice] = useState(null);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checkIn, setCheckIn] = useState(false);
  const [opened, setOpened] = useState(null); // { id, name }
  const [rulesOpen, setRulesOpen] = useState(false);
  // The picked day's appointments, and a lead whose status is being changed from here ({ leadId, name, status }).
  const [appts, setAppts] = useState(null);
  const [statusFor, setStatusFor] = useState(null);
  // Paging (18 Nov 2026): the table shows one page of visits, newest first; any filter, search or date change goes
  // back to page 1.
  const [paging, setPaging] = useState({ page: 1, limit: 25 });
  useEffect(() => { setPaging((p) => (p.page === 1 ? p : { ...p, page: 1 })); }, [range, view, q, filters]);
  const [rules, setRules] = useState(null);

  // Today in the dealership's time zone (only once the dealer, and so its time zone, is loaded).
  useEffect(() => {
    if (!range && dealerParent) {
      const r = presetRange("today", tz);
      setRange({ startDate: r[0].clone().startOf("day").utc().toDate(), endDate: r[1].clone().endOf("day").utc().toDate(),
        preset: "today" });
    }
  }, [range, tz, dealerParent]);

  // Opened from a customer's profile: "Check in to the showroom" (?check_in=<lead>) or a visit (?visit=<visit>).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (/^[0-9a-f]{24}$/i.test(p.get("check_in") || "")) setCheckIn({ leadId: p.get("check_in") });
    if (/^[0-9a-f]{24}$/i.test(p.get("visit") || "")) setOpened({ id: p.get("visit"), name: "" });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!dealerId) return;
    staffList(dealerId).then(setStaff).catch(() => setStaff([]));
    deskLogRules(dealerId).then(setRules).catch(() => setRules(null));
  }, [dealerId]);

  const dates = useMemo(() => (range ? reportDates(range, tz) : null), [range, tz]);

  // The AI Assistant's open Dealership Action Required count (DeskCards); no number when the AI service can't be read.
  const [actionNow, setActionNow] = useState(null);
  const loadActionNow = useCallback(() => aiFetch("/api/dealer-ai/alerts?count_only=1")
    .then((d) => setActionNow(d.unhandled_count || 0)).catch(() => setActionNow(null)), []);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!dealerId || !dates) return;
    loadActionNow();
    if (!silent) setLoading(true);
    try {
      // Appointments: the day the cards show (one day picked, or the last day of the range).
      const [list, ap] = await Promise.all([
        deskLogGet({ dealer_id: dealerId, ...dates, view, q, cards: 1, ...filters, page: paging.page, limit: paging.limit }),
        deskLogAppointments({ dealer_id: dealerId, day: dates.end_date, department: filters.department }).catch(() => null),
      ]);
      setData(list);
      setAppts(ap);
      setError(null);
    } catch (e) {
      if (!silent) setError(e.status === 404 ? "not_available" : e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [dealerId, dates, view, q, filters, loadActionNow, paging]);

  useEffect(() => { load(); }, [load]);
  // G-083: check-ins, stages and outcomes other people enter show up without a refresh (paused while a visit or the
  // check-in form is open). 13 Nov 2026 meeting (3.9): every 10 s, and at once when the tab is shown again.
  useLiveRefresh(() => load({ silent: true }), { everyMs: 10000, paused: loading || checkIn || !!opened || !!statusFor });

  // A status picked here goes through the lead's status route; a full slot keeps the modal open with the next time.
  const saveStatus = async (status, extra) => {
    try {
      await changeLeadStatus(statusFor.leadId, status, extra);
      setNotice(`${statusFor.name || "The lead"}: status set to ${status}.`);
      load();
    } catch (e) {
      if (e?.slotConflict) throw e;
      setError(e.message);
    }
  };

  if (loadingParent || !dealerParent || !range) {
    return <div className="page_content d-flex justify-content-center p-5"><Spinner animation="border" /></div>;
  }
  if (error === "not_available") {
    return <div className="page_content"><Alert variant="secondary">The Desk Log is not available for this account
      yet.</Alert></div>;
  }

  const setFilter = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const staffPairs = staff.map((x) => [x._id, x.name || x.email]);
  const filtered = Object.values(filters).some(Boolean) || q || view !== "all";
  const isToday = data?.cards?.day === moment.tz(tz).format("YYYY-MM-DD");
  const dayWord = isToday ? "TODAY" : (data?.cards?.day ? moment.tz(data.cards.day, "YYYY-MM-DD", tz).format("MMM D")
    .toUpperCase() : "");

  return (
    <div className="page_content desk_log">
      <div className="page_head">
        <div className="d-flex align-items-center flex-wrap gap-2">
          <div className="me-auto">
            <h3 className="page_title mb-0">Desk Log</h3>
            <small className="text-muted">Manage, follow up, and convert your sales and service opportunities.</small>
          </div>
          {/* Betsy's top bar: search, date, Customer Check-in (with its menu). */}
          <div className="dl_top_search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <Form.Control id="dl-search" size="sm" placeholder="Search by name, phone, email, VIN, stock #..." value={search}
              aria-label="Search" onChange={(e) => setSearch(e.target.value)} />
          </div>
          <DashboardDatePicker value={range} onChange={(r) => setRange({ ...r, compare: null })} timezone={tz} />
          {/* SOW G-056: the Desk Log as it is filtered now, on paper (styles.css @media print). */}
          <Button size="sm" variant="outline-custom" onClick={() => window.print()} title="Print the Desk Log as filtered now">
            <i className="fa-solid fa-print me-1"></i>Print
          </Button>
          <Dropdown as="div" className="btn-group">
            <Button size="sm" variant="custom" onClick={() => setCheckIn(true)}>
              <i className="fa-solid fa-right-to-bracket me-1"></i>Customer Check-in
            </Button>
            <Dropdown.Toggle split size="sm" variant="custom" aria-label="More" />
            <Dropdown.Menu align="end">
              <Dropdown.Item onClick={() => setCheckIn(true)}>Check in a customer</Dropdown.Item>
              <Dropdown.Item onClick={() => setRulesOpen(true)}>Desk Log settings</Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </div>
      </div>

      <div className="print_only small text-muted mb-2">Desk Log summary · printed {new Date().toLocaleString("en-US")} · the visits shown on screen (this page, current filters)</div>
      <div className="page_body">
        {data?.cards && (
          <div className="mb-1">
            <DeskCards cards={data.cards.cards} dayWord={dayWord} actionNow={actionNow} />
            {!isToday && <small className="text-muted d-block mt-1">Cards show the last picked day and its month up
              to that day.</small>}
          </div>
        )}

        <div className="w_card my-3">
          {/* Betsy's filter row: "All ..." menus, then Stage, Outcome and DND (13 Nov 2026 meeting). */}
          <div className="dl_filters">
            {[
              ["department", "All Departments", [["sales", "Sales"], ["service", "Service"]]],
              ["lead_type", "All Lead Types", LEAD_TYPES],
              ["source", "All Lead Sources", [...new Set([...(data?.sources || []), filters.source].filter(Boolean))].map((x) => [x, x])],
              ["salesperson_id", "All Salespeople", staffPairs],
              ["sales_manager_id", "All Sales Managers", staffPairs],
              ["bdc_agent_id", "All BDC Agents", staffPairs],
              ["stage", "All Stages", [["none", "No stage yet"], ...STAGE_OPTIONS.map((x) => [x, x])]],
              ["outcome", "All Outcomes", OUTCOME_OPTIONS],
              ["dnd", "DND: all customers", [["only", "DND only"], ["exclude", "Hide DND"]]],
            ].map(([key, all, options]) => (
              <div key={key}>
                <Form.Select size="sm" value={filters[key]} onChange={setFilter(key)} aria-label={all}
                  className={filters[key] ? "active_filter" : ""}>
                  <option value="">{all}</option>
                  {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Form.Select>
              </div>
            ))}
            <div className="text-end">
              <Button size="sm" variant="link" className="p-0 fw-semibold" disabled={!filtered}
                onClick={() => { setFilters(EMPTY_FILTERS); setSearch(""); setView("all"); }}>Clear Filters</Button>
            </div>
          </div>
          <div className="dl_views mt-3">
            {Object.entries(data?.views || { all: "All visits" }).map(([key, label]) => (
              <Button key={key} size="sm" variant={view === key ? "custom" : "outline-custom"}
                onClick={() => setView(key)}>{label}</Button>
            ))}
            {loading && <Spinner animation="border" size="sm" className="ms-2" />}
          </div>
        </div>

        {appts && (dates?.start_date === dates?.end_date || appts.appointments.length > 0) && (
          <AppointmentsToday day={appts.day} items={appts.appointments} tz={tz} loading={loading}
            onCheckIn={(a) => setCheckIn({ leadId: a.lead_id })} onStatus={setStatusFor} />
        )}

        {error && <Alert variant="danger">{error}</Alert>}
        {notice && <Alert variant="success" dismissible onClose={() => setNotice(null)} className="py-2">{notice}</Alert>}
        {data && (
          <DeskTable rows={data.rows} staff={staff} tz={tz} onChanged={load} onOpen={setOpened} dealerId={dealerId} rules={rules}
            onStatus={setStatusFor}
            empty={filtered ? "No visits match these filters." : "No customers checked in for these dates yet."} />
        )}
        {data && data.total > 0 && (
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mt-2 small text-muted">
            <span>{(data.page - 1) * data.limit + 1}-{Math.min(data.total, data.page * data.limit)} of {data.total} visits</span>
            <div className="d-flex align-items-center gap-2">
              <Form.Select size="sm" style={{ width: "auto" }} value={paging.limit} aria-label="Rows per page"
                onChange={(e) => setPaging({ page: 1, limit: Number(e.target.value) })}>
                {[25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}
              </Form.Select>
              {data.pages > 1 && <>
                <Button size="sm" variant="outline-custom" disabled={data.page <= 1}
                  onClick={() => setPaging((p) => ({ ...p, page: 1 }))}>First</Button>
                <Button size="sm" variant="outline-custom" disabled={data.page <= 1}
                  onClick={() => setPaging((p) => ({ ...p, page: data.page - 1 }))}>Previous</Button>
                <span>Page {data.page} of {data.pages}</span>
                <Button size="sm" variant="outline-custom" disabled={data.page >= data.pages}
                  onClick={() => setPaging((p) => ({ ...p, page: data.page + 1 }))}>Next</Button>
                <Button size="sm" variant="outline-custom" disabled={data.page >= data.pages}
                  onClick={() => setPaging((p) => ({ ...p, page: data.pages }))}>Last</Button>
              </>}
            </div>
          </div>
        )}
        {data?.truncated && <small className="text-muted d-block mt-1">These dates have more than 5,000 visits - only the
          latest 5,000 are listed. Pick fewer days to see the rest.</small>}
      </div>

      {checkIn && dealerId && <CheckInModal dealerId={dealerId} staff={staff} tz={tz} initialLeadId={checkIn.leadId || null}
        onHide={() => setCheckIn(false)}
        onStatus={(s) => { setCheckIn(false); setStatusFor(s); }}
        onDone={(msg) => { setCheckIn(false); setNotice(msg || null); load(); }} />}
      {opened && <VisitModal id={opened.id} name={opened.name} staff={staff} tz={tz} onHide={() => setOpened(null)}
        onChanged={load} />}
      {statusFor && <StatusModal show onHide={() => setStatusFor(null)} currentStatus={statusFor.status || ""}
        onStatusChange={saveStatus} />}
      {rulesOpen && <RulesModal dealerId={dealerId} onHide={() => setRulesOpen(false)}
        onSaved={() => deskLogRules(dealerId).then(setRules).catch(() => {})} />}
    </div>
  );
}
