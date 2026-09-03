"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import "../auth.css";
import { Col, Container, Row, Form, Button, Alert,Image } from "react-bootstrap";
import useFetch from "../../hooks/useFetch";


export default function VendorLogin() {
  const [errors, setErrors] = useState({});
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState(1); // 1: email/password, 2: OTP verification
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [otpSentTo, setOtpSentTo] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const router = useRouter();
  const inputRefs = [useRef(null), useRef(null), useRef(null), useRef(null)];

  const { fetchData, error: fetchError, loading } = useFetch();

  useEffect(() => {
    // Check for existing tokens on component mount
    const vendorToken = getCookie('vendortoken');
    const vendorOtpToken = getCookie('vendorotptoken');

    if (vendorToken && vendorOtpToken) {
      // User has both tokens - redirect to dashboard
      router.push("/agency/dashboard");
    } else if (vendorToken) {
      // Has auth token but not OTP token - clear it to force fresh login
      document.cookie = 'vendortoken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    }
  }, []);

  // Helper function to get cookie value
  const getCookie = (name) => {
    if (typeof document === 'undefined') return null; // SSR check
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
  };

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(""), 5000);
      return () => clearTimeout(timer);
    }
    if (errors) {
      const timer = setTimeout(() => setErrors(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [error, errors]);

  const validateForm = () => {
    let newErrors = {};
    if (!email.trim()) newErrors.email = "Email is required.";
    if (step === 1 && !password.trim()) newErrors.password = "Password is required.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleOtpChange = (element, index) => {
    const value = element.value.replace(/\D/, "");
    if (!value) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (index < 3 && value) {
      inputRefs[index + 1].current.focus();
    }
  };

  const handleOtpKeyDown = (e, index) => {
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

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    if (!validateForm()) return;

    try {
      if (step === 1) {
        // First step: verify email/password and request OTP
        const res = await fetchData("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, type: "vendor" }),
        });

        const data = await res.json();

        if (data.token) {
          // If token is received directly (OTP not required)
          localStorage.setItem("vendortoken", data.token);
          setAuthCookies(data.token, rememberDevice);
          router.push("/agency/dashboard");
        } else if (data.otp_sent) {
          setOtpSentTo(email);
          setStep(2); // Move to OTP verification step
        } else {
          setError(data.message || "Login failed. Please try again.");
        }
      } else {
        // Second step: verify OTP
        const finalOtp = otp.join("");
        if (finalOtp.length !== 4) {
          setError("Please enter a 4-digit code.");
          return;
        }

        const res = await fetchData("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: otpSentTo,
            otp: finalOtp,
            type: "vendor"
          }),
        });

        const data = await res.json();
        if (data.token) {
          // Store token and set cookies
          localStorage.setItem("vendortoken", data.token);
          setAuthCookies(data.token, rememberDevice);
          router.push("/agency/dashboard");
        } else {
          setError(data.message || "Verification failed. Please try again.");
        }
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    }
  };

  const setAuthCookies = (token, remember) => {
    if (remember) {
      // Set cookies for 60 days if "Remember this device" is checked
      const sixtyDays = 60 * 24 * 60 * 60;
      document.cookie = `vendortoken=${token}; max-age=${sixtyDays}; path=/; secure; samesite=lax`;
      document.cookie = `vendorotptoken=${token}; max-age=${sixtyDays}; path=/; secure; samesite=lax`;
    } else {
      // Session-only cookies
      document.cookie = `vendortoken=${token}; path=/; secure; samesite=lax`;
    }
  };

  const handleBackToLogin = () => {
    setStep(1);
    setOtp(["", "", "", ""]);
    setError("");
  };

  return (
    <>
      <div className="front_oauth_main">
        <Container fluid className="p-0 overflow-hidden h-100">
          <Row className="g-0 align-items-center justify-content-center h-100 py-4" style={{ minHeight: '100vh' }}>
            <Col xl={3} lg={4} sm={6} xs={12}>
              <Button variant="link" className="text-decoration-none text_blue mb-3" style={{ cursor: "pointer" }} onClick={() => router.push(`/`)}>
                <i className="fa-regular fa-arrow-left me-2"></i>Back To Home
              </Button>

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

                  <h1>{step === 1 ? "Agency Log in" : "Verify Your Identity"}</h1>

                  {step === 2 && (
                    <p>Please confirm your account by entering the verification code sent to <strong>{otpSentTo}</strong>.</p>
                  )}

                  <div className="front_oauth_form">
                    {error && <Alert variant="danger">{error}</Alert>}
                    {fetchError && <Alert variant="danger">{fetchError}</Alert>}

                    <Form onSubmit={handleLogin}>
                      {step === 1 ? (
                        <>
                          <Form.Group className="mb-3">
                            <Form.Label htmlFor="authEmail">Email</Form.Label>
                            <Form.Control
                              id="authEmail"
                              type="email"
                              placeholder="Enter your email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              isInvalid={!!errors.email}
                            />
                            <Form.Control.Feedback type="invalid">{errors.email}</Form.Control.Feedback>
                          </Form.Group>

                          <Form.Group className="mb-3 position-relative">
                            <Form.Label htmlFor="authPass">Password</Form.Label>
                            <div className="position-relative">
                              <Form.Control
                                id="authPass"
                                type={showPassword ? "text" : "password"}
                                placeholder="Enter your password"
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
                              <Form.Control.Feedback type="invalid">{errors.password}</Form.Control.Feedback>
                            </div>
                          </Form.Group>

                          <Form.Group className="mb-3">
                            <Form.Check
                              type="checkbox"
                              label="Remember this device"
                              checked={rememberDevice}
                              onChange={(e) => setRememberDevice(e.target.checked)}
                            />
                          </Form.Group>
                        </>
                      ) : (
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
                                onChange={(e) => handleOtpChange(e.target, index)}
                                onKeyDown={(e) => handleOtpKeyDown(e, index)}
                                ref={inputRefs[index]}
                                style={{ width: '50px', height: '50px', textAlign: 'center', fontSize: '1.5rem' }}
                                required
                              />
                            ))}
                          </div>
                        </Form.Group>
                      )}

                      <Button variant="frontfilled" type="submit" disabled={loading} className="w-100">
                        {loading ? "Processing..." : step === 1 ? "Log in" : "Verify Code"}
                      </Button>
                    </Form>

                    {step === 2 && (
                      <p className="mt-3 text-center mb-0">
                        <span
                          className="text_blue"
                          style={{ cursor: "pointer" }}
                          onClick={handleBackToLogin}
                        >
                          Back to Login
                        </span>
                      </p>
                    )}

                    {step === 1 && (
                      <>
                        <p className="mt-3 text-center">
                          <span
                            className="text_blue"
                            style={{ cursor: "pointer" }}
                            onClick={() => router.push("agency/forgot-password")}
                          >
                            I forgot my password
                          </span>
                        </p>
                        <p className="mt-3 text-center mb-0">
                          Don't have an account?{" "}
                          <span
                            className="text_blue"
                            style={{ cursor: "pointer" }}
                            onClick={() => router.push("/agency/register")}
                          >
                            Register now
                          </span>
                        </p>
                      </>
                    )}
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