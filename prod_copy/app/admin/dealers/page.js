"use client";
import { useState, useEffect, Suspense } from "react";
import { Button, Offcanvas, Alert, Badge, Form, InputGroup } from "react-bootstrap";
import DealerForm from "./components/DealerForm";
import DealerList from "./components/DealerList";
import DealerOffcanvas from "./components/DealerOffcanvas";
import DealerDetails from "./components/DealerDetails";
import useFetch from "../../hooks/useFetch";
import { useRouter, useSearchParams } from "next/navigation";
import DateRangePickerComponent from "../components/DateRangePicker";
import CustomLoader from "../components/CustomLoader";

export const dynamic = 'force-dynamic';

// Main content component that uses search params
function DealerManagementContent() {
  const { fetchData, error: fetchError, loading } = useFetch();
  const [dealers, setDealers] = useState([]);
  const [editDealer, setEditDealer] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedDealer, setSelectedDealer] = useState(null);
  const [show, setShow] = useState(false);
  const [dealerLimitError, setDealerLimitError] = useState(null);
  const router = useRouter();
  const urlSearchParams = useSearchParams();

  // Initialize filters from URL
  const [filters, setFilters] = useState({
    name: urlSearchParams.get('name') || '',
    email: urlSearchParams.get('email') || '',
    subscribed: urlSearchParams.get('subscribed') || '',
    dealer_type: urlSearchParams.get('dealer_type') || '',
    vendor_id: urlSearchParams.get('vendor_id') || '',
    dateRange: {
      startDate: urlSearchParams.get('startDate') ? new Date(urlSearchParams.get('startDate')) : null,
      endDate: urlSearchParams.get('endDate') ? new Date(urlSearchParams.get('endDate')) : null
    }
  });

  const [appliedFilters, setAppliedFilters] = useState(filters);

  const fetchDealers = async () => {
    try {
      let url = `/api/dealers?page=${currentPage}`;
      
      // Add applied filters to URL
      if (appliedFilters.name) url += `&name=${encodeURIComponent(appliedFilters.name)}`;
      if (appliedFilters.email) url += `&email=${encodeURIComponent(appliedFilters.email)}`;
      if (appliedFilters.subscribed) url += `&subscribed=${appliedFilters.subscribed}`;
      if (appliedFilters.dealer_type) url += `&dealer_type=${appliedFilters.dealer_type}`;
      if (appliedFilters.vendor_id) url += `&vendor_id=${appliedFilters.vendor_id}`;
      if (appliedFilters.dateRange.startDate) url += `&startDate=${appliedFilters.dateRange.startDate.toISOString()}`;
      if (appliedFilters.dateRange.endDate) url += `&endDate=${appliedFilters.dateRange.endDate.toISOString()}`;

      const dealerRes = await fetchData(url);
      const dealerData = await dealerRes.json();

      if (dealerData && Array.isArray(dealerData.dealers)) {
        setDealers(dealerData.dealers);
        setTotalPages(dealerData.totalPages || 1);
      }
    } catch (error) {
      console.error("Error fetching dealers:", error);
    }
  };

  useEffect(() => {
    fetchDealers();
  }, [currentPage, appliedFilters]);

  const exportToCSV = async () => {
    try {
      let url = `/api/dealers?format=csv`;
      
      // Add applied filters to export URL
      if (appliedFilters.name) url += `&name=${encodeURIComponent(appliedFilters.name)}`;
      if (appliedFilters.email) url += `&email=${encodeURIComponent(appliedFilters.email)}`;
      if (appliedFilters.subscribed) url += `&subscribed=${appliedFilters.subscribed}`;
      if (appliedFilters.dealer_type) url += `&dealer_type=${appliedFilters.dealer_type}`;
      if (appliedFilters.vendor_id) url += `&vendor_id=${appliedFilters.vendor_id}`;
      if (appliedFilters.dateRange.startDate) url += `&startDate=${appliedFilters.dateRange.startDate.toISOString()}`;
      if (appliedFilters.dateRange.endDate) url += `&endDate=${appliedFilters.dateRange.endDate.toISOString()}`;

      // Trigger download
      window.location.href = url;
    } catch (error) {
      console.error("Error exporting to CSV:", error);
    }
  };

  const handleApplyFilters = (e) => {
    e.preventDefault();
    setAppliedFilters(filters);
    setCurrentPage(1);
    
    // Update URL
    const params = new URLSearchParams();
    if (filters.name) params.set('name', filters.name);
    if (filters.email) params.set('email', filters.email);
    if (filters.subscribed) params.set('subscribed', filters.subscribed);
    if (filters.dealer_type) params.set('dealer_type', filters.dealer_type);
    if (filters.vendor_id) params.set('vendor_id', filters.vendor_id);
    if (filters.dateRange.startDate) params.set('startDate', filters.dateRange.startDate.toISOString());
    if (filters.dateRange.endDate) params.set('endDate', filters.dateRange.endDate.toISOString());
    
    router.replace(`?${params.toString()}`);
  };

  const handleResetFilters = () => {
    const resetFilters = {
      name: '',
      email: '',
      subscribed: '',
      dealer_type: '',
      vendor_id: '',
      dateRange: {
        startDate: null,
        endDate: null
      }
    };
    setFilters(resetFilters);
    setAppliedFilters(resetFilters);
    setCurrentPage(1);
    router.replace('/admin/dealers');
  };

  const handleDateRangeChange = (range) => {
    // Ensure we have valid dates
    const startDate = range.startDate ? new Date(range.startDate) : null;
    const endDate = range.endDate ? new Date(range.endDate) : null;
    
    // Reset time parts to ensure full day coverage
    if (startDate) startDate.setHours(0, 0, 0, 0);
    if (endDate) endDate.setHours(23, 59, 59, 999);

    setFilters({
      ...filters,
      dateRange: {
        startDate,
        endDate
      }
    });
  };

  const handleEditDealer = (dealer) => {
    setEditDealer(dealer);
    setShow(true);
  };

  const handleAddDealer = () => {
    setEditDealer(null);
    setShow(true);
    setDealerLimitError(null);
  };

  const handleClose = () => setShow(false);

  if (loading) {
    return <CustomLoader />;
  }

  return (
    <>
      <div className="page_content">
        <div className="page_head">
          <div className="row align-items-center">
            <div className="col col-12">
              <div className="d-flex align-items-center">
                {selectedDealer && (
                  <Button variant="secondary" size="sm" onClick={() => setSelectedDealer(null)} className="me-2">
                    <i className="fa-solid fa-arrow-left"></i>
                  </Button>
                )}
                <h3 className="page_title mb-0">Dealers</h3>
                <div className="ms-auto d-flex align-items-center gap-3">
                  <Button
                    variant="custom"
                    size="sm"
                    onClick={handleAddDealer}
                  >
                    <i className="fa fa-plus me-1"></i> Add Dealer
                  </Button>
                </div>
              </div>
            </div>
          </div>
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
              filters={filters}
              setFilters={setFilters}
              appliedFilters={appliedFilters}
              setAppliedFilters={setAppliedFilters}
              handleApplyFilters={handleApplyFilters}
              handleResetFilters={handleResetFilters}
              exportToCSV={exportToCSV}
              handleDateRangeChange={handleDateRangeChange}
              loading={loading}
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
    </>
  );
}

// Main page component with Suspense boundary
export default function DealerManagementPage() {
  return (
    <Suspense fallback={<CustomLoader />}>
      <DealerManagementContent />
    </Suspense>
  );
}