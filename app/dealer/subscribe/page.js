// app/agency/subscribe/page.jsx
"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from "../context/UserContext";
import { Alert, Button, Col, Row, Spinner, Tabs, Tab } from 'react-bootstrap';
import PackageCard from './PackageCard';
import CurrentPlan from './CurrentPlan';
import moment from 'moment';

export default function SubscribePage() {
  const { user, dealerParent } = useUser();
  const router = useRouter();
  const [packages, setPackages] = useState([]);
  const [filteredPackages, setFilteredPackages] = useState([]);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [activePlanTab, setActivePlanTab] = useState('currentplan');
  const [billingCycle, setBillingCycle] = useState('monthly');

  // Fetch available packages
  useEffect(() => {
    const fetchPackages = async () => {
      try {
        const res = await fetch('/api/packages?for_user_type=dealer');
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

  // Filter packages based on billing cycle
  useEffect(() => {
    if (packages.length > 0) {
      const filtered = packages.filter(pkg => 
        billingCycle === 'monthly' 
          ? pkg.duration <= 31 
          : pkg.duration > 31
      );
      setFilteredPackages(filtered);
    }
  }, [packages, billingCycle]);

  // Check for active subscription and set default tab
  useEffect(() => {
    if (!dealerParent) return;

    const hasActiveSub = dealerParent?.subscription && new Date(dealerParent.package_expiry) > new Date();
    setHasActiveSubscription(hasActiveSub);
    
    // Automatically switch to subscription plans tab if no active subscription
    if (!hasActiveSub) {
      setActivePlanTab('subscriptionplan');
    }
  }, [dealerParent]);

  const handleSubscribe = async () => {
    if (!selectedPackage) {
      setError('Please select a package');
      return;
    }

    setProcessing(true);
    try {
      const endpoint = hasActiveSubscription
        ? '/api/subscriptions/upgrade'
        : '/api/subscriptions/create';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package_id: selectedPackage,
          user_id: dealerParent.id,
          ...(hasActiveSubscription && { current_subscription_id: dealerParent.subscription?.id })
        })
      });

      const data = await res.json();

      if (res.ok) {
        if (data.url) {
          window.location.href = data.url;
        } else {
          setTimeout(() => {
            window.location.href = '/dealer/dashboard';
          }, 500);
        }
      } else {
        setError(data.message || (hasActiveSubscription ? 'Upgrade failed' : 'Subscription failed'));
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
          <span className="ms-3">Loading dealer information...</span>
        </div>
      </div>
    );
  }

  // If dealer has a vendor_id, show message that subscription is managed by agency
  if (dealerParent?.vendor_id) {
    return (
      <div className="page_content">
        <div className="page_head">
          <div className="row align-items-center">
            <div className="col col-12">
              <div className="d-flex align-items-center">
                <h3 className="page_title mb-0">Subscription Information</h3>
              </div>
            </div>
          </div>
        </div>

        <div className="page_body">
          <Row className="justify-content-center">
            <Col lg={10} xl={8}>
              <div className="w_card text-center w_card_info">
                <i className="fa-regular fa-circle-info"></i>
                <h3 className="w_card_title mb-1">Your subscription is managed by your agency</h3>
                <p className='mb-3'><span className="pulse_circle bg-custom me-2"></span>Please contact your agency administrator for any subscription-related inquiries.</p>
                <Button variant="custom" onClick={() => router.push('/dealer/dashboard')}>
                  Go to Dashboard
                </Button>
              </div>
            </Col>
          </Row>
        </div>
      </div>
    );
  }

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
          activeKey={activePlanTab}
          onSelect={(k) => setActivePlanTab(k)}
          className="mb-3 justify-content-center"
          variant="pills"
        >
          <Tab eventKey="currentplan" title="My Current Plan">
            <CurrentPlan />
          </Tab>
          <Tab eventKey="subscriptionplan" title="Subscription Plans">
            <Row className="justify-content-center">
              <Col lg={10}>
                {hasActiveSubscription && (
                  <div className="w_card mb-2">
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
                        <span className='text-secondary-light'>Expiration Date:</span> {' '}
                        {dealerParent.package_expiry ? moment(dealerParent.package_expiry).format('MMMM Do, YYYY') : 'N/A'}
                      </span>
                    </div>
                  </div>
                )}

                {error && <Alert variant="danger">{error}</Alert>}

                <div className="w_card">
                  <h3 className="w_card_title mb-1">Subscription Plans</h3>

                  {hasActiveSubscription ? (
                    <p className='mb-xl-4 mb-3'><span className="pulse_circle bg-custom me-2"></span>You can upgrade your plan at any time. Your new plan will take effect at the end of your current billing period.</p>
                  ) : (
                    <p className='mb-xl-4 mb-3'><span className="pulse_circle bg-custom me-2"></span>To access all dealer features, please select a subscription plan below.</p>
                  )}

                  <div className="text-center mb-xl-4 mb-3">
                    <Button
                      variant={billingCycle === 'monthly' ? 'custom' : 'outline-custom'}
                      className="me-2"
                      onClick={() => setBillingCycle('monthly')}
                    >
                      Monthly Plans
                    </Button>
                    <Button
                      variant={billingCycle === 'yearly' ? 'custom' : 'outline-custom'}
                      onClick={() => setBillingCycle('yearly')}
                    >
                      Yearly Plans
                    </Button>
                  </div>

                  <div className="w_card_list">
                    <Row className='justify-content-center g-md-3 g-2'>
                      {filteredPackages.map((pkg) => (
                        <Col 
                          key={pkg._id} 
                          md={4} 
                          lg={4} 
                          className='col-xxxl-3'
                          style={{ display: pkg.hide ? 'none' : 'block' }}
                        >
                          <PackageCard
                            pkg={pkg}
                            selected={selectedPackage === pkg._id}
                            onSelect={() => setSelectedPackage(pkg._id)}
                            currentPackageId={hasActiveSubscription ? dealerParent.subscription?.package?._id : null}
                            billingCycle={billingCycle}
                          />
                        </Col>
                      ))}
                    </Row>
                  </div>

                  <div className="mt-xl-4 mt-3 text-center">
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
                          'Current Plan'
                        ) : (
                          'Upgrade Plan'
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
                        onClick={() => router.push('/dealer/dashboard')}
                      >
                        Back to Dashboard
                      </Button>
                    )}
                  </div>
                </div>
              </Col>
            </Row>
          </Tab>
        </Tabs>
      </div>
    </div>
  );
}