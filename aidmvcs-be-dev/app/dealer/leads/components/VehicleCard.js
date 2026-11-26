"use client";
// The picked car in the reply window (Betsy, 25 Nov 2026: "I want to send a picture of this vehicle ... the miles ...
// is this two-wheel drive or four-wheel drive? It's right there, you click the drive train"). Tick photos to send them
// with the reply (a picture message by text, links in an email); click a fact to put it in the message.
import { Badge, Button, Card } from "react-bootstrap";
import { vehicleFacts } from "../../../lib/vehicleFacts";
import { MAX_STAFF_PHOTOS } from "../../../lib/staffMedia";

export default function VehicleCard({ vehicle, picked = [], onPick, onAdd, onRemove, channel }) {
  const { title, photos, facts } = vehicleFacts(vehicle);
  const toggle = (url) => onPick(picked.includes(url) ? picked.filter((u) => u !== url)
    : picked.length >= MAX_STAFF_PHOTOS ? picked : [...picked, url]);
  return (
    <Card className="mb-2" data-testid="vehicle-card">
      <Card.Body className="py-2">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <strong>{title || "Vehicle"}</strong>
          <Button variant="outline-danger" size="sm" onClick={onRemove} aria-label="Remove the vehicle">
            <i className="fa-solid fa-times"></i>
          </Button>
        </div>
        {photos.length > 0 ? (
          <>
            <div className="small text-muted mb-1">
              Photos: tick up to {MAX_STAFF_PHOTOS} to send{channel === "sms" ? " as a picture message" : " as links in the email"}
              {picked.length > 0 && <Badge bg="success" className="ms-2">{picked.length} picked</Badge>}
            </div>
            <div className="d-flex flex-wrap gap-1 mb-2">
              {photos.slice(0, 24).map((url) => (
                <button key={url} type="button" onClick={() => toggle(url)} aria-pressed={picked.includes(url)}
                  title={picked.includes(url) ? "Picked - click to drop" : "Click to send this photo"}
                  style={{ padding: 0, border: picked.includes(url) ? "3px solid #198754" : "1px solid #ccc", borderRadius: 4 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" width={72} height={54} style={{ objectFit: "cover", display: "block" }} loading="lazy" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="small text-muted mb-2">The inventory feed has no photos for this car.</div>
        )}
        <div className="small text-muted mb-1">Click to add to the message:</div>
        <div className="d-flex flex-wrap gap-1">
          {facts.map((f) => (
            <Button key={f.key} size="sm" variant="outline-custom" onClick={() => onAdd(f.text)} title={f.text}>
              <strong>{f.label}</strong>{f.key === "link" ? "" : `: ${f.value}`}
            </Button>
          ))}
          {facts.length === 0 && <span className="small text-muted">No details in the inventory feed for this car.</span>}
        </div>
      </Card.Body>
    </Card>
  );
}
