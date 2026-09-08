"use client";

import { useParams } from "next/navigation";
import RepairOrderDetail from "./components/RepairOrderDetail";

export default function RepairOrderDetailPage() {
  const { id } = useParams();

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col-12">
            <h3 className="page_title mb-0">Repair Order Details</h3>
          </div>
        </div>
      </div>
      <div className="page_body">
        <RepairOrderDetail repairOrderId={id} />
      </div>
    </div>
  );
}
