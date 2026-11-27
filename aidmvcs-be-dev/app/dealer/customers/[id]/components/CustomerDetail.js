"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Modal } from "react-bootstrap";
import { useUser } from "../../../context/UserContext";
import CustomerHeader, { CustomerIdentity, CustomerInfoCards, PROFILE_TABS, primaryContact } from "./CustomerHeader";
import CallButton from "../../../components/CallButton";
import CustomerLeadList, { NoLeads } from "./CustomerLeadCards";
import "./customerProfile.css";
import OverviewTab from "./OverviewTab";
import DmsDetails, { LeaseBar } from "./DmsDetails";
import OpenTasks from "./OpenTasks";
import PossibleMatch from "./PossibleMatch";
import LeadsTab from "./LeadsTab";
import SalesTab from "./SalesTab";
import ServiceTab from "./ServiceTab";
import AppointmentsTab from "./AppointmentsTab";
import VehiclesTab from "./VehiclesTab";
import TradeInTab from "./TradeInTab";
import LeadForm from "../../../leads/components/LeadForm";

// The right side of a customer's page (28 Nov 2026): the bar (Profile, Activity, Tasks, Appointments, Sales, Service,
// Vehicles, Trade-in, Forms, Actions), then either one lead (picked in the list on the left, as on the Leads page) or the
// section picked in the bar. view = "lead:<id>" or a section key; onShow(view) changes it.
export default function CustomerDetail({ customerId, leads = [], view = null, onShow, onLeadsChanged, newLeadAsk = 0, toolsTarget = null, onCustomer }) {
  const { user, dealerParent, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);
  const router = useRouter();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => { setData(null); }, [customerId]); // another customer: never show the last one while loading
  const [messageLead, setMessageLead] = useState(null);
  // Same convention: setEditCustomer({}) opens the create form (not used here,
  // see CustomerList.js), setEditCustomer(customer) opens it pre-filled to edit.
  const [staffList, setStaffList] = useState([]);
  const [assignmentError, setAssignmentError] = useState(null);

  const fetchStaffList = useCallback(async () => {
    if (!activeEntity?.id) return;
    try {
      const response = await fetch(`/api/staff/list?dealer_id=${activeEntity.id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const body = await response.json();
      if (response.ok) setStaffList(body.staff || []);
    } catch {
      // Non-fatal: the assignment dropdown just renders with no options.
    }
  }, [activeEntity?.id]);

  useEffect(() => {
    fetchStaffList();
  }, [fetchStaffList]);

  // A new lead for this customer ("New lead" under the customer in the list, or Send a message on Profile when they
  // have none): the lead form, pre-filled with the customer's name, phone and email.
  const handleSendMessage = useCallback(() => {
    const c = data?.customer;
    if (!c) return;
    const first = leads?.[0];
    setMessageLead(first ? { name: first.name || c.name || "", email: first.email || "", phone: first.phone || "" } : {
      name: c.name || "",
      email: primaryContact(c.emails)?.value || "",
      phone: primaryContact(c.phones)?.value || "",
      source: "dealervault",
    });
  }, [data, leads]);
  useEffect(() => { if (data?.customer) onCustomer?.(data.customer); }, [data, onCustomer]);
  useEffect(() => { if (newLeadAsk) handleSendMessage(); }, [newLeadAsk]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchCustomer360 = useCallback(async () => {
    if (loadingParent || !activeEntity?.id || !customerId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ dealer_id: activeEntity.id });
      const response = await fetch(`/api/customers/${customerId}/360?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Failed to load customer");
      setData(body.data);
    } catch (fetchError) {
      setError(fetchError.message || "Failed to load customer");
    } finally {
      setLoading(false);
    }
  }, [activeEntity?.id, customerId, loadingParent]);

  useEffect(() => {
    fetchCustomer360();
  }, [fetchCustomer360]);

  // Only the first load covers the page; a reload after a change (owner, task...) keeps the screen as it is.
  if (loadingParent || (loading && !data)) {
    return <div className="w_card text-center py-4">Loading customer...</div>;
  }

  if (error) {
    return (
      <div className="w_card">
        <Alert variant="danger">{error}</Alert>
        <Button variant="custom" size="sm" onClick={() => router.push("/dealer/customers")}>
          <i className="fa-solid fa-arrow-left me-2" />Back to Customers
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const { customer, value_snapshot, overview, activity, deals, repair_orders, appointments, all_appointments, vehicles, leads: summaryLeads, dms, open_tasks: openTasks } = data;

  // Counts on the tabs and the toolbar (17 Nov 2026, BB: "Sales (4) · Appts (2)" at a glance).
  const counts = { leads: summaryLeads?.length || 0, sales: deals?.length || 0, service: repair_orders?.length || 0,
    appointments: all_appointments?.length || 0, vehicles: vehicles?.length || 0, tasks: openTasks?.length || 0 };
  const tasksLate = (openTasks || []).filter((t) => t.missed).length;
  const changed = () => { fetchCustomer360(); onLeadsChanged?.(); };

  const handleMessageLeadChange = (value) => {
    setMessageLead(value);
    if (!value) { fetchCustomer360(); setTimeout(() => onLeadsChanged?.(), 3000); } // picks up the new lead, if any
  };


  const handleAssignmentChange = async (assignedToId) => {
    setAssignmentError(null);
    try {
      const response = await fetch(`/api/customers/${customerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
        body: JSON.stringify({ dealer_id: activeEntity.id, assigned_to: assignedToId || null }),
      });
      if (!response.ok) throw new Error(await response.text());
      fetchCustomer360(); // picks up the customer + cascaded lead assignments
    } catch (assignError) {
      setAssignmentError(assignError.message || "Failed to update assignment");
    }
  };

  const customerPhone = primaryContact(customer.phones)?.value;
  const views = {
    profile: () => (
      <>
        <CustomerIdentity customer={customer} valueSnapshot={value_snapshot} dmsPerson={dms?.person} dealerId={customer.dealer_id}
          onChanged={fetchCustomer360} staffList={staffList} onAssignmentChange={handleAssignmentChange} />
        {(summaryLeads?.length || 0) === 0 && (leads?.length || 0) === 0 && (
          // No lead yet: call the customer or start the first conversation here.
          <div className="w_card mb-3 d-flex flex-wrap align-items-center gap-2">
            <span className="text-muted me-auto">No leads for this customer yet.</span>
            {customerPhone && <CallButton phone={customerPhone} dealerId={customer.dealer_id} size="sm" />}
            <Button size="sm" variant="custom" onClick={handleSendMessage} disabled={!customerPhone && !primaryContact(customer.emails)}>
              <i className="fa-solid fa-paper-plane me-1" />Send a message
            </Button>
          </div>
        )}
        <CustomerInfoCards customer={customer} valueSnapshot={value_snapshot} dealerId={customer.dealer_id}
          onChanged={fetchCustomer360} latestLead={leads?.[0] || summaryLeads?.[0]} />
        <DmsDetails dms={dms} />
      </>
    ),
    activity: () => <OverviewTab overview={overview} activity={activity || []} />,
    tasks: () => (
      <OpenTasks tasks={openTasks} dealerId={activeEntity?.id} onChanged={changed} leads={summaryLeads || []} staffList={staffList}
        customerName={[customer.first_name, customer.last_name].filter(Boolean).join(" ")} />
    ),
    sales: () => <SalesTab deals={deals} />,
    service: () => <ServiceTab repairOrders={repair_orders} appointments={appointments} />,
    appointments: () => <AppointmentsTab appointments={all_appointments} bookings={data?.bookings || []} />,
    vehicles: () => <VehiclesTab vehicles={vehicles} leads={summaryLeads} customerId={customerId} dealerId={customer.dealer_id} onChanged={changed} />,
    tradeins: () => <TradeInTab customerId={customerId} />,
  };
  // Leads: "leads" opens the newest lead, "lead:<id>" that lead.
  const onLeads = view === "leads" || view?.startsWith("lead:");
  const openLead = onLeads ? ((leads || []).find((l) => view.startsWith("lead:") && String(l._id) === view.slice(5)) || leads?.[0] || null) : null;
  const shown = onLeads ? "leads" : (view in views ? view : "profile");
  const shownTab = PROFILE_TABS.find(([key]) => key === shown);

  return (
    <div className="cust_profile">
      {assignmentError && (
        <Alert variant="danger" dismissible onClose={() => setAssignmentError(null)}>
          {assignmentError}
        </Alert>
      )}

      <PossibleMatch customerId={customerId} dealerId={customer.dealer_id} />
      <LeaseBar dms={dms} />
      <CustomerHeader customer={customer} dealerId={customer.dealer_id} onChanged={changed} counts={counts}
        tasksLate={tasksLate} onOpenTab={onShow} activeTab={shown} toolsTarget={toolsTarget} />

      {shown === "leads" ? (
        openLead ? (
          // Two parts, as on the Leads page: the customer's leads | the open lead (the Leads page's lead screen, with
          // its milestones, visits and vehicles of interest under the actions).
          <div className="row gx-3">
            <div className="col-xxl-3 col-lg-4 col-12 inbox_side mb-3">
              <CustomerLeadList leads={leads} activeId={openLead._id} onOpen={(leadId) => onShow(`lead:${leadId}`)}
                onNew={handleSendMessage} timezone={activeEntity?.dealer_account_information?.time_zone} />
            </div>
            <div className="col-xxl-9 col-lg-8 col-12">
              <LeadsTab lead={openLead} leads={leads} onShow={onShow} onChanged={changed} />
            </div>
          </div>
        ) : (
          <NoLeads customerPhone={customerPhone} dealerId={customer.dealer_id} onNew={handleSendMessage} />
        )
      ) : (
        <section className="cp_view" key={shown}>
          <h3 className="cp_view_title"><i className={shownTab[2]} aria-hidden="true" />{shownTab[1]}</h3>
          {views[shown]()}
        </section>
      )}

      <Modal show={!!messageLead} onHide={() => handleMessageLeadChange(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{leads?.length ? "New lead for this customer" : "Send a message"}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {messageLead && <LeadForm editLead={messageLead} setEditLead={handleMessageLeadChange} />}
        </Modal.Body>
      </Modal>
    </div>
  );
}
