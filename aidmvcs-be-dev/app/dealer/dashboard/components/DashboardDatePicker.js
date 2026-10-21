"use client";
// Dashboard date picker (Betsy, 21 Oct 2026: the Google-style picker - presets on the left, the start/end dates and a
// scrolling calendar on the right, "days up to today/yesterday" and Compare). Default: Today.
// Dates go out as UTC instants for the start/end of the dealer's days; "All time" sends nulls.
import { useEffect, useRef, useState } from "react";
import { Button, Form } from "react-bootstrap";
import { DateRange } from "react-date-range";
import moment from "moment-timezone";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";
import "./dashboardDatePicker.css";
import { presetRange, previousPeriod } from "./dateRanges";

export { presetRange, previousPeriod };

// A dealer-local calendar day as a browser Date (what the calendar shows) and back.
const toLocal = (m) => new Date(m.year(), m.month(), m.date());
const fromLocal = (d, tz) => moment.tz(moment(d).format("YYYY-MM-DD"), "YYYY-MM-DD", tz);

const PRESETS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["this_week", "This week (Sun – Today)"],
  ["last_7", "Last 7 days"],
  ["last_week", "Last week (Sun – Sat)"],
  ["last_14", "Last 14 days"],
  ["this_month", "This month"],
  ["last_30", "Last 30 days"],
  ["last_month", "Last month"],
  ["all_time", "All time"],
];

export const PRESET_LABELS = Object.fromEntries([...PRESETS, ["custom", "Custom"]]);

export default function DashboardDatePicker({ value, onChange, timezone }) {
  const tz = timezone || "America/New_York";
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState(value?.preset || "today");
  const [toToday, setToToday] = useState(30);
  const [toYesterday, setToYesterday] = useState(30);
  const [compare, setCompare] = useState(Boolean(value?.compare));
  const [selection, setSelection] = useState(null);
  const wrapperRef = useRef(null);

  const rangeFor = (key, n) => {
    const r = presetRange(key, tz, n);
    return r ? { startDate: toLocal(r[0]), endDate: toLocal(r[1]), key: "selection" }
      : { startDate: null, endDate: null, key: "selection" };
  };

  // Opening the picker starts from what the page shows.
  useEffect(() => {
    if (!open) return;
    setPreset(value?.preset || "custom");
    setCompare(Boolean(value?.compare));
    setSelection(value?.startDate && value?.endDate
      ? { startDate: toLocal(moment.utc(value.startDate).tz(tz)), endDate: toLocal(moment.utc(value.endDate).tz(tz)), key: "selection" }
      : { startDate: null, endDate: null, key: "selection" });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const close = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (key, n) => { setPreset(key); setSelection(rangeFor(key, n)); };

  const apply = () => {
    const s = selection || {};
    const startDate = s.startDate ? fromLocal(s.startDate, tz).startOf("day").utc().toDate() : null;
    const endDate = s.endDate ? fromLocal(s.endDate, tz).endOf("day").utc().toDate() : null;
    onChange({
      startDate, endDate, preset,
      compare: compare && startDate && endDate ? previousPeriod(startDate, endDate, tz) : null,
    });
    setOpen(false);
  };

  const label = () => {
    if (!value?.startDate || !value?.endDate) return "All time";
    const start = moment.utc(value.startDate).tz(tz);
    const end = moment.utc(value.endDate).tz(tz);
    const named = value.preset && value.preset !== "custom" ? `${PRESET_LABELS[value.preset]}: ` : "";
    const dates = start.isSame(end, "day") ? start.format("MMM D, YYYY") : `${start.format("MMM D")} – ${end.format("MMM D, YYYY")}`;
    return `${named}${dates}${value.compare ? " · compared" : ""}`;
  };

  const shown = selection || { startDate: null, endDate: null, key: "selection" };
  const fmt = (d) => (d ? moment(d).format("MMM D, YYYY") : "");

  return (
    <div ref={wrapperRef} className="position-relative">
      <Button variant="light" size="sm" className="border p-2 rounded bg-white text-nowrap" onClick={() => setOpen((o) => !o)}>
        <i className="fa-regular fa-calendar me-1"></i>{label()}
      </Button>

      {open && (
        <div className="dash_datepicker">
          <div className="dash_datepicker_body">
            <div className="dash_datepicker_presets">
              <button type="button" className={`dash_preset ${preset === "custom" ? "active" : ""}`} onClick={() => setPreset("custom")}>
                Custom
              </button>
              <hr />
              {PRESETS.map(([key, text]) => (
                <button key={key} type="button" className={`dash_preset ${preset === key ? "active" : ""}`} onClick={() => pick(key)}>
                  {text}
                </button>
              ))}
              <hr />
              <div className={`dash_preset_days ${preset === "days_to_today" ? "active" : ""}`}>
                <Form.Control type="number" min={1} size="sm" value={toToday}
                  onChange={(e) => { setToToday(e.target.value); pick("days_to_today", e.target.value); }}
                  onFocus={() => pick("days_to_today", toToday)} />
                <span>days up to today</span>
              </div>
              <div className={`dash_preset_days ${preset === "days_to_yesterday" ? "active" : ""}`}>
                <Form.Control type="number" min={1} size="sm" value={toYesterday}
                  onChange={(e) => { setToYesterday(e.target.value); pick("days_to_yesterday", e.target.value); }}
                  onFocus={() => pick("days_to_yesterday", toYesterday)} />
                <span>days up to yesterday</span>
              </div>
              <hr />
              <Form.Check type="switch" id="dash-compare" label="Compare (previous period)" checked={compare}
                onChange={(e) => setCompare(e.target.checked)} />
            </div>

            <div className="dash_datepicker_calendar">
              <div className="dash_datepicker_inputs">
                <Form.Control size="sm" readOnly value={shown.startDate ? fmt(shown.startDate) : "All time"} aria-label="Start date" />
                <span>—</span>
                <Form.Control size="sm" readOnly value={shown.endDate ? fmt(shown.endDate) : ""} aria-label="End date" />
              </div>
              <DateRange
                ranges={[shown.startDate ? shown : { ...shown, startDate: new Date(), endDate: new Date() }]}
                onChange={(r) => { setPreset("custom"); setSelection(r.selection); }}
                moveRangeOnFirstSelection={false}
                rangeColors={["#1a73e8"]}
                direction="vertical"
                scroll={{ enabled: true, monthHeight: 260, longMonthHeight: 300, calendarHeight: 330 }}
                showDateDisplay={false}
                showMonthAndYearPickers={true}
                maxDate={toLocal(moment.tz(tz))}
              />
            </div>
          </div>
          <div className="dash_datepicker_footer">
            <Button variant="outline-secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="custom" size="sm" onClick={apply}>Apply</Button>
          </div>
        </div>
      )}
    </div>
  );
}
