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

// Downloads Betsy's source / sub-source report as CSV (GET /api/reports/source-performance?format=csv) in this tab:
// the file is fetched with the sign-in and saved, the page doesn't move.
export async function downloadSourceReport(params) {
  const res = await fetch(`/api/reports/source-performance?${reportQuery({ ...params, format: "csv" })}`,
    { headers: headers(), cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Download failed (${res.status})`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "source-report.csv";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
