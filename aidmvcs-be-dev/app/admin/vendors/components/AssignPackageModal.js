// app/components/AssignPackageModal.jsx
"use client";
import { useState, useEffect } from "react";
import { Modal, Button, Form, Alert, Row, Col, InputGroup } from "react-bootstrap";

export default function AssignPackageModal({ show, handleClose, vendor, packages, onAssignSuccess }) {
  const [selectedPackage, setSelectedPackage] = useState("");
  const [dealerCount, setDealerCount] = useState(1);
  const [calculatedPrice, setCalculatedPrice] = useState(0);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // Reset form when modal closes
  useEffect(() => {
    if (!show) {
      setSelectedPackage("");
      setDealerCount(1);
      setCalculatedPrice(0);
      setMessage("");
    }
  }, [show]);

  // Calculate price when package or dealer count changes
  useEffect(() => {
    if (selectedPackage) {
      const pkg = packages.find(p => p._id === selectedPackage);
      if (pkg) {
        if (pkg.pricing_model === "per_dealer") {
          const count = Math.max(dealerCount, pkg.min_dealers);
          const price = pkg.base_fee + (pkg.price_per_dealer * count);
          setCalculatedPrice(price);
        } else {
          setCalculatedPrice(pkg.price);
        }
      }
    }
  }, [selectedPackage, dealerCount, packages]);

  const handleAssign = async () => {
    if (!selectedPackage) {
      setMessage("Please select a package");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/subscriptions/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}`},
        body: JSON.stringify({
          user_id: vendor._id,
          package_id: selectedPackage,
          dealer_count: dealerCount
        })
      });

      const data = await res.json();

      if (res.ok) {
        setMessage("Package assigned successfully!");
        setTimeout(() => {
          handleClose();
          onAssignSuccess();
        }, 1500);
      } else {
        setMessage(data.message || "Error assigning package");
      }
    } catch (error) {
      setMessage("Error assigning package");
    } finally {
      setLoading(false);
    }
  };

  const getSelectedPackage = () => {
    return packages.find(p => p._id === selectedPackage);
  };

  const handleDealerCountChange = (value) => {
    const isManualSubscription = getSelectedPackage()?.pricing_model === "manual";
    if (isManualSubscription) return;

    const min = getSelectedPackage()?.min_dealers || 1;
    const max = getSelectedPackage()?.max_dealers || Infinity;

    const numValue = parseInt(value) || min;
    const newCount = Math.max(min, Math.min(numValue, max));

    setDealerCount(newCount);
  };


  return (
    <Modal show={show} onHide={handleClose} centered size="md">
      <Modal.Header closeButton>
        <Modal.Title>Assign Package to {vendor?.name}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {message && <Alert variant={message.includes("success") ? "success" : "danger"}>{message}</Alert>}

        <Form.Group>
          <Form.Label>Select Package</Form.Label>
          <Form.Select
            value={selectedPackage}
            onChange={(e) => setSelectedPackage(e.target.value)}
            disabled={loading}
          >
            <option value="">Select a package</option>
            {packages.map((pkg) => (
              <option key={pkg._id} value={pkg._id}>
                {pkg.name} - {pkg.pricing_model === "per_dealer"
                  ? `$${pkg.base_fee} base + $${pkg.price_per_dealer}/dealer`
                  : `$${pkg.price}`}
              </option>
            ))}
          </Form.Select>
        </Form.Group>

        {selectedPackage && (
          <>
            <Row className="mb-2 mt-3">
              <Col lg={12}>
                <Form.Group className="d-flex align-items-center gap-1">
                  <Form.Label className="text-nowrap mb-0">Package Type:</Form.Label>
                  <Form.Control
                    plaintext
                    readOnly
                    value={getSelectedPackage()?.pricing_model === "per_dealer" ? "Per-Dealer Pricing" : "Flat Rate"}
                    size="sm"
                  />
                </Form.Group>
              </Col>
              <Col lg={12}>
                <Form.Group className="d-flex align-items-center gap-1">
                  <Form.Label className="text-nowrap mb-0">Billing Interval:</Form.Label>
                  <Form.Control
                    plaintext
                    readOnly
                    value={getSelectedPackage()?.billing_interval === "month" ? "Monthly" : "Yearly"}
                    size="sm"
                  />
                </Form.Group>
              </Col>
              <Col lg={12}>
                {getSelectedPackage()?.pricing_model === "per_dealer" && (
                    <Form.Group className="d-flex align-items-center gap-1 mb-2">
                      <Form.Label className='text-lg-nowrap d-lg-block mb-0'>
                        Number of Dealers (Min: {getSelectedPackage()?.min_dealers || 1}, Max: {getSelectedPackage()?.max_dealers || 'Unlimited'}):
                      </Form.Label>
                      <div className="d-flex align-items-center gap-1">
                        <Button
                          variant="custom"
                          size="sm"
                          onClick={() => handleDealerCountChange(dealerCount - 1)}
                          disabled={dealerCount <= (getSelectedPackage()?.min_dealers || 1)}
                        >
                          <i className="fa-regular fa-minus"></i>
                        </Button>
                        <Form.Control
                          type="number"
                          min={getSelectedPackage()?.min_dealers || 1}
                          max={getSelectedPackage()?.max_dealers || undefined}
                          value={dealerCount}
                          onChange={(e) => handleDealerCountChange(e.target.value)}
                          className='text-center'
                          disabled={loading}
                          size="sm"
                          style={{ width: "80px", textAlign: "center" }}
                        />
                        <Button
                          variant="custom"
                          size="sm"
                          onClick={() => handleDealerCountChange(dealerCount + 1)}
                          disabled={getSelectedPackage()?.max_dealers && dealerCount >= getSelectedPackage()?.max_dealers}
                        >
                          <i className="fa-regular fa-plus"></i>
                        </Button>
                      </div>
                    </Form.Group>
                )}

                {/* {getSelectedPackage()?.pricing_model === "per_dealer" && (
                  <Form.Group className="mb-3">
                    <Form.Label>
                      Number of Dealers (Min: {getSelectedPackage()?.min_dealers}, Max: {getSelectedPackage()?.max_dealers || 'Unlimited'})
                    </Form.Label>
                    <Form.Control
                      type="number"
                      min={getSelectedPackage()?.min_dealers || 1}
                      max={getSelectedPackage()?.max_dealers || undefined}
                      value={dealerCount}
                      onChange={(e) => setDealerCount(Math.max(
                        getSelectedPackage()?.min_dealers || 1,
                        parseInt(e.target.value) || 1
                      ))}
                      disabled={loading}
                    />
                  </Form.Group>
                )} */}
              </Col>
            </Row>

            <div className="position-relative text-end border-top pt-2">
              <h5 className="mb-0">
                <small className='fw-normal fs-6'>Total Price:</small>&nbsp;<b>${calculatedPrice.toFixed(2)}</b> <small className='fw-normal fs-6'>{getSelectedPackage()?.billing_interval === "month" ? "/month" : "/year"}</small>
              </h5>
              {getSelectedPackage()?.pricing_model === "per_dealer" && (
                <small className="text-muted">
                  {getSelectedPackage()?.base_fee} base + ({dealerCount} dealers × ${getSelectedPackage()?.price_per_dealer})
                </small>
              )}
            </div>
          </>
        )}
      </Modal.Body>
      <Modal.Footer className="border-0 pt-0 justify-content-center bg_gray">
        <Button variant="custom" onClick={handleAssign} disabled={loading || !selectedPackage}>{loading ? 'Assigning...' : 'Assign Package'}</Button>
        <Button variant="secondary" onClick={handleClose} disabled={loading}>Cancel</Button>
      </Modal.Footer>
    </Modal>
  );
}