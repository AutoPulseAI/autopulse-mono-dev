"use client";

import { useState, useEffect } from "react";
import { Row, Col, Button, Alert, Form, Card, InputGroup } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";

const SOCIAL_NETWORKS = [
  { key: "facebook", label: "Facebook", icon: "fa-brands fa-square-facebook" },
  { key: "instagram", label: "Instagram", icon: "fa-brands fa-square-instagram" },
  { key: "twitter", label: "Twitter / X", icon: "fa-brands fa-twitter" },
  { key: "linkedin", label: "LinkedIn", icon: "fa-brands fa-linkedin-in" },
  { key: "youtube", label: "YouTube", icon: "fa-brands fa-youtube" },
];

const emptySettings = {
  address: "",
  phone: "",
  email: "",
  social: { facebook: "", instagram: "", twitter: "", linkedin: "", youtube: "" },
};

export default function SiteSettingsPage() {
  const { fetchData } = useFetch();
  const [settings, setSettings] = useState(emptySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState({ show: false, message: "", variant: "success" });

  const showAlert = (message, variant = "success") => {
    setAlert({ show: true, message, variant });
    setTimeout(() => setAlert({ show: false, message: "", variant: "success" }), 5000);
  };

  useEffect(() => {
    fetchData("/api/site-settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.settings) {
          setSettings({ ...emptySettings, ...data.settings, social: { ...emptySettings.social, ...data.settings.social } });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetchData("/api/site-settings", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("save failed");
      showAlert("Site settings saved");
    } catch (error) {
      showAlert("Failed to save site settings", "danger");
    }
    setSaving(false);
  };

  return (
    <div className="page_content cms-page">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <h4 className="page_title mb-0">Site Settings</h4>
          </div>
        </div>
      </div>

      {alert.show && (
        <Alert variant={alert.variant} dismissible onClose={() => setAlert({ ...alert, show: false })}>
          {alert.message}
        </Alert>
      )}

      {!loading && (
        <Form onSubmit={handleSubmit}>
          <Row>
            <Col lg={6} className="mb-4">
              <Card className="h-100">
                <Card.Header>Contact Details (shown in footer)</Card.Header>
                <Card.Body>
                  <Form.Group className="mb-3">
                    <Form.Label>Address</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={2}
                      placeholder="Street, City, State, ZIP"
                      value={settings.address}
                      onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                    />
                  </Form.Group>
                  <Form.Group className="mb-3">
                    <Form.Label>Phone</Form.Label>
                    <Form.Control
                      type="tel"
                      placeholder="Phone number"
                      value={settings.phone}
                      onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                    />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label>Email</Form.Label>
                    <Form.Control
                      type="email"
                      placeholder="Contact email"
                      value={settings.email}
                      onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                    />
                  </Form.Group>
                </Card.Body>
              </Card>
            </Col>

            <Col lg={6} className="mb-4">
              <Card className="h-100">
                <Card.Header>Social Links (icons show only when a URL is set)</Card.Header>
                <Card.Body>
                  {SOCIAL_NETWORKS.map((network) => (
                    <Form.Group className="mb-3" key={network.key}>
                      <Form.Label>{network.label}</Form.Label>
                      <InputGroup>
                        <InputGroup.Text>
                          <i className={network.icon}></i>
                        </InputGroup.Text>
                        <Form.Control
                          type="url"
                          placeholder={`https://${network.key === "twitter" ? "x" : network.key}.com/yourpage`}
                          value={settings.social[network.key] || ""}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              social: { ...settings.social, [network.key]: e.target.value },
                            })
                          }
                        />
                      </InputGroup>
                    </Form.Group>
                  ))}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Button variant="custom" type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </Form>
      )}
    </div>
  );
}
