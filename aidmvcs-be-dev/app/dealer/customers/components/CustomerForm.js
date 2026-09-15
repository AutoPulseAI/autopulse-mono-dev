"use client";
import { useState } from "react";
import { Form, Button, Row, Col, Alert, Badge } from "react-bootstrap";
import { useUser } from "../../context/UserContext";

export default function CustomerForm({ setEditCustomer, editCustomer }) {
    const { dealerParent } = useUser();
    const isEditMode = !!editCustomer?._id;

    const [formData, setFormData] = useState({
        name: editCustomer?.name || "",
        email: "",
        phone: "",
        followup_preference: editCustomer?.followup_preference || "email",
        preferred_communication_mode: editCustomer?.preferred_communication_mode || "",
        user_language: editCustomer?.user_language || "",
    });

    const [errors, setErrors] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const validateField = (name, value) => {
        const stringValue = value ? value.toString().trim() : "";
        switch (name) {
            case "name":
                // Letters (incl. accented), spaces, apostrophes, hyphens and
                // periods - covers names like O'Connor, Smith-Jones, José, Jr.
                if (stringValue && !/^[\p{L}\p{M}\s'.-]+$/u.test(stringValue))
                    return "Only letters, spaces, apostrophes and hyphens allowed";
                return "";
            case "email":
                if (stringValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stringValue))
                    return "Invalid email format";
                return "";
            case "phone":
                if (stringValue && !/^\d+$/.test(stringValue.replace(/\D/g, '')))
                    return "Invalid phone format";
                return "";
            default:
                return "";
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: "" }));
        }
    };

    const validateForm = () => {
        const newErrors = {
            name: validateField("name", formData.name),
            email: isEditMode ? "" : validateField("email", formData.email),
            phone: isEditMode ? "" : validateField("phone", formData.phone),
        };

        if (!formData.name?.trim()) {
            newErrors.name = "Name is required";
        }

        if (!isEditMode) {
            if (formData.phone?.trim()) {
                const digitsOnly = formData.phone.replace(/\D/g, '');
                if (digitsOnly.length < 10) {
                    newErrors.phone = "Phone number must have at least 10 digits";
                }
            }
            if (!formData.email?.trim() && !formData.phone?.trim()) {
                newErrors.form = "Provide at least an email or a phone number";
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
            const customerId = editCustomer?._id;
            const url = customerId ? `/api/customers/${customerId}` : "/api/customers";
            const body = customerId
                ? {
                    dealer_id: dealerParent.id,
                    name: formData.name,
                    followup_preference: formData.followup_preference,
                    preferred_communication_mode: formData.preferred_communication_mode,
                    user_language: formData.user_language,
                }
                : { ...formData, dealer_id: dealerParent.id };

            const response = await fetch(url, {
                method: customerId ? "PUT" : "POST",
                headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('dealertoken')}` },
                body: JSON.stringify(body)
            });

            if (!response.ok) throw new Error(await response.text());
            setEditCustomer(null);
        } catch (err) {
            setErrors(prev => ({ ...prev, form: err.message || "Submission failed" }));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="w_card">
            <h3 className="w_card_title">{isEditMode ? "Edit Customer" : "Add New Customer"}</h3>

            {errors.form && (
                <Alert variant="danger" dismissible onClose={() => setErrors(prev => ({ ...prev, form: "" }))}>
                    {errors.form}
                </Alert>
            )}

            <Form onSubmit={handleSubmit}>
                <Row>
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

                    {isEditMode ? (
                        <>
                            <Col lg={8} md={6} className="mb-3">
                                <Form.Label>Emails</Form.Label>
                                {editCustomer.emails?.length ? (
                                    <ul className="list-unstyled mb-0 mt-1">
                                        {editCustomer.emails.map((entry) => (
                                            <li key={entry.value}>
                                                {entry.value}
                                                {entry.is_primary && <Badge bg="custom" className="ms-2">Primary</Badge>}
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className="text-muted">No emails on file</div>
                                )}
                                <Form.Label className="mt-2">Phones</Form.Label>
                                {editCustomer.phones?.length ? (
                                    <ul className="list-unstyled mb-0 mt-1">
                                        {editCustomer.phones.map((entry) => (
                                            <li key={entry.value}>
                                                {entry.value}
                                                {entry.is_primary && <Badge bg="custom" className="ms-2">Primary</Badge>}
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className="text-muted">No phones on file</div>
                                )}
                                <div className="text-muted small">
                                    Email and phone can&apos;t be edited here because leads are linked to them.
                                </div>
                            </Col>
                        </>
                    ) : (
                        <>
                            <Form.Group as={Col} lg={4} md={6} className="mb-3">
                                <Form.Label>Email</Form.Label>
                                <Form.Control
                                    type="email"
                                    name="email"
                                    value={formData.email || ""}
                                    onChange={handleChange}
                                    isInvalid={!!errors.email}
                                    placeholder="john@example.com"
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
                                />
                                <Form.Control.Feedback type="invalid">
                                    {errors.phone}
                                </Form.Control.Feedback>
                            </Form.Group>
                        </>
                    )}

                    <Form.Group as={Col} lg={4} md={6} className="mb-3">
                        <Form.Label>Follow-up Preference</Form.Label>
                        <Form.Select
                            name="followup_preference"
                            value={formData.followup_preference}
                            onChange={handleChange}
                        >
                            <option value="email">Email</option>
                            <option value="sms">Sms</option>
                        </Form.Select>
                    </Form.Group>

                    <Form.Group as={Col} lg={4} md={6} className="mb-3">
                        <Form.Label>Preferred Contact Mode</Form.Label>
                        <Form.Control
                            name="preferred_communication_mode"
                            value={formData.preferred_communication_mode || ""}
                            onChange={handleChange}
                            placeholder="email / sms"
                        />
                    </Form.Group>

                    <Form.Group as={Col} lg={4} md={6} className="mb-3">
                        <Form.Label>Language</Form.Label>
                        <Form.Control
                            name="user_language"
                            value={formData.user_language || ""}
                            onChange={handleChange}
                            placeholder="english"
                        />
                    </Form.Group>

                    <Col lg={12} className="text-center mt-0 mt-md-3">
                        <Button
                            variant="custom"
                            type="submit"
                            disabled={isSubmitting}
                            className="me-2"
                        >
                            {isSubmitting ? "Saving..." : "Save Customer"}
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => setEditCustomer(null)}
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
