"use client";
// Shared pieces of Admin > DMS feed (24 Nov 2026): the API call, the address-held view state (Back and refresh keep the
// view), formatting, and the words the page uses for the importer's codes.
import { useCallback, useEffect, useState } from "react";
import PaginationComponent from "../../components/Pagination";

export const API = "/api/admin/dms-feed/v3";

export async function call(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("token")}`, ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** GET a view of the API; reloads when the query changes. */
export function useView(query) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const key = query ? new URLSearchParams(query).toString() : null;
  const load = useCallback(async () => {
    if (!key) return;
    setState((s) => ({ ...s, loading: true }));
    try { setState({ data: await call(`${API}?${key}`), error: null, loading: false }); }
    catch (e) { setState({ data: null, error: e.message, loading: false }); }
  }, [key]);
  useEffect(() => { load(); }, [load]);
  // Back on this tab after a while: fetch again so nothing stays stale (SOW Global UX 4B).
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [load]);
  return { ...state, reload: load };
}

/** The view lives in the address: tab, store, filters, page, open file, open record. Back steps back through it. */
export function useAddress() {
  const read = () => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search));
  // Empty on the server and on the first client render (no hydration mismatch); the address is read after mount.
  const [params, setParams] = useState(() => new URLSearchParams());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setParams(read());
    setReady(true);
    const onPop = () => setParams(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((changes, { replace = false } = {}) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(changes)) {
      next.delete(k);
      if (v != null && v !== "" && v !== false) next.set(k, String(v));
    }
    const url = `${window.location.pathname}${next.toString() ? `?${next}` : ""}`;
    window.history[replace ? "replaceState" : "pushState"]({ dmsf: true }, "", url);
    setParams(next);
  }, []);
  const back = useCallback((fallback) => {
    if (window.history.state?.dmsf) window.history.back();
    else go(fallback, { replace: true });
  }, [go]);
  return { params, ready, get: (k) => params.get(k) || "", go, back };
}

export const n = (v) => Number(v || 0).toLocaleString("en-US");
export const plural = (count, one, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A file time (YYYYMMDDhhmm, UTC) as "23 Nov, 12:03 UTC". */
export const stampText = (s, year = false) => (s ? `${+s.slice(6, 8)} ${MON[+s.slice(4, 6) - 1]}${year ? ` ${s.slice(0, 4)}` : ""}, ${s.slice(8, 10)}:${s.slice(10, 12)} UTC` : "");
export const dayText = (d) => (d ? `${new Date(d).getUTCDate()} ${MON[new Date(d).getUTCMonth()]} ${new Date(d).getUTCFullYear()}` : "");
export const ago = (hours) => (hours == null ? "" : hours < 48 ? `${hours} hours ago` : `${Math.floor(hours / 24)} days ago`);

export const TYPE = { SL: "Sales", SV: "Service ROs", SV_APPT: "Service appointments", PTINV: "Parts", OPENRO: "Open ROs" };
export const TYPES = ["SL", "SV", "SV_APPT", "PTINV"];
export const DEPT = { SL: "sales", SV: "service", SV_APPT: "appointments", PTINV: "parts" };
const CODE = {
  CUSTOMER_UNRESOLVED: "its customer matched no AutoPulse customer", CUSTOMER_AMBIGUOUS: "more than one AutoPulse customer matched",
  CUSTOMER_MERGED: "its customer was merged into another", ROW_MISSING_RO_NUMBER: "the row has no RO number",
  INVALID_RECORD: "the row isn't valid", INVALID_DEAL_NUMBER: "the deal number isn't valid", INVALID_PART_NUMBER: "the part number isn't valid",
  ROW_SOURCE_MISMATCH: "the row belongs to another store", SV_REPEAT_PARSE_ERROR: "its repair lines couldn't be read",
  SV_APPT_MISSING_APPOINTMENT_NUMBER: "the row has no appointment number", SV_APPT_INVALID_DATE: "the appointment date isn't valid",
  RECORD_EXCEEDS_MAX_JOB_BYTES: "the row is too large", DEALER_NOT_FOUND: "the store isn't linked to a dealer",
};
export const words = (c) => CODE[c] || (/^[A-Z0-9_]+$/.test(String(c)) ? String(c).toLowerCase().replace(/_/g, " ") : String(c || ""));
export const SOURCE = { DMS: "DealerVault (DMS)", DEALER_USER: "Staff", CUSTOMER: "Customer", LEAD: "Lead form", GUESS: "Split from a one-line name", AI: "AI" };
export const DECISION = { ACCEPT: "Used", RETAIN: "Kept the value we had", APPEND: "Kept as history", REVIEW: "Waiting for a decision", REJECT: "Not usable" };
export const fieldName = (f) => (f === "name" ? "Name" : f === "phone" ? "Phone" : f === "email" ? "Email" : f?.startsWith("mileage:") ? `Mileage, VIN ${f.slice(8)}` : f);

/** The app's own pagination (admin/components/Pagination.js), as on every other list. */
export function Pager({ page, pages, onPage }) {
  return <PaginationComponent currentPage={page} setCurrentPage={onPage} totalPages={pages} />;
}

export const CSS = `
.dmsx{--ink:#212529;--muted:#6F6F6F;--line:#e8e8e8;--soft:#f6f7f9}
.dmsx_scope{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.dmsx_picker{position:relative;min-width:280px;flex:0 1 360px}
.dmsx_picker_menu{position:absolute;top:100%;left:0;right:0;z-index:30;background:#fff;border:1px solid #d6d6d6;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:320px;overflow:auto;margin-top:2px}
.dmsx_picker_menu button{display:flex;width:100%;gap:8px;align-items:baseline;border:0;background:none;text-align:left;padding:8px 12px;font-size:14px}
.dmsx_picker_menu button:hover,.dmsx_picker_menu button:focus{background:#f1f7fb}
.dmsx_picker_menu small{color:var(--muted)}
.dmsx_chip{display:inline-flex;align-items:center;gap:8px;background:#e9f3fa;border:1px solid #b9dcf0;border-radius:6px;padding:4px 6px 4px 10px;font-size:14px}
.dmsx_chip button{border:0;background:none;color:#015688;padding:0 4px}
.dmsx_tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:14px;flex-wrap:wrap}
.dmsx_tabs button{border:0;background:none;padding:9px 14px;font-size:15px;color:#565E5E;border-bottom:2px solid transparent;margin-bottom:-1px;display:inline-flex;gap:8px;align-items:center}
.dmsx_tabs button.on{color:var(--primary);border-bottom-color:var(--primary);font-weight:600}
.dmsx_tabs .c{background:#fdeaea;color:#b02a37;border-radius:10px;padding:0 8px;font-size:12px;font-weight:700}
.dmsx_card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:14px}
.dmsx_item{display:flex;gap:14px;align-items:center;padding:14px 16px;border:1px solid var(--line);border-radius:8px;background:#fff;margin-bottom:10px;width:100%;text-align:left;color:var(--ink)}
.dmsx_item:hover{border-color:#b9c6d8}
.dmsx_item.on{border-color:var(--primary);box-shadow:inset 3px 0 0 var(--primary)}
.dmsx_item .i{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none}
.dmsx_item .i.red{background:#fdeaea;color:#b02a37}.dmsx_item .i.amber{background:#fff4dc;color:#8a5a00}
.dmsx_item .t{font-weight:600;font-size:15px}.dmsx_item .s{font-size:13px;color:var(--muted);margin-top:2px}
.dmsx_item .act{margin-left:auto;font-size:13px;color:var(--primary);white-space:nowrap}
.dmsx_clear{display:flex;gap:12px;align-items:center;padding:18px;border:1px solid #bfe3cc;background:#f0faf4;border-radius:8px;color:#146c43;font-size:15px}
.dmsx_tbl{width:100%;font-size:13.5px}
.dmsx_tbl th{font-weight:600;color:#565E5E;background:var(--soft);padding:8px 10px;white-space:nowrap;border-bottom:1px solid var(--line)}
.dmsx_tbl td{padding:9px 10px;border-bottom:1px solid #f0f0f0;vertical-align:middle}
.dmsx_tbl tr.go{cursor:pointer}.dmsx_tbl tr.go:hover td{background:#f1f7fb}
.dmsx_tbl tr.open td{background:#eef6fc}
.dmsx_tbl .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.dmsx_tbl .zero{color:#b8bec8}
.dmsx_sub{font-size:12px;color:#838282}
.dmsx_word{display:inline-flex;align-items:center;gap:5px;border-radius:12px;padding:1px 9px;font-size:12.5px;font-weight:600;white-space:nowrap}
.dmsx_word.ok{background:#e8f5ee;color:#146c43}.dmsx_word.late{background:#fdeaea;color:#b02a37}.dmsx_word.held{background:#fff4dc;color:#8a5a00}.dmsx_word.none{background:#eceff3;color:#6F6F6F}
.dmsx_inl{background:#f6f9fc;border-left:3px solid var(--primary);padding:12px 16px}
.dmsx_switch{display:flex;gap:4px;flex-wrap:wrap;margin:8px 0}
.dmsx_switch button{border:1px solid var(--line);background:#fff;border-radius:6px;padding:4px 10px;font-size:13px}
.dmsx_switch button.on{background:var(--primary);border-color:var(--primary);color:#fff}
.dmsx_switch button:disabled{color:#b8bec8}
.dmsx_switch span{margin-left:6px;font-weight:600}
.dmsx_pager{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:13px;color:var(--muted)}
.dmsx_empty{padding:22px;text-align:center;color:var(--muted)}
.dmsx_note{font-size:13px;color:var(--muted);margin-bottom:10px}
.dmsx_acts{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}
.dmsx_acts .btn{white-space:nowrap}
.dmsx_kv{display:grid;grid-template-columns:170px 1fr;gap:6px 14px;font-size:14px;margin:0}
.dmsx_kv dt{font-weight:400;color:var(--muted)}.dmsx_kv dd{margin:0}
`;
