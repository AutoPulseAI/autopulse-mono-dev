"use client";

import { Button, ListGroup, Row, Col, Badge, Form } from "react-bootstrap";
import Link from "next/link";
import useFetch from "../../../hooks/useFetch";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";
import Pagination from "../../components/Pagination";
import { useState } from "react";

function getEditorHref(page) {
  if (page.editor === "puck") {
    return `/admin/pages/${page._id}/edit`;
  }
  return `/admin/pages-vvveb?page=${encodeURIComponent(page.slug)}`;
}

export default function PageList({
  pages,
  fetchPages,
  currentPage,
  setCurrentPage,
  totalPages,
  onEdit,
  showAlert,
  filters,
  onFilterChange,
  onApplyFilters,
  onClearFilters,
}) {
  const { fetchData } = useFetch();
  const [selectedId, setSelectedId] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const confirmDelete = (id) => {
    setSelectedId(id);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    try {
      const res = await fetchData(`/api/pages/${selectedId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) {
        showAlert("Failed to delete page", "danger");
      } else {
        showAlert("Page deleted successfully");
        fetchPages();
      }
    } catch (err) {
      showAlert("Failed to delete page", "danger");
    }
    setShowDeleteModal(false);
    setSelectedId(null);
  };

  const getPageUrl = (slug) => (slug === "home" ? "/" : `/${slug}`);

  const getEditorBadge = (page) => {
    if (page.editor === "vvveb") {
      return <Badge bg="info">Vvveb</Badge>;
    }
    return <Badge bg="secondary">Puck</Badge>;
  };

  return (
    <>
      <div className="w_card">
        <Row className="align-items-center">
          <Col xl={3} md={2}>
            <div className="d-flex align-items-center">
              <h3 className="w_card_title mb-0">Page List</h3>
            </div>
          </Col>
          <Col xl={9} md={10}>
            <Row className="search_filters gx-1 gy-1 gy-md-0">
              <Col md={4} xs={6}>
                <Form.Control
                  type="text"
                  name="search"
                  placeholder="Search by title or slug"
                  value={filters.search}
                  onChange={onFilterChange}
                  size="sm"
                />
              </Col>
              <Col md={3} xs={6}>
                <Form.Select
                  name="status"
                  value={filters.status}
                  onChange={onFilterChange}
                  size="sm"
                >
                  <option value="">All Status</option>
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                </Form.Select>
              </Col>
              <Col md={3} xs={6}>
                <Form.Select
                  name="editor"
                  value={filters.editor}
                  onChange={onFilterChange}
                  size="sm"
                >
                  <option value="">All Editors</option>
                  <option value="vvveb">Vvveb</option>
                  <option value="puck">Puck</option>
                </Form.Select>
              </Col>
              <Col md={2} xs={6} className="text-end">
                <div className="d-flex gap-1 justify-content-end">
                  <Button variant="custom" size="sm" onClick={onApplyFilters}>
                    Apply
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onClearFilters}
                    disabled={!filters.search && !filters.status && !filters.editor}
                    className="text-nowrap"
                  >
                    Clear
                  </Button>
                </div>
              </Col>
            </Row>
          </Col>
        </Row>

        <div className="w_card_list mt-3">
          <ListGroup as="ul" variant="flush">
            <ListGroup.Item as="li" className="w_card_list_head border-0 list-group-item">
              <Row className="align-items-center g-0">
                <Col xl={3} lg={3} sm={4} xs={12}>
                  <p className="label">
                    <small>Title</small>
                  </p>
                </Col>
                <Col xl={2} lg={2} sm={3} xs={6}>
                  <p className="label">
                    <small>Slug</small>
                  </p>
                </Col>
                <Col xl={1} lg={1} sm={2} xs={6}>
                  <p className="label">
                    <small>Editor</small>
                  </p>
                </Col>
                <Col xl={2} lg={2} sm={3} xs={6}>
                  <p className="label">
                    <small>Status</small>
                  </p>
                </Col>
                <Col xl={2} lg={2} sm={3} xs={6}>
                  <p className="label">
                    <small>Navigation</small>
                  </p>
                </Col>
                <Col xl={2} lg={2} sm={3} xs={12}>
                  <p className="p_bold text-end">
                    <small>Action</small>
                  </p>
                </Col>
              </Row>
            </ListGroup.Item>

            {pages.length > 0 ? (
              pages.map((page) => (
                <ListGroup.Item as="li" key={page._id} className="w_card_list_box list-group-item">
                  <Row className="align-items-md-center g-0 gy-2">
                    <Col xl={3} lg={3} sm={4} xs={12}>
                      <p className="p_bold mb-0">{page.title}</p>
                      <small className="text-muted text-capitalize">{page.pageType || "marketing"}</small>
                    </Col>
                    <Col xl={2} lg={2} sm={3} xs={6}>
                      <div className="w_card_list_box_label">
                        <p className="label d-md-none">
                          <small>Slug:</small>
                        </p>
                        <p className="mb-0">
                          <code>/{page.slug === "home" ? "" : page.slug}</code>
                        </p>
                      </div>
                    </Col>
                    <Col xl={1} lg={1} sm={2} xs={6}>
                      <div className="w_card_list_box_label">
                        <p className="label d-md-none">
                          <small>Editor:</small>
                        </p>
                        {getEditorBadge(page)}
                      </div>
                    </Col>
                    <Col xl={2} lg={2} sm={3} xs={6}>
                      <div className="w_card_list_box_label">
                        <p className="label d-md-none">
                          <small>Status:</small>
                        </p>
                        <Badge bg={page.status === "published" ? "success" : "secondary"} className="text-capitalize">
                          {page.status}
                        </Badge>
                      </div>
                    </Col>
                    <Col xl={2} lg={2} sm={3} xs={6}>
                      <div className="w_card_list_box_label">
                        <p className="label d-md-none">
                          <small>Navigation:</small>
                        </p>
                        {page.showInNav ? (
                          <Badge bg="light" className="border text-dark">
                            Nav #{page.navOrder}
                          </Badge>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </div>
                    </Col>
                    <Col xl={2} lg={2} sm={3} xs={12}>
                      <div className="d-flex gap-1 w_card_list_btns justify-content-md-end flex-wrap">
                        <Link
                          href={getEditorHref(page)}
                          className="btn btn-custom btn-sm"
                          title={page.editor === "puck" ? "Edit in Puck" : "Edit in Vvveb"}
                        >
                          <i className="fa-regular fa-pen-to-square"></i>
                        </Link>
                        <a
                          className={`btn btn-custom btn-sm${page.status !== "published" ? " disabled" : ""}`}
                          href={page.status === "published" ? getPageUrl(page.slug) : undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-disabled={page.status !== "published"}
                          tabIndex={page.status !== "published" ? -1 : 0}
                          title="View live page"
                          onClick={(e) => page.status !== "published" && e.preventDefault()}
                        >
                          <i className="fa-regular fa-eye"></i>
                        </a>
                        <Button variant="custom" size="sm" onClick={() => onEdit(page)} title="Page settings">
                          <i className="fa-regular fa-gear"></i>
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => confirmDelete(page._id)} title="Delete page">
                          <i className="fa-regular fa-trash"></i>
                        </Button>
                      </div>
                    </Col>
                  </Row>
                </ListGroup.Item>
              ))
            ) : (
              <div className="text-center py-4 text-muted">No pages found.</div>
            )}
          </ListGroup>

          {totalPages > 1 && (
            <Pagination currentPage={currentPage} setCurrentPage={setCurrentPage} totalPages={totalPages} />
          )}
        </div>
      </div>

      <DeleteConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete Page"
        message="Are you sure you want to delete this page? This action cannot be undone."
      />
    </>
  );
}
