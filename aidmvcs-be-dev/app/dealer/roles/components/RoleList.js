"use client";
import { useState } from "react";
import { Button, Col, ListGroup, Row } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";

export default function RoleList({ roles, setRoles, setEditRole }) {
  const { fetchData } = useFetch();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState(null);

  const confirmDelete = (roleId) => {
    setSelectedRoleId(roleId);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!selectedRoleId) return;

      const res = await fetchData("/api/roles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('dealertoken')}` },
      body: JSON.stringify({ roleId: selectedRoleId }),
    });

    if (res.ok) {
      setRoles((prev) => prev.filter((r) => r._id !== selectedRoleId));
    }

    setShowDeleteModal(false);
    setSelectedRoleId(null);
  };

  return (
    <>
      <Row className="justify-content-center">
        <Col lg={10}>
          <div className="w_card">
            <h3 className="w_card_title">Role List</h3>

            <div className="w_card_list">
              <ListGroup as="ul" variant="flush">
                <ListGroup.Item as="li" key="head" className="w_card_list_head border-0">
                  <Row className="align-items-center">
                    <Col xl={11} lg={10} sm={10} xs={12}>
                      <p className="p_bold"><small>Name</small></p>
                    </Col>
                    <Col xl={1} lg={2} sm={2} xs={12}>
                      <p className="p_bold text-center"><small>Action</small></p>
                    </Col>
                  </Row>
                </ListGroup.Item>

                {Array.isArray(roles) && roles.length > 0 ? (
                  roles.map((role) => {
                    const isAdmin = (role?.name || '').toLowerCase() === 'admin';
                    return (
                    <ListGroup.Item as="li" key={role?._id} className="w_card_list_box">
                      <Row className="align-items-center gx-2 gx-md-0">
                        <Col xl={11} lg={10} sm={10} xs={10}>
                          <p className="p_bold">{role?.name || "N/A"}</p>
                        </Col>

                        <Col xl={1} lg={2} sm={2} xs={2}>
                          <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                            <Button
                              variant="custom"
                              size="sm"
                              disabled={isAdmin}
                              title={isAdmin ? 'Admin role cannot be edited' : ''}
                              onClick={() => {
                                if (isAdmin) return;
                                setEditRole({
                                  _id: role?._id,
                                  name: role?.name || "",
                                  permissions: role?.permissions?.map(p => (typeof p === "string" ? p : p._id)) || [],
                                })
                              }}
                            >
                              <i className="fa-regular fa-pen-to-square"></i>
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={isAdmin}
                              title={isAdmin ? 'Admin role cannot be deleted' : ''}
                              onClick={() => { if (!isAdmin) confirmDelete(role?._id); }}
                            >
                              <i className="fa-regular fa-trash"></i>
                            </Button>
                          </div>
                        </Col>
                      </Row>
                    </ListGroup.Item>
                    );
                  })
                ) : (
                  <div className="text-center py-4">No roles found.</div>
                )}
              </ListGroup>
            </div>
          </div>
        </Col>
      </Row>

      {/* modal */}
      <DeleteConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete Role?"
        body="Are you sure you want to delete this role?"
      />
    </>
  );
}
