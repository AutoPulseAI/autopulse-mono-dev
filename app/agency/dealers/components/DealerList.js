"use client";
import { useState } from "react";
import { Button, ListGroup, Row, Col, Dropdown } from "react-bootstrap";
import Pagination from "../../components/Pagination";
import useFetch from "../../../hooks/useFetch";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";
import { useRouter } from "next/navigation";

export default function DealerList({ dealers, onEditDealer, fetchDealers, currentPage, setCurrentPage, totalPages, onEmailSelect }) {
  const { fetchData, error: fetchError, loading } = useFetch();
  const router = useRouter();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedDealerId, setSelectedDealerId] = useState(null);

  const confirmDelete = (dealerId) => {
    setSelectedDealerId(dealerId);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!selectedDealerId) return;

    const res = await fetchData("/api/dealers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" ,'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`},
      body: JSON.stringify({ dealerId: selectedDealerId }),
    });

    if (res.ok) {
      fetchDealers();
    }

    setShowDeleteModal(false);
    setSelectedDealerId(null);
  };
  const loginAsDealer = async (dealerId) => {
    try {
      const res = await fetchData("/api/login-as", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`
        },
        body: JSON.stringify({ "userId": dealerId }),
      });
      const data = await res.json();
      if (data.token) {
        // Store token in localStorage
        localStorage.setItem("dealertoken", data.token);

        const newWindow = window.open("/dealer/dashboard", "_blank");

        // Focus the new tab if it was blocked by popup blocker
        if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
          // Fallback to same tab if popup blocked
          router.push("/dealer/dashboard");
        }
      } else {
        console.error("Impersonation failed:", res.message);
        // Handle error (show toast, etc.)
      }
    } catch (error) {
      console.error("Error logging in as dealer:", error);
      // Handle error
    }
  };

  return (
    <>
      <div className="w_card">
        <h3 className="w_card_title">Dealer List</h3>

        <div className="w_card_list">
          <ListGroup as="ul" variant="flush">
            <ListGroup.Item as="li" key="head" className="w_card_list_head border-0">
              <Row className="align-items-center">
                <Col xl={10} lg={10} sm={10} xs={12}>
                  <Row className="align-items-center">
                    <Col xl={3} lg={3} sm={3} xs={12}>
                      <p className="p_bold"><small>Name</small></p>
                    </Col>
                    <Col xl={3} lg={3} sm={3} xs={12}>
                      <p className="p_bold"><small>Email</small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="p_bold"><small>Store</small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="p_bold"><small>City</small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="p_bold"><small>Subscription Renew Date</small></p>
                    </Col>
                  </Row>
                </Col>
                <Col xl={2} lg={2} sm={2} xs={12}>
                  <p className="p_bold text-center"><small>Action</small></p>
                </Col>
              </Row>
            </ListGroup.Item>

            {Array.isArray(dealers) && dealers.length > 0 ? (
              dealers.map((dealer) => (
                <ListGroup.Item as="li" key={dealer._id} className="w_card_list_box">
                  <Row className="align-items-md-center g-0">
                    <Col xl={10} lg={10} sm={10} xs={9} onClick={() => onEmailSelect(dealer)} className="a_link">
                      <Row className="align-items-center">
                        <Col xl={3} lg={3} sm={3} xs={12}>
                          <p className="p_bold">{dealer.name || "No Name"}</p>
                        </Col>
                        <Col xl={3} lg={3} sm={3} xs={12}>
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Email:</small></p>
                            <p>{dealer.email}</p>
                          </div>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12}>
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Store:</small></p>
                            <p>{dealer.dealer_account_information?.store_name || "N/A"}</p>
                          </div>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12}>
                          <div className="w_card_list_box_label">
                            <p className="label"><small>City:</small></p>
                            <p>{dealer.dealer_account_information?.store_city || "N/A"}</p>
                          </div>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12}>
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Subscription Renew Date:</small></p>
                            <p>{"N/A"}</p>
                          </div>
                        </Col>
                      </Row>
                    </Col>

                    <Col xl={2} lg={2} sm={2} xs={3}>
                      <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                        <Dropdown>
                          <Dropdown.Toggle variant="secondary" id="dropdown-basic" className="btn-sm">
                            <i className="fa-regular fa-ellipsis-vertical"></i>
                          </Dropdown.Toggle>

                          <Dropdown.Menu>
                            <Dropdown.Item onClick={() => onEditDealer({ ...dealer, editonlyprofile: true })}><i className="fa-regular fa-pen-to-square me-2"></i>Edit Profile</Dropdown.Item>
                            <Dropdown.Item onClick={() => onEditDealer({ ...dealer, editAccount: true, step: 2 })}><i className="fa-regular fa-file-pen me-2"></i>Edit Account Info</Dropdown.Item>
                            <Dropdown.Item onClick={() => onEditDealer({ ...dealer, editonlyprofile: true })}><i className="fa-regular fa-key-skeleton me-2"></i>Change Password</Dropdown.Item>
                          </Dropdown.Menu>
                        </Dropdown>

                        {/*  Edit Dealer Basic Info */}
                        {/* <Button variant="custom" size="sm" onClick={() => onEditDealer({ ...dealer, editonlyprofile: true })}>
                          <i className="fa-regular fa-pen-to-square"></i>
                        </Button> */}

                        {/* <Button
                          variant="custom"
                          size="sm"
                          onClick={() => onEditDealer({ ...dealer, editAccount: true, step: 2 })}
                        >
                          Edit Account Info
                        </Button> */}
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

      {/* modal */}
      <DeleteConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete Dealer?"
        body="Are you sure you want to delete this dealer?"
      />
    </>

  );
}
