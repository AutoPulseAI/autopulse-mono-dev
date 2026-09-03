"use client";
import { useState, useEffect } from "react";
import { Form, Button, Row, Col, Alert, Spinner } from "react-bootstrap";
import { useUser } from "../../context/UserContext";

export default function LeadForm({ setEditLead, editLead }) {
    const { user, dealerParent } = useUser();
    const isEditMode = !!editLead?.id || !!editLead?._id;
    
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        phone: "",
        followup_preference: "email",
        vehicle_make: "",
        vehicle_model: "",
        vehicle_year: "",
        vin: "",
        comments: "",
        dealer_id: "", // Initialize dealer_id
        ...editLead // Spread existing lead data if editing
    });

    const [errors, setErrors] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Helper function to check if field is editable (blank or name field)
    const isFieldEditable = (fieldName, fieldValue) => {
        if (!isEditMode) return true; // All fields editable in create mode
        if (fieldName === 'name') return true; // Name always editable
        // Only editable if field is blank/empty
        return !fieldValue || fieldValue.toString().trim() === '';
    };

    useEffect(() => {
        // Wait for dealerParent to load
        if (dealerParent?.id) {
            setFormData(prev => ({
                ...prev,
                dealer_id: dealerParent.id
            }));
            setIsLoading(false);
        }
    }, [dealerParent]);

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
                // Only validate format if value exists
                if (stringValue && !/^\d+$/.test(stringValue.replace(/\D/g, ''))) 
                    return "Invalid phone format";
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
        const newErrors = {
            name: validateField("name", formData.name),
            email: validateField("email", formData.email),
            phone: validateField("phone", formData.phone),
            vehicle_year: validateField("vehicle_year", formData.vehicle_year),
            vin: validateField("vin", formData.vin)
        };

        // Only validate format if phone has value
        if (formData.phone?.trim()) {
            const digitsOnly = formData.phone.replace(/\D/g, '');
            if (digitsOnly.length < 10) {
                newErrors.phone = "Phone number must have at least 10 digits";
            }
        }

        setErrors(newErrors);
        return !Object.values(newErrors).some(error => error);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validateForm()) return;
        
        setIsSubmitting(true);
        try {
            const leadId = editLead?._id || editLead?.id;
            const url = leadId ? `/api/leads/${leadId}` : "/api/leads";
            const response = await fetch(url, {
                method: leadId ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" ,'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`},
                body: JSON.stringify({
                    ...formData,
                    dealer_id: dealerParent.id // Ensure we're using the latest dealer_id
                })
            });

            if (!response.ok) throw new Error(await response.text());
            setEditLead(null); // Close form on success
        } catch (err) {
            setErrors(prev => ({ ...prev, form: err.message || "Submission failed" }));
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="w_card">
                <div className="text-center py-4">
                    <Spinner animation="border" role="status">
                        <span className="visually-hidden">Loading dealer information...</span>
                    </Spinner>
                    <p className="mt-2">Loading dealer information...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="w_card">
            <h3 className="w_card_title">{editLead?.id ? "Edit Lead" : "Add New Lead"}</h3>
            
            {errors.form && (
                <Alert variant="danger" dismissible onClose={() => setErrors(prev => ({ ...prev, form: "" }))}>
                    {errors.form}
                </Alert>
            )}

            <Form onSubmit={handleSubmit}>
                <Row>
                    {/* Contact Information */}
                    <Form.Group as={Col} lg={4} md={6} className="mb-3">
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

                    <Form.Group as={Col} lg={4} md={6} className="mb-3">
                        <Form.Label>Email</Form.Label>
                        <Form.Control
                            type="email"
                            name="email"
                            value={formData.email || ""}
                            onChange={handleChange}
                            isInvalid={!!errors.email}
                            placeholder="john@example.com"
                            disabled={!isFieldEditable('email', formData.email)}
                            readOnly={!isFieldEditable('email', formData.email)}
                        />
                        <Form.Control.Feedback type="invalid">
                            {errors.email}
                        </Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group as={Col} lg={4} md={6} className="mb-3">
                        <Form.Label>Phone</Form.Label>
                        <Form.Control
                            type="tel"
                            name="phone"
                            value={formData.phone || ""}
                            onChange={handleChange}
                            isInvalid={!!errors.phone}
                            placeholder="1234567890"
                            maxLength="10"
                            disabled={!isFieldEditable('phone', formData.phone)}
                            readOnly={!isFieldEditable('phone', formData.phone)}
                        />
                        <Form.Control.Feedback type="invalid">
                            {errors.phone}
                        </Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group as={Col} lg={4} md={6} className="mb-3">
                        <Form.Label>Follow-up Preference</Form.Label>
                        <Form.Select
                            name="followup_preference"
                            value={formData.followup_preference}
                            onChange={handleChange}
                            disabled={!isFieldEditable('followup_preference', formData.followup_preference)}
                        >
                            <option value="email">Email</option>
                            <option value="sms">Sms</option>
                        </Form.Select>
                    </Form.Group>

                    {/* Vehicle Information */}
                    <Form.Group as={Col} lg={4} md={6} className="mb-3">
                        <Form.Label>Vehicle Make</Form.Label>
                        <Form.Control
                            name="vehicle_make"
                            value={formData.vehicle_make || ""}
                            onChange={handleChange}
                            placeholder="Toyota"
                            disabled={!isFieldEditable('vehicle_make', formData.vehicle_make)}
                            readOnly={!isFieldEditable('vehicle_make', formData.vehicle_make)}
                        />
                    </Form.Group>

                    <Form.Group as={Col} lg={4} md={6} className="mb-3">
                        <Form.Label>Vehicle Model</Form.Label>
                        <Form.Control
                            name="vehicle_model"
                            value={formData.vehicle_model || ""}
                            onChange={handleChange}
                            placeholder="Camry"
                            disabled={!isFieldEditable('vehicle_model', formData.vehicle_model)}
                            readOnly={!isFieldEditable('vehicle_model', formData.vehicle_model)}
                        />
                    </Form.Group>

                    <Form.Group as={Col} lg={4} md={6} className="mb-3">
                        <Form.Label>Vehicle Year</Form.Label>
                        <Form.Control
                            name="vehicle_year"
                            value={formData.vehicle_year || ""}
                            onChange={handleChange}
                            isInvalid={!!errors.vehicle_year}
                            placeholder="2023"
                            maxLength="4"
                            disabled={!isFieldEditable('vehicle_year', formData.vehicle_year)}
                            readOnly={!isFieldEditable('vehicle_year', formData.vehicle_year)}
                        />
                        <Form.Control.Feedback type="invalid">
                            {errors.vehicle_year}
                        </Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group as={Col} lg={4} md={6} className="mb-3">
                        <Form.Label>VIN</Form.Label>
                        <Form.Control
                            name="vin"
                            value={formData.vin || ""}
                            onChange={handleChange}
                            isInvalid={!!errors.vin}
                            placeholder="1HGBH41JXMN109186"
                            maxLength="17"
                            disabled={!isFieldEditable('vin', formData.vin)}
                            readOnly={!isFieldEditable('vin', formData.vin)}
                        />
                        <Form.Control.Feedback type="invalid">
                            {errors.vin}
                        </Form.Control.Feedback>
                    </Form.Group>

                    {/* Comments */}
                    <Form.Group as={Col} lg={12} className="mb-3">
                        <Form.Label>Comments</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={3}
                            name="comments"
                            value={formData.comments || ""}
                            onChange={handleChange}
                            placeholder="Additional notes..."
                            disabled={!isFieldEditable('comments', formData.comments)}
                            readOnly={!isFieldEditable('comments', formData.comments)}
                        />
                    </Form.Group>

                    {/* Form Actions */}
                    <Col lg={12} className="text-center mt-0 mt-md-3">
                        <Button 
                            variant="custom" 
                            type="submit" 
                            disabled={isSubmitting}
                            className="me-2"
                        >
                            {isSubmitting ? "Saving..." : "Save Lead"}
                        </Button>
                        <Button 
                            variant="secondary" 
                            onClick={() => setEditLead(null)}
                            disabled={isSubmitting}
                        >
                            Cancel
                        </Button>
                    </Col>
                </Row>
            </Form>
        </div>
    );
}