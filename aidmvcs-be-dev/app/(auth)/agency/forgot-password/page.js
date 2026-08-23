"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import "../../auth.css";

import { Form, Button, Alert, Container, Row, Col,Image } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";
export default function ForgotPassword() {
    const { fetchData, error: fetchError, loading } = useFetch();
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const router = useRouter();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setMessage("");

        const res = await fetchData("/api/auth/forgot-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, "type": "vendor" }),
        });

        const data = await res.json();
        if (res.ok) {
            setMessage("A password reset link has been sent to your email.");
        } else {
            setError(data.message || "Something went wrong. Please try again.");
        }
    };

    return (
        <>
            <div className="front_oauth_main">
                <Container fluid className="p-0 overflow-hidden h-100">
                    <Row className="g-0 align-items-center justify-content-center h-100 py-4" style={{ minHeight: '100vh' }}>
                        <Col xl={3} lg={4} sm={6} xs={12}>
                            {/* Back to home */}
                            <Button variant="link" className="text-decoration-none text_blue mb-3" style={{ cursor: "pointer" }} onClick={() => router.push(`/`)}><i className="fa-regular fa-arrow-left me-2"></i>Back To Home</Button>

                            <div className="front_oauth_content">
                                <div className="position-relative w-100">
                                    <div className="front_oauth_logo">
                                        <Image
                                            src="/Images/logo-w.png"
                                            alt="Company Logo"
                                            width={157}
                                            height={68}
                                            priority
                                        />
                                    </div>

                                    <h1>Forgot Password</h1>
                                    <div className="front_oauth_form">
                                        {message && <Alert variant="success">{message}</Alert>}
                                        {error && <Alert variant="danger">{error}</Alert>}
                                        <Form onSubmit={handleSubmit}>
                                            <Form.Group className="mb-3">
                                                <Form.Label>Email</Form.Label>
                                                <Form.Control
                                                    type="email"
                                                    value={email}
                                                    placeholder="Enter your email"
                                                    onChange={(e) => setEmail(e.target.value)}
                                                    required
                                                />
                                            </Form.Group>
                                            <Button variant="frontfilled" type="submit" disabled={loading} className="w-100">Send Reset Link</Button>
                                        </Form>

                                        {/* Redirect to Login */}
                                        <p className="mt-3 text-center mb-0">
                                            <span
                                                className="text_blue"
                                                style={{ cursor: "pointer" }}
                                                onClick={() => router.push(`/agency`)}
                                            >
                                                Back to Login
                                            </span>
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </Col>
                    </Row>
                </Container>
            </div>
        </>

    );
}
