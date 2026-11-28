"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import CustomerDetail from "./components/CustomerDetail";
import CustomerSideList from "./components/CustomerSideList";
import { BackButton } from "../../components/backLink";

export default function CustomerDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user, dealerParent, loadingParent } = useUser();
  const activeEntity = dealerParent || (user?.parent_id ? null : user);

  const [adjacent, setAdjacent] = useState({ previous: null, next: null });
  const [adjacentLoading, setAdjacentLoading] = useState(false);
  // The customers above and below this one in the side list (null when it is not on the page shown there).
  const [listNeighbours, setListNeighbours] = useState(null);

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

  // Betsy, 25 Nov 2026: Previous / Next sit at the top, not under the whole profile. They follow the side list when
  // this customer is in it (its filters and order), otherwise the full customer list.
  const previous = listNeighbours?.previous || adjacent.previous;
  const next = listNeighbours?.next || adjacent.next;

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="d-flex align-items-center flex-wrap gap-2">
          <BackButton className="" />
          <h3 className="page_title mb-0 me-auto">Customer Details</h3>
          <div className="cust_nav">
            <Button variant="custom" size="sm" disabled={adjacentLoading || !previous}
              onClick={() => previous && router.push(`/dealer/customers/${previous._id}`)}>
              <i className="fa-solid fa-arrow-left me-2" />Previous Customer
            </Button>
            <Button variant="custom" size="sm" disabled={adjacentLoading || !next}
              onClick={() => next && router.push(`/dealer/customers/${next._id}`)}>
              Next Customer<i className="fa-solid fa-arrow-right ms-2" />
            </Button>
          </div>
        </div>
      </div>

      <div className="page_body">
        <div className="cust_layout">
          <CustomerSideList dealerId={activeEntity?.id} currentId={id} onNeighbours={setListNeighbours} />
          <div className="cust_layout_main">
            <CustomerDetail customerId={id} />
          </div>
        </div>
      </div>
    </div>
  );
}
