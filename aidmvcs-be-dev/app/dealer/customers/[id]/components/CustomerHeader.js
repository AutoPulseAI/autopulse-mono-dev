"use client";

import { Badge, Button, Col, Form, Row } from "react-bootstrap";
import { formatTimestamp } from "../../../../utils/dateUtils";
import { formatCurrency } from "../../../../utils/formatCurrency";
import { useCan } from "../../../../hooks/PermissionsContext";

export function primaryContact(entries) {
  if (!entries?.length) return null;
  return entries.find((entry) => entry.is_primary) || entries[0];
}

const BADGE_COLOR = {
  "DealerVault": "#cb5c63",
  "Inbound Lead": "#476c02",
  "Inbound & DealerVault": "#a16f3c",
  "Manual": "#5a67d8",
  "Unknown": "#fc9009",
};

export default function CustomerHeader({ customer, valueSnapshot, onSendMessage, onEdit, staffList, onAssignmentChange }) {
  const primaryEmail = primaryContact(customer.emails);
  const primaryPhone = primaryContact(customer.phones);
  // Same phone-priority reuse of getReplyChannel()'s rule (viewConversations.js:21-33):
  // SMS whenever a phone is on file, otherwise email, otherwise no button at all.
  const sendLabel = primaryPhone ? "Send SMS" : primaryEmail ? "Send Mail" : null;
  // Reuses the leads permission - assigning a customer cascades to all of
  // their leads, so it belongs to the same permission as assigning a lead.
  const canAssignLeads = useCan("Assign Leads");

  return (
    <div className="w_card mb-3">
      <div className="d-flex align-items-start justify-content-between flex-wrap gap-2 mb-3">
        <div>
          <h3 className="w_card_title mb-1">{customer.name || "Unnamed customer"}</h3>
          <Badge bg={null} style={{ backgroundColor: BADGE_COLOR[customer.origin_badge] || BADGE_COLOR.Unknown, color: "#fff" }}>
            {customer.origin_badge}
          </Badge>
        </div>
        <div className="d-flex align-items-center gap-2">
          {canAssignLeads && (
            <Form.Select
              size="sm"
              style={{ width: "auto" }}
              value={customer.assigned_to || ""}
              onChange={(e) => onAssignmentChange(e.target.value)}
              aria-label="Assigned to"
            >
              <option value="">Unassigned</option>
              {staffList?.map((staff) => (
                <option key={staff._id} value={staff._id}>{staff.name}</option>
              ))}
            </Form.Select>
          )}
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <i className="fa-solid fa-pen me-2" />
            Edit
          </Button>
          {sendLabel && (
            <Button variant="custom" size="sm" onClick={onSendMessage}>
              <i className={`fa-solid ${primaryPhone ? "fa-comment-sms" : "fa-envelope"} me-2`} />
              {sendLabel}
            </Button>
          )}
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

      <hr />

      <Row className="gy-3">
        <Col md={6}>
          <strong>Emails:</strong>
          {customer.emails?.length ? (
            <ul className="list-unstyled mb-0 mt-1">
              {customer.emails.map((entry) => (
                <li key={entry.value}>
                  {entry.value}
                  {entry.is_primary && <Badge bg="custom" className="ms-2">Primary</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-muted">No emails on file</div>
          )}
        </Col>
        <Col md={6}>
          <strong>Phones:</strong>
          {customer.phones?.length ? (
            <ul className="list-unstyled mb-0 mt-1">
              {customer.phones.map((entry) => (
                <li key={entry.value}>
                  {entry.value}
                  {entry.is_primary && <Badge bg="custom" className="ms-2">Primary</Badge>}
                  {entry.sms_opt_in && <Badge bg="success" className="ms-2">SMS opt-in</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-muted">No phones on file</div>
          )}
        </Col>
        <Col md={4}><strong>Follow-up preference:</strong> {customer.followup_preference || "N/A"}</Col>
        <Col md={4}><strong>Language:</strong> {customer.user_language || "N/A"}</Col>
        <Col md={4}><strong>Customer since:</strong> {customer.createdAt ? formatTimestamp(customer.createdAt) : "N/A"}</Col>
      </Row>
    </div>
  );
}
