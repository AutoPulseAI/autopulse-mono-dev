"use client";
// "Download report" beside the Dashboard's date picker (client, 11 Nov 2026): every report for the dates picked there
// in one PDF (or CSV) - Executive, Betsy's source / sub-source table, Appointments, AI, BDC, Service, Data quality, Sales
// (GET /api/reports/full, app/lib/reporting/fullReport.js). Shown only where the reports are visible.
import { useState } from "react";
import { Dropdown } from "react-bootstrap";
import moment from "moment-timezone";
import { downloadFullReport } from "../reportsApi";

const ALL_TIME_FROM = "2015-01-01";

// The picked range ({startDate, endDate}, null = All time) as dealer-local days, as the report tags send them.
export function reportDates(range, tz) {
  const day = (d) => moment.utc(new Date(d).toISOString()).tz(tz).format("YYYY-MM-DD");
  return {
    start_date: range?.startDate ? day(range.startDate) : ALL_TIME_FROM,
    end_date: range?.endDate ? day(range.endDate) : moment.tz(tz).format("YYYY-MM-DD"),
  };
}

export default function DownloadReport({ dealerId, tz, range }) {
  const [busy, setBusy] = useState(null); // "pdf" | "csv" while that file is being prepared
  const [error, setError] = useState(null);
  const download = async (format) => {
    setBusy(format);
    setError(null);
    try {
      await downloadFullReport({ dealer_id: dealerId, ...reportDates(range, tz) }, format);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };
  // One button; the format is picked from its menu (user, 13 Nov 2026).
  return (
    <>
      <Dropdown align="end">
        <Dropdown.Toggle size="sm" variant="outline-dark" disabled={Boolean(busy) || !dealerId}>
          <i className="fa-regular fa-download me-1"></i>{busy ? `Preparing ${busy.toUpperCase()}...` : "Download report"}
        </Dropdown.Toggle>
        <Dropdown.Menu>
          <Dropdown.Item onClick={() => download("pdf")}><i className="fa-regular fa-file-pdf me-2"></i>PDF</Dropdown.Item>
          <Dropdown.Item onClick={() => download("csv")}><i className="fa-regular fa-file-csv me-2"></i>CSV (Excel)</Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>
      {error && <small className="text-danger">{error}</small>}
    </>
  );
}
