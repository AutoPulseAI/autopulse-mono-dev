"use client";

// The customer list beside a customer's profile, drawn like the Leads page's list (the user, 28 Nov 2026): an inbox -
// avatar with who wrote last, name, the newest message over all of the customer's leads, its time, how long the
// customer has waited, unread count. It shows the same list the user opened the customer from (the Customers page's
// search, source, assigned to, sort and dates, kept per browser tab), page by page.
// The customer's leads are under Leads in the customer's bar (two parts, like the Leads page).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Form, ListGroup } from "react-bootstrap";
import { lastFirst } from "../../../../lib/personName";
import { avatarStyle, initialsOf } from "../../../../lib/avatarColor";
import { inboxTime, waitingFor } from "../../../leads/components/LeadList";
import "../../../leads/components/chat.css";
import "./customerSideList.css";
import { keptCustomerList, rememberCustomerList } from "./customerListMemory";

export { rememberCustomerList };

const LIMIT = 15;
const keptList = keptCustomerList;

function primaryValue(items) {
  return items?.find((item) => item.is_primary)?.value || items?.[0]?.value || "";
}

// The newest message, as the Leads list shows it: who wrote it (AI: / You:), a failed mark, the channel, the text.
function Snip({ last, fallback }) {
  if (!last) return <span className="text-muted">{fallback}</span>;
  return (
    <>
      {last.from === "ai" && <b>AI: </b>}
      {last.from === "staff" && <b>You: </b>}
      {last.failed && <i className="fa-solid fa-circle-exclamation text-danger me-1" aria-hidden="true"></i>}
      {last.channel === "email" && <i className="fa-regular fa-envelope me-1" aria-hidden="true"></i>}
      {last.text || "(no text)"}
    </>
  );
}

