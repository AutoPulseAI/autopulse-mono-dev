"use client";

import DealList from "./components/DealList";

export default function SalesPage() {
  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col-12">
            <h3 className="page_title mb-0">Sales</h3>
          </div>
        </div>
      </div>
      <div className="page_body">
        <DealList />
      </div>
    </div>
  );
}
