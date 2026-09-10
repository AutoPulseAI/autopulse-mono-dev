"use client";

import { useRouter } from "next/navigation";
import { ListGroup, Row, Col, Badge } from "react-bootstrap";
import { formatTimestamp } from "../../../../utils/dateUtils";
import { formatCurrency } from "../../../../utils/formatCurrency";

function vehicleLabel(deal) {
  const parts = [deal["Year"], deal["Make"], deal["Model"]].filter(Boolean);
  return parts.length ? parts.join(" ") : deal.vin || "Unknown vehicle";
}

function tradeInLabel(tradeIn) {
  if (!tradeIn?.vin && !tradeIn?.year && !tradeIn?.make && !tradeIn?.model) return null;
  const parts = [tradeIn.year, tradeIn.make, tradeIn.model].filter(Boolean);
  return parts.length ? parts.join(" ") : tradeIn.vin;
}

export default function SalesTab({ deals }) {
  const router = useRouter();

  return (
    <div className="w_card">
      <h3 className="w_card_title mb-3">Sales</h3>
      {deals.length === 0 ? (
        <div className="text-center py-4 text-muted">No deals found for this customer.</div>
      ) : (
        <ListGroup variant="flush">
          {deals.map((deal) => {
            const tradeIns = (deal.trade_ins || []).map(tradeInLabel).filter(Boolean);
            return (
              <ListGroup.Item
                key={deal._id}
                action
                onClick={() => router.push(`/dealer/sales/${deal._id}`)}
                className="px-0"
              >
                <Row className="align-items-center gy-1">
                  <Col md={3} className="p_bold">
                    <i className="fa-solid fa-car me-2" />{vehicleLabel(deal)}
                  </Col>
                  <Col md={2}>{deal.computed_date ? formatTimestamp(deal.computed_date) : deal["Contract Date"] || "N/A"}</Col>
                  <Col md={2}>{deal.computed_price ? formatCurrency(deal.computed_price) : "N/A"}</Col>
                  <Col md={3}>{deal.computed_salesperson || "N/A"}</Col>
                  <Col md={2}>
                    {tradeIns.length
                      ? tradeIns.map((label) => <Badge bg="secondary" className="me-1" key={label}>{label}</Badge>)
                      : <span className="text-muted small">No trade-in</span>}
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
