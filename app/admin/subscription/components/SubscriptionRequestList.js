"use client";
import { useState, useEffect } from "react";
import { Offcanvas } from "react-bootstrap";
import { Button, ListGroup, Row, Col, Badge, Alert } from "react-bootstrap";
import CustomLoader from "../../components/CustomLoader";

export default function SubscriptionRequestList() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0
  });

  const [selectedReq, setSelectedReq] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  console.log(selectedReq);

  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const response = await fetch("/api/subscriptions/request",{headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }});
        const result = await response.json();
        
        if (!response.ok) {
          throw new Error(result.message || "Failed to fetch requests");
        }

        // Use result.data instead of result
        setRequests(result.data || []);
        setPagination(result.pagination || {
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 1
        });
        
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchRequests();
  }, []);

  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return "Invalid date";
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case "pending": return <Badge bg="warning">Pending</Badge>;
      case "approved": return <Badge bg="success">Approved</Badge>;
      case "rejected": return <Badge bg="danger">Rejected</Badge>;
      default: return <Badge bg="secondary">Unknown</Badge>;
    }
  };

  const handleShowDetails = (req) => {
    setSelectedReq(req);
    setShowDetails(true);
  };

  const handleCloseDetails = () => {
    setShowDetails(false);
    setSelectedReq(null);
  };

  if (loading) {
    return <CustomLoader />;
  }

  if (error) {
    return <Alert variant="danger">Error: {error}</Alert>;
  }



  return (
    <div>

      <div className="w_card">
        <h3 className="w_card_title">Requests List</h3>

        <div className="w_card_list">
          <ListGroup as="ul" variant="flush">
            <ListGroup.Item as="li" key="head" className="w_card_list_head border-0">
              <Row className="align-items-center gx-2">
                <Col xl={8} lg={7} sm={7} xs={12}>
                  <p className="p_bold"><small>Agency</small></p>
                </Col>
                <Col xl={1} lg={1} sm={1} xs={12}>
                  <p className="p_bold"><small>Dealers</small></p>
                </Col>
                <Col xl={1} lg={2} sm={2} xs={12}>
                  <p className="p_bold"><small>Requested Date</small></p>
                </Col>
                <Col xl={1} lg={1} sm={1} xs={12}>
                  <p className="p_bold"><small>Status</small></p>
                </Col>
                <Col xl={1} lg={1} sm={1} xs={12}>
                  <p className="p_bold text-center"><small>Action</small></p>
                </Col>
              </Row>
            </ListGroup.Item>

              {requests.length > 0 ? (
                requests.map((request) => (
                  <ListGroup.Item as="li" key={request._id} className="w_card_list_box">
                    <Row className="align-items-center gx-2">
                      <Col xl={8} lg={7} sm={7} xs={12}>
                        <p className="p_bold">{request.user?.name || "N/A"}</p>
                        <small className="text-muted">{request.message || "N/A"}</small>
                      </Col>
                      <Col xl={1} lg={1} sm={1} xs={12}>
                        <div className="w_card_list_box_label">
                          <p className="label"><small>Dealers:</small></p>
                          <p>{request.dealerCount || 0}</p>
                        </div>
                      </Col>
                      <Col xl={1} lg={2} sm={2} xs={12}>
                        <div className="w_card_list_box_label">
                          <p className="label"><small>Requested Date:</small></p>
                          <p>{formatDate(request.requestedAt)}</p>
                        </div>
                      </Col>
                      <Col xl={1} lg={1} sm={1} xs={6}>
                        {getStatusBadge(request.status)}
                      </Col>
                      <Col xl={1} lg={1} sm={1} xs={6}>
                        <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                          {/* <Button
                            variant="custom"
                            size="sm"
                            onClick={() => onRequestSelected(request)}
                          >
                            <i className="fa-regular fa-eye"></i>
                          </Button> */}
                          <Button variant="custom" size="sm" onClick={() => handleShowDetails(request)}>
                            <i className="fa-regular fa-eye"></i>
                          </Button>
                        </div>
                      </Col>
                    </Row>
                  </ListGroup.Item>
                ))
              ) : (
                <div className="text-center py-4">No subscription requests found.</div>
              )}
          </ListGroup>
        </div>
      </div>
      
      {/* Pagination controls - Only show when there are results */}
      {requests.length > 0 && pagination.total > 0 ? (
        <div className="d-flex justify-content-between align-items-center mt-3">
          <div>
            Showing {requests.length} of {pagination.total} requests
          </div>
          {pagination.totalPages > 1 && (
            <div>
              <Button 
                variant="outline-secondary" 
                size="sm" 
                disabled={pagination.page === 1}
                // onClick={() => handlePageChange(pagination.page - 1)}
              >
                Previous
              </Button>
              <span className="mx-2">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <Button 
                variant="outline-secondary" 
                size="sm" 
                disabled={pagination.page >= pagination.totalPages}
                // onClick={() => handlePageChange(pagination.page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {/* Req Details Offcanvas */}
      <Offcanvas show={showDetails} onHide={handleCloseDetails} placement="end">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>Request Details</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {selectedReq && (
            <div className="req_offcanvas">
              <p><strong>Agency:</strong> {selectedReq.user?.name || "N/A"}</p>
              <p><strong>Email:</strong> {selectedReq.email || "N/A"}</p>
              <p><strong>Phone:</strong> {selectedReq.phone || "N/A"}</p>

              <p><strong>Dealer Count:</strong> {selectedReq.dealerCount || 0}</p>
              <p><strong>Requested Date:</strong> {formatDate(selectedReq.requestedAt)}</p>
              <p className="d-flex align-items-center gap-1"><strong>Status:</strong>
                {getStatusBadge(selectedReq.status)}
              </p>
              <p><strong>Message:</strong> {selectedReq.message || "N/A"}</p>
            </div>
          )}
        </Offcanvas.Body>
      </Offcanvas>

    </div>
  );
}