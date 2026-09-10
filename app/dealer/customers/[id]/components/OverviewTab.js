"use client";

import { Badge, ListGroup } from "react-bootstrap";
import { formatTimestamp } from "../../../../utils/dateUtils";
import { formatCurrency } from "../../../../utils/formatCurrency";

function vehicleLabel(record) {
  const parts = [record["Year"], record["Make"], record["Model"]].filter(Boolean);
  return parts.length ? parts.join(" ") : record.vin || null;
}

const TYPE_META = {
  lead: { label: "Lead", variant: "info", icon: "fa-user-plus" },
  deal: { label: "Sale", variant: "success", icon: "fa-file-signature" },
  repair_order: { label: "Service visit", variant: "custom", icon: "fa-wrench" },
  appointment: { label: "Appointment", variant: "warning", icon: "fa-calendar-check" },
};

function describeEntry(entry) {
  const { type, record } = entry;
  if (type === "lead") {
    return `${record.name || "Unnamed lead"} via ${record.source || record.lead_source || "unknown source"}`;
  }
  if (type === "deal") {
    const price = record.computed_price;
    return `${vehicleLabel(record) || "Vehicle"}${price ? ` — ${formatCurrency(price)}` : ""}${record.computed_salesperson ? ` (${record.computed_salesperson})` : ""}`;
  }
  if (type === "repair_order") {
    const { total_sale } = record.computed_totals || {};
    return `${vehicleLabel(record) || "Vehicle"}${total_sale ? ` — ${formatCurrency(total_sale)}` : ""}${record["RO Status"] ? ` (${record["RO Status"]})` : ""}`;
  }
  if (type === "appointment") {
    return `${vehicleLabel(record) || "Vehicle"}${record["Service Advisor Name"] ? ` with ${record["Service Advisor Name"]}` : ""}`;
  }
  return "Activity";
}

export default function OverviewTab({ customer, overview }) {
  return (
    <>
      <div className="w_card mb-3">
        <h3 className="w_card_title mb-3">Recent Activity</h3>
        {overview.length === 0 ? (
          <div className="text-center py-4 text-muted">No activity found for this customer yet.</div>
        ) : (
          <ListGroup variant="flush">
            {overview.map((entry, index) => {
              const meta = TYPE_META[entry.type] || { label: entry.type, variant: "secondary", icon: "fa-circle" };
              return (
                <ListGroup.Item key={`${entry.type}-${entry.record._id || index}`} className="px-0">
                  <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                    <div>
                      <Badge bg={meta.variant} className="me-2">
                        <i className={`fa-solid ${meta.icon} me-1`} />{meta.label}
                      </Badge>
                      {describeEntry(entry)}
                    </div>
                    <small className="text-muted">{entry.at ? formatTimestamp(entry.at) : "Date unknown"}</small>
                  </div>
                </ListGroup.Item>
              );
            })}
          </ListGroup>
        )}
      </div>

      <div className="w_card">
        <h3 className="w_card_title mb-3">Profile</h3>
        <div className="row gy-3">
          <div className="col-md-6">
            <strong>Emails:</strong>
            {customer.emails?.length ? (
              <ul className="list-unstyled mb-0 mt-1">
                {customer.emails.map((entry) => (
                  <li key={entry.value}>
                    {entry.value}
                    {entry.is_primary && <Badge bg="custom" className="ms-2">Primary</Badge>}
                    <span className="text-muted small ms-2">({entry.source || "unknown"})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-muted">No emails on file</div>
            )}
          </div>
          <div className="col-md-6">
            <strong>Phones:</strong>
            {customer.phones?.length ? (
              <ul className="list-unstyled mb-0 mt-1">
                {customer.phones.map((entry) => (
                  <li key={entry.value}>
                    {entry.value}
                    {entry.is_primary && <Badge bg="custom" className="ms-2">Primary</Badge>}
                    {entry.sms_opt_in && <Badge bg="success" className="ms-2">SMS opt-in</Badge>}
                    <span className="text-muted small ms-2">({entry.source || "unknown"})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-muted">No phones on file</div>
            )}
          </div>
          <div className="col-md-4"><strong>Follow-up preference:</strong> {customer.followup_preference || "N/A"}</div>
          <div className="col-md-4"><strong>Language:</strong> {customer.user_language || "N/A"}</div>
          <div className="col-md-4"><strong>Customer since:</strong> {customer.createdAt ? formatTimestamp(customer.createdAt) : "N/A"}</div>
        </div>
      </div>
    </>
  );
}
