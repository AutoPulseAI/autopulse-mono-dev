"use client";

import { useRouter } from "next/navigation";
import { Badge, ListGroup, Row, Col } from "react-bootstrap";
import { formatTimestamp } from "../../../../utils/dateUtils";
import { formatCurrency } from "../../../../utils/formatCurrency";

function vehicleLabel(record) {
  const parts = [record["Year"], record["Make"], record["Model"]].filter(Boolean);
  return parts.length ? parts.join(" ") : record.vin || "Unknown vehicle";
}

export default function ServiceTab({ repairOrders, appointments }) {
  const router = useRouter();
  const now = Date.now();

  const timeline = [
    ...repairOrders.map((ro) => ({ kind: "repair_order", at: ro.computed_date, record: ro })),
    ...appointments.map((appointment) => ({ kind: "appointment", at: appointment.computed_date, record: appointment })),
  ].sort((a, b) => {
    if (a.at && b.at) return b.at - a.at;
    if (a.at) return -1;
    if (b.at) return 1;
    return 0;
  });

  return (
    <div className="w_card">
      <h3 className="w_card_title mb-3">Service</h3>
      {timeline.length === 0 ? (
        <div className="text-center py-4 text-muted">No service history found for this customer.</div>
      ) : (
        <ListGroup variant="flush">
          {timeline.map(({ kind, at, record }) => {
            const isUpcoming = kind === "appointment" && at && new Date(at).getTime() > now;
            return (
              <ListGroup.Item
                key={`${kind}-${record._id}`}
                action
                onClick={() => router.push(kind === "repair_order" ? `/dealer/service/${record._id}` : `/dealer/service-appointments/${record._id}`)}
                className="px-0"
              >
                <Row className="align-items-center gy-1">
                  <Col md={2}>
                    <Badge bg={kind === "repair_order" ? "custom" : isUpcoming ? "warning" : "secondary"}>
                      {kind === "repair_order" ? "Repair Order" : isUpcoming ? "Upcoming" : "Past Appointment"}
                    </Badge>
                  </Col>
                  <Col md={3} className="p_bold"><i className="fa-solid fa-wrench me-2" />{vehicleLabel(record)}</Col>
                  <Col md={2}>{at ? formatTimestamp(at) : "Date unknown"}</Col>
                  <Col md={3}>
                    {kind === "repair_order"
                      ? `${formatCurrency(record.computed_totals?.total_sale)} all-pay / ${formatCurrency(record.computed_totals?.customer_total_sale)} customer-pay`
                      : record["Service Advisor Name"] || "No advisor assigned"}
                  </Col>
                  <Col md={2} className="text-md-end text-muted small">
                    {kind === "repair_order" ? record.ro_number : record.appointment_number}
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
