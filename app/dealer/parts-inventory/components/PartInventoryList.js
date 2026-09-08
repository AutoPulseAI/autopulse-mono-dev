"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, ListGroup, Pagination, Row, Col } from "react-bootstrap";
import { useUser } from "../../context/UserContext";

const defaultPagination = {
  currentPage: 1,
  totalPages: 1,
  totalItems: 0,
  itemsPerPage: 10,
  hasNextPage: false,
  hasPreviousPage: false,
};

export default function PartInventoryList() {
  const { user, dealerParent, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);
  const router = useRouter();
  const [parts, setParts] = useState([]);
  const [pagination, setPagination] = useState(defaultPagination);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchParts = useCallback(async (page = 1) => {
    if (loadingParent || !activeEntity?.id) return;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        dealer_id: activeEntity.id,
        page: String(page),
        limit: String(pagination.itemsPerPage),
      });

      const response = await fetch(`/api/part-inventory?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to load parts inventory");

      setParts(data.data || []);
      setPagination(data.pagination || { ...defaultPagination, currentPage: page });
    } catch (fetchError) {
      setError(fetchError.message || "Failed to load parts inventory");
    } finally {
      setLoading(false);
    }
  }, [activeEntity?.id, loadingParent, pagination.itemsPerPage]);

  useEffect(() => {
    fetchParts(1);
  }, [fetchParts]);

  const openPart = (id) => {
    router.push(`/dealer/parts-inventory/${id}`);
  };

  const handlePageChange = (page) => {
    if (page >= 1 && page <= pagination.totalPages) fetchParts(page);
  };

  if (loadingParent || (loading && parts.length === 0)) {
    return <div className="w_card text-center py-4">Loading parts inventory...</div>;
  }

  return (
    <div className="w_card">
      {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}

      <div className="d-flex align-items-center mb-2">
        <h3 className="w_card_title mb-0">Part Inventory List</h3>
        <small className="text-muted ms-2">({pagination.totalItems.toLocaleString()} {pagination.totalItems === 1 ? "part" : "parts"})</small>
      </div>

      <div className="w_card_list">
        <ListGroup variant="flush">
          <ListGroup.Item className="w_card_list_head border-bottom-0">
            <Row className="align-items-center">
              <Col md={4}>Part Number</Col>
              <Col md={8}>Description</Col>
            </Row>
          </ListGroup.Item>

          {parts.length === 0 ? <div className="text-center py-4">No parts found.</div> : parts.map((part) => (
            <ListGroup.Item key={part._id} className="w_card_list_box p-0">
              <button type="button" className="w-100 border-0 bg-transparent text-start px-3 py-3" onClick={() => openPart(part._id)}>
                <Row className="align-items-center">
                  <Col md={4} className="p_bold"><i className="fa-solid fa-chevron-right me-2" />{part.part_number || "Unknown part"}</Col>
                  <Col md={8}>{part["Part Description"] || "No description"}</Col>
                </Row>
              </button>
            </ListGroup.Item>
          ))}
        </ListGroup>
      </div>

      {pagination.totalPages > 1 && (
        <div className="d-md-flex justify-content-center mt-3">
          <Pagination className="mb-md-0 justify-content-center flex-wrap">
            <Pagination.Prev
              onClick={() => handlePageChange(pagination.currentPage - 1)}
              disabled={pagination.currentPage === 1 || loading}
            />
            <Pagination.Item active>{pagination.currentPage}</Pagination.Item>
            <Pagination.Next
              onClick={() => handlePageChange(pagination.currentPage + 1)}
              disabled={pagination.currentPage === pagination.totalPages || loading}
            />
          </Pagination>
        </div>
      )}
    </div>
  );
}
