"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Col, Row } from "react-bootstrap";
import { useUser } from "../../../context/UserContext";

const FIELD_ROWS = [
  ["RO Number", (r) => r.ro_number],
  ["Customer Name", (r) => r["Full Name"]],
  ["Email", (r) => r["Email 1"]],
  ["Cell Phone", (r) => r["Cell Phone"]],
  ["VIN", (r) => r.vin],
  ["Year", (r) => r["Year"]],
  ["Make", (r) => r["Make"]],
  ["Model", (r) => r["Model"]],
  ["RO Mileage", (r) => r["RO Mileage"]],
  ["Stock Number", (r) => r["Stock Number"]],
  ["RO Status", (r) => r["RO Status"]],
  ["Open Date", (r) => r["Open Date"]],
  ["Close Date", (r) => r["Close Date"]],
  ["Promise Date", (r) => r["Promise Date"]],
  ["Service Advisor", (r) => r["Service Advisor Name"]],
  ["Total Sale", (r) => r["Total Sale"]],
  ["Total Cost", (r) => r["Total Cost"]],
  ["Customer Total Sale", (r) => r["Customer Total Sale"]],
  ["Warranty Total Sale", (r) => r["Warranty Total Sale"]],
  ["Appointment Number", (r) => r["Appointment Number"]],
];

export default function RepairOrderDetail({ repairOrderId }) {
  const { user, dealerParent, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);
  const router = useRouter();
  const [repairOrder, setRepairOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchRepairOrder = useCallback(async () => {
    if (loadingParent || !activeEntity?.id || !repairOrderId) return;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ dealer_id: activeEntity.id });
      const response = await fetch(`/api/repair-orders/${repairOrderId}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to load repair order");

      setRepairOrder(data.data);
    } catch (fetchError) {
      setError(fetchError.message || "Failed to load repair order");
    } finally {
      setLoading(false);
    }
  }, [activeEntity?.id, repairOrderId, loadingParent]);

  useEffect(() => {
    fetchRepairOrder();
  }, [fetchRepairOrder]);

  if (loadingParent || loading) {
    return <div className="w_card text-center py-4">Loading repair order...</div>;
  }

  if (error) {
    return (
      <div className="w_card">
        <Alert variant="danger">{error}</Alert>
        <Button variant="custom" size="sm" onClick={() => router.push("/dealer/service")}>
          <i className="fa-solid fa-arrow-left me-2" />Back to Service
        </Button>
      </div>
    );
  }

  if (!repairOrder) return null;

  return (
    <div className="w_card">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h3 className="w_card_title mb-0">{repairOrder["Full Name"] || "Unnamed customer"}</h3>
        <Button variant="custom" size="sm" onClick={() => router.push("/dealer/service")}>
          <i className="fa-solid fa-arrow-left me-2" />Back to Service
        </Button>
      </div>
      <Row className="gy-3">
        {FIELD_ROWS.map(([label, accessor]) => (
          <Col md={4} key={label}>
            <strong>{label}:</strong> {accessor(repairOrder) ?? "—"}
          </Col>
        ))}
      </Row>
    </div>
  );
}
