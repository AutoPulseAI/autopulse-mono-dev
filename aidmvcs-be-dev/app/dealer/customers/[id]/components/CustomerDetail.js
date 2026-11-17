"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Modal, Tab, Tabs } from "react-bootstrap";
import { useUser } from "../../../context/UserContext";
import CustomerHeader, { primaryContact } from "./CustomerHeader";
import OverviewTab from "./OverviewTab";
import DmsDetails, { LeaseBar } from "./DmsDetails";
import OpenTasks from "./OpenTasks";
import LeadsTab from "./LeadsTab";
import SalesTab from "./SalesTab";
import ServiceTab from "./ServiceTab";
import AppointmentsTab from "./AppointmentsTab";
import VehiclesTab from "./VehiclesTab";
import TradeInTab from "./TradeInTab";
import LeadForm from "../../../leads/components/LeadForm";

export default function CustomerDetail({ customerId }) {
  const { user, dealerParent, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);
  const router = useRouter();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  // Mirrors the `editLead` convention from app/dealer/leads/page.js: an object
  // pre-fills LeadForm, and LeadForm itself calls this setter with null when
  // it's done (submitted or cancelled) to close.
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

  if (loadingParent || loading) {
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

  const { customer, value_snapshot, overview, activity, deals, repair_orders, appointments, all_appointments, vehicles, leads, dms, open_tasks: openTasks } = data;

  // A customer with an existing Lead already has a reachable conversation
  // under "Leads & Communications" (ViewConversations' own SMS/Email Reply
  // button) - just land there. Only a customer with zero leads needs the
  // create-lead-and-send-first-message flow (LeadForm, pre-filled).
  // Counts on the tabs and the toolbar (17 Nov 2026, BB: "Sales (4) · Appts (2)" at a glance).
  const counts = { leads: leads?.length || 0, sales: deals?.length || 0, service: repair_orders?.length || 0,
    appointments: all_appointments?.length || 0, vehicles: vehicles?.length || 0 };
  const tabTitle = (icon, label, n) => (
    <span className="cp_tab"><i className={icon} />{label}{n ? <span className="cp_tab_count">{n}</span> : null}</span>
  );

  const handleSendMessage = () => {
    if ((leads?.length || 0) > 0) {
      setActiveTab("leads");
    } else {
      setMessageLead({
        name: customer.name || "",
        email: primaryContact(customer.emails)?.value || "",
        phone: primaryContact(customer.phones)?.value || "",
        source: "dealervault",
      });
    }
  };

  const handleMessageLeadChange = (value) => {
    setMessageLead(value);
    if (!value) fetchCustomer360(); // picks up the newly created lead, if any
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

  return (
    <div className="cust_profile">
      <div className="d-flex align-items-center justify-content-end mb-3">
        <Button variant="custom" size="sm" onClick={() => router.push("/dealer/customers")}>
          <i className="fa-solid fa-arrow-left me-2" />Back to Customers
        </Button>
      </div>

      {assignmentError && (
        <Alert variant="danger" dismissible onClose={() => setAssignmentError(null)}>
          {assignmentError}
        </Alert>
      )}

      <LeaseBar dms={dms} />
      <CustomerHeader
        customer={customer}
        valueSnapshot={value_snapshot}
        onSendMessage={handleSendMessage}
        onChanged={fetchCustomer360}
        staffList={staffList}
        onAssignmentChange={handleAssignmentChange}
        // G-059: a call from the profile is logged on the customer's newest lead.
        callLeadId={leads?.[0]?._id}
        dealerId={customer.dealer_id}
        counts={counts}
        onOpenTab={setActiveTab}
      />

      <OpenTasks tasks={openTasks} />
      <DmsDetails dms={dms} />

      <Tabs activeKey={activeTab} onSelect={(key) => setActiveTab(key)} className="mb-3 cp_tabs" mountOnEnter unmountOnExit>
        <Tab eventKey="overview" title={tabTitle("fa-solid fa-clock-rotate-left", "Overview")}>
          <OverviewTab overview={overview} activity={activity || []} />
        </Tab>
        <Tab eventKey="leads" title={tabTitle("fa-solid fa-comments", "Leads & Communications", counts.leads)}>
          <LeadsTab customerId={customerId} onChanged={fetchCustomer360} />
        </Tab>
        <Tab eventKey="sales" title={tabTitle("fa-solid fa-key", "Sales", counts.sales)}>
          <SalesTab deals={deals} />
        </Tab>
        <Tab eventKey="service" title={tabTitle("fa-solid fa-wrench", "Service", counts.service)}>
          <ServiceTab repairOrders={repair_orders} appointments={appointments} />
        </Tab>
        <Tab eventKey="appointments" title={tabTitle("fa-regular fa-calendar-check", "Appointments", counts.appointments)}>
          <AppointmentsTab appointments={all_appointments} />
        </Tab>
        <Tab eventKey="vehicles" title={tabTitle("fa-solid fa-car-side", "Vehicles", counts.vehicles)}>
          <VehiclesTab vehicles={vehicles} leads={leads} />
        </Tab>
        <Tab eventKey="tradeins" title={tabTitle("fa-solid fa-right-left", "Trade In")}>
          <TradeInTab customerId={customerId} />
        </Tab>
      </Tabs>

      <Modal show={!!messageLead} onHide={() => handleMessageLeadChange(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Send a message</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {messageLead && <LeadForm editLead={messageLead} setEditLead={handleMessageLeadChange} />}
        </Modal.Body>
      </Modal>
    </div>
  );
}
