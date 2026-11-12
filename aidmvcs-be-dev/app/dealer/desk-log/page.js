"use client";
// Desk Log (Betsy's Priority 3; SOW v6 Deliverable C, design: "AutoPulse AI Desk Log Dashboard"). Every customer
// checked in at the showroom, who works the deal, its stage and its outcome. Today / month-to-date cards, the
// design's filter row, manager views (still open, stalled, no next step, unsold to follow up), and the visits table
// with stage, people and outcome changed in place. While the 'desk_log' feature is at level 'admin', only a super
// admin (also through "login as") can open it.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Form, Spinner } from "react-bootstrap";
import moment from "moment-timezone";
import { useUser } from "../context/UserContext";
import DashboardDatePicker, { presetRange } from "../dashboard/components/DashboardDatePicker";
import { reportDates } from "../reports/components/DownloadReport";
import { deskLogGet, staffList } from "./deskLogApi";
import DeskCards from "./components/DeskCards";
import DeskTable from "./components/DeskTable";
import CheckInModal from "./components/CheckInModal";
import VisitModal from "./components/VisitModal";
import "./deskLog.css";

const EMPTY_FILTERS = { department: "", lead_type: "", source: "", salesperson_id: "", sales_manager_id: "",
  bdc_agent_id: "" };
const LEAD_TYPES = [["Internet", "Internet"], ["Phone", "Phone Up"], ["Walk-in", "Walk-In"], ["Campaign", "Campaign"],
  ["Other", "Other"]];

export default function DeskLogPage() {
  const { dealerParent, loadingParent } = useUser();
  const dealerId = dealerParent?.id || dealerParent?._id || null;
  const tz = dealerParent?.dealer_account_information?.time_zone || "America/New_York";
  const [range, setRange] = useState(null);
  const [view, setView] = useState("all");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checkIn, setCheckIn] = useState(false);
  const [opened, setOpened] = useState(null); // { id, name }

  // Today in the dealership's time zone (only once the dealer, and so its time zone, is loaded).
  useEffect(() => {
    if (!range && dealerParent) {
      const r = presetRange("today", tz);
      setRange({ startDate: r[0].clone().startOf("day").utc().toDate(), endDate: r[1].clone().endOf("day").utc().toDate(),
        preset: "today" });
    }
  }, [range, tz, dealerParent]);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!dealerId) return;
    staffList(dealerId).then(setStaff).catch(() => setStaff([]));
  }, [dealerId]);

  const dates = useMemo(() => (range ? reportDates(range, tz) : null), [range, tz]);

  const load = useCallback(async () => {
    if (!dealerId || !dates) return;
    setLoading(true);
    try {
      setData(await deskLogGet({ dealer_id: dealerId, ...dates, view, q, cards: 1, ...filters }));
      setError(null);
    } catch (e) {
      setError(e.status === 404 ? "not_available" : e.message);
    } finally {
      setLoading(false);
    }
  }, [dealerId, dates, view, q, filters]);

  useEffect(() => { load(); }, [load]);

  if (loadingParent || !dealerParent || !range) {
    return <div className="page_content d-flex justify-content-center p-5"><Spinner animation="border" /></div>;
  }
  if (error === "not_available") {
    return <div className="page_content"><Alert variant="secondary">The Desk Log is not available for this account
      yet.</Alert></div>;
  }

  const setFilter = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const staffOptions = staff.map((s) => <option key={s._id} value={s._id}>{s.name || s.email}</option>);
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
            <small className="text-muted">Every customer in the showroom: who is working the deal, how far it got
              and how it ended.</small>
          </div>
          <Form.Control size="sm" style={{ width: 260 }} placeholder="Search by name, phone, VIN, stock #..."
            value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the Desk Log" />
          <DashboardDatePicker value={range} onChange={(r) => setRange({ ...r, compare: null })} timezone={tz} />
          <Button size="sm" variant="primary" onClick={() => setCheckIn(true)}>
            <i className="fa-solid fa-plus me-1"></i>Check in customer
          </Button>
        </div>
      </div>

      <div className="page_body">
        {data?.cards && (
          <div className="mb-1">
            <DeskCards cards={data.cards.cards} dayWord={dayWord} />
            {!isToday && <small className="text-muted d-block mt-1">Cards show the last picked day and its month up
              to that day.</small>}
          </div>
        )}

        <div className="dl_filters my-3">
          <Form.Select size="sm" value={filters.department} onChange={setFilter("department")} aria-label="Department">
            <option value="">All Departments</option><option value="sales">Sales</option>
            <option value="service">Service</option>
          </Form.Select>
          <Form.Select size="sm" value={filters.lead_type} onChange={setFilter("lead_type")} aria-label="Lead type">
            <option value="">All Lead Types</option>
            {LEAD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Form.Select>
          <Form.Select size="sm" value={filters.source} onChange={setFilter("source")} aria-label="Lead source">
            <option value="">All Lead Sources</option>
            {[...new Set([...(data?.sources || []), filters.source].filter(Boolean))]
              .map((s) => <option key={s} value={s}>{s}</option>)}
          </Form.Select>
          <Form.Select size="sm" value={filters.salesperson_id} onChange={setFilter("salesperson_id")}
            aria-label="Salesperson"><option value="">All Salespeople</option>{staffOptions}</Form.Select>
          <Form.Select size="sm" value={filters.sales_manager_id} onChange={setFilter("sales_manager_id")}
            aria-label="Sales manager"><option value="">All Sales Managers</option>{staffOptions}</Form.Select>
          <Form.Select size="sm" value={filters.bdc_agent_id} onChange={setFilter("bdc_agent_id")}
            aria-label="BDC agent"><option value="">All BDC Agents</option>{staffOptions}</Form.Select>
          {filtered && (
            <Button size="sm" variant="link" onClick={() => { setFilters(EMPTY_FILTERS); setSearch(""); setView("all"); }}>
              Clear filters
            </Button>
          )}
        </div>

        <div className="dl_views mb-2">
          {Object.entries(data?.views || { all: "All visits" }).map(([key, label]) => (
            <Button key={key} size="sm" variant={view === key ? "dark" : "outline-secondary"}
              onClick={() => setView(key)}>{label}</Button>
          ))}
          {loading && <Spinner animation="border" size="sm" className="ms-2 align-self-center" />}
        </div>

        {error && <Alert variant="danger">{error}</Alert>}
        {data && (
          <DeskTable rows={data.rows} staff={staff} tz={tz} onChanged={load} onOpen={setOpened} dealerId={dealerId}
            empty={filtered ? "No visits match these filters." : "No customers checked in for these dates yet."} />
        )}
        {data?.truncated && <small className="text-muted">Showing the latest 500 visits. Pick fewer days to see the
          rest.</small>}
      </div>

      {checkIn && <CheckInModal dealerId={dealerId} staff={staff} tz={tz} onHide={() => setCheckIn(false)}
        onDone={() => { setCheckIn(false); load(); }} />}
      {opened && <VisitModal id={opened.id} name={opened.name} staff={staff} tz={tz} onHide={() => setOpened(null)}
        onChanged={load} />}
    </div>
  );
}
