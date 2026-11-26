"use client";
import { Alert, Badge, Button, ListGroup, Row, Col, Dropdown, Form, Modal } from "react-bootstrap";
import DateRangePickerComponent from "../../components/DateRangePicker";
import Pagination from "../../components/Pagination";
import useFetch from "../../../hooks/useFetch";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";
import { useState } from "react";
import ResetPasswordModal from "./ResetPasswordModal";
import { useRouter } from "next/navigation";

export default function DealerList({ 
  dealers, 
  onEditDealer, 
  fetchDealers, 
  currentPage, 
  setCurrentPage, 
  totalPages, 
  onEmailSelect,
  filters,
  setFilters,
  appliedFilters,
  setAppliedFilters,
  handleApplyFilters,
  handleResetFilters,
  exportToCSV,
  handleDateRangeChange
}) {
  const { fetchData, loading } = useFetch();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedDealer, setSelectedDealer] = useState(null);
  const [passwordError, setPasswordError] = useState(null);
  const router = useRouter();

  const confirmDelete = (dealerId) => {
    setSelectedDealer(dealers.find(d => d._id === dealerId));
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!selectedDealer?._id) return;

    const res = await fetchData("/api/dealers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" ,'Authorization': `Bearer ${localStorage.getItem('token')}`},
      body: JSON.stringify({ dealerId: selectedDealer._id }),
    });

    if (res.ok) {
      fetchDealers();
    }

    setShowDeleteModal(false);
    setSelectedDealer(null);
  };

  const handleResetPassword = async (dealerId, newPassword) => {
    try {
      const res = await fetchData("/api/dealers/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('token')}`},
        body: JSON.stringify({ dealerId, password: newPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to reset password");
      }

      return res;
    } catch (error) {
      setPasswordError(error.message);
      throw error;
    }
  };

  // Pause / deactivate / reactivate a dealership (Betsy, 25 Nov 2026; app/lib/dealerAccountStatus.js).
  const [stateChange, setStateChange] = useState(null); // { dealer, state, reason, busy, error }
  const saveState = async () => {
    setStateChange((c) => ({ ...c, busy: true, error: null }));
    try {
      const res = await fetch("/api/admin/dealer-status", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ dealer_id: stateChange.dealer._id, state: stateChange.state, reason: stateChange.reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save");
      setStateChange(null);
      fetchDealers?.();
    } catch (e) { setStateChange((c) => ({ ...c, busy: false, error: e.message })); }
  };
  const STATE_WORDS = { paused: ["Pause", "warning"], deactivated: ["Deactivate", "danger"], active: ["Reactivate", "success"] };

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
        localStorage.setItem("dealertoken", data.token);
        const newWindow = window.open("/dealer/dashboard", "_blank");
        if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
          router.push("/dealer/dashboard");
        }
      } else {
        console.error("Impersonation failed:", res.message);
      }
    } catch (error) {
      console.error("Error logging in as dealer:", error);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <>
      {/* Search and Filter Section */}
      <div className="w_card">
        <Row className="align-items-center">
          <Col md={7} xs={6}>
            <div className="d-flex align-items-center mb-2">
              <h3 className="w_card_title mb-0">Dealer List</h3>
            </div>
          </Col>
          <Col md={5} xs={6}>
            <div className="d-flex justify-content-end align-items-center mb-2">
              <Button 
                variant="custom" 
                size="sm"
                onClick={exportToCSV}
                disabled={loading || dealers.length === 0}
              ><i className="fa fa-download me-1"></i> Export to CSV
              </Button>
            </div>
          </Col>

          <Col md={12}>
            {/* Filter Controls */}
            <Form onSubmit={handleApplyFilters}>
              <Row className="search_filters gx-1 gy-md-0 gy-1">
                <Col md={2} xs={12}>
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
            
                <Col md={2} xs={12}>
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
                  <Form.Group controlId="dealer_type">
                    <Form.Select
                      value={filters.dealer_type}
                      onChange={(e) => setFilters({...filters, dealer_type: e.target.value})}
                  size="sm"
                    >
                      <option value="">All (Independent + Agency)</option>
                      <option value="independent">Independent</option>
                      <option value="vendor">Agency</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
            
                <Col md={2} xs={6}>
                  <Form.Group controlId="dateRange">
                    <DateRangePickerComponent 
                      onDateRangeChange={handleDateRangeChange}
                      dateRange={filters.dateRange}
                    />
                  </Form.Group>
                </Col>

                <Col xl={2} lg={2} md={2} xs={6}>
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
                {appliedFilters.dealer_type && (
                  <Badge bg="light" text="dark" className="me-2">
                    type: {appliedFilters.dealer_type}
                  </Badge>
                )}
                {appliedFilters.vendor_id && (
                  <Badge bg="light" text="dark" className="me-2">
                    vendor: {appliedFilters.vendor_id}
                  </Badge>
                )}
                {appliedFilters.dateRange.startDate && appliedFilters.dateRange.endDate && (
                  <Badge bg="light" text="dark" className="me-2">
                    date: {appliedFilters.dateRange.startDate.toLocaleDateString()} - {appliedFilters.dateRange.endDate.toLocaleDateString()}
                  </Badge>
                )}
                <span>
                  <Button 
                  variant="link" 
                  size="sm" 
                  onClick={handleResetFilters}
                  className="p-0 ms-2"
                >
                  Clear all
                </Button>
                </span>
                
              </>
            )}
          </Col> */}
        </Row>

        <div className="w_card_list mt-3">
          <ListGroup as="ul" variant="flush">
            <ListGroup.Item as="li" key="head" className="w_card_list_head border-0">
              <Row className="align-items-center g-0">
                <Col xl={11} lg={10} sm={10} xs={9}>
                  <Row className="align-items-center gx-2">
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="p_bold"><small>Name</small></p>
                    </Col>
                    <Col xl={3} lg={3} sm={2} xs={12}>
                      <p className="p_bold"><small>Email</small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={1} xs={12}>
                      <p className="p_bold"><small>Store</small></p>
                    </Col>
                    <Col xl={1} lg={1} sm={1} xs={12}>
                      <p className="p_bold"><small>City</small></p>
                    </Col>
                    <Col xl={1} lg={1} sm={2} xs={12}>
                      <p className="p_bold"><small>Package</small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="p_bold"><small>Agency</small></p>
                    </Col>
                    <Col xl={1} lg={1} sm={2} xs={12}>
                      <p className="p_bold"><small>Expiry Date</small></p>
                    </Col>
                  </Row>
                </Col>
                <Col xl={1} lg={2} sm={2} xs={3}>
                  <p className="p_bold text-center"><small>Action</small></p>
                </Col>
              </Row>
            </ListGroup.Item>

            {Array.isArray(dealers) && dealers.length > 0 ? (
              dealers.map((dealer) => (
                <ListGroup.Item as="li" key={dealer._id} className="w_card_list_box">
                  <Row className="align-items-md-center g-0">
                    <Col xl={11} lg={10} sm={10} xs={9} onClick={() => onEmailSelect(dealer)} className="a_link">
                      <Row className="align-items-center gx-2">
                        <Col xl={2} lg={2} sm={2} xs={12}>
                          <p className="p_bold">
                            {dealer.name || "No Name"}
                            {dealer.account_status && dealer.account_status !== "active" && (
                              <Badge bg={dealer.account_status === "paused" ? "warning" : "danger"} text={dealer.account_status === "paused" ? "dark" : undefined}
                                className="ms-1">{dealer.account_status === "paused" ? "Paused" : "Deactivated"}</Badge>
                            )}
                          </p>
                        </Col>
                        <Col xl={3} lg={3} sm={2} xs={12}>
                        <div className="w_card_list_box_label">
                            <p className="label"><small>Email:</small></p>
                          <p>{dealer.email}</p>
                          </div>
                        </Col>
                        <Col xl={2} lg={2} sm={1} xs={12}>
                        <div className="w_card_list_box_label">
                            <p className="label"><small>Store:</small></p>
                          <p>{dealer.dealer_account_information?.store_name || "N/A"}</p>
                          </div>
                        </Col>
                        <Col xl={1} lg={1} sm={1} xs={12}>
                        <div className="w_card_list_box_label">
                            <p className="label"><small>City:</small></p>
                          <p>{dealer.dealer_account_information?.store_city || "N/A"}</p>
                          </div>
                        </Col>
                        <Col xl={1} lg={1} sm={2} xs={12}>
                        <div className="w_card_list_box_label">
                            <p className="label"><small>Package:</small></p>
                          <p className="me-2">{dealer.current_subscription?.package_id?.name || "No package"}</p>
                          </div>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12}>
                        <div className="w_card_list_box_label">
                            <p className="label"><small>Agency:</small></p>
                          <p>{dealer.vendor_id?.name || "No Vendor"}</p>
                          </div>
                        </Col>
                        <Col xl={1} lg={1} sm={2} xs={12}>
                        <div className="w_card_list_box_label">
                            <p className="label"><small>Expiry Date:</small></p>
                          <p>{formatDate(dealer.package_expiry)}</p>
                          </div>
                        </Col>
                      </Row>
                    </Col>

                    <Col xl={1} lg={2} sm={2} xs={3}>
                      <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                        <Dropdown>
                          <Dropdown.Toggle variant="secondary" id="dropdown-basic" className="btn-sm">
                            <i className="fa-regular fa-ellipsis-vertical"></i>
                          </Dropdown.Toggle>

                          <Dropdown.Menu>
                            <Dropdown.Item onClick={() => onEditDealer({ ...dealer, editonlyprofile: true })}>
                              <i className="fa-regular fa-pen-to-square me-2"></i>Edit Profile
                            </Dropdown.Item>
                            <Dropdown.Item onClick={() => onEditDealer({ ...dealer, editAccount: true, step: 2 })}>
                              <i className="fa-regular fa-file-pen me-2"></i>Edit Account Info
                            </Dropdown.Item>
                            <Dropdown.Item onClick={() => {
                              setSelectedDealer(dealer);
                              setShowPasswordModal(true);
                              setPasswordError(null);
                            }}>
                              <i className="fa-regular fa-key-skeleton me-2"></i>Change Password
                            </Dropdown.Item>
                            <Dropdown.Divider />
                            {["paused", "deactivated", "active"].filter((st) => st !== (dealer.account_status || "active")).map((st) => (
                              <Dropdown.Item key={st} onClick={() => setStateChange({ dealer, state: st, reason: "" })}>
                                <i className={`fa-regular ${st === "active" ? "fa-circle-play" : st === "paused" ? "fa-circle-pause" : "fa-circle-stop"} me-2`}></i>
                                {STATE_WORDS[st][0]} dealership
                              </Dropdown.Item>
                            ))}
                          </Dropdown.Menu>
                        </Dropdown>

                        <Button variant="danger" size="sm" onClick={() => confirmDelete(dealer._id)}>
                          <i className="fa-regular fa-trash"></i>
                        </Button>
                        <Button
                          variant="custom"
                          size="sm"
                          onClick={() => loginAsDealer(dealer._id)}
                          title="Login as this dealer"
                          disabled={loading}
                        >
                          {loading ? 'Logging in...' : <i className="fa-solid fa-right-to-bracket"></i>}
                        </Button>
                      </div>
                    </Col>
                  </Row>
                </ListGroup.Item>
              ))
            ) : (
              <div className="text-center py-4">No dealers found.</div>
            )}
          </ListGroup>

          <Pagination currentPage={currentPage} setCurrentPage={setCurrentPage} totalPages={totalPages} />
        </div>
      </div>

      <DeleteConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete Dealer?"
        body="Are you sure you want to delete this dealer?"
      />

      <ResetPasswordModal
        show={showPasswordModal}
        handleClose={() => setShowPasswordModal(false)}
        dealer={selectedDealer}
        onSuccess={() => {
          setShowPasswordModal(false);
          setSelectedDealer(null);
        }}
        loading={loading}
        error={passwordError}
        onResetPassword={handleResetPassword}
      />
      <Modal show={!!stateChange} onHide={() => setStateChange(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title as="h6">{stateChange ? `${STATE_WORDS[stateChange.state][0]} ${stateChange.dealer.name || "dealership"}` : ""}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="small">
          {stateChange?.error && <Alert variant="danger" className="py-2">{stateChange.error}</Alert>}
          {stateChange?.state === "active" ? (
            <p>The dealership and its staff can sign in again.</p>
          ) : (
            <p>The dealership and all its staff will not be able to sign in until it is reactivated. Its leads, customers,
              settings and AI setup stay as they are; &quot;Login as&quot; still works. To stop the AI messaging its customers,
              use Admin &gt; AI mode.</p>
          )}
          <Form.Control size="sm" as="textarea" rows={2} maxLength={300} value={stateChange?.reason || ""}
            placeholder={stateChange?.state === "active" ? "Note (optional)" : "Why (required, kept in the history)"}
            onChange={(e) => setStateChange((c) => ({ ...c, reason: e.target.value }))} />
          {stateChange?.dealer?.account_status_history?.length > 0 && (
            <div className="mt-2 text-muted">
              Last change: {stateChange.dealer.account_status_history.at(-1).to} by{" "}
              {stateChange.dealer.account_status_history.at(-1).by_name || "-"} ({stateChange.dealer.account_status_history.at(-1).reason || "no reason"})
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button size="sm" variant="secondary" onClick={() => setStateChange(null)}>Cancel</Button>
          <Button size="sm" variant={stateChange ? STATE_WORDS[stateChange.state][1] : "custom"} disabled={stateChange?.busy}
            onClick={saveState}>{stateChange ? STATE_WORDS[stateChange.state][0] : ""}</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}