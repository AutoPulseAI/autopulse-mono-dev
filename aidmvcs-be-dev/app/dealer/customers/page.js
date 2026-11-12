"use client";

import Link from "next/link";
import CustomerList from "./components/CustomerList";
import { useCan } from "../../hooks/PermissionsContext";

export default function CustomersPage() {
  const canReview = useCan("Manage Leads");
  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col-12 d-flex align-items-center">
            <h3 className="page_title mb-0 me-auto">Customers</h3>
            {canReview && (
              <Link href="/dealer/customers/duplicates" className="btn btn-sm btn-outline-custom">
                <i className="fa-regular fa-clone me-1" />Possible duplicates
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="page_body">
        <CustomerList />
      </div>
    </div>
  );
}
