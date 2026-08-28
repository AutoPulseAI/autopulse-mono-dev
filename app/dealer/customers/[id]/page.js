"use client";

import { useParams } from "next/navigation";
import CustomerDetail from "./components/CustomerDetail";

export default function CustomerDetailPage() {
  const { id } = useParams();

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
      </div>
    </div>
  );
}
