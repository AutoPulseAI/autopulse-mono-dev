"use client";

import { useParams } from "next/navigation";
import PartInventoryDetail from "./components/PartInventoryDetail";

export default function PartInventoryDetailPage() {
  const { id } = useParams();

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col-12">
            <h3 className="page_title mb-0">Part Details</h3>
          </div>
        </div>
      </div>
      <div className="page_body">
        <PartInventoryDetail partId={id} />
      </div>
    </div>
  );
}
