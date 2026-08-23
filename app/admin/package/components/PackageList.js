// app/components/PackageList.jsx
"use client";
import { Button, ListGroup, Row, Col, Badge, Alert } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";
import { useState } from "react";

export default function PackageList({
  packages,
  setEditPackage,
  fetchPackages,
  currentPage,
  setCurrentPage,
  totalPages,
  userTypeFilter
}) {
  const { fetchData, error: fetchError, loading } = useFetch();
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [alert, setAlert] = useState({ show: false, message: "", variant: "success" });

  const showAlert = (message, variant = "success") => {
    setAlert({ show: true, message, variant });
    setTimeout(() => setAlert({ ...alert, show: false }), 5000);
  };

  const confirmDelete = (id) => {
    setSelectedPackage(id);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!selectedPackage) return;

    if (!selectedPackage) {
      console.error("No Package ID provided");
      return;
    }

    try {
      const res = await fetchData(`/api/packages/${selectedPackage}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('token')}`},
      });

      if (!res.ok) {
        showAlert("Failed to delete package", "danger");
      };

      if (res.ok) {
        setEditPackage(null);
        fetchPackages();
      }
    } catch (err) {
      console.error("Error deleting package:", err);
      showAlert("Failed to delete package", "danger");
    }

    setShowDeleteModal(false);
    setSelectedPackage(null);
  };

  const getPriceDisplay = (pkg) => {
    if (pkg.pricing_model === "per_dealer") {
      return (
        <>
          ${pkg.base_fee} base + ${pkg.price_per_dealer}/dealer
          <br />
          <small className="ms-1 ms-md-0 d-flex align-items-center">(Min {pkg.min_dealers} & Max {pkg.max_dealers} dealers)</small>
        </>
      );
    }
    return (
      <>
        <span>${pkg.price}</span>
        {pkg.max_dealers !== 0 && (
          <>
            <br />
            <small className="ms-1 ms-md-0 d-flex align-items-center">(Max {pkg.max_dealers} dealers)</small>
          </>
        )}
      </>
    );
  };

  const toggleStatus = async (packageId, currentStatus) => {
    const res = await fetchData(`/api/packages/${packageId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" ,'Authorization': `Bearer ${localStorage.getItem('token')}`},
      body: JSON.stringify({ is_active: !currentStatus }),
    });

    if (res.ok) {
      fetchPackages();
    }
  };

  return (
    <>
      {alert.show && (
        <Alert variant={alert.variant} onClose={() => setAlert({ ...alert, show: false })} dismissible>
          {alert.message}
        </Alert>
      )}

      <div className="w_card">
        <h3 className="w_card_title">Package List</h3>

        <div className="w_card_list">
          <ListGroup as="ul" variant="flush">
            <ListGroup.Item as="li" key="head" className="w_card_list_head border-0">
              <Row className="align-items-center gx-2">
                <Col xl={5} lg={4} sm={4} xs={12}>
                  <p className="p_bold"><small>Package Name</small></p>
                </Col>
                <Col xl={1} lg={1} sm={1} xs={12}>
                  <p className="p_bold"><small>User Type</small></p>
                </Col>
                <Col xl={2} lg={3} sm={2} xs={12}>
                  <p className="p_bold"><small>Price ($)</small></p>
                </Col>
                <Col xl={2} lg={1} sm={2} xs={12}>
                  <p className="p_bold"><small>Billing</small></p>
                </Col>
                <Col xl={1} lg={1} sm={1} xs={12}>
                  <p className="p_bold"><small>Status</small></p>
                </Col>
                {/*<Col xl={1} lg={2} sm={2} xs={12}>
                  <p className="p_bold text-center"><small>Action</small></p>
                </Col>
                */}
              </Row>
            </ListGroup.Item>

            {Array.isArray(packages) && packages.length > 0 ? (
              packages
                .filter(pkg => userTypeFilter ? pkg.for_user_type === userTypeFilter : true)
                .map((pkg) => (
                  <ListGroup.Item as="li" key={pkg._id} className="w_card_list_box">
                    <Row className="align-items-center gx-2 gy-md-0 gy-1">
                      <Col xl={5} lg={4} sm={4} xs={10}>
                        <p className="p_bold d-flex align-items-center gap-2">
                          <span>{pkg.name}</span>
                          {pkg.hide && (
                            <Badge bg="secondary">Hidden</Badge>
                          )}
                        </p>
                        <small className="text-muted">{pkg.description}</small>
                      </Col>
                      <Col xl={1} lg={1} sm={1} xs={2}>
                        <Badge
                          pill
                          bg="light"
                          className={`border text-capitalize ${pkg.for_user_type === "dealer"
                            ? "text-info-emphasis border-info-emphasis"
                            : "text-warning-emphasis border-warning-emphasis"
                            }`}>
                          {pkg.for_user_type === 'vendor' ? 'Agency' : 'Dealer'}
                        </Badge>
                      </Col>
                      <Col xl={2} lg={3} sm={2} xs={12}>
                        <div className="w_card_list_box_label">
                          <p className="label"><small>Price:</small></p>
                          <p className="d-flex align-items-center d-md-block">{getPriceDisplay(pkg)}</p>
                        </div>
                      </Col>
                      <Col xl={2} lg={1} sm={2} xs={6} className="d-flex align-items-center d-md-block">
                        <div className="w_card_list_box_label align-items-stretch">
                          <p className="label"><small>Billing:</small></p>
                          <div>
                            <p>{pkg.billing_interval === 'month' ? 'Monthly' : 'Yearly'}</p>
                            <small className="text-muted ms-0 d-flex align-items-center">{pkg.discount}% discount</small>
                          </div>
                        </div>
                      </Col>
                      <Col xl={1} lg={1} sm={1} xs={2}>
                        <Badge bg={pkg.is_active ? "success" : "danger"}>
                          {pkg.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </Col>
                      <Col xl={1} lg={2} sm={2} xs={4}>
                        <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                          <Button
                            variant="custom"
                            size="sm"
                            onClick={() => setEditPackage(pkg)}
                          >
                            <i className="fa-regular fa-pen-to-square"></i>
                          </Button>
                          {/* Keep status toggle and delete commented if not needed */}
                        </div>
                      </Col>
                    </Row>
                  </ListGroup.Item>
                ))
            ) : (
              <div className="text-center py-4">No packages found.</div>
            )}
          </ListGroup>


        </div>
      </div>

      {/* modal */}
      <DeleteConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete Package?"
        body="Are you sure you want to delete this package?"
      />
    </>
  );
}