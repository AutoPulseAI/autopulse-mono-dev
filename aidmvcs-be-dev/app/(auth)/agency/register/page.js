"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { Col, Container, Row, Form, Button, Alert,Image } from "react-bootstrap";
import "../../auth.css";
import useFetch from "../../../hooks/useFetch";

export default function AgencyRegister() {
    const { fetchData, error: fetchError, loading } = useFetch();
    const [errors, setErrors] = useState({});
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [website, setWebsite] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const router = useRouter();
    const [showPassword, setShowPassword] = useState(false);
    const [passwordStrength, setPasswordStrength] = useState({
        score: 0,
        message: "",
        color: "text-danger"
    });

    const [acceptTerms, setAcceptTerms] = useState(true);

    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => setError(""), 3000);
            return () => clearTimeout(timer);
        }
        if (errors) {
            const timer = setTimeout(() => setErrors({}), 3000);
            return () => clearTimeout(timer);
        }
        if (success) {
            const timer = setTimeout(() => setSuccess(""), 3000);
            return () => clearTimeout(timer);
        }
    }, [error, errors, success]);

    const checkPasswordStrength = (pass) => {
        let score = 0;
        let messages = [];

        // Length check
        if (pass.length >= 8) score += 1;
        if (pass.length >= 12) score += 1;

        // Complexity checks
        if (/[A-Z]/.test(pass)) score += 1; // Uppercase
        if (/[a-z]/.test(pass)) score += 1; // Lowercase
        if (/[0-9]/.test(pass)) score += 1; // Numbers
        if (/[^A-Za-z0-9]/.test(pass)) score += 1; // Special chars

        // Determine strength message and color
        let message, color;
        if (score >= 5) {
            message = "Strong password";
            color = "text-success";
        } else if (score >= 3) {
            message = "Medium password";
            color = "text-warning";
        } else {
            message = "Weak password";
            color = "text-danger";
        }

        // Additional requirements messages
        if (pass.length < 8) messages.push("at least 8 characters");
        if (!/[A-Z]/.test(pass)) messages.push("one uppercase letter");
        if (!/[a-z]/.test(pass)) messages.push("one lowercase letter");
        if (!/[0-9]/.test(pass)) messages.push("one number");
        if (!/[^A-Za-z0-9]/.test(pass)) messages.push("one special character");

        return {
            score,
            message,
            color,
            requirements: messages.length > 0 ? `Missing: ${messages.join(", ")}` : "All requirements met"
        };
    };

    const handlePasswordChange = (e) => {
        const newPassword = e.target.value;
        setPassword(newPassword);
        setPasswordStrength(checkPasswordStrength(newPassword));
    };

    const validateForm = () => {
        let newErrors = {};
        let isValid = true;

        // Name validation (only alphabets and spaces)
        if (!name.trim()) {
            newErrors.name = "Agency Name is required.";
            isValid = false;
        } else if (!/^[a-zA-Z\s]+$/.test(name)) {
            newErrors.name = "Agency Name should only contain alphabetic characters and spaces.";
            isValid = false;
        } else if (name.trim().length < 2) {
            newErrors.name = "Agency Name should be at least 2 characters.";
            isValid = false;
        }

        // Email validation
        if (!email.trim()) {
            newErrors.email = "Email is required.";
            isValid = false;
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            newErrors.email = "Please enter a valid email address.";
            isValid = false;
        }

        // Phone validation
        if (!phone.trim()) {
            newErrors.phone = "Phone number is required.";
            isValid = false;
        } else if (!/^[0-9]{10,15}$/.test(phone)) {
            newErrors.phone = "Please enter a valid phone number (10-15 digits).";
            isValid = false;
        }

        // Website validation (optional)
        if (website.trim() && !/^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(website)) {
            newErrors.website = "Please enter a valid website URL.";
            isValid = false;
        }

        // Password validation
        if (!password.trim()) {
            newErrors.password = "Password is required.";
            isValid = false;
        } else if (password.length < 8) {
            newErrors.password = "Password must be at least 8 characters.";
            isValid = false;
        } else if (passwordStrength.score < 3) {
            newErrors.password = "Password is too weak. Please follow the requirements.";
            isValid = false;
        }

        // Confirm Password validation
        if (!confirmPassword.trim()) {
            newErrors.confirmPassword = "Confirm password is required.";
            isValid = false;
        } else if (password !== confirmPassword) {
            newErrors.confirmPassword = "Passwords do not match.";
            isValid = false;
        }

        // Terms validation
        if (!acceptTerms) {
            newErrors.acceptTerms = "You must accept the Terms & Conditions.";
            isValid = false;
        }

        setErrors(newErrors);
        return isValid;
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        setError("");
        setSuccess("");

        if (!validateForm()) return;

        const res = await fetchData("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                name, 
                email, 
                phone,
                website: website.trim() || null,
                password, 
                type: "vendor" 
            }),
        });

        const data = await res.json();
        if (res.ok) {
            setSuccess("Registration successful! Redirecting to login...");
            setTimeout(() => router.push("/agency"), 2000);
        } else {
            setError(data.message || "Registration failed.");
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

                                    <h1>Create an account</h1>
                                    <div className="front_oauth_form">
                                        {error && <Alert variant="danger">{error}</Alert>}
                                        {success && <Alert variant="success">{success}</Alert>}

                                        <Form onSubmit={handleRegister}>
                                            <Form.Group className="mb-3">
                                                <Form.Label htmlFor="regName">Agency Name</Form.Label>
                                                <Form.Control
                                                    id="regName"
                                                    type="text"
                                                    placeholder="Enter agency name"
                                                    value={name}
                                                    onChange={(e) => setName(e.target.value)}
                                                    isInvalid={!!errors.name}
                                                />
                                                <Form.Control.Feedback type="invalid">{errors.name}</Form.Control.Feedback>
                                            </Form.Group>

                                            <Form.Group className="mb-3">
                                                <Form.Label htmlFor="regEmail">Email Id</Form.Label>
                                                <Form.Control
                                                    id="regEmail"
                                                    type="email"
                                                    placeholder="Enter your email id"
                                                    value={email}
                                                    onChange={(e) => setEmail(e.target.value)}
                                                    isInvalid={!!errors.email}
                                                />
                                                <Form.Control.Feedback type="invalid">{errors.email}</Form.Control.Feedback>
                                            </Form.Group>

                                            <Form.Group className="mb-3">
                                                <Form.Label htmlFor="regPhone">Phone Number</Form.Label>
                                                <Form.Control
                                                    id="regPhone"
                                                    type="tel"
                                                    placeholder="Enter your phone number"
                                                    value={phone}
                                                    onChange={(e) => setPhone(e.target.value)}
                                                    isInvalid={!!errors.phone}
                                                />
                                                <Form.Control.Feedback type="invalid">{errors.phone}</Form.Control.Feedback>
                                            </Form.Group>

                                            <Form.Group className="mb-3">
                                                <Form.Label htmlFor="regWebsite">Website (Optional)</Form.Label>
                                                <Form.Control
                                                    id="regWebsite"
                                                    type="url"
                                                    placeholder="Enter your website URL"
                                                    value={website}
                                                    onChange={(e) => setWebsite(e.target.value)}
                                                    isInvalid={!!errors.website}
                                                />
                                                <Form.Control.Feedback type="invalid">{errors.website}</Form.Control.Feedback>
                                            </Form.Group>

                                            <Form.Group className="mb-3 position-relative">
                                                <Form.Label htmlFor="authPass">Password</Form.Label>
                                                <div className="position-relative">
                                                    <Form.Control
                                                        id="authPass"
                                                        type={showPassword ? "text" : "password"}
                                                        placeholder="Enter your password"
                                                        value={password}
                                                        onChange={handlePasswordChange}
                                                        isInvalid={!!errors.password}
                                                    />
                                                    <span
                                                        className="position-absolute end-0 translate-middle-y me-3 text-secondary"
                                                        style={{ cursor: "pointer", fontSize: "1rem", top: "22px" }}
                                                        onClick={() => setShowPassword(!showPassword)}
                                                    >
                                                        <i className={showPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye"}></i>
                                                    </span>
                                                    <Form.Control.Feedback type="invalid">{errors.password}</Form.Control.Feedback>
                                                </div>
                                                {password && (
                                                    <div className="mt-2">
                                                        <Form.Text className={`${passwordStrength.color}`}>
                                                            Strength: {passwordStrength.message}
                                                        </Form.Text>
                                                        <Form.Text muted>{passwordStrength.requirements}</Form.Text>
                                                        <div className="progress mt-1" style={{ height: "5px" }}>
                                                            <div
                                                                className={`progress-bar ${passwordStrength.color.replace("text", "bg")}`}
                                                                role="progressbar"
                                                                style={{ width: `${(passwordStrength.score / 6) * 100}%` }}
                                                            ></div>
                                                        </div>
                                                    </div>
                                                )}
                                                <Form.Text muted>
                                                    Password must be at least 8 characters with uppercase, lowercase, numbers, and special characters.
                                                </Form.Text>
                                            </Form.Group>

                                            <Form.Group className="mb-3">
                                                <Form.Label htmlFor="confirmPass">Confirm Password</Form.Label>
                                                <Form.Control
                                                    id="confirmPass"
                                                    type="password"
                                                    placeholder="Enter your confirm password"
                                                    value={confirmPassword}
                                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                                    isInvalid={!!errors.confirmPassword}
                                                />
                                                <Form.Control.Feedback type="invalid">{errors.confirmPassword}</Form.Control.Feedback>
                                            </Form.Group>

                                            <Form.Group className="mb-3">
                                                <Form.Check
                                                    type="checkbox"
                                                    id="termsCheck"
                                                    label={<>I accept the <a href="/terms-of-services" target="_blank" rel="noopener noreferrer">Terms of Service</a></>}
                                                    checked={acceptTerms}
                                                    onChange={(e) => setAcceptTerms(e.target.checked)}
                                                    isInvalid={!!errors.acceptTerms}
                                                />
                                                <Form.Control.Feedback type="invalid">{errors.acceptTerms}</Form.Control.Feedback>
                                            </Form.Group>

                                            <Button variant="frontfilled" type="submit" disabled={loading} className="w-100">
                                                {loading ? "Registering..." : "Register"}
                                            </Button>

                                            <p className="mt-3 text-center mb-0">
                                                Already have an account?{" "}
                                                <span
                                                    className="text_blue"
                                                    style={{ cursor: "pointer" }}
                                                    onClick={() => router.push(`/agency`)}
                                                >
                                                    Login here
                                                </span>
                                            </p>
                                        </Form>
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