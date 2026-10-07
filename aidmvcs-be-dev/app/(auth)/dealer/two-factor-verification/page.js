"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import "../../auth.css";
import useFetch from "../../../hooks/useFetch";
import { Form, Button, Alert, Container, Row, Col,Image } from "react-bootstrap";

export default function TwoFactorVerification() {
    const { fetchData, error: fetchError, loading } = useFetch();
    const [otp, setOtp] = useState(["", "", "", ""]);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const router = useRouter();

    const inputRefs = [useRef(null), useRef(null), useRef(null), useRef(null)];

    const handleChange = (element, index) => {
        const value = element.value.replace(/\D/, ""); // Allow only digits
        if (!value) return;

        const newOtp = [...otp];
        newOtp[index] = value;
        setOtp(newOtp);

        // Move focus to next input
        if (index < 3 && value) {
            inputRefs[index + 1].current.focus();
        }
    };

    const handleKeyDown = (e, index) => {
        if (e.key === "Backspace") {
            if (otp[index]) {
                const newOtp = [...otp];
                newOtp[index] = "";
                setOtp(newOtp);
            } else if (index > 0) {
                inputRefs[index - 1].current.focus();
                const newOtp = [...otp];
                newOtp[index - 1] = "";
                setOtp(newOtp);
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setMessage("");

        const finalOtp = otp.join("");

        if (finalOtp.length !== 4) {
            setError("Please enter a 4-digit code.");
            return;
        }

        const res = await fetchData("/api/auth/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ otp: finalOtp, type: "dealer" }),
        });

        const data = await res.json();
        if (res.ok) {
            setMessage("Verification successful.");
        } else {
            setError(data.message || "Something went wrong. Please try again.");
        }
    };

    return (
        <div className="front_oauth_main">
            <Container fluid className="p-0 overflow-hidden h-100">
                <Row className="g-0 align-items-center justify-content-center h-100 py-4" style={{ minHeight: '100vh' }}>
                    <Col xl={3} lg={4} sm={6} xs={12}>
                        {/* Back to home */}
                        {/* <Button variant="link" className="text-decoration-none text_blue mb-3" style={{ cursor: "pointer" }} onClick={() => router.push(`/`)}>
                            <i className="fa-regular fa-arrow-left me-2"></i>Back To Home
                        </Button> */}

                        <div className="front_oauth_content">
                            <div className="position-relative w-100">
                                <div className="front_oauth_logo">
                                    <Image
                                        src="/Images/logo-w.png"
                                        alt="Company Logo"
                                        width={157}
                                        height={68}
                                    />
                                </div>

                                <h1>Authenticate Your Account</h1>
                                <p>Please confirm your account by entering the verification code sent to <strong>abc*****</strong>.</p>
                                <div className="front_oauth_form">
                                    {message && <Alert variant="success">{message}</Alert>}
                                    {error && <Alert variant="danger">{error}</Alert>}

                                    <Form onSubmit={handleSubmit}>
                                        <Form.Group className="mb-3">
                                            <Form.Label>Verification Code (OTP)</Form.Label>
                                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                                                {otp.map((data, index) => (
                                                    <Form.Control
                                                        key={index}
                                                        type="text"
                                                        inputMode="numeric"
                                                        maxLength="1"
                                                        value={otp[index]}
                                                        onChange={(e) => handleChange(e.target, index)}
                                                        onKeyDown={(e) => handleKeyDown(e, index)}
                                                        ref={inputRefs[index]}
                                                        style={{ width: '50px', height: '50px', textAlign: 'center', fontSize: '1.5rem' }}
                                                        required
                                                    />
                                                ))}
                                            </div>
                                        </Form.Group>

                                        <Button variant="frontfilled" type="submit" disabled={loading} className="w-100">
                                            Verify Code
                                        </Button>
                                    </Form>

                                    {/* Redirect to Login */}
                                    <p className="mt-3 text-center mb-0">
                                        <span
                                            className="text_blue"
                                            style={{ cursor: "pointer" }}
                                            onClick={() => router.push(`/dealer`)}
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
    );
}
