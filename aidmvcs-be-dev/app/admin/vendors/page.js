"use client";
import { useState, useEffect, Suspense } from "react";
import { Button, Col, Form, Offcanvas, Row, Alert, Badge, InputGroup } from "react-bootstrap";
import CustomLoader from "./../components/CustomLoader";
import VendorForm from "./components/VendorForm";
import VendorList from "./components/VendorList";
import useFetch from "../../hooks/useFetch";
import { useRouter, useSearchParams } from "next/navigation";
import DateRangePickerComponent from "../components/DateRangePicker";

export const dynamic = 'force-dynamic';

// Main content component that uses search params
function VendorManagementContent() {
  const { fetchData, error: fetchError } = useFetch();
  const [show, setShow] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [editVendor, setEditVendor] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const urlSearchParams = useSearchParams();

  // Initialize filters from URL
  const [filters, setFilters] = useState({
    name: urlSearchParams.get('name') || '',
    email: urlSearchParams.get('email') || '',
    subscribed: urlSearchParams.get('subscribed') || '',
    dateRange: {
      startDate: urlSearchParams.get('startDate') ? new Date(urlSearchParams.get('startDate')) : null,
      endDate: urlSearchParams.get('endDate') ? new Date(urlSearchParams.get('endDate')) : null
    }
  });

  const [appliedFilters, setAppliedFilters] = useState(filters);

  const fetchVendors = async () => {
    try {
      setLoading(true);
      let url = `/api/vendors?page=${currentPage}`;
      
      // Add applied filters to URL
      if (appliedFilters.name) url += `&name=${encodeURIComponent(appliedFilters.name)}`;
      if (appliedFilters.email) url += `&email=${encodeURIComponent(appliedFilters.email)}`;
      if (appliedFilters.subscribed) url += `&subscribed=${appliedFilters.subscribed}`;
      if (appliedFilters.dateRange.startDate) url += `&startDate=${appliedFilters.dateRange.startDate.toISOString()}`;
      if (appliedFilters.dateRange.endDate) url += `&endDate=${appliedFilters.dateRange.endDate.toISOString()}`;

      const vendorRes = await fetchData(url);
      const vendorData = await vendorRes.json();

      if (vendorData && Array.isArray(vendorData.vendors)) {
        setVendors(vendorData.vendors);
        setTotalPages(vendorData.totalPages || 1);
      }
    } catch (error) {
      console.error("Error fetching vendors:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVendors();
  }, [currentPage, appliedFilters]);

  const exportToCSV = async () => {
    try {
      let url = `/api/vendors?format=csv`;
      
      // Add applied filters to export URL
      if (appliedFilters.name) url += `&name=${encodeURIComponent(appliedFilters.name)}`;
      if (appliedFilters.email) url += `&email=${encodeURIComponent(appliedFilters.email)}`;
      if (appliedFilters.subscribed) url += `&subscribed=${appliedFilters.subscribed}`;
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
    if (filters.dateRange.startDate) {
      params.set('startDate', filters.dateRange.startDate.toISOString());
    }
    if (filters.dateRange.endDate) {
      params.set('endDate', filters.dateRange.endDate.toISOString());
    }
    
    router.replace(`?${params.toString()}`);
  };

  const handleResetFilters = () => {
    const resetFilters = {
      name: '',
      email: '',
      subscribed: '',
      dateRange: {
        startDate: null,
        endDate: null
      }
    };
    setFilters(resetFilters);
    setAppliedFilters(resetFilters);
    setCurrentPage(1);
    router.replace('/admin/vendors');
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

  const handleEditVendor = (vendorMember) => {
    setEditVendor(vendorMember);
    setShow(true);
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
                <h3 className="page_title mb-0">Agency Management</h3>
                <Button
                  variant="custom"
                  size="sm"
                  onClick={() => {
                    setEditVendor(null);
                    setShow(true);
                  }}
                  className="ms-auto"
                >
                  <i className="fa fa-plus me-1"></i> Add Agency
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="page_body">

          {fetchError && (
            <Alert variant="danger" onClose={() => {}} dismissible>
              <p>{fetchError}</p>
            </Alert>
          )}

          <VendorList
            fetchVendors={fetchVendors}
  vendors={vendors}
  setEditVendor={handleEditVendor}
  currentPage={currentPage}
  setCurrentPage={setCurrentPage}
  totalPages={totalPages}
  filters={filters}
  setFilters={setFilters}
  appliedFilters={appliedFilters}
  setAppliedFilters={setAppliedFilters}
  handleApplyFilters={handleApplyFilters}
  handleResetFilters={handleResetFilters}
  handleDateRangeChange={handleDateRangeChange}
  exportToCSV={exportToCSV}
  loading={loading}
          />
        </div>

        <Offcanvas show={show} onHide={handleClose} placement="end">
          <Offcanvas.Header closeButton>
            <Offcanvas.Title>{editVendor ? "Edit Agency" : "Add Agency"}</Offcanvas.Title>
          </Offcanvas.Header>
          <Offcanvas.Body>
            <VendorForm
              fetchVendors={fetchVendors} 
              setEditVendor={setEditVendor} 
              editVendor={editVendor}
              handleClose={handleClose}
            />
          </Offcanvas.Body>
        </Offcanvas>
      </div>
    </>
  );
}

// Main page component with Suspense boundary
export default function VendorManagementPage() {
  return (
    <Suspense fallback={<CustomLoader />}>
      <VendorManagementContent />
    </Suspense>
  );
}