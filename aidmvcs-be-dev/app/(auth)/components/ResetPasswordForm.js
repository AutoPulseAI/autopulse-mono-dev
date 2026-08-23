"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Col, Container, Row, Form, Button, Alert, Spinner } from "react-bootstrap";
import "../auth.css";
import useFetch from "../../hooks/useFetch";
import Image from "next/image";

// Component that uses useSearchParams - needs to be wrapped in Suspense
function ResetPasswordFormContent() {
  const { fetchData, loading } = useFetch();
  const [errors, setErrors] = useState({});
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");


  useEffect(() => {
    const urlToken = searchParams.get("token");
    const urlEmail = searchParams.get("email");

    if (!urlToken || !urlEmail) {
      router.push("/agency/forgot-password");
    } else {
      setToken(urlToken);
      setEmail(decodeURIComponent(urlEmail));
    }
  }, [searchParams, router]);

  useEffect(() => {
    if (error || success || errors) {
      const timer = setTimeout(() => {
        setError("");
        setSuccess("");
        setErrors("");
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [error, success, errors]);

  const validateForm = () => {
    let newErrors = {};
    if (!password.trim()) newErrors.password = "Password is required.";
    if (password.length < 8) newErrors.password = "Password must be at least 8 characters.";
    if (password !== confirmPassword) newErrors.confirmPassword = "Passwords must match.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!validateForm()) return;

    const res = await fetchData("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, email, newPassword: password }),
    });

    const data = await res.json();
    if (res.ok) {
      setSuccess("Password reset successfully! Redirecting to login...");
      setTimeout(() => router.push("/"), 2000);
    } else {
      setError(data.message || "Failed to reset password");
    }
  };

  return (
    <>
      <div className="front_oauth_main">
        <Container fluid className="p-0 h-100">
          <Row className="g-0 align-items-center justify-content-center h-100 py-4" style={{ minHeight: '100vh' }}>
            <Col xl={3} lg={4} sm={6} xs={12}>
              {/* Back to home */}
              {/* <Button variant="link" className="text-decoration-none text_blue mb-3" style={{ cursor: "pointer" }} onClick={() => router.push(`/`)}><i className="fa-regular fa-arrow-left me-2"></i>Back To Home</Button> */}

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

                  <h1>Reset Password</h1>
                  <div className="front_oauth_form">
                    {error && <Alert variant="danger">{error}</Alert>}
                    {success && <Alert variant="success">{success}</Alert>}
                    <Form onSubmit={handleResetPassword}>
                      <Form.Group className="mb-3">
                        <Form.Label htmlFor="authEmail">Email</Form.Label>
                        <Form.Control
                          id="authEmail"
                          type="email"
                          value={email}
                          readOnly
                        />
                      </Form.Group>

                      <Form.Group className="mb-3 position-relative">
                        <Form.Label htmlFor="authPass">New Password</Form.Label>
                        <div className="position-relative">
                          <Form.Control
                            id="authPass"
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            isInvalid={!!errors.password}
                          />
                          <span
                            className="position-absolute end-0 translate-middle-y me-3 text-secondary"
                            style={{ cursor: "pointer", fontSize: "1rem", top: "22px" }}
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            <i className={showPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye"}></i>
                          </span>
                          <Form.Control.Feedback type="invalid">
                            {errors.password}
                          </Form.Control.Feedback>
                        </div>
                      </Form.Group>

                      <Form.Group className="mb-3">
                        <Form.Label htmlFor="authConfirmPass">Confirm Password</Form.Label>
                        <Form.Control
                          id="authConfirmPass"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          isInvalid={!!errors.confirmPassword}
                        />
                        <Form.Control.Feedback type="invalid">
                          {errors.confirmPassword}
                        </Form.Control.Feedback>
                      </Form.Group>

                      <Button
                        variant="custom"
                        type="submit"
                        disabled={loading}
                      >
                        {loading ? "Resetting..." : "Reset Password"}
                      </Button>
                    </Form>
                  </div>

                  <hr className="my-lg-4 my-3" />

                  <p className="mt-3 text-center">
                    Remember your password?{" "}
                    <span
                      className="text-custom"
                      style={{ cursor: "pointer" }}
                      onClick={() => router.push("/agency")}
                    >
                      Login here
                    </span>
                  </p>
                </div>
              </div>
            </Col>
          </Row>
        </Container>
      </div>
    </>
  );
}

// Main component with Suspense boundary
export default function ResetPasswordForm() {
  return (
    <Suspense fallback={
      <div className="front_oauth_main">
        <Container fluid className="p-0 h-100">
          <Row className="g-0 align-items-center justify-content-center h-100 py-4" style={{ minHeight: '100vh' }}>
            <Col xl={3} lg={4} sm={6} xs={12}>
              <div className="d-flex justify-content-center align-items-center" style={{ height: '300px' }}>
                <Spinner animation="border" variant="dark" />
                <span className="ms-3">Loading...</span>
              </div>
            </Col>
          </Row>
        </Container>
      </div>
    }>
      <ResetPasswordFormContent />
    </Suspense>
  );
}