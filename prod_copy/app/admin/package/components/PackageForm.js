// app/components/PackageForm.jsx
"use client";
import { useState, useEffect } from "react";
import { Form, Button, Alert, Row, Col, Tabs, Tab } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";

export default function PackageForm({ fetchPackages, setEditPackage, editPackage, handleClose }) {
  const { fetchData, error: fetchError, loading } = useFetch();
  const [message, setMessage] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [errors, setErrors] = useState({});
  const [features, setFeatures] = useState([]);
  const [newFeature, setNewFeature] = useState("");
  const [activeTab, setActiveTab] = useState("general");

  // Form fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");

  const [maxDealers, setMaxDealers] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [forUserType, setForUserType] = useState("vendor");
  const [isActive, setIsActive] = useState(true);

  // New pricing fields
  const [pricingModel, setPricingModel] = useState("flat");
  const [baseFee, setBaseFee] = useState(0);
  const [pricePerDealer, setPricePerDealer] = useState(0);
  const [minDealers, setMinDealers] = useState(1);
  const [billingInterval, setBillingInterval] = useState("month");
  const [hide, setHide] = useState(false);

  useEffect(() => {
    if (editPackage) {
      setName(editPackage.name || "");
      setDescription(editPackage.description || "");
      setPrice(editPackage.price || "");

      setMaxDealers(editPackage.max_dealers || 0);
      setDiscount(editPackage.discount || 0);
      setForUserType(editPackage.for_user_type || "vendor");
      setFeatures(editPackage.features || []);
      setIsActive(editPackage.is_active !== undefined ? editPackage.is_active : true);

      // Set new pricing fields
      setPricingModel(editPackage.pricing_model || "flat");
      setBaseFee(editPackage.base_fee || 0);
      setPricePerDealer(editPackage.price_per_dealer || 0);
      setMinDealers(editPackage.min_dealers || 1);
      setBillingInterval(editPackage.billing_interval || "month");
      setHide(!!editPackage.hide);
    }
  }, [editPackage]);

  const validateForm = () => {
    let newErrors = {};
    if (!name.trim()) newErrors.name = "Package name is required";
    if (!description.trim()) newErrors.description = "Description is required";

    if (pricingModel === "flat") {
      if (!price || isNaN(price)) newErrors.price = "Valid price is required";
    } else {
      if (!baseFee || isNaN(baseFee)) newErrors.baseFee = "Valid base fee is required";
      if (!pricePerDealer || isNaN(pricePerDealer)) newErrors.pricePerDealer = "Valid price per dealer is required";
    }


    if (forUserType === "vendor" && (!maxDealers || isNaN(maxDealers))) {
      newErrors.maxDealers = "Max dealers is required for agency packages";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  const handleAddFeature = () => {
    if (newFeature.trim() && !features.includes(newFeature.trim())) {
      setFeatures([...features, newFeature.trim()]);
      setNewFeature("");
    }
  };
  const handleRemoveFeature = (index) => {
    const updatedFeatures = [...features];
    updatedFeatures.splice(index, 1);
    setFeatures(updatedFeatures);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSuccess(false);

    if (!validateForm()) return;

    const payload = {
      name,
      description,
      price: pricingModel === "flat" ? parseFloat(price) : undefined,

      max_dealers: parseInt(maxDealers),
      discount: parseFloat(discount),
      features,
      for_user_type: forUserType,
      is_active: isActive,
      hide,
      // New pricing fields
      pricing_model: pricingModel,
      base_fee: parseFloat(baseFee),
      price_per_dealer: parseFloat(pricePerDealer),
      min_dealers: parseInt(minDealers),
      billing_interval: billingInterval
    };

    const method = editPackage ? "PUT" : "POST";
    const url = editPackage ? `/api/packages/${editPackage._id}` : "/api/packages";

    const res = await fetchData(url, {
      method,
      headers: { "Content-Type": "application/json" ,'Authorization': `Bearer ${localStorage.getItem('token')}`},
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (res.ok) {
      setMessage(editPackage ? "Package updated successfully!" : "Package created successfully!");
      setIsSuccess(true);
      fetchPackages();
      if (!editPackage) {
        resetForm();
      }
    } else {
      setMessage(data.message || "Error saving package");
      setIsSuccess(false);
    }
  };

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage("");
        if (isSuccess) {
          handleClose();
        }
      }, 2500);

      return () => clearTimeout(timer);
    }
  }, [message, isSuccess]);

  const resetForm = () => {
    setEditPackage(null);
    setName("");
    setDescription("");
    setPrice("");
    // setDuration(30);
    setMaxDealers(0);
    setDiscount(0);
    setFeatures([]);
    setForUserType("vendor");
    setIsActive(true);
    setErrors({});
    // Reset pricing fields
    setPricingModel("flat");
    setBaseFee(0);
    setPricePerDealer(0);
    setMinDealers(1);
    setBillingInterval("month");
    setHide(false);
  };

  const renderPricingFields = () => {
    if (forUserType !== "vendor") {
      return (
        <Form.Group className="mb-3">
          <Form.Label>Price ($)</Form.Label>
          <Form.Control
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            isInvalid={!!errors.price}
            disabled={!!editPackage}
          />
          <Form.Control.Feedback type="invalid">{errors.price}</Form.Control.Feedback>
        </Form.Group>
      );
    }

    return (
      <>
        <Form.Group className="mb-3">
          <Form.Label>Pricing Model</Form.Label>
          <Form.Select
            value={pricingModel}
            onChange={(e) => setPricingModel(e.target.value)}
            disabled={!!editPackage}
          >
            <option value="flat">Flat Rate</option>
            <option value="per_dealer">Per-Dealer Pricing</option>
          </Form.Select>
        </Form.Group>

        {pricingModel === "flat" ? (
          <Form.Group className="mb-3">
            <Form.Label>Price ($)</Form.Label>
            <Form.Control
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              isInvalid={!!errors.price}
              disabled={!!editPackage}
            />
            <Form.Control.Feedback type="invalid">{errors.price}</Form.Control.Feedback>
          </Form.Group>
        ) : (
          <>
            <Row className="gx-2">
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Base Fee ($)</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    min="0"
                    value={baseFee}
                    onChange={(e) => setBaseFee(e.target.value)}
                    isInvalid={!!errors.baseFee}
                  disabled={!!editPackage}
                  />
                  <Form.Control.Feedback type="invalid">{errors.baseFee}</Form.Control.Feedback>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Price Per Dealer ($)</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    min="0"
                    value={pricePerDealer}
                    onChange={(e) => setPricePerDealer(e.target.value)}
                    isInvalid={!!errors.pricePerDealer}
                  disabled={!!editPackage}
                  />
                  <Form.Control.Feedback type="invalid">{errors.pricePerDealer}</Form.Control.Feedback>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Minimum Dealers</Form.Label>
                  <Form.Control
                    type="number"
                    min="1"
                    value={minDealers}
                    onChange={(e) => setMinDealers(e.target.value)}
                  disabled={!!editPackage}
                  />
                </Form.Group>
              </Col>
            </Row>
          </>
        )}
      </>
    );
  };

  return (
    <>
      {message && (
        <Alert variant={isSuccess ? "success" : "danger"}>{message}</Alert>
      )}

      {/* {message && <Alert variant={message.includes("successfully") ? "success" : "danger"}>{message}</Alert>} */}

      <div className="w_card">
        <Tabs
          activeKey={activeTab}
          onSelect={(k) => setActiveTab(k)}
          className="mb-3"
        >
          <Tab eventKey="general" title="General">
            <Form onSubmit={handleSubmit}>
              <Row>
                <Col md={12}>
                  <Form.Group className="mb-3">
                    <Form.Label>Package Name</Form.Label>
                    <Form.Control
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      isInvalid={!!errors.name}
                    />
                    <Form.Control.Feedback type="invalid">{errors.name}</Form.Control.Feedback>
                  </Form.Group>
                </Col>
                <Col md={12}>
                  <Form.Group className="mb-3">
                    <Form.Label>For User Type</Form.Label>
                    <Form.Select
                      value={forUserType}
                      onChange={(e) => setForUserType(e.target.value)}
                    >
                      <option value="vendor">Agency</option>
                      <option value="dealer">Dealer</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>

              <Form.Group className="mb-3">
                <Form.Label>Description</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  isInvalid={!!errors.description}
                />
                <Form.Control.Feedback type="invalid">{errors.description}</Form.Control.Feedback>
              </Form.Group>

              {renderPricingFields()}

              <Form.Group className="mb-3">
                <Form.Check
                  type="switch"
                  id="show-in-front-switch"
                  label="Show in front"
                  checked={!hide}
                  onChange={(e) => setHide(!e.target.checked)}
                />
              </Form.Group>

              <Row className="gx-2">
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Billing Interval</Form.Label>
                    <Form.Select
                      value={billingInterval}
                      onChange={(e) => setBillingInterval(e.target.value)}
                      disabled={editPackage} // Prevent changing after creation
                    >
                      <option value="month">Monthly</option>
                      <option value="year">Yearly</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Discount (%)</Form.Label>
                    <Form.Control
                      type="number"
                      min="0"
                      max="100"
                      value={discount}
                      onChange={(e) => setDiscount(e.target.value)}
                    />
                  </Form.Group>
                </Col>
              </Row>

              {forUserType === "vendor" && (
                <Form.Group className="mb-3">
                  <Form.Label>Max Dealers Allowed</Form.Label>
                  <Form.Control
                    type="number"
                    min="0"
                    value={maxDealers}
                    onChange={(e) => setMaxDealers(e.target.value)}
                    isInvalid={!!errors.maxDealers}
                  />
                  <Form.Control.Feedback type="invalid">{errors.maxDealers}</Form.Control.Feedback>
                </Form.Group>
              )}
            </Form>
          </Tab>

          <Tab eventKey="features" title="Features">
            <Form onSubmit={handleSubmit}>
              <Form.Group className="mb-3">
                <Form.Label>Features</Form.Label>
                <div className="d-flex mb-2">
                  <Form.Control
                    type="text"
                    value={newFeature}
                    onChange={(e) => setNewFeature(e.target.value)}
                    placeholder="Add feature"
                  />
                  <Button
                    variant="custom"
                    className="ms-2"
                    onClick={handleAddFeature}
                    disabled={!newFeature.trim()}
                  >
                    <i className="fa-solid fa-plus"></i>
                  </Button>
                </div>
                {features.length > 0 && (
                  <div className="border p-2 rounded">
                    {features.map((feature, index) => (
                      <div key={index} className="d-flex justify-content-between align-items-center mb-1">
                        <span>{feature}</span>
                        <Button
                          variant="danger"
                          size="xs"
                          onClick={() => handleRemoveFeature(index)}
                        >
                          <i className="fa-solid fa-times"></i>
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Check
                  type="switch"
                  id="active-switch"
                  label="Active Package"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
              </Form.Group>

              <div className="d-flex gap-2">
                <Button variant="custom" type="submit" disabled={loading}>
                  {editPackage ? "Update Package" : "Create Package"}
                </Button>
              </div>
            </Form>
          </Tab>
        </Tabs>
      </div>
    </>
  );
}