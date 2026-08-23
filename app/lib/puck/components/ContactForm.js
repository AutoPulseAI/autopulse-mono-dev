"use client";

import { useState } from "react";
import { Form, Button, Col, Container, Row, Alert } from "react-bootstrap";
import parse from "html-react-parser";

function ContactFormInner({
  formTitle,
  formDescription,
  sidebarItems,
}) {
  const [validated, setValidated] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    message: "",
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    const form = e.currentTarget;
    e.preventDefault();
    setValidated(true);
    setError(null);

    if (form.checkValidity() === false) {
      e.stopPropagation();
      return;
    }

    try {
      const payload = { ...formData };
      if (!payload.phone?.trim()) delete payload.phone;

      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Submission failed");
      setSubmitted(true);
      setFormData({ firstName: "", lastName: "", email: "", phone: "", message: "" });
      setValidated(false);
    } catch (err) {
      setError(err.message || "There was an error submitting your form.");
    }
  };

  return (
    <section className="front_contact section_padding">
      <Container>
        <Row className="justify-content-center mb-4">
          <Col lg="8" data-aos="fade-up">
            <div className="contact_form mb-3">
              {formTitle && <h3 className="mb-2">{formTitle}</h3>}
              {formDescription && <p className="mb-4">{formDescription}</p>}

              {submitted && (
                <Alert variant="success" onClose={() => setSubmitted(false)} dismissible>
                  Thank you! We&apos;ll get back to you shortly.
                </Alert>
              )}
              {error && (
                <Alert variant="danger" onClose={() => setError(null)} dismissible>
                  {error}
                </Alert>
              )}

              <Form noValidate validated={validated} onSubmit={handleSubmit}>
                <Row className="g-3">
                  <Form.Group as={Col} md={6}>
                    <Form.Control required type="text" placeholder="First name" name="firstName" value={formData.firstName} onChange={handleChange} />
                    <Form.Control.Feedback type="invalid">Please enter your first name.</Form.Control.Feedback>
                  </Form.Group>
                  <Form.Group as={Col} md={6}>
                    <Form.Control required type="text" placeholder="Last name" name="lastName" value={formData.lastName} onChange={handleChange} />
                    <Form.Control.Feedback type="invalid">Please enter your last name.</Form.Control.Feedback>
                  </Form.Group>
                  <Form.Group as={Col} md={6}>
                    <Form.Control required type="email" placeholder="Email address" name="email" value={formData.email} onChange={handleChange} />
                    <Form.Control.Feedback type="invalid">Please provide a valid email.</Form.Control.Feedback>
                  </Form.Group>
                  <Form.Group as={Col} md={6}>
                    <Form.Control type="tel" placeholder="Phone number" name="phone" value={formData.phone} onChange={handleChange} />
                  </Form.Group>
                  <Form.Group as={Col} md={12}>
                    <Form.Control required as="textarea" rows={4} placeholder="How can we help?" name="message" value={formData.message} onChange={handleChange} minLength={10} />
                    <Form.Control.Feedback type="invalid">Please enter a message (min 10 characters).</Form.Control.Feedback>
                  </Form.Group>
                  <Col md={12}>
                    <p><small>By submitting this form, you agree to our <a href="/terms-of-services" target="_blank">Terms of Service</a>.</small></p>
                    <Button variant="frontfilled" type="submit" disabled={submitted}>
                      {submitted ? "Sending..." : "Send"}
                    </Button>
                  </Col>
                </Row>
              </Form>
            </div>
          </Col>
          {sidebarItems?.length > 0 && (
            <Col lg="4" data-aos="fade-up" data-aos-delay="100">
              <div className="contact_form contact_form_right">
                {sidebarItems.map((item, i) => (
                  <div key={i} className={`position-relative ${i < sidebarItems.length - 1 ? "mb-4" : ""}`}>
                    {item.icon && <i className={item.icon}></i>}
                    <h3 className="mb-2">{item.title}</h3>
                    <p className="mb-0">{parse(item.body || "")}</p>
                  </div>
                ))}
              </div>
            </Col>
          )}
        </Row>
      </Container>
    </section>
  );
}

export const ContactForm = {
  label: "Contact Form",
  fields: {
    formTitle: { type: "text", label: "Form title" },
    formDescription: { type: "textarea", label: "Form description" },
    sidebarItems: {
      type: "array",
      label: "Sidebar items",
      arrayFields: {
        icon: { type: "text", label: "Font Awesome class" },
        title: { type: "text" },
        body: { type: "textarea", label: "HTML body" },
      },
      defaultItemProps: {
        icon: "fa-regular fa-envelope",
        title: "Contact",
        body: "Email us at <a href='mailto:support@autopulse.ai'>support@autopulse.ai</a>",
      },
    },
  },
  defaultProps: {
    formTitle: "Connect with Us",
    formDescription: "Have a question? Drop your details below.",
    sidebarItems: [
      {
        icon: "fa-regular fa-messages-question",
        title: "Access Support",
        body: "Contact <a href='mailto:support@autopulse.ai'>support@autopulse.ai</a>",
      },
    ],
  },
  render: (props) => <ContactFormInner {...props} />,
};
