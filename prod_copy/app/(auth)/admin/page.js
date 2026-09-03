"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import "../auth.css";
import { Col, Container, Row, Form, Button, Alert,Image } from "react-bootstrap";
import useFetch from "../../hooks/useFetch";

export default function AdminLogin() {
  const { fetchData, loading } = useFetch(); // Keep loading now that we're using it
  const [errors, setErrors] = useState({});
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(""), 3000);
      return () => clearTimeout(timer);
    }
    if (errors) {
      const timer = setTimeout(() => setErrors(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [error, errors]);

  const validateForm = () => {
    let newErrors = {};
    if (!email.trim()) newErrors.email = "Email is required.";
    if (!password.trim()) newErrors.password = "Password is required.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    if (!validateForm()) return;

    const res = await fetchData("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, type: 'admin' }),
    });

    const data = await res.json();
    if (res.ok) {
      localStorage.setItem("token", data.token);
      router.push("/admin/dashboard");
    } else {
      setError(data.message);
    }
  };

  return (
    <div className="front_oauth_main">
      <Container fluid className="p-0 overflow-hidden h-100">
        <Row className="g-0 align-items-center justify-content-center h-100 py-4" style={{ minHeight: '100vh' }}>
          <Col xl={3} lg={4} sm={6} xs={12}>
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
                <h1>Admin Log in</h1>
                <div className="front_oauth_form">
                  {error && <Alert variant="danger">{error}</Alert>}
                  <Form onSubmit={handleLogin}>
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

                    <Button variant="frontfilled" type="submit" disabled={loading} className="w-100">
                      {loading ? 'Logging in...' : 'Log in'}
                    </Button>
                  </Form>
                </div>
              </div>
            </div>
          </Col>
        </Row>
      </Container>
    </div>
  );
}