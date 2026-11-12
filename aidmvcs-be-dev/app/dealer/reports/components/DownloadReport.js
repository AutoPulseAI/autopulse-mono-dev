"use client";
// "Download report" beside the Dashboard's date picker (client, 11 Nov 2026): every report for the dates picked there
// in one PDF (or CSV) - Executive, Betsy's source / sub-source table, Appointments, AI, BDC, Service, Data quality, Sales
// (GET /api/reports/full, app/lib/reporting/fullReport.js). Shown only where the reports are visible.
import { useState } from "react";
import { Button } from "react-bootstrap";
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
  return (
    <>
      <Button size="sm" variant="outline-dark" onClick={() => download("pdf")} disabled={Boolean(busy) || !dealerId}
        title="Every report for the dates picked here, in one PDF">
        <i className="fa-regular fa-file-pdf me-1"></i>{busy === "pdf" ? "Preparing report..." : "Download report"}
      </Button>
      <Button size="sm" variant="link" className="px-1" onClick={() => download("csv")} disabled={Boolean(busy) || !dealerId}
        title="The same report as a CSV (opens in Excel)">
        {busy === "csv" ? "Preparing..." : "CSV"}
      </Button>
      {error && <small className="text-danger">{error}</small>}
    </>
  );
}
