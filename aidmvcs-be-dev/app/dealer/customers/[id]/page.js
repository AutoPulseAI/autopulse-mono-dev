"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import CustomerDetail from "./components/CustomerDetail";

export default function CustomerDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user, dealerParent, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);

  const [adjacent, setAdjacent] = useState({ previous: null, next: null });
  const [adjacentLoading, setAdjacentLoading] = useState(false);

  const fetchAdjacent = useCallback(async () => {
    if (loadingParent || !activeEntity?.id || !id) return;
    setAdjacentLoading(true);
    try {
      const params = new URLSearchParams({ dealer_id: activeEntity.id });
      const response = await fetch(`/api/customers/${id}/adjacent?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dealertoken")}` },
      });
      const data = await response.json();
      setAdjacent(response.ok ? data.data || { previous: null, next: null } : { previous: null, next: null });
    } catch {
      setAdjacent({ previous: null, next: null });
    } finally {
      setAdjacentLoading(false);
    }
  }, [activeEntity?.id, id, loadingParent]);

  useEffect(() => {
    fetchAdjacent();
  }, [fetchAdjacent]);

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col-12">
            <h3 className="page_title mb-0">Customer Details</h3>
          </div>
        </div>
      </div>

      <div className="page_body">
        <CustomerDetail customerId={id} />

        <div className="d-flex align-items-center justify-content-between mt-3">
          <Button
            variant="custom"
            size="sm"
            disabled={adjacentLoading || !adjacent.previous}
            onClick={() => adjacent.previous && router.push(`/dealer/customers/${adjacent.previous._id}`)}
          >
            <i className="fa-solid fa-arrow-left me-2" />Previous Customer
          </Button>
          <Button
            variant="custom"
            size="sm"
            disabled={adjacentLoading || !adjacent.next}
            onClick={() => adjacent.next && router.push(`/dealer/customers/${adjacent.next._id}`)}
          >
            Next Customer<i className="fa-solid fa-arrow-right ms-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
