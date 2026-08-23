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
    console.log(setEditEmailAccount, editEmailAccount);
    const [showPassword, setShowPassword] = useState(false);

    // Predefined domain from user.dealer_account_information.sanitized_domain
    const domain = user?.dealer_account_information?.sanitized_domain || "example.com";

    useEffect(() => {
        if (editEmailAccount) {
            // If in Edit Mode, pre-fill the form with the selected account data
            // Remove the domain part from the email address
            const emailWithoutDomain = editEmailAccount?.email_address?.split("@")[0] ?? "";

            setFormData({ ...editEmailAccount, email_address: emailWithoutDomain });
        } else {
            // If in Add Mode, reset the form to default values
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
    }, [editEmailAccount]);

    const handleChange = (e) => {
        const { name, value } = e.target;

        // If the field is email_address, remove the domain part after @ and prevent @ symbol
        if (name === "email_address") {
            const sanitizedValue = value.split("@")[0]; // Remove everything after @
            setFormData({ ...formData, [name]: sanitizedValue });
        } else {
            setFormData({ ...formData, [name]: value });
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        console.log("Form submitted");
        // Combine user input with predefined domain for email_address
        const fullEmailAddress = `${formData.email_address}@${domain}`;

        // Determine the method and URL based on whether it's Add Mode or Edit Mode
        const isEditMode = !editEmailAccount; // Check if editEmailAccount exists
        const method = isEditMode ? "PUT" : "POST"; // Use PUT for Edit Mode, POST for Add Mode
        const url = "/api/email-accounts";

        try {
            const res = await fetchData(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...formData,
                    email_address: fullEmailAddress, // Use the combined email address
                    domain: domain,
                    dealer_id: user?.id,
                    id: editEmailAccount?._id, // Include the ID only in Edit Mode
                }),
            });

            if (res.ok) {
                fetchEmailAccounts();
                setEditEmailAccount(null); // Reset to Add Mode after submission
            } else {
                alert("Failed to save email account");
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
                                    required
                                />
                            </Form.Group>

                            {/* Event Type */}
                            <Form.Group controlId="event_type" as={Col} lg={6} md={6} className="mb-2">
                                <Form.Label>Event Type</Form.Label>
                                <Form.Control
                                    as="select"
                                    name="event_type"
                                    value={formData.event_type ?? ""}
                                    onChange={handleChange}
                                    required
                                >
                                    <option value="">Select an Event Type</option>
                                    <option value="User Registration">User Registration</option>
                                    <option value="Support Ticket">Support Ticket</option>
                                    <option value="Promotional">Promotional</option>
                                    <option value="Transactional">Transactional</option>
                                </Form.Control>
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
                                        required
                                        className="me-2"
                                        onKeyDown={(e) => {
                                            // Prevent the @ symbol from being entered
                                            if (e.key === "@") {
                                                e.preventDefault();
                                            }
                                        }}
                                    />
                                    <span>@{domain}</span>
                                </div>
                                <Form.Text className="text-muted">
                                    Full email address: {formData.email_address}@{domain}
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
                                        required
                                    />
                                    <Button
                                        variant="outline-secondary"
                                        onClick={() => setShowPassword(!showPassword)}
                                    >
                                        {showPassword ? <EyeSlash /> : <Eye />}
                                    </Button>
                                </InputGroup>
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
                                <Button variant="custom" type="submit" className="me-2">Save</Button>
                                <Button variant="secondary" type="button" onClick={() => setEditEmailAccount(null)}>Cancel</Button>
                            </div>
                        </Row>
                    </Form>
                </div>
            </Col>
        </Row>
    );
}