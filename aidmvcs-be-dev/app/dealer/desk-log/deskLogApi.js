// Calls to /api/desk-log with the dealer sign-in (localStorage "dealertoken").
const token = () => (typeof window !== "undefined" ? localStorage.getItem("dealertoken") : null);
const headers = (extra = {}) => ({ ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...extra });

export function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") q.set(k, String(v));
  return q.toString();
}

async function call(url, opts = {}) {
  const res = await fetch(url, { cache: "no-store", ...opts, headers: headers(opts.headers) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export const deskLogGet = (params) => call(`/api/desk-log?${query(params)}`);
export const deskLogEntry = (id) => call(`/api/desk-log/${id}`);
export const deskLogSearch = (dealerId, q) => call(`/api/desk-log/customers?${query({ dealer_id: dealerId, q })}`);
export const deskLogStock = (dealerId, q) => call(`/api/desk-log/stock?${query({ dealer_id: dealerId, q })}`);
export const deskLogCheckIn = (body) => call("/api/desk-log", { method: "POST", body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" } });
export const deskLogUpdate = (id, body) => call(`/api/desk-log/${id}`, { method: "PATCH", body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" } });
export const staffList = (dealerId) => call(`/api/staff/list?${query({ dealer_id: dealerId })}`)
  .then((d) => d.staff || []);
export const deskLogRules = (dealerId) => call(`/api/desk-log/rules?${query({ dealer_id: dealerId })}`);
export const saveDeskLogRules = (body) => call("/api/desk-log/rules", { method: "PUT", body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" } });
// The day's appointments (api/desk-log/appointments).
export const deskLogAppointments = (params) => call(`/api/desk-log/appointments?${query(params)}`);

/**
 * A lead's status changed from the Desk Log (No Show, Appointment Booked, Visited with its outcome, ...): the same
 * status route as the Leads page, so its workflows run. A full appointment slot throws the StatusModal's
 * "Book {next available}" answer (app/lib/bookingConflict.js).
 */
export async function changeLeadStatus(leadId, status, extra = {}) {
  const { throwIfStatusFailed } = await import("../../lib/bookingConflict");
  const res = await fetch("/api/conversations/lead/status", { method: "PUT",
    headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ id: leadId, status, ...extra }) });
  await throwIfStatusFailed(res, extra);
}
