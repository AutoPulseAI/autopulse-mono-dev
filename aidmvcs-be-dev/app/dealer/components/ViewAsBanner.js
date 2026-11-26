"use client";
// The bar shown while "viewing as" an employee (app/lib/viewAs.js; Betsy, 25 Nov 2026): whose view it is, that nothing
// can be changed, and the way back to one's own account.
import { useEffect, useState } from "react";
import { Button } from "react-bootstrap";
import { tokenPayload } from "../../lib/viewAs";

export const OWNER_TOKEN_KEY = "dealertoken_view_as_owner";

export async function startViewAs(staff) {
  const own = localStorage.getItem("dealertoken");
  const res = await fetch("/api/login-as", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${own}` },
    body: JSON.stringify({ userId: staff._id }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) throw new Error(body.message || "Could not open the employee's view");
  localStorage.setItem(OWNER_TOKEN_KEY, own);
  localStorage.setItem("dealertoken", body.token);
  window.location.assign("/dealer/dashboard");
}

export function endViewAs() {
  const own = localStorage.getItem(OWNER_TOKEN_KEY);
  if (own) localStorage.setItem("dealertoken", own);
  localStorage.removeItem(OWNER_TOKEN_KEY);
  window.location.assign("/dealer/staff");
}

export default function ViewAsBanner() {
  const [view, setView] = useState(null);
  const [name, setName] = useState("");
  useEffect(() => {
    let p = null;
    try { p = tokenPayload(localStorage.getItem("dealertoken")); } catch { /* no storage */ }
    if (!p?.view_as) return;
    setView(p);
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` } })
      .then((r) => (r.ok ? r.json() : null)).then((u) => setName(u?.name || "")).catch(() => {});
  }, []);
  if (!view) return null;
  return (
    <div className="alert alert-info d-flex flex-wrap align-items-center gap-2 py-2 small mb-2" role="status" data-testid="view-as-banner">
      <i className="fa-duotone fa-eye" aria-hidden="true" />
      <span>You are viewing the CRM as <strong>{name || "this employee"}</strong>: what they see. Nothing can be changed here.</span>
      <Button size="sm" variant="custom" className="ms-auto" onClick={endViewAs}>Back to my account</Button>
    </div>
  );
}
