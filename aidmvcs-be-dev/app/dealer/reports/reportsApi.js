// Calls to GET /api/reports/kpis from the Reports page, with the dealer sign-in (localStorage "dealertoken").
const token = () => (typeof window !== "undefined" ? localStorage.getItem("dealertoken") : null);
const headers = () => (token() ? { Authorization: `Bearer ${token()}` } : {});

export function reportQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    q.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return q.toString();
}

// Downloads a report file in this tab: fetched with the sign-in and saved; the page doesn't move.
async function downloadFile(url, fallbackName) {
  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Download failed (${res.status})`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

// Betsy's source / sub-source report (GET /api/reports/source-performance?format=csv).
export const downloadSourceReport = (params) => downloadFile(
  `/api/reports/source-performance?${reportQuery({ ...params, format: "csv" })}`, "source-report.csv");

// The Dashboard's full report for the picked dates (GET /api/reports/full).
export const downloadFullReport = (params) => downloadFile(`/api/reports/full?${reportQuery(params)}`,
  "dealership-report.csv");

export async function reportsGet(params) {
  const res = await fetch(`/api/reports/kpis?${reportQuery(params)}`, { headers: headers(), cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || `Request failed (${res.status})`);
    error.status = res.status;
    error.body = data;
    throw error;
  }
  return data;
}
