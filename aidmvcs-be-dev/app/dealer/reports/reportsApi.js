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
