"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Modal, Tab, Tabs } from "react-bootstrap";
import { useUser } from "../../../context/UserContext";
import CustomerHeader, { primaryContact } from "./CustomerHeader";
import OverviewTab from "./OverviewTab";
import LeadsTab from "./LeadsTab";
import SalesTab from "./SalesTab";
import ServiceTab from "./ServiceTab";
import AppointmentsTab from "./AppointmentsTab";
import VehiclesTab from "./VehiclesTab";
import TradeInTab from "./TradeInTab";
import LeadForm from "../../../leads/components/LeadForm";
import CustomerForm from "../../components/CustomerForm";

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
  const [editCustomer, setEditCustomer] = useState(null);
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

  const { customer, value_snapshot, overview, deals, repair_orders, appointments, all_appointments, vehicles, leads } = data;

  // A customer with an existing Lead already has a reachable conversation
  // under "Leads & Communications" (ViewConversations' own SMS/Email Reply
  // button) - just land there. Only a customer with zero leads needs the
  // create-lead-and-send-first-message flow (LeadForm, pre-filled).
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

  const handleEditCustomerChange = (value) => {
    setEditCustomer(value);
    if (!value) fetchCustomer360(); // picks up the saved edits
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
    <>
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

      <CustomerHeader
        customer={customer}
        valueSnapshot={value_snapshot}
        onSendMessage={handleSendMessage}
        onEdit={() => setEditCustomer(customer)}
        staffList={staffList}
        onAssignmentChange={handleAssignmentChange}
      />

      <Tabs activeKey={activeTab} onSelect={(key) => setActiveTab(key)} className="mb-3" mountOnEnter unmountOnExit>
        <Tab eventKey="overview" title="Overview">
          <OverviewTab overview={overview} />
        </Tab>
        <Tab eventKey="leads" title="Leads & Communications">
          <LeadsTab customerId={customerId} />
        </Tab>
        <Tab eventKey="sales" title="Sales">
          <SalesTab deals={deals} />
        </Tab>
        <Tab eventKey="service" title="Service">
          <ServiceTab repairOrders={repair_orders} appointments={appointments} />
        </Tab>
        <Tab eventKey="appointments" title="Appointments">
          <AppointmentsTab appointments={all_appointments} />
        </Tab>
        <Tab eventKey="vehicles" title="Vehicles">
          <VehiclesTab vehicles={vehicles} />
        </Tab>
        <Tab eventKey="tradeins" title="Trade In">
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

      <Modal show={!!editCustomer} onHide={() => handleEditCustomerChange(null)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Edit Customer</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {editCustomer && <CustomerForm editCustomer={editCustomer} setEditCustomer={handleEditCustomerChange} />}
        </Modal.Body>
      </Modal>
    </>
  );
}
