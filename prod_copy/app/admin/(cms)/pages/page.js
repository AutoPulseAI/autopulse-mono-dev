"use client";

import { useState, useEffect } from "react";
import { Button, Offcanvas, Alert } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";
import PageList from "../../pages/components/PageList";
import PageForm from "../../pages/components/PageForm";

const emptyFilters = { search: "", status: "", editor: "" };

export default function PagesManagement() {
  const { fetchData, error: fetchError } = useFetch();
  const [pages, setPages] = useState([]);
  const [editPage, setEditPage] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [show, setShow] = useState(false);
  const [alert, setAlert] = useState({ show: false, message: "", variant: "success" });
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);

  const showAlert = (message, variant = "success") => {
    setAlert({ show: true, message, variant });
    setTimeout(() => setAlert({ show: false, message: "", variant: "success" }), 5000);
  };

  const fetchPages = async () => {
    try {
      const params = new URLSearchParams({ page: String(currentPage) });
      if (appliedFilters.status) params.set("status", appliedFilters.status);
      if (appliedFilters.search) params.set("search", appliedFilters.search);
      if (appliedFilters.editor) params.set("editor", appliedFilters.editor);

      const res = await fetchData(`/api/pages?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const data = await res.json();
      if (data?.pages) {
        setPages(data.pages);
        setTotalPages(data.totalPages || 1);
      }
    } catch (error) {
      console.error("Error fetching pages:", error);
    }
  };

  useEffect(() => {
    fetchPages();
  }, [currentPage, appliedFilters]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const handleApplyFilters = () => {
    setCurrentPage(1);
    setAppliedFilters(filters);
  };

  const handleClearFilters = () => {
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setCurrentPage(1);
  };

  const handleClose = () => {
    setShow(false);
    setEditPage(null);
  };

  const handleSaved = (page, isNew) => {
    handleClose();
    fetchPages();
    showAlert(isNew ? "Page created successfully" : "Page updated successfully");
    if (isNew && page?.slug) {
      window.location.href = `/admin/pages-vvveb?page=${encodeURIComponent(page.slug)}`;
    }
  };

  return (
    <>
      <div className="page_content cms-page">
        <div className="page_head">
          <div className="row align-items-center">
            <div className="col col-12">
              <div className="d-flex align-items-center">
                <h4 className="page_title mb-0">Pages</h4>
                <Button
                  variant="custom"
                  size="sm"
                  onClick={() => {
                    setEditPage(null);
                    setShow(true);
                  }}
                  className="ms-auto text-nowrap"
                >
                  <i className="fa fa-plus me-1"></i>Add Page
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="page_body">
          {fetchError && (
            <Alert variant="danger">
              <p className="mb-0">{fetchError}</p>
            </Alert>
          )}

          {alert.show && (
            <Alert variant={alert.variant} dismissible onClose={() => setAlert({ ...alert, show: false })}>
              {alert.message}
            </Alert>
          )}

          <PageList
            pages={pages}
            fetchPages={fetchPages}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            totalPages={totalPages}
            onEdit={(page) => {
              setEditPage(page);
              setShow(true);
            }}
            showAlert={showAlert}
            filters={filters}
            onFilterChange={handleFilterChange}
            onApplyFilters={handleApplyFilters}
            onClearFilters={handleClearFilters}
          />
        </div>
      </div>

      <Offcanvas show={show} onHide={handleClose} placement="end">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>{editPage ? "Edit Page Settings" : "Add Page"}</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <PageForm page={editPage} onSaved={handleSaved} onCancel={handleClose} />
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
}
