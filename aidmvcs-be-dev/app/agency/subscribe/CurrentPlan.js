// app/agency/subscriptions/page.jsx
"use client";
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from "../context/UserContext";
import {
  Alert,
  Button,
  Card,
  Col,
  Container,
  ListGroup,
  Row,
  Spinner,
  Tab,
  Tabs,
  Badge
} from 'react-bootstrap';
import moment from 'moment';

export default function SubscriptionManagement() {
  const router = useRouter();
  const { user, dealerParent } = useUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [activeTab, setActiveTab] = useState('current');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {

    const fetchData = async () => {
      try {
        setLoading(true);
        const user_id = dealerParent?.id;
        // Fetch subscription transactions
        const transactionsRes = await fetch(`/api/subscriptions/transactions?user_id=${user_id}`);
        const transactionsData = await transactionsRes.json();

        if (transactionsRes.ok) {
          setTransactions(transactionsData.transactions);
        } else {
          throw new Error(transactionsData.message || 'Failed to load transactions');
        }

      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    if (!dealerParent) return;
    fetchData(dealerParent);
  }, [dealerParent]);

  const handleCancelSubscription = async () => {
    try {
      // 1. Verify we have required data
      if (!dealerParent?.subscription?.id) {
        throw new Error('No active subscription found');
      }

      // 2. Show confirmation
      if (!window.confirm('Are you sure you want to cancel your subscription?')) {
        return;
      }

      // 3. Start process
      setProcessing(true);
      setError(null);

      // 4. Make API call
      const res = await fetch('/api/subscriptions/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          subscriptionId: dealerParent.subscription.id
        })
      });

      // 5. Handle response
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to cancel subscription');
      }

      // 6. Refresh data
      const userRes = await fetch('/api/auth/me');
      if (!userRes.ok) throw new Error('Failed to refresh user data');

      const userData = await userRes.json();
      //setUser(userData);

      // 7. Redirect
      router.push('/agency/dashboard');

    } catch (err) {
      console.error('Cancellation error:', err);
      setError(err.message);
      // Optional: show toast notification
    } finally {
      setProcessing(false);
    }
  };

  const handleUpgrade = () => {
    router.push('/agency/subscribe');
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

  return (
      <Row className="justify-content-center">
        <Col lg={12} xl={9}>
          {user.parent_id && (
            <div className="w_card text-center w_card_info">
              <i className="fa-regular fa-circle-info"></i>
              <h3 className="w_card_title mb-1">Your subscription is managed by {user.parent_id.name}.</h3>
              <p className='mb-3'><span className="pulse_circle bg-custom me-2"></span>Please contact them for any subscription-related inquiries.</p>
              <Button variant="custom" onClick={() => router.push('/agency/dashboard')}>
                Go to Dashboard
              </Button>
            </div>
          )}

          {error && <Alert variant="danger">{error}</Alert>}

          {/* <Tabs
                activeKey={activeTab}
                onSelect={(k) => setActiveTab(k)}
                className="mb-3"
              >
                <Tab eventKey="current" title="Current Plan"> */}
          {dealerParent.subscription ? (
            <div className="w_card w_card_currplan mb-2">
              <Row className='align-items-center mb-2'>
                <Col lg={8} xs={6}>
                  <h3 className="w_card_title mb-0">
                    <span className='text-custom'>{dealerParent.subscription.package.name}</span>
                    <small className="text_dark ms-2 subs_month_yr">(Monthly)</small>
                  </h3>
                </Col>
                <Col lg={4} xs={6}>
                  <h4 className='w_card_currplan_price text-end mb-0'>
                    <span>${dealerParent.subscription.package.price}</span>&nbsp;
                    <small className="text-secondary-light">per&nbsp;{dealerParent.subscription.package.duration} days</small>
                  </h4>
                </Col>
              </Row>

              <Row className='align-items-center mb-3'>
                <Col md={3}>
                  <span className='d-flex'>{' '}
                    <div className={`status_ribbon ${dealerParent.subscription.status === 'active' ? 'success' : 'warning'}`}>
                      <span>{dealerParent.subscription.status}</span>
                    </div>
                  </span>
                </Col>
                <Col md={9}>
                  <div className="d-md-flex justify-content-end mt-md-0 mt-2">
                    <p className='mb-md-0 mb-1 text-custom'>
                      {dealerParent.subscription.is_manual ? 'Manual Assignment' : 'Auto Subscription'}
                    </p>
                    <span className='d-md-inline-block d-none'>&nbsp;|&nbsp;</span>
                    <p className='mb-md-0 mb-1 text-md-end'>
                      <span className='text-secondary-light'>Started Date:</span> {' '}
                      {moment(dealerParent.subscription.start_date).format('LL')}
                    </p>
                    <span className='d-md-inline-block d-none'>&nbsp;|&nbsp;</span>
                    <p className='mb-md-0 mb-1 text-md-end'>
                      <span className='text-secondary-light'>Expiration Date:</span> {' '}
                      {moment(dealerParent.subscription.end_date).format('LL')}
                    </p>
                  </div>
                </Col>
                <Col>
                  {user.type === 'vendor' && (
                    <p className='mb-0 mt-md-3 mt-2'><span className="pulse_circle bg-custom me-2"></span><strong>Dealer Accounts:</strong> {dealerParent.package_dealers_used} / {dealerParent.package_dealers_allowed}</p>
                  )}
                </Col>
              </Row>

              <Row>
                <Col lg={12}>
                  <h6 className='mb-2'><b>Package Features:</b></h6>
                  <Row as='ul' className='mb-0 gx-0 gy-1 ps-3'>
                    {dealerParent.subscription.package.features?.map((feature, i) => (
                      <Col key={i} as='li' xl={4} lg={4} md={6}>{feature}</Col>
                    ))}
                  </Row>
                </Col>
              </Row>

              {!dealerParent.parent_id && (
                <Row className="mt-md-3 mt-3">
                  <Col>
                    {/* <Button
                                variant="custom"
                                onClick={handleUpgrade}
                                disabled={processing}
                                className='me-2'
                              >
                                Change Plan
                              </Button> */}
                    <Button
                      variant="outline-danger"
                      onClick={handleCancelSubscription}
                      disabled={processing || dealerParent.subscription.is_manual}
                    >
                      {processing ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" />
                          Processing...
                        </>
                      ) : (
                        'Cancel Subscription'
                      )}
                    </Button>
                  </Col>
                </Row>
              )}

            </div>
          ) : (
            <div className="w_card text-center w_card_info">
              <i className="fa-regular fa-triangle-exclamation text-warning"></i>
              <h3 className="w_card_title mb-1">No active subscription found.</h3>
              <p className='mb-3'><span className="pulse_circle bg-custom me-2"></span>You do not have an active subscription. Please subscribe to access this.</p>
              {/* <Button variant="custom" onClick={() => router.push('/agency/subscribe')}>
                Subscribe now
              </Button> */}
            </div>
          )}
          {/* </Tab> */}

          {/* <Tab eventKey="transactions" title="Payment History">
                  <Card className="mt-3">
                    <Card.Body>
                      {transactions.length > 0 ? (
                        <ListGroup variant="flush">
                          {transactions.map((txn) => (
                            <ListGroup.Item key={txn.id} className="d-flex justify-content-between align-items-center">
                              <div>
                                <strong>{txn.description}</strong>
                                <div className="text-muted small">
                                  {moment(txn.date).format('LLL')} • {txn.id}
                                </div>
                              </div>
                              <div className="text-end">
                                <div className={`fw-bold ${txn.amount < 0 ? 'text-danger' : 'text-success'}`}>
                                  ${Math.abs(txn.amount).toFixed(2)}
                                </div>
                                <Badge bg={txn.status === 'completed' ? 'success' : 'warning'}>
                                  {txn.status}
                                </Badge>
                              </div>
                            </ListGroup.Item>
                          ))}
                        </ListGroup>
                      ) : (
                        <Alert variant="info">No transaction history found</Alert>
                      )}
                    </Card.Body>
                  </Card>
                </Tab> */}
          {/* </Tabs> */}

        </Col>
      </Row>
  );
}