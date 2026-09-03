"use client";
import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Form, Button, Container, Row, Col, Alert, Spinner } from "react-bootstrap";

export default function BookingForm() {
    const { dealerId, leadId } = useParams();
    const [isLoading, setIsLoading] = useState(!!leadId);
    const [validated, setValidated] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState(null);
    const [formData, setFormData] = useState({
        dealer_id: dealerId || "",
        lead_id: leadId || "",
        customerName: "",
        email: "",
        phone: "",
        bookingDate: "",
        bookingTime: "",
        notes: "",
    });

    useEffect(() => {
        if (leadId) {
            const fetchLeadData = async () => {
                try {
                    const response = await fetch(`/api/booking?lead_id=${leadId}`);
                    if (!response.ok) throw new Error('Failed to fetch lead data');
                    const data = await response.json();
                    
                    if (data.customerName || data.email || data.phone) {
                        setFormData(prev => ({
                            ...prev,
                            customerName: data.customerName || "",
                            email: data.email || "",
                            phone: data.phone || ""
                        }));
                    }
                } catch (err) {
                    console.error("Error fetching lead data:", err);
                    setError(err.message);
                } finally {
                    setIsLoading(false);
                }
            };
            
            fetchLeadData();
        }
    }, [leadId]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setValidated(true);
        setError(null);

        if (form.checkValidity() === false) {
            e.stopPropagation();
            return;
        }

        try {
            setSubmitted(true);
            const response = await fetch("/api/booking", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Booking failed");

            setSubmitted(true);
            setFormData({
                dealer_id: dealerId || "",
                lead_id: leadId || "",
                customerName: "",
                email: "",
                phone: "",
                bookingDate: "",
                bookingTime: "",
                notes: "",
            });
            setValidated(false);
        } catch (err) {
            console.error("Error submitting booking:", err);
            setError(err.message || "Error creating booking. Please try again.");
            setSubmitted(false);
        }
    };

    if (isLoading) {
        return (
            <Container className="text-center py-5">
                <Spinner animation="border" role="status">
                    <span className="visually-hidden">Loading...</span>
                </Spinner>
            </Container>
        );
    }

    return (
        <section className="booking_section section_padding">
            <Container>
                <Row className="justify-content-center">
                    <Col lg="8">
                        <h2 className="mb-4">Book an Appointment</h2>

                        {submitted && (
                            <Alert variant="success" onClose={() => setSubmitted(false)} dismissible>
                                Booking created successfully! We'll confirm shortly.
                            </Alert>
                        )}
                        {error && (
                            <Alert variant="danger" onClose={() => setError(null)} dismissible>
                                {error}
                            </Alert>
                        )}

                        <Form noValidate validated={validated} onSubmit={handleSubmit}>
                            {/* Hidden IDs from URL */}
                            <Form.Control type="hidden" name="dealer_id" value={formData.dealer_id} />
                            <Form.Control type="hidden" name="lead_id" value={formData.lead_id} />

                            <Row className="g-3">
                                <Form.Group as={Col} md={6} controlId="customerName">
                                    <Form.Control
                                        required
                                        type="text"
                                        placeholder="Customer Name"
                                        name="customerName"
                                        value={formData.customerName}
                                        onChange={handleChange}
                                    />
                                    <Form.Control.Feedback type="invalid">
                                        Please enter customer name.
                                    </Form.Control.Feedback>
                                </Form.Group>

                                <Form.Group as={Col} md={6} controlId="email">
                                    <Form.Control
                                        required
                                        type="email"
                                        placeholder="Email address"
                                        name="email"
                                        value={formData.email}
                                        onChange={handleChange}
                                    />
                                    <Form.Control.Feedback type="invalid">
                                        Please provide a valid email address.
                                    </Form.Control.Feedback>
                                </Form.Group>

                                <Form.Group as={Col} md={6} controlId="phone">
                                    <Form.Control
                                        required
                                        type="tel"
                                        placeholder="Phone number"
                                        name="phone"
                                        value={formData.phone}
                                        onChange={handleChange}
                                    />
                                    <Form.Control.Feedback type="invalid">
                                        Please provide a valid phone number.
                                    </Form.Control.Feedback>
                                </Form.Group>

                                <Form.Group as={Col} md={3} controlId="bookingDate">
                                    <Form.Control
                                        required
                                        type="date"
                                        name="bookingDate"
                                        value={formData.bookingDate}
                                        onChange={handleChange}
                                    />
                                    <Form.Control.Feedback type="invalid">
                                        Please select a booking date.
                                    </Form.Control.Feedback>
                                </Form.Group>

                                <Form.Group as={Col} md={3} controlId="bookingTime">
                                    <Form.Control
                                        required
                                        type="time"
                                        name="bookingTime"
                                        value={formData.bookingTime}
                                        onChange={handleChange}
                                    />
                                    <Form.Control.Feedback type="invalid">
                                        Please select a booking time.
                                    </Form.Control.Feedback>
                                </Form.Group>

                               

                                <Col md={12}>
                                    <Button variant="frontfilled" type="submit" disabled={submitted}>
                                        {submitted ? "Booking..." : "Book Now"}
                                    </Button>
                                </Col>
                            </Row>
                        </Form>
                    </Col>
                </Row>
            </Container>
        </section>
    );
}