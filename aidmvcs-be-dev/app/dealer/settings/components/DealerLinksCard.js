"use client";
// The links the AI can share at the right time (Betsy, 22 Oct 2026), edited by the dealership itself. Saved with
// PUT /api/dealer-ai/settings { links } (app/lib/ai/dealerLinks.js); the AI shares one when the customer asks for it.
import { useState } from "react";
import { Alert, Button, Form, Spinner } from "react-bootstrap";
import { aiFetch } from "../../ai/components/aiShared";

const LINKS = [
  ["trade_estimate", "Trade Estimate"],
  ["prequalification", "Prequalification"],
  ["credit_application", "Full Credit Application"],
  ["hours_map", "Hours & Map"],
  ["service_scheduler", "Service Scheduler"],
  ["dealer_website", "Dealer Website"],
  ["new_car_specials", "New Car Specials"],
  ["used_car_specials", "Used Car Specials"],
  ["service_specials", "Service Specials"],
  ["parts_specials", "Parts Specials"],
  ["oem_incentives", "OEM Incentives"],
];

export default function DealerLinksCard({ links, canEdit, onSaved }) {
  const [form, setForm] = useState(() => ({ ...(links || {}) }));
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const changed = LINKS.filter(([key]) => (form[key] || "") !== ((links || {})[key] || ""));

  const save = async () => {
    setStatus("saving");
    setError("");
    try {
      const body = { links: Object.fromEntries(changed.map(([key]) => [key, (form[key] || "").trim()])) };
      const data = await aiFetch("/api/dealer-ai/settings", { method: "PUT", body: JSON.stringify(body) });
      setForm({ ...(data.links || {}) });
      onSaved?.(data);
      setStatus("success");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  };

  return (
    <div className="w_card">
      <h3 className="w_card_title mb-0">Links the AI can share</h3>
      <p className="text-secondary-light">
        <small>
          The AI answers in the conversation first and sends one of these only when the customer asks for it. Leave a
          link empty if you don&apos;t have that page. Never shared: dealer cost or any price except the list price.
        </small>
      </p>
      {error && <Alert variant="danger" className="py-2 small">{error}</Alert>}
      {LINKS.map(([key, label]) => (
        <Form.Group key={key} className="mb-2 d-flex flex-wrap align-items-center gap-2">
          <Form.Label className="mb-0 small" style={{ width: 190 }}>{label}</Form.Label>
          <Form.Control size="sm" type="url" placeholder="https://" disabled={!canEdit} style={{ flex: "1 1 260px" }}
            value={form[key] || ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
        </Form.Group>
      ))}
      {canEdit ? (
        <div className="d-flex align-items-center gap-2 mt-2">
          <Button size="sm" variant="custom" disabled={!changed.length || status === "saving"} onClick={save}>
            {status === "saving" ? <Spinner animation="border" size="sm" /> : "Save links"}
          </Button>
          {status === "success" && <small className="text-success">Saved</small>}
        </div>
      ) : (
        <small className="text-secondary-light">Only the dealership account can change these links.</small>
      )}
    </div>
  );
}