// onNeighbours({ previous, next }): the customers above and below the open one in this list (null when it is not on
// the page shown), so the page's Previous / Next buttons follow the list the user is looking at.
export default function CustomerSideList({ dealerId, currentId, current = null, onNeighbours, timezone, onCollapse }) {
  const router = useRouter();
  const [kept] = useState(keptList);
  const [page, setPage] = useState(Math.max(1, Number(kept.page) || 1));
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  // Whose customers, as on the Leads list; "" keeps what the Customers page had.
  const [whose, setWhose] = useState(() => new URLSearchParams(kept.query || "").get("assigned_to") || "");
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
      params.set("preview", "1");
      if (whose) params.set("assigned_to", whose); else params.delete("assigned_to");
      if (search) {
        // One box for name, phone or email (user, 25 Nov 2026): an @ means email, only digits and phone signs mean
        // a phone number (any part of it), anything else is a name. It replaces the Customers page's own search.
        ["name", "last_name", "email", "phone"].forEach((k) => params.delete(k));
        const digits = search.replace(/\D/g, "");
        if (search.includes("@")) params.set("email", search);
        else if (/^[\d\s()+.-]+$/.test(search) && digits.length >= 3) params.set("phone", search);
        else params.set("name", search);
      }
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
  }, [dealerId, kept.query, page, search, whose]);

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
    <div className="dealer_info position-sticky">
      <div className="w_card cust_inbox">
        <div className="cust_inbox_head">
          <span className="p_bold"><i className="fa-solid fa-users me-2" aria-hidden="true" />Customers</span>
          {onCollapse && (
            <Button variant="outline-secondary" size="sm" onClick={onCollapse} title="Hide the customer list" aria-label="Hide the customer list">
              <i className="fa-solid fa-angles-left" />
            </Button>
          )}
        </div>
        <div className="btn-group mb-2 lead_fltr w-100" role="group" aria-label="Whose customers">
          {[["", "All", "fa-users"], ["me", "Mine", "fa-user"], ["none", "Unassigned", "fa-user-slash"]].map(([key, label, icon]) => (
            <Button key={key || "all"} size="sm" aria-pressed={whose === key} variant={whose === key ? "custom" : "outline-custom"}
              onClick={() => { setWhose(key); setPage(1); }}>
              <i className={`fa-regular ${icon} me-1`} />{label}
            </Button>
          ))}
        </div>
        <Form.Control type="search" size="sm" placeholder="Search name, phone or email" value={name}
          onChange={(e) => setName(e.target.value)} aria-label="Search customers by name, phone or email" />
        {kept.query && !search && <small className="text-muted d-block mt-1">Same filters as the Customers page</small>}

        <div className="w_card_list mt-2">
          {loading && <div className="inbox_loading" role="status">Loading customers...</div>}
          <ListGroup as="ul" variant="flush" style={loading ? { opacity: 0.5 } : undefined}>
            {!loading && rows.length === 0 && <div className="text-muted small text-center py-3">No customers found.</div>}
            {/* The open customer stays on top when they are not on the page of the list shown. */}
            {(!loading && current && String(current._id) === String(currentId) && !rows.some((r) => String(r._id) === String(currentId))
              ? [{ ...current, pinned: true }, ...rows] : rows).map((c) => {
              const active = String(c._id) === String(currentId);
              const who = lastFirst(c) || "Unnamed customer";
              const last = c.inbox?.last;
              const n = c.lead_count ?? 0;
              const fallback = `${n ? `${n} lead${n === 1 ? "" : "s"}` : "No leads"} · ${primaryValue(c.phones) || primaryValue(c.emails) || "no contact"}`;
              const wait = waitingFor(last);
              return (
                <ListGroup.Item as="li" key={c._id} ref={active ? activeRef : null}
                  className={`lead-item w_card_list_box${active ? " active-lead" : ""}`}
                  aria-current={active ? "page" : undefined} title={c.pinned ? "Open now - not on this page of the list" : undefined}
                  onClick={() => !active && open(c._id)}>
                  <div className="inbox_row">
                    <span className="inbox_avatar" aria-hidden="true" style={avatarStyle(c.name || who)}>
                      {initialsOf(c.name || who)}
                      {last?.from === "ai" && <span className="inbox_avatar_badge ai" title="The AI wrote last"><i className="fa-solid fa-robot"></i></span>}
                      {last?.from === "customer" && <span className="inbox_avatar_badge cust" title="The customer wrote last"></span>}
                    </span>
                    <span className="inbox_main">
                      <span className="inbox_top">
                        <span className={`inbox_title${c.inbox?.unread ? " unread" : ""}`}>{who}</span>
                        {c.inbox?.hot && <span className="inbox_hot" title="A lead is marked hot"><i className="fa-solid fa-fire" aria-hidden="true"></i></span>}
                        <span className="inbox_time">{inboxTime(last?.at || c.updatedAt || c.createdAt, timezone)}</span>
                      </span>
                      <span className="inbox_bottom">
                        <span className="inbox_snip"><Snip last={last} fallback={fallback} /></span>
                        {wait && <span className="inbox_wait" title="The customer is waiting for an answer">
                          <i className="fa-regular fa-hourglass-half me-1" aria-hidden="true"></i>{wait}</span>}
                        {c.inbox?.unread > 0 && <span className="inbox_unread">{c.inbox.unread}</span>}
                      </span>
                    </span>
                  </div>

                </ListGroup.Item>
              );
            })}
          </ListGroup>
        </div>

        <div className="inbox_pager">
          <Button variant="outline-custom" size="sm" aria-label="Previous page" disabled={page <= 1 || loading}
            onClick={() => setPage(page - 1)}><i className="fa-solid fa-chevron-left"></i></Button>
          <span>Page <strong>{page}</strong> of {pages.total}
            <small className="text-muted d-block">{pages.items.toLocaleString("en-US")} customers</small></span>
          <Button variant="outline-custom" size="sm" aria-label="Next page" disabled={page >= pages.total || loading}
            onClick={() => setPage(page + 1)}><i className="fa-solid fa-chevron-right"></i></Button>
        </div>
      </div>
    </div>
  );
}
