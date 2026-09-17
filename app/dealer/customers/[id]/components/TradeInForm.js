"use client";

import { useState } from "react";
import { Alert, Button, Col, Form, Row } from "react-bootstrap";

const TRADE_IN_STATUSES = [
  "open",
  "closed",
  "appointment booked",
  "Awaiting Customer response",
  "contacted",
];

const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/i;
const YEAR_REGEX = /^\d{4}$/;

function validateField(name, value, allowMissingVin = false) {
  const stringValue = value ? value.toString().trim() : "";
  switch (name) {
    case "vin":
      if (!stringValue) return allowMissingVin ? "" : "VIN is required";
      if (!VIN_REGEX.test(stringValue)) return "Invalid VIN format";
      return "";
    case "year":
      if (stringValue && !YEAR_REGEX.test(stringValue)) return "Year must be 4 digits";
      return "";
    case "status":
      if (!stringValue) return "Status is required";
      return "";
    default:
      return "";
  }
}

export default function TradeInForm({ customerId, dealerId, editTradeIn, setEditTradeIn }) {
  const isEditMode = !!editTradeIn?._id;

  const [formData, setFormData] = useState({
    vin: editTradeIn?.vin || "",
    year: editTradeIn?.year ?? "",
    make: editTradeIn?.make || "",
    model: editTradeIn?.model || "",
    trim: editTradeIn?.trim || "",
    miles: editTradeIn?.miles ?? "",
    exterior_color: editTradeIn?.exterior_color || "",
    interior_color: editTradeIn?.interior_color || "",
    trade_offer_amount: editTradeIn?.trade_offer_amount ?? "",
    trade_acv_amount: editTradeIn?.trade_acv_amount ?? "",
    trade_stock_number: editTradeIn?.trade_stock_number || "",
    status: editTradeIn?.status || "open",
  });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: "", form: "" }));
  };

  const validateForm = () => {
    const newErrors = {
      vin: validateField("vin", formData.vin, !!editTradeIn?.raw_adf_payload_id),
      year: validateField("year", formData.year),
      status: validateField("status", formData.status),
    };
    setErrors(newErrors);
    return !Object.values(newErrors).some(Boolean);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/customers/${customerId}/trade-ins`, {
        method: isEditMode ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("dealertoken")}`,
        },
        body: JSON.stringify({
          ...formData,
          _id: editTradeIn?._id,
          dealer_id: dealerId,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Failed to save trade-in");
      setEditTradeIn(null, { created: !isEditMode });
    } catch (submitError) {
      setErrors((prev) => ({ ...prev, form: submitError.message || "Failed to save trade-in" }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w_card">
      <h3 className="w_card_title">{isEditMode ? "Edit Trade In" : "Add Trade In"}</h3>

      {errors.form && (
        <Alert variant="danger" dismissible onClose={() => setErrors((prev) => ({ ...prev, form: "" }))}>
          {errors.form}
        </Alert>
      )}

      <Form onSubmit={handleSubmit}>
        <Row>
          <Form.Group as={Col} lg={4} md={6} className="mb-3">
            <Form.Label>VIN</Form.Label>
            <Form.Control
              name="vin"
              value={formData.vin}
              onChange={handleChange}
              maxLength={17}
              isInvalid={!!errors.vin}
            />
            <Form.Control.Feedback type="invalid">{errors.vin}</Form.Control.Feedback>
          </Form.Group>

          <Form.Group as={Col} lg={4} md={6} className="mb-3">
            <Form.Label>Year</Form.Label>
            <Form.Control
              name="year"
              type="number"
              value={formData.year}
              onChange={handleChange}
              isInvalid={!!errors.year}
            />
            <Form.Control.Feedback type="invalid">{errors.year}</Form.Control.Feedback>
          </Form.Group>

          <Form.Group as={Col} lg={4} md={6} className="mb-3">
            <Form.Label>Make</Form.Label>
            <Form.Control name="make" value={formData.make} onChange={handleChange} />
          </Form.Group>

          <Form.Group as={Col} lg={4} md={6} className="mb-3">
            <Form.Label>Model</Form.Label>
            <Form.Control name="model" value={formData.model} onChange={handleChange} />
          </Form.Group>

          <Form.Group as={Col} lg={4} md={6} className="mb-3">
            <Form.Label>Trim</Form.Label>
            <Form.Control name="trim" value={formData.trim} onChange={handleChange} />
          </Form.Group>

          <Form.Group as={Col} lg={4} md={6} className="mb-3">
            <Form.Label>Miles</Form.Label>
            <Form.Control name="miles" type="number" value={formData.miles} onChange={handleChange} />
          </Form.Group>

          <Form.Group as={Col} lg={4} md={6} className="mb-3">
            <Form.Label>Exterior Color</Form.Label>
            <Form.Control name="exterior_color" value={formData.exterior_color} onChange={handleChange} />
          </Form.Group>

          <Form.Group as={Col} lg={4} md={6} className="mb-3">
            <Form.Label>Interior Color</Form.Label>
            <Form.Control name="interior_color" value={formData.interior_color} onChange={handleChange} />
          </Form.Group>

          <Form.Group as={Col} lg={4} md={6} className="mb-3">
            <Form.Label>Trade Offer ($)</Form.Label>
            <Form.Control name="trade_offer_amount" type="number" value={formData.trade_offer_amount} onChange={handleChange} />
          </Form.Group>

          <Form.Group as={Col} lg={4} md={6} className="mb-3">
            <Form.Label>Trade ACV ($)</Form.Label>
            <Form.Control name="trade_acv_amount" type="number" value={formData.trade_acv_amount} onChange={handleChange} />
          </Form.Group>

          <Form.Group as={Col} lg={4} md={6} className="mb-3">
            <Form.Label>Trade Stock Number</Form.Label>
            <Form.Control name="trade_stock_number" value={formData.trade_stock_number} onChange={handleChange} />
          </Form.Group>

          <Form.Group as={Col} lg={4} md={6} className="mb-3">
            <Form.Label>Status</Form.Label>
            <Form.Select name="status" value={formData.status} onChange={handleChange} isInvalid={!!errors.status}>
              {TRADE_IN_STATUSES.map((statusOption) => (
                <option key={statusOption} value={statusOption}>{statusOption}</option>
              ))}
            </Form.Select>
            <Form.Control.Feedback type="invalid">{errors.status}</Form.Control.Feedback>
          </Form.Group>

          <Col lg={12} className="text-center mt-0 mt-md-3">
            <Button variant="custom" type="submit" disabled={isSubmitting} className="me-2">
              {isSubmitting ? "Saving..." : "Save Trade In"}
            </Button>
            <Button variant="secondary" onClick={() => setEditTradeIn(null)} disabled={isSubmitting}>
              Cancel
            </Button>
          </Col>
        </Row>
      </Form>
    </div>
  );
}
