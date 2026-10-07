"use client";
// NHTSA recalls for the vehicles on a lead, with the staff actions the AI needs (agentic-upsell PLAN_4 stream X2).
// A recall NHTSA lists for the model ("unverified") reaches the customer only once staff confirm it for this VIN;
// staff close a recall once it's repaired or doesn't apply. Shown in the AI panel (lead screen, AI Alerts and Call
// Tasks drawers). Renders nothing when the lead has no watched vehicle.

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Spinner } from "react-bootstrap";
import { aiFetch, formatDate } from "./aiShared";

const STATUS = {
  unverified: { label: "Needs VIN check", variant: "warning" },
  open: { label: "Open", variant: "danger" },
  completed: { label: "Repaired", variant: "secondary" },
  not_applicable: { label: "Doesn't apply", variant: "secondary" },
};
const CLOSED = ["completed", "not_applicable"];

export default function RecallsSection({ leadId }) {
  const [vehicles, setVehicles] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!leadId) return;
    try {
      const data = await aiFetch(`/api/dealer-ai/leads/${leadId}/recalls`);
      setVehicles((data.vehicles || []).filter((v) => v.recalls.length));
    } catch {
      setVehicles([]); // no AI profile / no watched vehicle: nothing to show
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (vin, recallId, action, reason) => {
    if (action === "confirm" && !window.confirm(
      `Confirm recall ${recallId} applies to VIN ${vin}? The customer will be told about it.`)) return;
    setBusy(`${vin}:${recallId}`);
    setError("");
    try {
      await aiFetch(`/api/dealer-ai/leads/${leadId}/recalls`, {
        method: "POST", body: JSON.stringify({ vin, recall_id: recallId, action, reason }),
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  if (!vehicles.length) return null;
  return (
    <div className="border-top pt-2 mt-2">
      <p className="mb-1 small text-secondary-light text-uppercase fw-semibold">
        <i className="fa-regular fa-triangle-exclamation me-1" />Recalls
      </p>
      {error && <p className="small text-danger mb-1">{error}</p>}
      {vehicles.map((v) => (
        <div key={v.vin} className="mb-2">
          <p className="mb-1 small"><strong>{v.label || "Vehicle"}</strong> <span className="text-secondary-light">{v.vin}</span></p>
          {v.recalls.map((r) => {
            const s = STATUS[r.status] || { label: r.status, variant: "secondary" };
            const key = `${v.vin}:${r.recall_id}`;
            return (
              <div key={r.recall_id} className="small mb-1">
                <Badge bg={s.variant} className="me-1">{s.label}</Badge>
                <strong>{r.recall_id}</strong>{r.component ? ` - ${r.component}` : ""}
                {r.detected_at && <span className="text-secondary-light"> (found {formatDate(r.detected_at)})</span>}
                {!CLOSED.includes(r.status) && (
                  <div className="mt-1 d-flex gap-1 flex-wrap">
                    {busy === key && <Spinner size="sm" />}
                    {r.status === "unverified" && (
                      <Button size="sm" variant="outline-primary" disabled={!!busy}
                        onClick={() => act(v.vin, r.recall_id, "confirm")}>Confirm for this VIN</Button>
                    )}
                    <Button size="sm" variant="outline-secondary" disabled={!!busy}
                      onClick={() => act(v.vin, r.recall_id, "close", "completed")}>Repaired</Button>
                    <Button size="sm" variant="outline-secondary" disabled={!!busy}
                      onClick={() => act(v.vin, r.recall_id, "close", "not_applicable")}>Doesn&apos;t apply</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
