"use client";
// Same-tab links from the Dashboard to a Leads list, with a way back (client, 11 Nov 2026: links must not open new
// tabs, and there must be a back button). Before leaving, the Dashboard notes where it sent the user; the Leads page
// shows "Back to Dashboard" only while it shows that same list. Kept per browser tab (sessionStorage).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "react-bootstrap";

const KEY = "back_link";

const RANGE_KEY = "dashboard_range";

// The Dashboard's picked range, kept for this tab ({startDate, endDate, preset, compare}; dates as ISO strings).
export function keepRange(range) {
  try {
    sessionStorage.setItem(RANGE_KEY, JSON.stringify({ ...range,
      startDate: range?.startDate ? new Date(range.startDate).toISOString() : null,
      endDate: range?.endDate ? new Date(range.endDate).toISOString() : null }));
  } catch { /* not kept; fine */ }
}

// The kept range, only when the user left the Dashboard through one of its links (then the way back is used up).
export function takeBackRange() {
  try {
    const back = JSON.parse(sessionStorage.getItem(KEY) || "null");
    const range = JSON.parse(sessionStorage.getItem(RANGE_KEY) || "null");
    if (back?.back !== "/dealer/dashboard" || !range) return null;
    sessionStorage.removeItem(KEY);
    const dates = (r) => ({ ...r, startDate: r.startDate ? new Date(r.startDate) : null,
      endDate: r.endDate ? new Date(r.endDate) : null });
    return { ...dates(range), compare: range.compare ? dates(range.compare) : null };
  } catch {
    return null;
  }
}

export function rememberBack(url, back = "/dealer/dashboard", label = "Dashboard") {
  try { sessionStorage.setItem(KEY, JSON.stringify({ url, back, label })); } catch { /* no way back; fine */ }
}

// Open a CRM page in this tab, remembering the way back to the Dashboard.
export function openFromDashboard(url, router) {
  if (!url) return;
  rememberBack(url);
  if (router) router.push(url);
  else window.location.assign(url);
}

// The remembered way back, when the page now shown is the one it was remembered for (every parameter of that link is
// still in the address; the Leads page adds its own, e.g. the opened lead).
export function backFor(location) {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { return null; }
  if (!saved?.url) return null;
  const want = new URL(saved.url, location.origin);
  if (want.pathname !== location.pathname) return null;
  const now = new URLSearchParams(location.search);
  for (const [k, v] of want.searchParams) if (now.get(k) !== v) return null;
  return saved;
}

export function BackButton({ className = "me-2" }) {
  const router = useRouter();
  const [back, setBack] = useState(null);
  useEffect(() => { setBack(backFor(window.location)); }, []);
  if (!back) return null;
  const goBack = () => {
    // Back keeps the Dashboard as it was (dates, open report); a fresh tab has nothing to go back to.
    if (window.history.length > 1) router.back();
    else router.push(back.back);
  };
  return (
    <Button variant="outline-dark" size="sm" className={className} onClick={goBack}>
      <i className="fa-solid fa-arrow-left me-1"></i>Back to {back.label}
    </Button>
  );
}
