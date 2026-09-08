"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Col, Row } from "react-bootstrap";
import { useUser } from "../../../context/UserContext";

const FIELD_ROWS = [
  ["Deal Number", (d) => d.deal_number],
  ["Buyer Name", (d) => d["Full Name"]],
  ["Co-Buyer Name", (d) => d["Co-Buyer Full Name"]],
  ["Email", (d) => d["Email 1"]],
  ["Cell Phone", (d) => d["Cell Phone"]],
  ["VIN", (d) => d.vin],
  ["Year", (d) => d["Year"]],
  ["Make", (d) => d["Make"]],
  ["Model", (d) => d["Model"]],
  ["New/Used", (d) => d["New/Used"]],
  ["Stock Number", (d) => d["Stock Number"]],
  ["Deal Status", (d) => d["Deal Status"]],
  ["Deal Type", (d) => d["Deal Type"]],
  ["Sale Type", (d) => d["Sale Type"]],
  ["Sales Price", (d) => d["Sales Price"]],
  ["Total Down", (d) => d["Total Down"]],
  ["Amount Financed", (d) => d["Amount Financed"]],
  ["Front Gross", (d) => d["Front Gross"]],
  ["Salesman", (d) => d["Salesman 1 Name"]],
  ["Contract Date", (d) => d["Contract Date"]],
];

export default function DealDetail({ dealId }) {
  const { user, dealerParent, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);
  const router = useRouter();
  const [deal, setDeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDeal = useCallback(async () => {
    if (loadingParent || !activeEntity?.id || !dealId) return;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ dealer_id: activeEntity.id });
      const response = await fetch(`/api/deals/${dealId}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to load deal");

      setDeal(data.data);
    } catch (fetchError) {
      setError(fetchError.message || "Failed to load deal");
    } finally {
      setLoading(false);
    }
  }, [activeEntity?.id, dealId, loadingParent]);

  useEffect(() => {
    fetchDeal();
  }, [fetchDeal]);

  if (loadingParent || loading) {
    return <div className="w_card text-center py-4">Loading deal...</div>;
  }

  if (error) {
    return (
      <div className="w_card">
        <Alert variant="danger">{error}</Alert>
        <Button variant="custom" size="sm" onClick={() => router.push("/dealer/sales")}>
          <i className="fa-solid fa-arrow-left me-2" />Back to Sales
        </Button>
      </div>
    );
  }

  if (!deal) return null;

  return (
    <div className="w_card">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h3 className="w_card_title mb-0">{deal["Full Name"] || "Unnamed buyer"}</h3>
        <Button variant="custom" size="sm" onClick={() => router.push("/dealer/sales")}>
          <i className="fa-solid fa-arrow-left me-2" />Back to Sales
        </Button>
      </div>
      <Row className="gy-3">
        {FIELD_ROWS.map(([label, accessor]) => (
          <Col md={4} key={label}>
            <strong>{label}:</strong> {accessor(deal) ?? "—"}
          </Col>
        ))}
      </Row>
    </div>
  );
}
