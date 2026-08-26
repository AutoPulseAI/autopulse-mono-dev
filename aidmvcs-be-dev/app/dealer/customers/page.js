"use client";

import CustomerList from "./components/CustomerList";

export default function CustomersPage() {
  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col-12">
            <h3 className="page_title mb-0">Customers</h3>
          </div>
        </div>
      </div>

      <div className="page_body">
        <CustomerList />
      </div>
    </div>
  );
}
