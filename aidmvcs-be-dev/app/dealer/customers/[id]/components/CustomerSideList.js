"use client";

// The customer list beside a customer's 360 profile, like the list beside a lead on the Leads page (Betsy, 25 Nov
// 2026): click a name to open that customer without going back to the list. It shows the same list the user opened
// the customer from (the Customers page's search, source and dates, kept per browser tab), page by page, with the
// open customer highlighted. Each row says who it is (name), how to reach them (phone, else email) and how many
// leads they have.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Form, Spinner } from "react-bootstrap";
import { lastFirst } from "../../../../lib/personName";
import AppIcon, { Avatar } from "../../../components/AppIcon";
import "./customerSideList.css";

const KEY = "customerListQuery";
const LIMIT = 15;

// The Customers page calls this when a customer is opened, so the side list shows that same list.
export function rememberCustomerList(query, page) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ query, page })); } catch { /* the side list starts at page 1 */ }
}

function keptList() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || "null") || { query: "", page: 1 }; } catch { return { query: "", page: 1 }; }
}

function primaryValue(items) {
  return items?.find((item) => item.is_primary)?.value || items?.[0]?.value || "";
}

// onNeighbours({ previous, next }): the customers above and below the open one in this list (null when it is not on
// the page shown), so the page's Previous / Next buttons follow the list the user is looking at.
export default function CustomerSideList({ dealerId, currentId, onNeighbours }) {
  const router = useRouter();
  const [kept] = useState(keptList);
  const [page, setPage] = useState(Math.max(1, Number(kept.page) || 1));
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [pages, setPages] = useState({ total: 1, items: 0 });
  const [loading, setLoading] = useState(true);
  const activeRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(name.trim()), 400);
    return () => clearTimeout(t);
  }, [name]);

  const load = useCallback(async () => {
    if (!dealerId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams(kept.query || "");
      params.set("dealer_id", dealerId);
      params.set("page", String(page));
      params.set("limit", String(LIMIT));
      if (search) params.set("name", search);
      const res = await fetch(`/api/customers?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setRows(data.data || []);
      setPages({ total: data.pagination?.totalPages || 1, items: data.pagination?.totalItems || 0 });
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [dealerId, kept.query, page, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage((p) => (search ? 1 : p)); }, [search]);

  useEffect(() => {
    const at = rows.findIndex((r) => String(r._id) === String(currentId));
    onNeighbours?.(at < 0 ? null : { previous: rows[at - 1] || null, next: rows[at + 1] || null });
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [rows, currentId, onNeighbours]);

  const open = (id) => {
    rememberCustomerList(kept.query || "", page);
    router.push(`/dealer/customers/${id}`);
  };

  return (
    <aside className="cust_side w_card">
      <div className="cust_side_head">
        <span className="p_bold"><AppIcon name="customer" />Customers</span>
        <small className="text-muted">{pages.items.toLocaleString()}</small>
      </div>
      <Form.Control size="sm" placeholder="Search by name" value={name} onChange={(e) => setName(e.target.value)}
        aria-label="Search customers by name" />
      {kept.query && !search && <small className="text-muted d-block mt-1">Same filters as the Customers page</small>}

      <div className="cust_side_list">
        {loading && <div className="text-center py-3"><Spinner animation="border" size="sm" /></div>}
        {!loading && rows.length === 0 && <div className="text-muted small text-center py-3">No customers found.</div>}
        {!loading && rows.map((c) => {
          const active = String(c._id) === String(currentId);
          const reach = primaryValue(c.phones) || primaryValue(c.emails);
          return (
            <button key={c._id} type="button" ref={active ? activeRef : null}
              className={`cust_side_row${active ? " active" : ""}`} onClick={() => !active && open(c._id)}
              aria-current={active ? "page" : undefined}>
              <Avatar name={lastFirst(c)} small />
              <span className="cust_side_text">
                <span className="cust_side_name">{lastFirst(c) || "Unnamed customer"}</span>
                <span className="cust_side_sub">
                  <AppIcon name={primaryValue(c.phones) ? "phone" : "email"} />{reach || "No contact"}
                </span>
              </span>
              <span className="cust_side_leads" title={`${c.lead_count ?? 0} leads`}>
                <AppIcon name="lead" />{c.lead_count ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {pages.total > 1 && (
        <div className="cust_side_pager">
          <button type="button" className="btn btn-sm btn-outline-secondary" disabled={page <= 1 || loading}
            onClick={() => setPage(page - 1)} aria-label="Previous page"><i className="fa-solid fa-chevron-left" /></button>
          <small className="text-muted">Page {page} of {pages.total}</small>
          <button type="button" className="btn btn-sm btn-outline-secondary" disabled={page >= pages.total || loading}
            onClick={() => setPage(page + 1)} aria-label="Next page"><i className="fa-solid fa-chevron-right" /></button>
        </div>
      )}
    </aside>
  );
}
