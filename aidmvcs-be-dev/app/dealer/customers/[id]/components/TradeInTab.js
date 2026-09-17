"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Accordion, Alert, Badge, Button, Col, Modal, Pagination, Row, Spinner } from "react-bootstrap";
import { useUser } from "../../../context/UserContext";
import { formatCurrency } from "../../../../utils/formatCurrency";
import { formatTimestamp } from "../../../../utils/dateUtils";
import TradeInForm from "./TradeInForm";

const defaultTradeInsPagination = {
  currentPage: 1,
  totalPages: 1,
  totalItems: 0,
  itemsPerPage: 5,
  hasNextPage: false,
  hasPreviousPage: false,
};

function vehicleSummary(tradeIn) {
  const parts = [tradeIn.year, tradeIn.make, tradeIn.model].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Unspecified vehicle";
}

// Self-contained tab, mirroring LeadsTab.js: fetches/paginates its own data
// and owns its own create/edit form + modal, since trade-ins aren't part of
// the /360 payload shared across the other tabs.
export default function TradeInTab({ customerId }) {
  const { dealerParent, user, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);

  const [tradeIns, setTradeIns] = useState([]);
  const [tradeInsPagination, setTradeInsPagination] = useState(defaultTradeInsPagination);
  const [tradeInsLoading, setTradeInsLoading] = useState(true);
  const [tradeInsError, setTradeInsError] = useState(null);
  const [activeTradeInId, setActiveTradeInId] = useState(null);
  const [editTradeIn, setEditTradeIn] = useState(null);
  const hasAutoOpenedRef = useRef(false);
  const requestIdRef = useRef(0);

  // Navigating directly from one customer to another re-renders this tab
  // with a new customerId rather than unmounting it, so without this the
  // previous customer's trade-ins (and accordion selection) would stay
  // visible until the new fetch resolves.
  useEffect(() => {
    setTradeIns([]);
    setTradeInsPagination(defaultTradeInsPagination);
    setActiveTradeInId(null);
    hasAutoOpenedRef.current = false;
  }, [customerId]);

  const fetchTradeIns = useCallback(async (page = 1) => {
    if (loadingParent || !activeEntity?.id || !customerId) return;
    const requestId = ++requestIdRef.current;
    setTradeInsLoading(true);
    setTradeInsError(null);
    try {
      const params = new URLSearchParams({
        dealer_id: activeEntity.id,
        page: String(page),
        limit: String(defaultTradeInsPagination.itemsPerPage),
      });
      const response = await fetch(`/api/customers/${customerId}/trade-ins?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const data = await response.json();
      // Ignore a response if a newer request (e.g. for a different customer,
      // or a different page) has since been fired - a slower, stale request
      // must not overwrite what the newer one already rendered.
      if (requestIdRef.current !== requestId) return;
      if (!response.ok) throw new Error(data.message || "Failed to load trade-ins");
      setTradeIns(data.data || []);
      setTradeInsPagination(data.pagination || { ...defaultTradeInsPagination, currentPage: page });
    } catch (fetchError) {
      if (requestIdRef.current !== requestId) return;
      setTradeInsError(fetchError.message || "Failed to load trade-ins");
    } finally {
      if (requestIdRef.current === requestId) setTradeInsLoading(false);
    }
  }, [activeEntity?.id, customerId, loadingParent]);

  useEffect(() => {
    fetchTradeIns(1);
  }, [fetchTradeIns]);

  // Land on the most-recent trade-in's detail instead of making the dealer
  // expand the accordion themselves - fires once, guarded by a ref (not
  // activeTradeInId itself) so collapsing it afterward doesn't force it back open.
  useEffect(() => {
    if (!hasAutoOpenedRef.current && tradeIns.length > 0) {
      hasAutoOpenedRef.current = true;
      setActiveTradeInId(tradeIns[0]._id);
    }
  }, [tradeIns]);

  const handleTradeInsPageChange = (page) => {
    if (page >= 1 && page <= tradeInsPagination.totalPages) fetchTradeIns(page);
  };

  const handleTradeInFormChange = (value, meta = {}) => {
    setEditTradeIn(value);
    if (!value) {
      // A newly created trade-in sorts to the top (newest-first) and would
      // be invisible if we simply refetched whatever page the dealer was
      // on - jump back to page 1 only when a create actually succeeded
      // (not on cancel, and not after editing, which never changes sort order).
      fetchTradeIns(meta.created ? 1 : tradeInsPagination.currentPage);
    }
  };

  return (
    <div className="w_card">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h3 className="w_card_title mb-0">Trade In</h3>
        <Button variant="custom" size="sm" onClick={() => setEditTradeIn({})}>
          <i className="fa-solid fa-plus me-2" />Add Trade In
        </Button>
      </div>

      {tradeInsError && (
        <Alert variant="danger" dismissible onClose={() => setTradeInsError(null)}>{tradeInsError}</Alert>
      )}

      {tradeInsLoading && tradeIns.length === 0 ? (
        <div className="text-center py-4"><Spinner animation="border" size="sm" /></div>
      ) : tradeIns.length === 0 ? (
        <div className="text-center py-4 text-muted">No trade-ins found for this customer.</div>
      ) : (
        <Accordion activeKey={activeTradeInId} onSelect={(key) => setActiveTradeInId(key)}>
          {tradeIns.map((tradeIn) => (
            <Accordion.Item eventKey={tradeIn._id} key={tradeIn._id}>
              <Accordion.Header>
                <Row className="align-items-center w-100 me-2 small">
                  <Col md={3} className="p_bold">{vehicleSummary(tradeIn)}</Col>
                  <Col md={3}>{tradeIn.vin || "VIN not provided"}</Col>
                  <Col md={2}><Badge bg="secondary">{tradeIn.status}</Badge></Col>
                  <Col md={2}>{formatCurrency(tradeIn.trade_offer_amount)}</Col>
                  <Col md={2} className="text-md-end text-muted">
                    {tradeIn.createdAt ? formatTimestamp(tradeIn.createdAt) : "N/A"}
                  </Col>
                </Row>
              </Accordion.Header>
              <Accordion.Body>
                <Row className="small mb-3">
                  <Col md={3}><strong>Trim:</strong> {tradeIn.trim || "N/A"}</Col>
                  <Col md={3}><strong>Miles:</strong> {tradeIn.miles ?? "N/A"}</Col>
                  <Col md={3}><strong>Exterior Color:</strong> {tradeIn.exterior_color || "N/A"}</Col>
                  <Col md={3}><strong>Interior Color:</strong> {tradeIn.interior_color || "N/A"}</Col>
                  <Col md={3}><strong>Trade Offer:</strong> {formatCurrency(tradeIn.trade_offer_amount)}</Col>
                  <Col md={3}><strong>Trade ACV:</strong> {formatCurrency(tradeIn.trade_acv_amount)}</Col>
                  <Col md={3}><strong>Stock #:</strong> {tradeIn.trade_stock_number || "N/A"}</Col>
                  <Col md={3}><strong>Status:</strong> {tradeIn.status}</Col>
                  {tradeIn.condition && <Col md={3}><strong>Condition:</strong> {tradeIn.condition}</Col>}
                  {tradeIn.notes && <Col md={12}><strong>Trade Notes:</strong> {tradeIn.notes}</Col>}
                </Row>
                <div className="d-flex justify-content-end">
                  <Button variant="outline-custom" size="sm" onClick={() => setEditTradeIn(tradeIn)}>
                    <i className="fa-regular fa-pen-to-square me-1" />Edit
                  </Button>
                </div>
              </Accordion.Body>
            </Accordion.Item>
          ))}
        </Accordion>
      )}

      {tradeInsPagination.totalPages > 1 && (
        <Pagination size="sm" className="justify-content-center mt-3 mb-0">
          <Pagination.Prev
            disabled={!tradeInsPagination.hasPreviousPage || tradeInsLoading}
            onClick={() => handleTradeInsPageChange(tradeInsPagination.currentPage - 1)}
          />
          <Pagination.Item active>{tradeInsPagination.currentPage}</Pagination.Item>
          <Pagination.Next
            disabled={!tradeInsPagination.hasNextPage || tradeInsLoading}
            onClick={() => handleTradeInsPageChange(tradeInsPagination.currentPage + 1)}
          />
        </Pagination>
      )}

      <Modal show={!!editTradeIn} onHide={() => handleTradeInFormChange(null)} centered size="lg">
        <Modal.Body>
          {editTradeIn && (
            <TradeInForm
              customerId={customerId}
              dealerId={activeEntity?.id}
              editTradeIn={editTradeIn}
              setEditTradeIn={handleTradeInFormChange}
            />
          )}
        </Modal.Body>
      </Modal>
    </div>
  );
}
