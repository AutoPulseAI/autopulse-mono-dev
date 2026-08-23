"use client";
import { useState, useEffect } from "react";
import { useUser } from "../context/UserContext";
import DealerList from "./components/DealerList";
import DealerOffcanvas from "./components/DealerOffcanvas";
import useFetch from "../../hooks/useFetch";
import { Button, Offcanvas, Alert, Badge, Row, Col } from "react-bootstrap";
import DealerDetails from "./components/DealerDetails";

export default function DealerManagement() {
  const { user, dealerParent, updateUser, logout } = useUser();
  const { fetchData, error: fetchError, loading } = useFetch();
  const [dealers, setDealers] = useState([]);
  const [editDealer, setEditDealer] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedDealer, setSelectedDealer] = useState(null);
  const [show, setShow] = useState(false);
  const [dealerLimitError, setDealerLimitError] = useState(null);
  const [totalDealersCount, setTotalDealersCount] = useState(0);

  const fetchDealers = async () => {
    try {
      const vendor_id = dealerParent?.id;
      const dealerRes = await fetchData(`/api/dealers?page=${currentPage}&vendor_id=${vendor_id}`,{headers: {
        'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`
      }});
      const dealerData = await dealerRes.json();

      if (dealerData && Array.isArray(dealerData.dealers)) {
        setDealers(dealerData.dealers);
        setTotalPages(dealerData.totalPages || 1);
        
        // Fetch total count of dealers for this vendor
        const countRes = await fetchData(`/api/dealers/count?vendor_id=${vendor_id}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`
        }});
        const countData = await countRes.json();
        if (countData && countData.count !== undefined) {
          setTotalDealersCount(countData.count);
        }
      }
    } catch (error) {
      console.error("Error fetching dealers:", error);
    }
  };

  useEffect(() => {
    if (dealerParent) {
      fetchDealers();
    }
  }, [currentPage, dealerParent]);

  const handleEditDealer = (dealer) => {
    setEditDealer(dealer);
    setShow(true);
  };

  const handleAddDealer = () => {
    if (dealerParent && dealerParent.package_dealers_used >= dealerParent.package_dealers_limit) {
      setDealerLimitError(`You have reached your dealer limit (${dealerParent.package_dealers_limit}). Please upgrade your package to add more dealers.`);
      return;
    }
    setEditDealer(null);
    setShow(true);
    setDealerLimitError(null);
  };

  const handleClose = () => setShow(false);

  if (!dealerParent) {
    return (
      <div className="container mx-auto p-6">
        <p>Loading dealer information...</p>
      </div>
    );
  }

  return (
    <div className="page_content">
      <div className="page_head">
        <Row className="row align-items-center">
          <Col xl={6} md={5} xs={6} className="order-md-1">
            <div className="d-flex align-items-center">
              {selectedDealer && (
                <Button variant="secondary" size="sm" onClick={() => setSelectedDealer(null)} className="me-2">
                  <i className="fa-solid fa-arrow-left"></i>
                </Button>
              )}
              <h3 className="page_title mb-0">Dealer Setup</h3>
            </div>
          </Col>
          <Col xl={2} md={2} xs={6} className="order-md-3">
            <Button 
                variant="custom" 
                size="sm" 
                onClick={handleAddDealer} 
                disabled={dealerParent.package_dealers_used >= dealerParent.package_dealers_limit}
                className="ms-auto"
              >
                <i className="fa fa-plus me-1"></i> Add Dealer
              </Button>
          </Col>
          <Col xl={4} md={5} xs={12} className="order-md-2">
            <div className="d-flex align-items-center justify-content-end gap-3 mt-2 mt-md-0">
              <div className="d-flex align-items-center gap-1">
                <span className="text-muted">Dealer Package Limit:</span>
                <Badge bg="secondary">
                  {dealerParent.package_dealers_used || 0}
                </Badge>
              </div>
              <div className="d-flex align-items-center gap-1">
                <span className="text-muted">Total Dealer Added:</span>
                <Badge bg="info">{totalDealersCount}</Badge>
              </div>
            </div>
          </Col>
        </Row>
      </div>

      <div className="page_body">
        {dealerLimitError && (
          <Alert variant="danger" onClose={() => setDealerLimitError(null)} dismissible>
            {dealerLimitError}
          </Alert>
        )}
        
        {selectedDealer ? (
          <DealerDetails selectedDealer={selectedDealer} />
        ) : (
          <DealerList
            dealers={dealers}
            onEditDealer={handleEditDealer}
            fetchDealers={fetchDealers}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            totalPages={totalPages}
            onEmailSelect={setSelectedDealer}
          />
        )}
      </div>

      <DealerOffcanvas
        show={show}
        handleClose={handleClose}
        fetchDealers={fetchDealers}
        editDealer={editDealer}
        setEditDealer={setEditDealer}
      />
    </div>
  );
}