// app/agency/subscribe/success/page.jsx
"use client";
import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from "../../context/UserContext";
import { Alert, Button, Card, Col, Container, Row, Spinner } from 'react-bootstrap';

function SubscriptionSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, setUser } = useUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    const verifySubscription = async () => {
      try {
        if (!sessionId) {
          throw new Error('Invalid session ID');
        }

        const response = await fetch('/api/subscriptions/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'Verification failed');
        }

        // Update user context with new subscription
        if (data.user) {
         // setUser(data.user);
        }

        // Redirect to dashboard after 5 seconds
        setTimeout(() => {
          window.location.href = '/agency/dashboard';
        }, 500);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    verifySubscription();
  }, [sessionId, router, setUser]);

  if (loading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" variant="dark" />
        <h4 className="mt-3">Verifying your subscription...</h4>
      </Container>
    );
  }

  return (
    <>
      <div className="page_content">
        <div className="page_head">
          <div className="row align-items-center">
            <div className="col col-12">
              <div className="d-flex align-items-center">
                <h3 className="page_title mb-0">{error ? 'Subscription Processing' : 'Subscription Successful!'}</h3>
              </div>
            </div>
          </div>
        </div>

        <div className="page_body">
          <Row className="justify-content-center">
            <Col lg={10} xl={8}>

              <Alert variant="danger">{error}</Alert>

              {error ? (
                <div className="w_card text-center w_card_info">
                  <i className="fa-regular fa-triangle-exclamation text-warning"></i>
                  <h3 className="w_card_title mb-1">Subscription Processing...</h3>
                  <p className='mb-3'><span className="pulse_circle bg-custom me-2"></span>We're having trouble verifying your payment. Please check your email for confirmation.</p>
                  <Button variant="custom" onClick={() => router.push('/agency/dashboard')}>
                    Go to Dashboard
                  </Button>
                </div>
              ) : (
                <div className="w_card text-center w_card_info">
                  <i className="fa-regular fa-circle-check text-success"></i>
                  <h3 className="w_card_title mb-1">Thank you for subscribing!</h3>
                  <p className='mb-3'><span className="pulse_circle bg-custom me-2"></span>Welcome to your new <strong>{user?.current_subscription?.package_id?.name}</strong> plan.</p>
                  <p>You'll be redirected to your dashboard shortly...</p>
                  <Spinner animation="border" variant="custom" />
                </div>
              )}
            </Col>
          </Row>
        </div>
      </div>

      {/* <Container className="py-5">
        <Row className="justify-content-center">
          <Col md={8} lg={6}>
            <Card className="shadow-sm">
              <Card.Header className="bg-success text-white">
                <h3 className="mb-0">
                  {error ? 'Subscription Processing' : 'Subscription Successful!'}
                </h3>
              </Card.Header>
              <Card.Body className="text-center">
                {error ? (
                  <>
                    <Alert variant="danger">{error}</Alert>
                    <p>We're having trouble verifying your payment. Please check your email for confirmation.</p>
                    <Button variant="primary" onClick={() => router.push('/agency/dashboard')}>
                      Go to Dashboard
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="mb-4">
                      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
                          stroke="#28a745" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <h4 className="mt-3">Thank you for subscribing!</h4>
                      <p className="lead">
                        Welcome to your new {user?.current_subscription?.package_id?.name} plan
                      </p>
                    </div>
                    <p>You'll be redirected to your dashboard shortly...</p>
                    <Spinner animation="border" variant="success" className="mt-3" />
                  </>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container> */}
    </>
  );
}

export default function SubscriptionSuccess() {
  return (
    <Suspense fallback={
      <Container className="py-5 text-center">
        <Spinner animation="border" variant="dark" />
        <h4 className="mt-3">Loading...</h4>
      </Container>
    }>
      <SubscriptionSuccessContent />
    </Suspense>
  );
}