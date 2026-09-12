"use client";

import { Badge, Col, Row } from "react-bootstrap";
import { formatTimestamp } from "../../../../utils/dateUtils";
import { formatCurrency } from "../../../../utils/formatCurrency";

function primaryContact(entries) {
  if (!entries?.length) return null;
  return entries.find((entry) => entry.is_primary) || entries[0];
}

const BADGE_COLOR = {
  "DealerVault": "#cb5c63",
  "Inbound Lead": "#476c02",
  "Inbound & DealerVault": "#a16f3c",
  "Unknown": "#fc9009",
};

export default function CustomerHeader({ customer, valueSnapshot }) {
  const primaryEmail = primaryContact(customer.emails);
  const primaryPhone = primaryContact(customer.phones);

  return (
    <div className="w_card mb-3">
      <div className="d-flex align-items-start justify-content-between flex-wrap gap-2 mb-3">
        <div>
          <h3 className="w_card_title mb-1">{customer.name || "Unnamed customer"}</h3>
          <Badge bg={null} style={{ backgroundColor: BADGE_COLOR[customer.origin_badge] || BADGE_COLOR.Unknown, color: "#fff" }}>
            {customer.origin_badge}
          </Badge>
        </div>
      </div>
      <Row className="gy-3">
        <Col md={3}><strong>Email:</strong> {primaryEmail?.value || "N/A"}</Col>
        <Col md={3}><strong>Phone:</strong> {primaryPhone?.value || "N/A"}</Col>
        <Col md={3}><strong>Preferred contact:</strong> {customer.preferred_communication_mode || "N/A"}</Col>
        <Col md={3}><strong>Last activity:</strong> {valueSnapshot.last_activity_at ? formatTimestamp(valueSnapshot.last_activity_at) : "N/A"}</Col>
        <Col md={4}><strong>Total sales:</strong> {formatCurrency(valueSnapshot.total_deal_price)}</Col>
        <Col md={4}>
          <strong>Total service (all-pay):</strong> {formatCurrency(valueSnapshot.total_repair_order_sale)}
        </Col>
        <Col md={4}>
          <strong>Total service (customer-pay):</strong> {formatCurrency(valueSnapshot.total_repair_order_customer_sale)}
        </Col>
      </Row>
    </div>
  );
}
