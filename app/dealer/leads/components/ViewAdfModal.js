"use client";
import { useEffect, useState } from "react";
import { Modal, Spinner } from "react-bootstrap";

export function isAdfLead(lead) {
  return lead?.data?.format === "adf/xml";
}

export default function ViewAdfModal({ show, onHide, leadId }) {
  const [adfText, setAdfText] = useState(null);
  const [adfLoading, setAdfLoading] = useState(false);
  const [adfError, setAdfError] = useState(null);

  useEffect(() => {
    if (!show || !leadId) {
      setAdfText(null);
      setAdfError(null);
      setAdfLoading(false);
      return;
    }

    let cancelled = false;
    setAdfLoading(true);
    setAdfError(null);
    setAdfText(null);

    (async () => {
      try {
        const response = await fetch(`/api/leads/${leadId}/adf`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Failed to load ADF");
        if (!cancelled) setAdfText(data.data.raw_xml);
      } catch (fetchError) {
        if (!cancelled) setAdfError(fetchError.message || "Failed to load ADF");
      } finally {
        if (!cancelled) setAdfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [show, leadId]);

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>ADF Payload</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {adfLoading ? (
          <div className="text-muted small">
            <Spinner animation="border" size="sm" className="me-2" />
            Loading ADF...
          </div>
        ) : adfError ? (
          <div className="text-danger small">{adfError}</div>
        ) : adfText ? (
          <pre
            className="small bg-light border rounded p-2 mb-0"
            style={{ maxHeight: "60vh", overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {adfText}
          </pre>
        ) : null}
      </Modal.Body>
    </Modal>
  );
}
