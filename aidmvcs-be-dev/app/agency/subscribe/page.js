// app/agency/subscribe/page.js
"use client";
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from "../context/UserContext";
import { Alert, Button, Col, Container, Row, Spinner, Badge, Tabs, Tab, Form, InputGroup } from 'react-bootstrap';
import PackageCard from './PackageCard';
import CurrentPlan from './CurrentPlan';
import moment from 'moment';

export default function SubscribePage() {
  const { user, dealerParent } = useUser();
  const router = useRouter();
  const [packages, setPackages] = useState([]);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [selectedPackageDetails, setSelectedPackageDetails] = useState(null);
  const [dealerCount, setDealerCount] = useState(1);
  const [calculatedPrice, setCalculatedPrice] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [activeplanTab, setActiveplanTab] = useState('currentplan');
  const [requestForm, setRequestForm] = useState({
    package: '',
    message: '',
    dealerCount: 1
  });
  const [requestSubmitted, setRequestSubmitted] = useState(false);
  const bottomRef = useRef(null);

  // Check if current subscription is manual
  const isManualSubscription = dealerParent?.subscription?.is_manual;

  // Fetch available packages
  useEffect(() => {
    const fetchPackages = async () => {
      try {
        const res = await fetch('/api/packages?for_user_type=vendor');
        const data = await res.json();
        if (res.ok) {
          setPackages(data.packages);
        } else {
          setError(data.message || 'Failed to load packages');
        }
      } catch (err) {
        setError('Network error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchPackages();
  }, []);

  // Check for active subscription and initialize dealer count
  useEffect(() => {
    if (!dealerParent) return;

    if (dealerParent?.subscription && new Date(dealerParent.package_expiry) > new Date()) {
      setHasActiveSubscription(true);
      if (dealerParent.subscription.dealer_count) {
        setDealerCount(dealerParent.subscription.dealer_count);
      }
    }
  }, [dealerParent]);

  // Update selected package details and calculate price
  useEffect(() => {
    if (selectedPackage) {
      const pkg = packages.find(p => p._id === selectedPackage);
      setSelectedPackageDetails(pkg);

      if (pkg) {
        if (pkg.pricing_model === "per_dealer") {
          const count = Math.max(dealerCount, pkg.min_dealers || 1);
          const price = pkg.base_fee + (pkg.price_per_dealer * count);
          setCalculatedPrice(price);
        } else {
          setCalculatedPrice(pkg.price);
        }
      }
    } else {
      setSelectedPackageDetails(null);
      setCalculatedPrice(0);
    }
  }, [selectedPackage, dealerCount, packages]);

  const handleSupportTicket = () => {
    router.push('/agency/support');
  };

  const handleSubscribe = async () => {
    if (!selectedPackage) {
      setError('Please select a package');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      let endpoint;
      let payload;

      if (hasActiveSubscription) {
        if (isManualSubscription) {
          setError('Your subscription is managed manually. Please contact support for changes.');
          return;
        }

        const isSamePackage = selectedPackage === dealerParent.subscription?.package?._id;

        if (isSamePackage && selectedPackageDetails?.pricing_model === "per_dealer") {
          endpoint = '/api/subscriptions/modify';
          payload = {
            subscriptionId: dealerParent.subscription._id,
            newDealerCount: dealerCount
          };
        } else {
          endpoint = '/api/subscriptions/upgrade';
          payload = {
            userId: dealerParent.id,
            packageId: selectedPackage,
            currentSubscriptionId: dealerParent.subscription._id,
            ...(selectedPackageDetails?.pricing_model === "per_dealer" && {
              dealerCount: dealerCount
            })
          };
        }
      } else {
        endpoint = '/api/subscriptions/create';
        payload = {
          user_id: dealerParent.id,
          package_id: selectedPackage,
          ...(selectedPackageDetails?.pricing_model === "per_dealer" && {
            dealer_count: dealerCount
          })
        };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok) {
        if (data.url) {
          window.location.href = data.url;
        } else {
          router.refresh();
          router.push('/agency/dashboard');
        }
      } else {
        setError(data.message || (hasActiveSubscription ? 'Update failed' : 'Subscription failed'));
      }
    } catch (err) {
      setError('Network error occurred');
    } finally {
      setProcessing(false);
    }
  };

  const handleDealerCountChange = (value) => {
    if (isManualSubscription) return;

    const numValue = parseInt(value) || 1;
    const newCount = Math.max(
      selectedPackageDetails.min_dealers || 1,
      Math.min(
        numValue,
        selectedPackageDetails.max_dealers || Infinity
      )
    );
    setDealerCount(newCount);
  };

  const handleRequestSubmit = async (e) => {
    e.preventDefault();
    setProcessing(true);

    try {
      const res = await fetch('/api/subscriptions/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: dealerParent.id,

          message: requestForm.message,
          dealerCount: requestForm.dealerCount
        })
      });

      const data = await res.json();
      if (res.ok) {
        setRequestSubmitted(true);
      } else {
        setError(data.message || 'Failed to submit request');
      }
    } catch (err) {
      setError('Network error occurred');
    } finally {
      setProcessing(false);
    }
  };

  if (!dealerParent?.id) {
    return (
      <div className="page_content">
        <div className="d-flex justify-content-center align-items-center" style={{ height: '300px' }}>
          <Spinner animation="border" variant="dark" />
          <span className="ms-3">Loading agency information...</span>
        </div>
      </div>
    );
  }

  // Manual subscription message
  if (isManualSubscription) {
    return (
      <div className="page_content">
        <div className="page_head">
          <div className="row align-items-center">
            <div className="col col-12">
              <div className="d-flex align-items-center">
                <h3 className="page_title mb-0">My Subscription</h3>
              </div>
            </div>
          </div>
        </div>

        <div className="page_body">
          <Row className="justify-content-center">
            <Col lg={10} xl={6}>
              <div className="w_card text-center w_card_info">
                <i className="fa-regular fa-circle-info"></i>
                <h3 className="w_card_title mb-1">Your subscription is managed by our team</h3>
                <p className="mb-3"><span className="pulse_circle bg-custom me-2"></span>For any changes to your subscription or dealer count, please contact our support team.</p>

                <div className="w_card w_card_currplan mb-3 border">
                  <h3 className="w_card_title mb-2">
                    <span className='text-custom'>{dealerParent.subscription?.package?.name}</span>
                  </h3>
                  <div className="d-flex justify-content-between">
                    <p className='mb-0'><span className='text-secondary-light'>Expires:</span> {' '} <span>{moment(dealerParent.package_expiry).format('MMMM Do, YYYY')}</span></p>
                    <p className='mb-0'><span className='text-secondary-light'>Dealer Limit:</span> {' '} <span>{dealerParent.package_dealers_used}</span></p>
                    <p className='mb-0'><span className='text-secondary-light'>Status:</span> {' '} <span><Badge bg={`${dealerParent.subscription?.status === 'active' ? 'success' : 'danger'}`} className='text-capitalize'>{dealerParent.subscription?.status}</Badge></span></p>
                  </div>
                  {dealerParent.subscription?.package?.pricing_model === "per_dealer" && (
                    <div className="mt-3">
                      <p className="mb-1">
                        <strong>Dealer Accounts:</strong> {dealerParent.subscription.dealer_count} / {dealerParent.subscription.max_dealers}
                      </p>
                      <small className="text-muted">
                        (${dealerParent.subscription.package.price_per_dealer} per dealer)
                      </small>


                    </div>
                  )}
                </div>

                <Button variant="custom" onClick={handleSupportTicket}>
                  Create Support Ticket
                </Button>
              </div>
            </Col>
          </Row>
        </div>
      </div>
    );
  }

  // Request form for unsubscribed vendors
  if (!hasActiveSubscription && !requestSubmitted) {
    return (
      <div className="page_content">
        <div className="page_head">
          <div className="row align-items-center">
            <div className="col col-12">
              <div className="d-flex align-items-center">
                <h3 className="page_title mb-0">Request Subscription</h3>
              </div>
            </div>
          </div>
        </div>

        <div className="page_body">
          <Row className="justify-content-center">
            <Col lg={8} xl={6}>
              <div className="w_card">
                <h3 className="w_card_title mb-4">Request a Subscription Package</h3>

                {error && <Alert variant="danger">{error}</Alert>}

                <Form onSubmit={handleRequestSubmit}>
                  <Form.Group className="mb-3 d-flex align-items-center gap-2">
                    <Form.Label className='mb-0'>Number of Dealers Needed:</Form.Label>
                    <div className="d-flex align-items-center gap-1">
                      <Button
                        variant="outline-secondary"
                        onClick={() =>
                          setRequestForm((prev) => ({
                            ...prev,
                            dealerCount: Math.max(1, (prev.dealerCount || 1) - 1),
                          }))
                        }
                      ><i className="fa-regular fa-minus"></i></Button>

                      <Form.Control
                        type="number"
                        min="1"
                        value={requestForm.dealerCount}
                        onChange={(e) => setRequestForm({ ...requestForm, dealerCount: parseInt(e.target.value) || 1 })}
                        required
                        style={{ width: "80px", textAlign: "center" }}
                      />

                      <Button
                        variant="outline-secondary"
                        onClick={() =>
                          setRequestForm((prev) => ({
                            ...prev,
                            dealerCount: (prev.dealerCount || 1) + 1,
                          }))
                        }
                      ><i className="fa-regular fa-plus"></i></Button>
                    </div>
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>Additional Information</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={4}
                      placeholder="Tell us about your requirements..."
                      value={requestForm.message}
                      onChange={(e) => setRequestForm({ ...requestForm, message: e.target.value })}
                    />
                  </Form.Group>

                  <Form.Group className="text-center">
                    <Button
                      variant="custom"
                      type="submit"
                      disabled={processing}
                    >
                      {processing ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" />
                          Submitting...
                        </>
                      ) : (
                        'Submit Request'
                      )}
                    </Button>
                  </Form.Group>
                </Form>
              </div>
            </Col>
          </Row>
        </div>
      </div>
    );
  }

  // Request submitted confirmation
  if (!hasActiveSubscription && requestSubmitted) {
    return (
      <div className="page_content">
        <div className="page_head">
          <div className="row align-items-center">
            <div className="col col-12">
              <div className="d-flex align-items-center">
                <h3 className="page_title mb-0">Request Submitted</h3>
              </div>
            </div>
          </div>
        </div>

        <div className="page_body">
          <Row className="justify-content-center">
            <Col lg={8} xl={6}>
              <div className="w_card text-center w_card_info">
                <i className="fa-regular fa-circle-check"></i>
                <h3 className="w_card_title mb-2">Your Subscription Request Received.</h3>
                <p className='mb-2'>Thank you for your subscription request. Our team will review your requirements and get back to you shortly with the next steps.</p>
                <p className='mb-3'><span className="pulse_circle bg-custom me-2"></span>You'll receive a confirmation email with the details of your request.</p>
                {/* <Button variant="custom" onClick={() => router.push('/agency/dashboard')}>
                  Return to Dashboard
                </Button> */}
              </div>
            </Col>
          </Row>
        </div>
      </div>
    );
  }

  // Normal subscription management for subscribed vendors
  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center">
              <h3 className="page_title mb-0">My Subscription</h3>
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        <Tabs
          activeKey={activeplanTab}
          onSelect={(k) => setActiveplanTab(k)}
          className="mb-3 justify-content-center"
          variant="pills"
        >
          {hasActiveSubscription && (
            <Tab eventKey="currentplan" title="My Current Plan">
              <CurrentPlan />
            </Tab>
          )}

          <Tab eventKey="subscriptionplan" title={hasActiveSubscription ? "Change Plan" : "Subscription Plans"}>
            <Row className="justify-content-center">
              <Col xl={10} lg={12}>
                {hasActiveSubscription && (
                  <div className="w_card mb-4">
                    <h3 className="w_card_title mb-2">
                      <span className='text-secondary-light fw-normal'>Current Plan:</span>&nbsp;
                      <span className='text-custom'>{dealerParent.subscription?.package?.name || 'No active plan'}</span>
                    </h3>
                    <div className='d-flex align-items-center'>
                      <div>
                        <div className={`status_ribbon ${dealerParent.subscription?.status === 'active' ? 'success' : 'warning'}`}>
                          <span>{dealerParent.subscription?.status || 'inactive'}</span>
                        </div>
                      </div>
                      <span className='ms-auto'>
                        <span className='text-secondary-light'>Expires:</span> {' '}
                        {dealerParent.package_expiry ? moment(dealerParent.package_expiry).format('MMMM Do, YYYY') : 'N/A'}
                      </span>
                    </div>
                    {dealerParent.subscription?.package?.pricing_model === "per_dealer" && (
                      <div className="mt-2">
                        <span className="text-muted">
                          <strong>Dealer Accounts:</strong> {dealerParent.subscription.dealer_count} / {dealerParent.subscription.max_dealers}
                          (${dealerParent.subscription.package.price_per_dealer} each)
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {error && <Alert variant="danger">{error}</Alert>}

                <div className="w_card">
                  <h3 className="w_card_title mb-1">Available Subscription Plans</h3>

                  <p className='mb-lg-4 mb-3'>
                    <span className="pulse_circle bg-custom me-2"></span>
                    {hasActiveSubscription
                      ? 'You can change your plan at any time. Changes will take effect immediately.'
                      : 'Select a subscription plan that fits your needs.'}
                  </p>

                  <div className="w_card_list">
                    <Row className='justify-content-center g-xl-3 g-2'>
                      {packages.map((pkg) => (
                        <Col key={pkg._id} md={6} lg={4} className='col-xxxl-3'>
                          <PackageCard
                            pkg={pkg}
                            selected={selectedPackage === pkg._id}
                            onSelect={() => {
                              setSelectedPackage(pkg._id);
                              if (hasActiveSubscription &&
                                dealerParent.subscription?.package?.pricing_model === "per_dealer" &&
                                pkg.pricing_model === "per_dealer") {
                                setDealerCount(dealerParent.subscription.dealer_count);
                              } else {
                                setDealerCount(pkg.min_dealers || 1);
                              }

                              // Scroll to bottom
                              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
                            }}
                            currentPackageId={hasActiveSubscription ? dealerParent.subscription?.package?._id : null}
                          />
                        </Col>
                      ))}
                    </Row>
                  </div>

                  {selectedPackageDetails && (
                    <div className="mt-4">
                      {selectedPackageDetails.pricing_model === "per_dealer" && (
                        <div className="mb-4 p-3 bg_gray rounded">
                          <Row className='align-items-center justify-content-end'>
                            <Col xl={4} lg={7} md={7}>
                              <div className='d-md-flex align-items-center'>
                                <p className='mb-md-0 mb-2 me-2 text-nowrap'>Number of Dealers (Min: {selectedPackageDetails.min_dealers || 1},
                                  Max: {selectedPackageDetails.max_dealers || 'Unlimited'}) :</p>
                                <InputGroup className="input_group">
                                  <Button
                                    variant="custom"
                                    size="sm"
                                    onClick={() => handleDealerCountChange(dealerCount - 1)}
                                    disabled={dealerCount <= (selectedPackageDetails.min_dealers || 1)}
                                  ><i className="fa-regular fa-minus"></i></Button>
                                  <Form.Control
                                    type="number"
                                    min={selectedPackageDetails.min_dealers || 1}
                                    max={selectedPackageDetails.max_dealers || undefined}
                                    value={dealerCount}
                                    onChange={(e) => handleDealerCountChange(e.target.value)}
                                    className='text-center'
                                    size="sm"
                                  />
                                  <Button
                                    variant="custom"
                                    size="sm"
                                    onClick={() => handleDealerCountChange(dealerCount + 1)}
                                    disabled={selectedPackageDetails.max_dealers && dealerCount >= selectedPackageDetails.max_dealers}
                                  ><i className="fa-regular fa-plus"></i></Button>
                                </InputGroup>
                              </div>
                            </Col>
                            <Col xl={8} lg={5} md={5}>
                              <div className="text-end mt-3 mt-md-0">
                                <h5 className="mb-0">
                                  <small className='fw-normal fs-6'>Total Price:</small>&nbsp;<b>${calculatedPrice.toFixed(2)}</b> <small className='fw-normal fs-6'>/{selectedPackageDetails.billing_interval}</small>
                                </h5>
                                <small className="text-muted">
                                  {selectedPackageDetails.base_fee} base + ({dealerCount} dealers × ${selectedPackageDetails.price_per_dealer})
                                </small>
                                {hasActiveSubscription &&
                                  selectedPackageDetails._id === dealerParent.subscription?.package?._id && (
                                    <div className="mt-2">
                                      <small className={dealerCount > dealerParent.subscription.dealer_count ? 'text-success' : 'text-warning'}>
                                        {dealerCount > dealerParent.subscription.dealer_count ?
                                          `+${dealerCount - dealerParent.subscription.dealer_count} dealers ($${(selectedPackageDetails.price_per_dealer * (dealerCount - dealerParent.subscription.dealer_count)).toFixed(2)}/month)` :
                                          dealerCount < dealerParent.subscription.dealer_count ?
                                            `-${dealerParent.subscription.dealer_count - dealerCount} dealers (-$${(selectedPackageDetails.price_per_dealer * (dealerParent.subscription.dealer_count - dealerCount)).toFixed(2)}/month)` :
                                            'No change in dealer count'}
                                      </small>
                                    </div>
                                  )}
                              </div>
                            </Col>
                          </Row>
                        </div>
                      )}

                      <div className="text-center">
                        <Button
                          variant="custom"
                          size="lg"
                          onClick={handleSubscribe}
                          disabled={!selectedPackage || processing}
                        >
                          {processing ? (
                            <>
                              <Spinner animation="border" size="sm" className="me-2" />
                              Processing...
                            </>
                          ) : hasActiveSubscription ? (
                            selectedPackage === dealerParent.subscription?.package?._id ? (
                              dealerCount !== dealerParent.subscription.dealer_count ?
                                'Update Dealer Count' :
                                'Current Plan'
                            ) : (
                              'Change Plan'
                            )
                          ) : (
                            'Subscribe Now'
                          )}
                        </Button>

                        {hasActiveSubscription && (
                          <Button
                            variant="secondary"
                            size="lg"
                            className="ms-2"
                            onClick={() => router.push('/agency/dashboard')}
                          >
                            Back to Dashboard
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Col>
            </Row>
          </Tab>
        </Tabs>
      </div>

      <div ref={bottomRef} />
    </div>
  );
}