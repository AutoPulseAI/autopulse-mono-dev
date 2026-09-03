"use client";
import { useState, useEffect } from "react";
import { formatTimestamp } from "../../../utils/dateUtils";
import { Button, ListGroup, Row, Col, Dropdown, Form, Badge, Modal } from "react-bootstrap";
import Pagination from "../../components/Pagination";
import useFetch from "../../../hooks/useFetch";
import AssignPackageModal from "./AssignPackageModal";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";
import ResetPasswordModal from "./ResetPasswordModal";
import DateRangePickerComponent from "../../components/DateRangePicker";
import { useRouter } from "next/navigation";

export default function VendorList({ fetchVendors,
  vendors,
  setEditVendor,
  currentPage,
  setCurrentPage,
  totalPages,
  filters,
  setFilters,
  appliedFilters,
  setAppliedFilters,
  handleApplyFilters,
  handleResetFilters,
  handleDateRangeChange,
  exportToCSV }) {
  const { fetchData, error: fetchError, loading } = useFetch();
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [packages, setPackages] = useState([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const router = useRouter();
  // Fetch packages when component mounts
  useEffect(() => {
    const fetchPackages = async () => {
      const res = await fetch('/api/packages?for_user_type=vendor',{headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }});
      const data = await res.json();
      if (res.ok) setPackages(data.packages);
    };
    fetchPackages();
  }, []);

  const confirmDelete = (vendorId) => {
    setSelectedVendorId(vendorId);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!selectedVendorId) return;

    if (!selectedVendorId) {
      console.error("No Agency ID provided");
      return;
    }

    try {
      const res = await fetch("/api/vendors", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('token')}`},
        body: JSON.stringify({ vendorId: selectedVendorId }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        console.error("Error deleting agency:", errorData.message);
        return;
      } else {
        fetchVendors(); // Refresh the list
      }

    } catch (error) {
      console.error("Delete request failed:", error);
    }

    setShowDeleteModal(false);
    setSelectedVendorId(null);
  };

  // const handleDelete = async () => {
  //   if (!selectedVendorId) return;

  //   const res = await fetch("/api/vendors", {
  //     method: "DELETE",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({ vendorId: selectedVendorId }),
  //   });

  //   if (res.ok) {
  //     setEditVendor(null);
  //     fetchVendors(); // Refresh the list
  //   }

  //   setShowDeleteModal(false);
  //   setSelectedVendorId(null);
  // };

  const handleAssignClick = (vendor) => {
    setSelectedVendor(vendor);
    setShowAssignModal(true);
  };

  const loginAsDealer = async (dealerId) => {
    try {
      const res = await fetchData("/api/login-as", {
        method: "POST",
        headers: {
          "Content-Type": "application/json", 
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ "userId": dealerId }),
      });
      const data = await res.json();
      if (data.token) {
        localStorage.setItem("vendortoken", data.token);
        const newWindow = window.open("/agency/dashboard", "_blank");
        if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
          router.push("/agency/dashboard");
        }
      } else {
        console.error("Impersonation failed:", res.message);
      }
    } catch (error) {
      console.error("Error logging in as dealer:", error);
    }
  };

  return (
    <>
      <div className="w_card">
        <Row className="align-items-center">
          <Col md={7} xs={6}>
            <div className="d-flex align-items-center mb-2">
              <h3 className="w_card_title mb-0">Agency List</h3>
            </div>
          </Col>
          <Col md={5} xs={6}>
            <div className="d-flex justify-content-end align-items-center mb-2">
              <Button 
                variant="custom" 
                size="sm"
                onClick={exportToCSV}
                disabled={loading || vendors.length === 0}
              ><i className="fa fa-download me-1"></i> Export to CSV
              </Button>
            </div>
          </Col>

          <Col md={12}>
            <Form onSubmit={handleApplyFilters}>
              <Row className="search_filters gx-1 gy-md-0 gy-1">
                <Col md={3} xs={12}>
                  <Form.Group controlId="name">
                    <Form.Control
                      type="text"
                      placeholder="Filter by name"
                      value={filters.name}
                      onChange={(e) => setFilters({...filters, name: e.target.value})}
                  size="sm"
                    />
                  </Form.Group>
                </Col>
                
                <Col md={3} xs={12}>
                  <Form.Group controlId="email">
                    <Form.Control
                      type="text"
                      placeholder="Filter by email"
                      value={filters.email}
                      onChange={(e) => setFilters({...filters, email: e.target.value})}
                  size="sm"
                    />
                  </Form.Group>
                </Col>
                
                <Col md={2} xs={6}>
                  <Form.Group controlId="subscribed">
                    <Form.Select
                      value={filters.subscribed}
                      onChange={(e) => setFilters({...filters, subscribed: e.target.value})}
                  size="sm"
                    >
                      <option value="">All (Subscribed + Unsubscribed)</option>
                      <option value="1">Subscribed</option>
                      <option value="0">Unsubscribed</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                
                <Col md={2} xs={6}>
                  <Form.Group controlId="dateRange">
                    <DateRangePickerComponent 
                      onDateRangeChange={handleDateRangeChange}
                      dateRange={{
                        startDate: filters.dateRange.startDate,
                        endDate: filters.dateRange.endDate
                      }}
                    />
                  </Form.Group>
                </Col>
                
                <Col md={2} xs={12}>
                  <div className="d-flex gap-1">
                    <Button
                      variant="custom"
                      type="submit"
                      size="sm"
                      className="w-50"
                    >
                      Search
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={handleResetFilters}
                      size="sm"
                      className="w-50"
                    >
                      Clear
                    </Button>
                  </div>
                </Col>
              </Row>
            </Form>
          </Col>

          {/* <Col md={12}>
            {Object.entries(appliedFilters).some(([key, value]) => 
              (typeof value === 'string' && value) || 
              (typeof value === 'object' && value.startDate)
            ) && (
              <>
                <small className="text-muted me-2">Active filters:</small>
                {appliedFilters.name && (
                  <Badge bg="light" text="dark" className="me-2">
                    name: {appliedFilters.name}
                  </Badge>
                )}
                {appliedFilters.email && (
                  <Badge bg="light" text="dark" className="me-2">
                    email: {appliedFilters.email}
                  </Badge>
                )}
                {appliedFilters.subscribed && (
                  <Badge bg="light" text="dark" className="me-2">
                    subscribed: {appliedFilters.subscribed === '1' ? 'Yes' : 'No'}
                  </Badge>
                )}
                {appliedFilters.dateRange.startDate && appliedFilters.dateRange.endDate && (
                  <Badge bg="light" text="dark" className="me-2">
                    date: {appliedFilters.dateRange.startDate.toLocaleDateString()} - {appliedFilters.dateRange.endDate.toLocaleDateString()}
                  </Badge>
                )}
                <Button 
                  variant="link" 
                  size="sm" 
                  onClick={handleResetFilters}
                  className="p-0 ms-2"
                >
                  Clear all
                </Button>
              </>
            )}
          </Col> */}
              
        </Row>

        <div className="w_card_list mt-3">
          <ListGroup as="ul" variant="flush">
            <ListGroup.Item as="li" key="head" className="w_card_list_head border-0">
              <Row className="align-items-md-center">
                <Col xl={11} lg={11} sm={10} xs={10}>
                  <Row className="align-items-center">
                    <Col xl={3} lg={2} sm={2} xs={12}>
                      <p className="p_bold"><small>Name</small></p>
                    </Col>
                    <Col xl={4} lg={4} sm={4} xs={12}>
                      <p className="p_bold"><small>Email</small></p>
                    </Col>
                    <Col xl={2} lg={3} sm={3} xs={12}>
                      <p className="p_bold"><small>Package</small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="p_bold"><small>Expiry Date</small></p>
                    </Col>
                    {/* <Col xl={1} lg={1} sm={5} xs={12}>
                      <p className="p_bold"><small>Dealers</small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={5} xs={12}>
                      <p className="p_bold"><small>Cost</small></p>
                    </Col> */}
                  </Row>
                </Col>
                <Col xl={1} lg={1} sm={2} xs={12}>
                  <p className="p_bold text-center"><small>Action</small></p>
                </Col>
              </Row>
            </ListGroup.Item>

            {Array.isArray(vendors) && vendors.length > 0 ? (
              vendors.map((vendor) => (
                <ListGroup.Item as="li" key={vendor._id} className="w_card_list_box">
                  <Row className="align-items-md-center g-0">
                    <Col xl={11} lg={11} sm={10} xs={10}>
                      <Row className="align-items-center">
                        <Col xl={3} lg={2} sm={2} xs={12}>
                          <p className="p_bold">{vendor.name}</p>
                        </Col>
                        <Col xl={4} lg={4} sm={4} xs={12}>
                        <div className="w_card_list_box_label">
                                <p className="label"><small>Email:</small></p>
                          <p>{vendor.email}</p>
                          </div>
                        </Col>
                        <Col xl={2} lg={3} sm={3} xs={12}>
                        <div className="w_card_list_box_label">
                                <p className="label"><small>Package:</small></p>
                          <div className="d-flex align-items-center">
                            <p className="me-1">{vendor.current_subscription?.package_id?.name || "No package"}</p>
                            <Badge bg={vendor.subscription_type === "Manual" ? "custom" : "warning"}>
                              {vendor.subscription_type || "None"}
                            </Badge>
                          </div>
                          </div>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12}>
                        <div className="w_card_list_box_label">
                                <p className="label"><small>Expiry Date:</small></p>
                          <p>
                            {formatTimestamp(vendor.package_expiry) || 'N/A'}
                          </p>
                          </div>
                        </Col>
                        {/* <Col xl={1} lg={1} sm={5} xs={12}>
                          <p>
                            {vendor.package_dealers_used || 0}
                          </p>
                        </Col>
                        <Col xl={2} lg={2} sm={5} xs={12}>
                          {vendor.current_subscription?.price ? (
                            <p>${vendor.current_subscription.price.toFixed(2)}</p>
                          ) : (
                            <p>$0.00</p>
                          )}
                        </Col> */}
                      </Row>
                    </Col>
                    <Col xl={1} lg={1} sm={2} xs={2}>
                      <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                        <Button
                          variant="custom"
                          size="sm"
                          onClick={() => loginAsDealer(vendor._id)}
                          title="Login as this Vendor"
                          disabled={loading}
                        >
                          {loading ? 'Logging in...' : <i className="fa-solid fa-right-to-bracket"></i>}
                        </Button>
                        <Dropdown>
                          <Dropdown.Toggle variant="secondary" size="sm" id="dropdown-basic" className="btn-sm">
                            <i className="fa-regular fa-ellipsis-vertical"></i>
                          </Dropdown.Toggle>
                          <Dropdown.Menu>
                            <Dropdown.Item onClick={() => setEditVendor(vendor)}>
                              <i className="fa-regular fa-pen-to-square me-2"></i>Edit
                            </Dropdown.Item>
                            <Dropdown.Item onClick={() => handleAssignClick(vendor)}>
                              <i className="fa-regular fa-calendar-range me-2"></i>Assign Package
                            </Dropdown.Item>
                            <Dropdown.Item onClick={() => {
                              setSelectedVendor(vendor);
                              setShowResetModal(true);
                            }}>
                              <i className="fa-regular fa-key me-2"></i>Change Password
                            </Dropdown.Item>
                            <Dropdown.Item onClick={() => confirmDelete(vendor?._id)} className="text-danger">
                              <i className="fa-regular fa-trash me-2"></i>Delete
                            </Dropdown.Item>
                          </Dropdown.Menu>
                        </Dropdown>
                      </div>
                    </Col>
                  </Row>
                </ListGroup.Item>
              ))
            ) : (
              <div className="text-center py-4">No parent vendors found.</div>
            )}
          </ListGroup>

          <Pagination currentPage={currentPage} setCurrentPage={setCurrentPage} totalPages={totalPages} />
        </div>

        <AssignPackageModal
          show={showAssignModal}
          handleClose={() => setShowAssignModal(false)}
          vendor={selectedVendor}
          packages={packages}
          onAssignSuccess={fetchVendors} // This will refresh the list after assignment
        />
        <ResetPasswordModal 
          show={showResetModal}
          handleClose={() => setShowResetModal(false)}
          vendor={selectedVendor}
          onSuccess={() => {
            setShowResetModal(false);
            fetchVendors();
          }}
        />
      </div>

      {/* modal */}
      <DeleteConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete Agency?"
        body="Are you sure you want to delete this Agency?"
      />
    </>
  );
}