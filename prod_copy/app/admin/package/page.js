// app/admin/packages/page.jsx
"use client";
import { useState, useEffect } from "react";
import { Row, Col, Button, Offcanvas } from "react-bootstrap";
import PackageForm from "./components/PackageForm";
import PackageList from "./components/PackageList";
import useFetch from "../../hooks/useFetch";

export default function PackageManagement() {
  const { fetchData, error: fetchError } = useFetch();
  const [packages, setPackages] = useState([]);
  const [editPackage, setEditPackage] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [userTypeFilter, setUserTypeFilter] = useState(""); 
  const [show, setShow] = useState(false);

  const fetchPackages = async () => {
    try {
      const res = await fetchData(`/api/packages?page=${currentPage}`,{headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }});
      const data = await res.json();

      if (data && Array.isArray(data.packages)) {
        setPackages(data.packages);
        setTotalPages(data.totalPages || 1);
      }
    } catch (error) {
      console.error("Error fetching packages:", error);
    }
  };

  useEffect(() => {
    fetchPackages();
  }, [currentPage, userTypeFilter]);

  const handleEditPackage = (pkg) => {
    setEditPackage(pkg);
    setShow(true);
  };

  const handleClose = () => setShow(false);

  return (
    <>
      <div className="page_content">
        <div className="page_head">
          <div className="row align-items-center">
            <div className="col col-12">
              <div className="d-flex align-items-center">
                <h3 className="page_title mb-0">Subscription Packages Management</h3>
                <Button
                  variant="custom"
                  size="sm"
                  onClick={() => {
                    setEditPackage(null);
                    setShow(true);
                  }}
                  className="ms-auto text-nowrap"
                >
                  <i className="fa fa-plus me-1"></i> Add Package
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="page_body">
          {fetchError && (
            <div className="alert alert-danger">
              <p>{fetchError}</p>
            </div>
          )}

          <Row className="mb-3">
            <Col>
              <div className="btn-group btn-group-sm">
                <button
                  className={`btn ${userTypeFilter === "" ? "btn-custom" : "btn-outline-custom"}`}
                  onClick={() => setUserTypeFilter("")}
                >
                  All Packages
                </button>
                <button
                  className={`btn ${userTypeFilter === "vendor" ? "btn-custom" : "btn-outline-custom"}`}
                  onClick={() => setUserTypeFilter("vendor")}
                >
                  Agency Packages
                </button>
                <button
                  className={`btn ${userTypeFilter === "dealer" ? "btn-custom" : "btn-outline-custom"}`}
                  onClick={() => setUserTypeFilter("dealer")}
                >
                  Dealer Packages
                </button>
              </div>
            </Col>
          </Row>

          <PackageList
            packages={packages}
            setPackages={setPackages}
            setEditPackage={handleEditPackage}
            fetchPackages={fetchPackages}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            totalPages={totalPages}
            userTypeFilter={userTypeFilter}
          />

        </div>

        <Offcanvas show={show} onHide={handleClose} placement="end">
          <Offcanvas.Header closeButton>
            <Offcanvas.Title>{editPackage ? "Edit Package" : "Add Package"}</Offcanvas.Title>
          </Offcanvas.Header>
          <Offcanvas.Body>
            <PackageForm
              fetchPackages={fetchPackages}
              setEditPackage={setEditPackage}
              editPackage={editPackage}
              handleClose={handleClose}
            />
          </Offcanvas.Body>
        </Offcanvas>
      </div>

      {/* <div className="page_content">
 
        <div className="page_head">
          <div className="row align-items-center">
            <div className="col col-12">
              <h3 className="page_title">Manage Packages</h3>
            </div>
          </div>
        </div>

        <div className="position-relative">
          <div className="row mb-3">
            <div className="col">
              <div className="btn-group">
                <button
                  className={`btn ${userTypeFilter === "" ? "btn-custom" : "btn-outline-custom"}`}
                  onClick={() => setUserTypeFilter("")}
                >
                  All Packages
                </button>
                <button
                  className={`btn ${userTypeFilter === "vendor" ? "btn-custom" : "btn-outline-custom"}`}
                  onClick={() => setUserTypeFilter("vendor")}
                >
                  Vendor Packages
                </button>
                <button
                  className={`btn ${userTypeFilter === "dealer" ? "btn-custom" : "btn-outline-custom"}`}
                  onClick={() => setUserTypeFilter("dealer")}
                >
                  Dealer Packages
                </button>
              </div>
            </div>
          </div>

          <div className="row">
            <div className="col col-lg-4 col-12">
              <PackageForm
                fetchPackages={fetchPackages}
                setEditPackage={setEditPackage}
                editPackage={editPackage}
              />
            </div>
            <div className="col col-lg-8 col-12">
              <PackageList
                packages={packages}
                setEditPackage={setEditPackage}
                fetchPackages={fetchPackages}
                currentPage={currentPage}
                setCurrentPage={setCurrentPage}
                totalPages={totalPages}
                userTypeFilter={userTypeFilter}
              />
            </div>
          </div>
        </div>
      </div> */}
    </>
  );
}