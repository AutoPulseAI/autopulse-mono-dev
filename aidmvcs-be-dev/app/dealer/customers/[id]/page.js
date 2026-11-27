"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Col, Row } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import CustomerDetail from "./components/CustomerDetail";
import CustomerSideList from "./components/CustomerSideList";
import { BackButton } from "../../components/backLink";

export default function CustomerDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user, dealerParent, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);

  const [adjacent, setAdjacent] = useState({ previous: null, next: null });
  const [adjacentLoading, setAdjacentLoading] = useState(false);
  // The customers above and below this one in the side list (null when it is not on the page shown there).
  const [listNeighbours, setListNeighbours] = useState(null);
  const dealerTimezone = activeEntity?.dealer_account_information?.time_zone || "America/New_York";

  // The customer's leads (28 Nov 2026): listed under the customer in the list on the left, opened on the right. One
  // fetch for both, with each lead's last message (preview).
  const [leads, setLeads] = useState([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const loadLeads = useCallback(async () => {
    if (loadingParent || !activeEntity?.id || !id) return;
    setLeadsLoading(true);
    try {
      const params = new URLSearchParams({ dealer_id: activeEntity.id, customer_id: id, page: "1", limit: "50", preview: "1" });
      const res = await fetch(`/api/leads?${params}`, { headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` } });
      const data = await res.json();
      setLeads(res.ok ? data.data || [] : []);
    } catch {
      setLeads([]);
    } finally {
      setLeadsLoading(false);
    }
  }, [activeEntity?.id, id, loadingParent]);
  useEffect(() => { setLeads([]); loadLeads(); }, [loadLeads]);

  // What the right side shows: "lead:<id>" (one lead, as on the Leads page) or a section of the profile. Kept in the
  // address (?lead=<id> or ?tab=<section>). Opening a customer shows their newest lead, or Profile when they have none.
  const [view, setView] = useState(null);
  useEffect(() => { setView(null); }, [id]);
  useEffect(() => {
    if (view || leadsLoading) return;
    const q = new URLSearchParams(window.location.search);
    const lead = q.get("lead");
    const tab = q.get("tab");
    if (lead && leads.some((l) => String(l._id) === lead)) setView(`lead:${lead}`);
    else if (tab && tab !== "overview") setView(tab);
    else if (tab === "overview") setView("activity");
    else setView("profile");
  }, [view, leadsLoading, leads]);
  const show = useCallback((next) => {
    setView(next);
    try {
      const q = new URLSearchParams(window.location.search);
      q.delete("lead"); q.delete("tab");
      if (next.startsWith("lead:")) q.set("lead", next.slice(5)); else q.set("tab", next);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${q}`);
    } catch { /* still shown */ }
  }, []);
  const [newLeadAsk, setNewLeadAsk] = useState(0);
  // The customer list can fold away (the user, 28 Nov 2026); open / folded is remembered in this browser.
  const [listOpen, setListOpen] = useState(true);
  useEffect(() => { try { if (localStorage.getItem("customerListFolded") === "1") setListOpen(false); } catch { /* open */ } }, []);
  // On Leads the leads take the left side (two parts, like the Leads page), so the customer list folds there unless
  // asked for with Show customers.
  const onLeads = view === "leads" || Boolean(view?.startsWith("lead:"));
  const [listOnLeads, setListOnLeads] = useState(false);
  const showList = onLeads ? listOnLeads : listOpen;
  const toggleList = () => (onLeads ? setListOnLeads((v) => !v) : setListOpen((open) => {
    try { localStorage.setItem("customerListFolded", open ? "1" : "0"); } catch { /* not kept */ }
    return !open;
  }));
  // Export to form and Actions sit up here beside Back to Customers (the customer's bar keeps one row).
  const [toolsEl, setToolsEl] = useState(null);
  const [current, setCurrent] = useState(null); // the open customer, for the list when they are not on its page

  const fetchAdjacent = useCallback(async () => {
    if (loadingParent || !activeEntity?.id || !id) return;
    setAdjacentLoading(true);
    try {
      const params = new URLSearchParams({ dealer_id: activeEntity.id });
      const response = await fetch(`/api/customers/${id}/adjacent?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const data = await response.json();
      setAdjacent(response.ok ? data.data || { previous: null, next: null } : { previous: null, next: null });
    } catch {
      setAdjacent({ previous: null, next: null });
    } finally {
      setAdjacentLoading(false);
    }
  }, [activeEntity?.id, id, loadingParent]);

  useEffect(() => {
    fetchAdjacent();
  }, [fetchAdjacent]);

  // Betsy, 25 Nov 2026: Previous / Next sit at the top, not under the whole profile. They follow the side list when
  // this customer is in it (its filters and order), otherwise the full customer list.
  const previous = listNeighbours?.previous || adjacent.previous;
  const next = listNeighbours?.next || adjacent.next;

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="d-flex align-items-center flex-wrap gap-2">
          <BackButton className="" />
          <h3 className="page_title mb-0 me-auto">Customer Details</h3>
          <div className="cust_nav">
            {!showList && (
              <Button variant="outline-custom" size="sm" onClick={toggleList} title="Show the customer list">
                <i className="fa-solid fa-angles-right me-2" />Show customers
              </Button>
            )}
            <span className="cust_tools_slot" ref={setToolsEl} />
            <Button variant="outline-custom" size="sm" onClick={() => router.push("/dealer/customers")}>
              <i className="fa-solid fa-users me-2" />Back to Customers
            </Button>
            <Button variant="custom" size="sm" disabled={adjacentLoading || !previous}
              onClick={() => previous && router.push(`/dealer/customers/${previous._id}`)}>
              <i className="fa-solid fa-arrow-left me-2" />Previous Customer
            </Button>
            <Button variant="custom" size="sm" disabled={adjacentLoading || !next}
              onClick={() => next && router.push(`/dealer/customers/${next._id}`)}>
              Next Customer<i className="fa-solid fa-arrow-right ms-2" />
            </Button>
          </div>
        </div>
      </div>

      <div className="page_body">
        <Row className="justify-content-center gx-3">
          {showList && <Col xxl={3} lg={4} md={12} className="inbox_side mb-3">
            <CustomerSideList dealerId={activeEntity?.id} currentId={id} current={current && { ...current, lead_count: leads.length }} onNeighbours={setListNeighbours} timezone={dealerTimezone}
              onCollapse={toggleList} />
          </Col>}
          <Col xxl={showList ? 9 : 12} lg={showList ? 8 : 12} md={12}>
            <CustomerDetail customerId={id} leads={leads} view={view} onShow={show} onLeadsChanged={loadLeads}
              newLeadAsk={newLeadAsk} toolsTarget={toolsEl} onCustomer={setCurrent} />
          </Col>
        </Row>
      </div>
    </div>
  );
}
