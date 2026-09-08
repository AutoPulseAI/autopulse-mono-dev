"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Col, Row } from "react-bootstrap";
import { useUser } from "../../../context/UserContext";

const FIELD_ROWS = [
  ["Appointment Number", (a) => a.appointment_number],
  ["Customer Name", (a) => a["Full Name"]],
  ["Email", (a) => a["Email 1"]],
  ["Cell Phone", (a) => a["Cell Phone"]],
  ["VIN", (a) => a.vin],
  ["Year", (a) => a["Year"]],
  ["Make", (a) => a["Make"]],
  ["Model", (a) => a["Model"]],
  ["Appointment Date", (a) => a["Appointment Date"]],
  ["Appointment Time", (a) => a["Appointment Time"]],
  ["Promise Date", (a) => a["Promise Date"]],
  ["Service Advisor", (a) => a["Service Advisor Name"]],
  ["Complaint", (a) => a["Complaint"]],
  ["Cause", (a) => a["Cause"]],
  ["Operation Code Description", (a) => a["Operation Code Description"]],
  ["Waiting Flag", (a) => a["Waiting Flag"]],
  ["Loaner Flag", (a) => a["Loaner Flag"]],
  ["Estimate Amount", (a) => a["Estimate Amount"]],
  ["RO Number", (a) => a.ro_number],
  ["Appointment Mileage", (a) => a["Appointment Mileage"]],
];

export default function ServiceAppointmentDetail({ appointmentId }) {
  const { user, dealerParent, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);
  const router = useRouter();
  const [appointment, setAppointment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAppointment = useCallback(async () => {
    if (loadingParent || !activeEntity?.id || !appointmentId) return;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ dealer_id: activeEntity.id });
      const response = await fetch(`/api/service-appointments/${appointmentId}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to load service appointment");

      setAppointment(data.data);
    } catch (fetchError) {
      setError(fetchError.message || "Failed to load service appointment");
    } finally {
      setLoading(false);
    }
  }, [activeEntity?.id, appointmentId, loadingParent]);

  useEffect(() => {
    fetchAppointment();
  }, [fetchAppointment]);

  if (loadingParent || loading) {
    return <div className="w_card text-center py-4">Loading service appointment...</div>;
  }

  if (error) {
    return (
      <div className="w_card">
        <Alert variant="danger">{error}</Alert>
        <Button variant="custom" size="sm" onClick={() => router.push("/dealer/service-appointments")}>
          <i className="fa-solid fa-arrow-left me-2" />Back to Service Appointments
        </Button>
      </div>
    );
  }

  if (!appointment) return null;

  return (
    <div className="w_card">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h3 className="w_card_title mb-0">{appointment["Full Name"] || "Unnamed customer"}</h3>
        <Button variant="custom" size="sm" onClick={() => router.push("/dealer/service-appointments")}>
          <i className="fa-solid fa-arrow-left me-2" />Back to Service Appointments
        </Button>
      </div>
      <Row className="gy-3">
        {FIELD_ROWS.map(([label, accessor]) => (
          <Col md={4} key={label}>
            <strong>{label}:</strong> {accessor(appointment) ?? "—"}
          </Col>
        ))}
      </Row>
    </div>
  );
}
