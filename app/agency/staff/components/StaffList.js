"use client";
import { useState } from "react";
import { Button, Col, ListGroup, Row } from "react-bootstrap";
import Pagination from "../../components/Pagination";
import useFetch from "../../../hooks/useFetch";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";

export default function StaffList({ staff, setStaff, setEditStaff, currentPage, setCurrentPage, totalPages, empName, empEmail, empRole }) {
  const { fetchData, error: fetchError, loading } = useFetch();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState(null);

  const confirmDelete = (staffId) => {
    setSelectedStaffId(staffId);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!selectedStaffId) return;

    if (!selectedStaffId) {
      console.error("No staff ID provided");
      return;
    }

    try {
      const res = await fetchData("/api/staff", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`},
        body: JSON.stringify({ staffId: selectedStaffId }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        console.error("Error deleting staff:", errorData.message);
        return;
      }

      setStaff((prev) => prev.filter((s) => s._id !== selectedStaffId));
    } catch (error) {
      console.error("Delete request failed:", error);
    }

    setShowDeleteModal(false);
    setSelectedStaffId(null);
  };

  return (
    <>
      <div className="w_card">
        <h3 className="w_card_title">Employee List</h3>

        <div className="w_card_list">
          <ListGroup as="ul" variant="flush">
            <ListGroup.Item as="li" key="head" className="w_card_list_head border-0">
              <Row className="align-items-center">
                <Col xl={11} lg={11} sm={10} xs={12}>
                  <Row className="align-items-center">
                    <Col xl={4} lg={4} sm={4} xs={12}>
                      <p className="p_bold"><small>Employee Name</small></p>
                    </Col>
                    <Col xl={4} lg={5} sm={5} xs={12}>
                      <p className="p_bold"><small>Email</small></p>
                    </Col>
                    <Col xl={4} lg={3} sm={3} xs={12}>
                      <p className="p_bold"><small>Roles</small></p>
                    </Col>
                  </Row>
                </Col>
                <Col xl={1} lg={1} sm={2} xs={12}>
                  <p className="p_bold text-center"><small>Action</small></p>
                </Col>
              </Row>
            </ListGroup.Item>

            {Array.isArray(staff) && staff.length > 0 ? (
              staff?.map((s) => (
                <ListGroup.Item as="li" key={s?._id} className="w_card_list_box">
                  <Row className="align-items-md-center">

                    <Col xl={11} lg={11} sm={10} xs={10}>
                      <Row className="align-items-center">
                        <Col xl={4} lg={4} sm={4} xs={12}>
                          <p className="p_bold">{s?.name || "N/A"}</p>
                        </Col>
                        <Col xl={4} lg={5} sm={5} xs={12}>
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Email:</small></p>
                            <p>{s?.email || "N/A"}</p>
                          </div>
                        </Col>
                        <Col xl={4} lg={3} sm={3} xs={6}>
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Roles:</small></p>
                            <p>{s?.role?.name || "N/A"}</p>
                          </div>
                        </Col>
                      </Row>
                    </Col>

                    <Col xl={1} lg={1} sm={2} xs={2}>
                      <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                        {/*  Edit Dealer Basic Info */}
                        <Button variant="custom" size="sm" onClick={() => setEditStaff(s)}>
                          <i className="fa-regular fa-pen-to-square"></i>
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => confirmDelete(s?._id)}>
                          <i className="fa-regular fa-trash"></i>
                        </Button>
                      </div>
                    </Col>
                  </Row>
                </ListGroup.Item>
              ))
            ) : (
              <div className="text-center py-4">No staff found.</div>
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
        title="Delete Employee?"
        body="Are you sure you want to delete this Employee?"
      />
    </>
  );
}
