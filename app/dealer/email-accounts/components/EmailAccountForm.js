"use client";
import { useState, useEffect } from "react";
import { Form, Button, InputGroup, Row, Col } from "react-bootstrap";
import { Eye, EyeSlash } from "react-bootstrap-icons";
import useFetch from "../../../hooks/useFetch";

export default function EmailAccountForm({ setEditEmailAccount, editEmailAccount, fetchEmailAccounts, user }) {
    const { fetchData, error: fetchError, loading } = useFetch();
    const [formData, setFormData] = useState({
        account_name: "",
        event_type: "",
        account_type: "",
        mail_account: "",
        email_address: "",
        pop3_server: "",
        email_login: "",
        email_password: "",
        reenter_password: "",
        admin_email: "",
        active: true,
    });
    
    const [errors, setErrors] = useState({});
    const [showPassword, setShowPassword] = useState(false);

    // Predefined domain from user.dealer_account_information.sanitized_domain
    const domain = user?.dealer_account_information?.sanitized_domain || "example.com";

    useEffect(() => {
        if (editEmailAccount) {
            const emailWithoutDomain = editEmailAccount?.email_address?.split("@")[0] ?? "";
            setFormData({ ...editEmailAccount, email_address: emailWithoutDomain });
        } else {
            setFormData({
                account_name: "",
                event_type: "",
                account_type: "",
                mail_account: "",
                email_address: "",
                pop3_server: "",
                email_login: "",
                email_password: "",
                reenter_password: "",
                admin_email: "",
                active: true,
            });
        }
        setErrors({});
    }, [editEmailAccount]);

    const validateForm = () => {
        const newErrors = {};
        
        // Account Name validation
        if (!formData.account_name.trim()) {
            newErrors.account_name = "Account name is required";
        } else if (formData.account_name.length > 50) {
            newErrors.account_name = "Account name must be less than 50 characters";
        }

        // Event Type validation
        if (!formData.event_type) {
            newErrors.event_type = "Event type is required";
        }

        // Email Address validation
        if (!formData.email_address.trim()) {
            newErrors.email_address = "Email prefix is required";
        } else if (!/^[a-zA-Z0-9._-]+$/.test(formData.email_address)) {
            newErrors.email_address = "Only letters, numbers, dots, hyphens and underscores allowed";
        } else if (formData.email_address.length > 64) {
            newErrors.email_address = "Email prefix must be less than 64 characters";
        }

        // Password validation
        if (!formData.email_password) {
            newErrors.email_password = "Password is required";
        } else if (formData.email_password.length < 8) {
            newErrors.email_password = "Password must be at least 8 characters";
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        
        // Clear error when user starts typing
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: null }));
        }

        if (name === "email_address") {
            const sanitizedValue = value.split("@")[0];
            setFormData({ ...formData, [name]: sanitizedValue });
        } else {
            setFormData({ ...formData, [name]: value });
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!validateForm()) {
            return;
        }

        const fullEmailAddress = `${formData.email_address}@${domain}`;
        const isEditMode = !!editEmailAccount?._id;
        const method = isEditMode ? "PUT" : "POST";
        const url = "/api/email-accounts";

        try {
            const res = await fetchData(url, {
                method,
                headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('dealertoken')}` },
                body: JSON.stringify({
                    ...formData,
                    email_address: fullEmailAddress,
                    domain: domain,
                    dealer_id: user?.id,
                    id: editEmailAccount?._id,
                }),
            });

            if (res.ok) {
                fetchEmailAccounts();
                setEditEmailAccount(null);
            } else {
                const errorData = await res.json();
                alert(errorData.message || "Failed to save email account");
            }
        } catch (err) {
            alert(`Error: ${err.message}`);
        }
    };

    return (
        <Row className="justify-content-center">
            <Col lg={10}>
                <div className="w_card">
                    <h3 className="w_card_title">{editEmailAccount ? "Edit Email Account" : "Add New Email Account"}</h3>
                    <Form onSubmit={handleSubmit}>
                        {/* Account Name */}
                        <Row>
                            <Form.Group controlId="account_name" as={Col} lg={6} md={6} className="mb-2">
                                <Form.Label>Account Name</Form.Label>
                                <Form.Control
                                    type="text"
                                    name="account_name"
                                    value={formData.account_name ?? ""}
                                    onChange={handleChange}
                                    isInvalid={!!errors.account_name}
                                />
                                <Form.Control.Feedback type="invalid">
                                    {errors.account_name}
                                </Form.Control.Feedback>
                                <Form.Text className="text-muted">
                                    A descriptive name for this email account
                                </Form.Text>
                            </Form.Group>

                            {/* Event Type */}
                            <Form.Group controlId="event_type" as={Col} lg={6} md={6} className="mb-2">
                                <Form.Label>Event Type</Form.Label>
                                <Form.Control
                                    as="select"
                                    name="event_type"
                                    value={formData.event_type ?? ""}
                                    onChange={handleChange}
                                    isInvalid={!!errors.event_type}
                                >
                                    <option value="">Select an Event Type</option>
                                    <option value="User Registration">User Registration</option>
                                    <option value="Support Ticket">Support Ticket</option>
                                    <option value="Promotional">Promotional</option>
                                    <option value="Transactional">Transactional</option>
                                </Form.Control>
                                <Form.Control.Feedback type="invalid">
                                    {errors.event_type}
                                </Form.Control.Feedback>
                            </Form.Group>

                            {/* Email Address */}
                            <Form.Group controlId="email_address" as={Col} lg={7} md={6} className="mb-2">
                                <Form.Label>Email Address</Form.Label>
                                <div className="d-flex align-items-center">
                                    <Form.Control
                                        type="text"
                                        name="email_address"
                                        value={formData.email_address ?? ""}
                                        onChange={handleChange}
                                        isInvalid={!!errors.email_address}
                                        className="me-2"
                                        onKeyDown={(e) => {
                                            if (e.key === "@") {
                                                e.preventDefault();
                                            }
                                        }}
                                    />
                                    <span>@{domain}</span>
                                </div>
                                <Form.Control.Feedback type="invalid">
                                    {errors.email_address}
                                </Form.Control.Feedback>
                                <Form.Text className="text-muted">
                                    Full email address: {formData.email_address || 'prefix'}@{domain}
                                </Form.Text>
                            </Form.Group>

                            {/* Email Password with Show/Hide Toggle */}
                            <Form.Group controlId="email_password" as={Col} lg={6} md={6} className="mb-2">
                                <Form.Label>Email Password</Form.Label>
                                <InputGroup>
                                    <Form.Control
                                        type={showPassword ? "text" : "password"}
                                        name="email_password"
                                        value={formData.email_password ?? ""}
                                        onChange={handleChange}
                                        isInvalid={!!errors.email_password}
                                    />
                                    <Button
                                        variant="outline-secondary"
                                        onClick={() => setShowPassword(!showPassword)}
                                    >
                                        {showPassword ? <EyeSlash /> : <Eye />}
                                    </Button>
                                </InputGroup>
                                <Form.Control.Feedback type="invalid">
                                    {errors.email_password}
                                </Form.Control.Feedback>
                                <Form.Text className="text-muted">
                                    Password must be at least 8 characters long
                                </Form.Text>
                            </Form.Group>

                            {/* Active Status */}
                            <Form.Group controlId="active" as={Col} lg={6} md={6} className="mb-2">
                                <Form.Label>Active</Form.Label>
                                <Form.Control
                                    as="select"
                                    name="active"
                                    value={formData.active ?? ""}
                                    onChange={handleChange}
                                >
                                    <option value="true">Yes</option>
                                    <option value="false">No</option>
                                </Form.Control>
                            </Form.Group>

                            <div className="text-center mt-3" as={Col}>
                                <Button variant="custom" type="submit" className="me-2" disabled={loading}>
                                    {loading ? 'Saving...' : 'Save'}
                                </Button>
                                <Button variant="secondary" type="button" onClick={() => setEditEmailAccount(null)}>
                                    Cancel
                                </Button>
                            </div>
                        </Row>
                    </Form>
                </div>
            </Col>
        </Row>
    );
}