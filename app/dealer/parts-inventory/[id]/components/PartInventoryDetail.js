"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Col, Row } from "react-bootstrap";
import { useUser } from "../../../context/UserContext";

const FIELD_ROWS = [
  ["Part Number", (p) => p.part_number],
  ["Description", (p) => p["Part Description"]],
  ["Cost", (p) => p["Part Cost"]],
  ["Price", (p) => p["Part Price"]],
  ["Quantity On Hand", (p) => p["Quantity On Hand"]],
  ["Quantity On Order", (p) => p["Quantity On Order"]],
  ["Best Stock Level", (p) => p["Best Stock Level"]],
  ["Minimum Stock Level", (p) => p["Minimum Stock Level"]],
  ["Maximum Stock Level", (p) => p["Maximum Stock Level"]],
  ["Stocking Status", (p) => p["Stocking Status"]],
  ["BIN#", (p) => p["BIN#"]],
  ["Source", (p) => p["Source"]],
  ["Make", (p) => p["Make"]],
  ["Manufacturer Status", (p) => p["Manufacturer Status"]],
  ["Entry Date", (p) => p["Entry Date"]],
  ["Last Sale Date", (p) => p["Last Sale Date"]],
  ["Last Received Date", (p) => p["Last Received Date"]],
  ["Year-To-Date Total", (p) => p["Year-To-Date Total"]],
  ["Previous Year-To-Date Total", (p) => p["Previous Year-To-Date Total"]],
  ["Part Group", (p) => p["Part Group"]],
];

export default function PartInventoryDetail({ partId }) {
  const { user, dealerParent, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);
  const router = useRouter();
  const [part, setPart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPart = useCallback(async () => {
    if (loadingParent || !activeEntity?.id || !partId) return;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ dealer_id: activeEntity.id });
      const response = await fetch(`/api/part-inventory/${partId}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to load part");

      setPart(data.data);
    } catch (fetchError) {
      setError(fetchError.message || "Failed to load part");
    } finally {
      setLoading(false);
    }
  }, [activeEntity?.id, partId, loadingParent]);

  useEffect(() => {
    fetchPart();
  }, [fetchPart]);

  if (loadingParent || loading) {
    return <div className="w_card text-center py-4">Loading part...</div>;
  }

  if (error) {
    return (
      <div className="w_card">
        <Alert variant="danger">{error}</Alert>
        <Button variant="custom" size="sm" onClick={() => router.push("/dealer/parts-inventory")}>
          <i className="fa-solid fa-arrow-left me-2" />Back to Parts Inventory
        </Button>
      </div>
    );
  }

  if (!part) return null;

  return (
    <div className="w_card">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h3 className="w_card_title mb-0">{part["Part Description"] || "No description"}</h3>
        <Button variant="custom" size="sm" onClick={() => router.push("/dealer/parts-inventory")}>
          <i className="fa-solid fa-arrow-left me-2" />Back to Parts Inventory
        </Button>
      </div>
      <Row className="gy-3">
        {FIELD_ROWS.map(([label, accessor]) => (
          <Col md={4} key={label}>
            <strong>{label}:</strong> {accessor(part) ?? "—"}
          </Col>
        ))}
      </Row>
    </div>
  );
}
