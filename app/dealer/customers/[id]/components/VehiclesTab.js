"use client";

import { useRouter } from "next/navigation";
import { Badge, Card, Col, Row, Button } from "react-bootstrap";

function vehicleTitle(vehicle) {
  const parts = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean);
  return parts.length ? parts.join(" ") : vehicle.vin;
}

export default function VehiclesTab({ vehicles }) {
  const router = useRouter();

  return (
    <div className="w_card">
      <h3 className="w_card_title mb-3">Vehicles</h3>
      <p className="text-muted small">
        Vehicles referenced in this customer&apos;s sales and service records — not necessarily
        vehicles they currently own, since a VIN can pass between customers over time.
      </p>
      {vehicles.length === 0 ? (
        <div className="text-center py-4 text-muted">No vehicles found for this customer.</div>
      ) : (
        <Row className="gy-3">
          {vehicles.map((vehicle) => (
            <Col md={6} lg={4} key={vehicle.vin}>
              <Card className="h-100">
                <Card.Body>
                  <div className="d-flex align-items-start justify-content-between mb-2">
                    <Card.Title className="mb-0">{vehicleTitle(vehicle)}</Card.Title>
                    <Badge bg="secondary">Referenced</Badge>
                  </div>
                  <div className="text-muted small mb-2">VIN: {vehicle.vin}</div>
                  {!vehicle.is_current_owner && vehicle.current_owner_customer_id && (
                    <div className="small text-warning mb-2">
                      <i className="fa-solid fa-triangle-exclamation me-1" />
                      Currently associated with a different customer
                    </div>
                  )}
                  <div className="d-flex gap-2 mt-3">
                    <Button
                      variant="outline-custom"
                      size="sm"
                      onClick={() => router.push(`/dealer/sales?vin=${encodeURIComponent(vehicle.vin)}`)}
                    >
                      View Sales
                    </Button>
                    <Button
                      variant="outline-custom"
                      size="sm"
                      onClick={() => router.push(`/dealer/service?vin=${encodeURIComponent(vehicle.vin)}`)}
                    >
                      View Service
                    </Button>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
