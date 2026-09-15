"use client";

import { useRouter } from "next/navigation";
import { Badge, ListGroup, Row, Col } from "react-bootstrap";
import { formatTimestamp } from "../../../../utils/dateUtils";

function vehicleLabel(record) {
  const parts = [record["Year"], record["Make"], record["Model"]].filter(Boolean);
  return parts.length ? parts.join(" ") : record.vin || "Unknown vehicle";
}

export default function AppointmentsTab({ appointments }) {
  const router = useRouter();
  const now = Date.now();

  const sorted = [...appointments].sort((a, b) => {
    if (a.computed_date && b.computed_date) return b.computed_date - a.computed_date;
    if (a.computed_date) return -1;
    if (b.computed_date) return 1;
    return 0;
  });

  return (
    <div className="w_card">
      <h3 className="w_card_title mb-3">Appointments</h3>
      {sorted.length === 0 ? (
        <div className="text-center py-4 text-muted">No appointments found for this customer.</div>
      ) : (
        <ListGroup variant="flush">
          {sorted.map((appointment) => {
            const isUpcoming = appointment.computed_date && new Date(appointment.computed_date).getTime() > now;
            return (
              <ListGroup.Item
                key={appointment._id}
                action
                onClick={() => router.push(`/dealer/service-appointments/${appointment._id}`)}
                className="px-0"
              >
                <Row className="align-items-center gy-1">
                  <Col md={2}>
                    <Badge bg={isUpcoming ? "warning" : "secondary"}>
                      {isUpcoming ? "Upcoming" : "Past Appointment"}
                    </Badge>
                  </Col>
                  <Col md={3} className="p_bold"><i className="fa-solid fa-calendar-check me-2" />{vehicleLabel(appointment)}</Col>
                  <Col md={2}>{appointment.computed_date ? formatTimestamp(appointment.computed_date) : "Date unknown"}</Col>
                  <Col md={3}>{appointment["Service Advisor Name"] || "No advisor assigned"}</Col>
                  <Col md={2} className="text-md-end text-muted small">
                    {appointment.appointment_number}
                  </Col>
                </Row>
              </ListGroup.Item>
            );
          })}
        </ListGroup>
      )}
    </div>
  );
}
