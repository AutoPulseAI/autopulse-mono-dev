"use client";
import { useState, useEffect } from "react";
import { Offcanvas, Form, Button, Alert, Spinner, Row, Col } from "react-bootstrap";
import { useUser } from "../../context/UserContext";

function isAdfLead(lead) {
  return lead?.data?.format === "adf/xml";
}

export default function LeadDetailsSidebar({ show, onHide, lead, onLeadUpdated }) {
  const { dealerParent } = useUser();
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [adfText, setAdfText] = useState(null);
  const [adfLoading, setAdfLoading] = useState(false);
  const [adfError, setAdfError] = useState(null);

  // Helper function to check if field is editable (blank or name field)
  const isFieldEditable = (fieldName, fieldValue) => {
    if (fieldName === 'name') return true; // Name always editable
    // Only editable if field is blank/empty
    return !fieldValue || fieldValue.toString().trim() === '';
  };

  useEffect(() => {
    if (lead) {
      setFormData({
        name: lead.name || "",
        email: lead.email || "",
        phone: lead.phone || "",
        vin: lead.vin || "",
        vehicle_make: lead.vehicle_make || "",
        vehicle_model: lead.vehicle_model || "",
        vehicle_year: lead.vehicle_year || "",
        lead_source: lead.lead_source || ""
      });
      setErrors({});
    }
  }, [lead]);

  useEffect(() => {
    if (!show || !isAdfLead(lead)) {
      setAdfText(null);
      setAdfError(null);
      setAdfLoading(false);
      return;
    }

    let cancelled = false;
    setAdfLoading(true);
    setAdfError(null);
    setAdfText(null);

    (async () => {
      try {
        const response = await fetch(`/api/leads/${lead._id}/adf`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Failed to load ADF");
        if (!cancelled) setAdfText(data.data.raw_xml);
      } catch (fetchError) {
        if (!cancelled) setAdfError(fetchError.message || "Failed to load ADF");
      } finally {
        if (!cancelled) setAdfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [show, lead]);

  const validateField = (name, value) => {
    const stringValue = value ? value.toString().trim() : "";
    
    // No required validations - everything is optional
    switch (name) {
      case "name":
        // Only validate format if value exists
        if (stringValue && !/^[a-zA-Z\s]+$/.test(stringValue)) 
          return "Only letters and spaces allowed";
        return "";
      case "email":
        // Only validate format if value exists
        if (stringValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stringValue)) 
          return "Invalid email format";
        return "";
      case "phone":
        if (stringValue) {
          // Remove +1 prefix and non-digit characters for validation
          const cleanPhone = stringValue.replace(/^\+1/, '').replace(/\D/g, '');
          if (cleanPhone.length !== 10) 
            return "Must be 10 digits (excluding +1 prefix)";
        }
        return "";
      case "vehicle_year":
        if (stringValue && !/^\d{4}$/.test(stringValue)) 
          return "Year must be 4 digits";
        return "";
      case "vin":
        if (stringValue && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(stringValue))
          return "Invalid VIN format";
        return "";
      default:
        return "";
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear error when user types
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: "" }));
    }
  };

  const validateForm = () => {
    const newErrors = {};
    
    // Only validate fields that have values
    Object.keys(formData).forEach(field => {
      if (formData[field]) {
        newErrors[field] = validateField(field, formData[field]);
      }
    });

    setErrors(newErrors);
    return !Object.values(newErrors).some(error => error);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/leads/${lead._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" ,'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`},
        body: JSON.stringify({
          ...formData,
          dealer_id: dealerParent?.id
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update lead");
      }

      const updatedLead = await response.json();
      onLeadUpdated(updatedLead);
      onHide();
    } catch (err) {
      setErrors(prev => ({ ...prev, form: err.message || "Update failed" }));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!lead) return null;

  return (
    <Offcanvas show={show} onHide={onHide} placement="end" size="lg">
      <Offcanvas.Header closeButton>
        <Offcanvas.Title>Lead Details</Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body>
        {errors.form && (
          <Alert variant="danger" dismissible onClose={() => setErrors(prev => ({ ...prev, form: "" }))}>
            {errors.form}
          </Alert>
        )}

        <Form onSubmit={handleSubmit}>
          <Row>
            {/* Contact Information */}
            <Col md={6}>
              <h6 className="mb-3">Contact Information</h6>
              
              <Form.Group className="mb-3">
                <Form.Label>Name</Form.Label>
                <Form.Control
                  name="name"
                  value={formData.name || ""}
                  onChange={handleChange}
                  isInvalid={!!errors.name}
                  placeholder="John Doe"
                />
                <Form.Control.Feedback type="invalid">
                  {errors.name}
                </Form.Control.Feedback>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Email</Form.Label>
                <Form.Control
                  type="email"
                  name="email"
                  value={formData.email || ""}
                  onChange={handleChange}
                  isInvalid={!!errors.email}
                  placeholder="john@example.com"
                  disabled={!isFieldEditable('email', lead?.email)}
                  readOnly={!isFieldEditable('email', lead?.email)}
                  className={lead?.email ? "bg-light" : ""}
                />
                <Form.Control.Feedback type="invalid">
                  {errors.email}
                </Form.Control.Feedback>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Phone</Form.Label>
                <Form.Control
                  type="tel"
                  name="phone"
                  value={formData.phone || ""}
                  onChange={handleChange}
                  isInvalid={!!errors.phone}
                  placeholder="+17083088626 or 7083088626"
                  maxLength="12"
                  disabled={!isFieldEditable('phone', lead?.phone)}
                  readOnly={!isFieldEditable('phone', lead?.phone)}
                  className={lead?.phone ? "bg-light" : ""}
                />
                <Form.Control.Feedback type="invalid">
                  {errors.phone}
                </Form.Control.Feedback>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Lead Source</Form.Label>
                <Form.Control
                  name="lead_source"
                  value={formData.lead_source || ""}
                  onChange={handleChange}
                  placeholder="Website, Referral, etc."
                  disabled={!isFieldEditable('lead_source', lead?.lead_source)}
                  readOnly={!isFieldEditable('lead_source', lead?.lead_source)}
                  className={lead?.lead_source ? "bg-light" : ""}
                />
              </Form.Group>
            </Col>

            {/* Vehicle Information */}
            <Col md={6}>
              <h6 className="mb-3">Vehicle Information</h6>
              
              <Form.Group className="mb-3">
                <Form.Label>VIN</Form.Label>
                <Form.Control
                  name="vin"
                  value={formData.vin || ""}
                  onChange={handleChange}
                  isInvalid={!!errors.vin}
                  placeholder="1HGBH41JXMN109186"
                  maxLength="17"
                  disabled={!isFieldEditable('vin', lead?.vin)}
                  readOnly={!isFieldEditable('vin', lead?.vin)}
                  className={lead?.vin ? "bg-light" : ""}
                />
                <Form.Control.Feedback type="invalid">
                  {errors.vin}
                </Form.Control.Feedback>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Make</Form.Label>
                <Form.Control
                  name="vehicle_make"
                  value={formData.vehicle_make || ""}
                  onChange={handleChange}
                  placeholder="Toyota"
                  disabled={!isFieldEditable('vehicle_make', lead?.vehicle_make)}
                  readOnly={!isFieldEditable('vehicle_make', lead?.vehicle_make)}
                  className={lead?.vehicle_make ? "bg-light" : ""}
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Model</Form.Label>
                <Form.Control
                  name="vehicle_model"
                  value={formData.vehicle_model || ""}
                  onChange={handleChange}
                  placeholder="Camry"
                  disabled={!isFieldEditable('vehicle_model', lead?.vehicle_model)}
                  readOnly={!isFieldEditable('vehicle_model', lead?.vehicle_model)}
                  className={lead?.vehicle_model ? "bg-light" : ""}
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Year</Form.Label>
                <Form.Control
                  name="vehicle_year"
                  value={formData.vehicle_year || ""}
                  onChange={handleChange}
                  isInvalid={!!errors.vehicle_year}
                  placeholder="2023"
                  maxLength="4"
                  disabled={!isFieldEditable('vehicle_year', lead?.vehicle_year)}
                  readOnly={!isFieldEditable('vehicle_year', lead?.vehicle_year)}
                  className={lead?.vehicle_year ? "bg-light" : ""}
                />
                <Form.Control.Feedback type="invalid">
                  {errors.vehicle_year}
                </Form.Control.Feedback>
              </Form.Group>
            </Col>

            {/* Form Actions */}
            <Col md={12} className="text-center mt-3">
              <Button 
                variant="custom" 
                type="submit" 
                disabled={isSubmitting}
                className="me-2"
              >
                {isSubmitting ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />
                    Updating...
                  </>
                ) : (
                  "Update Lead"
                )}
              </Button>
              <Button 
                variant="secondary" 
                onClick={onHide}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </Col>
          </Row>
        </Form>

        {/* Read-only Information */}
        <hr className="my-4" />
        <div className="position-relative">
          <h6 className="mb-3">Lead Information</h6>
          <Row>
            <Col md={6}>
              <p><strong>Status:</strong> {lead.fe_lead_status || "N/A"}</p>
              <p><strong>Source:</strong> {lead.source || "N/A"}</p>
            </Col>
            <Col md={6}>
              <p><strong>Created:</strong> {new Date(lead.createdAt).toLocaleDateString()}</p>
              <p><strong>Last Updated:</strong> {new Date(lead.updatedAt).toLocaleDateString()}</p>
            </Col>
          </Row>

          {isAdfLead(lead) && (
            <div className="mt-2">
              <div className="small text-muted mb-1">ADF payload</div>
              {adfLoading ? (
                <div className="text-muted small">
                  <Spinner animation="border" size="sm" className="me-2" />
                  Loading ADF...
                </div>
              ) : adfError ? (
                <div className="text-danger small">{adfError}</div>
              ) : adfText ? (
                <pre
                  className="small bg-light border rounded p-2 mb-0"
                  style={{ maxHeight: 320, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                >
                  {adfText}
                </pre>
              ) : null}
            </div>
          )}
        </div>
      </Offcanvas.Body>
    </Offcanvas>
  );
}
