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

// The CSV of exactly what a drill-down shows (same KPI, filters, part and group).
export async function downloadCsv(params, filename) {
  const res = await fetch(`/api/reports/kpis?${reportQuery({ ...params, format: "csv" })}`, { headers: headers() });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
