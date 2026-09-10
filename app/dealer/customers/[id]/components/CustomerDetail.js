"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Tab, Tabs } from "react-bootstrap";
import { useUser } from "../../../context/UserContext";
import CustomerHeader from "./CustomerHeader";
import OverviewTab from "./OverviewTab";
import LeadsTab from "./LeadsTab";
import SalesTab from "./SalesTab";
import ServiceTab from "./ServiceTab";
import VehiclesTab from "./VehiclesTab";

export default function CustomerDetail({ customerId }) {
  const { user, dealerParent, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);
  const router = useRouter();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  const { customer, value_snapshot, overview, deals, repair_orders, appointments, vehicles } = data;

  return (
    <>
      <div className="d-flex align-items-center justify-content-end mb-3">
        <Button variant="custom" size="sm" onClick={() => router.push("/dealer/customers")}>
          <i className="fa-solid fa-arrow-left me-2" />Back to Customers
        </Button>
      </div>

      <CustomerHeader customer={customer} valueSnapshot={value_snapshot} />

      <Tabs defaultActiveKey="overview" className="mb-3" mountOnEnter unmountOnExit>
        <Tab eventKey="overview" title="Overview">
          <OverviewTab customer={customer} overview={overview} />
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
        <Tab eventKey="vehicles" title="Vehicles">
          <VehiclesTab vehicles={vehicles} />
        </Tab>
      </Tabs>
    </>
  );
}
