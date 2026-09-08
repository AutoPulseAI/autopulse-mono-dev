"use client";

import PartInventoryList from "./components/PartInventoryList";

export default function PartsInventoryPage() {
  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col-12">
            <h3 className="page_title mb-0">Parts Inventory</h3>
          </div>
        </div>
      </div>
      <div className="page_body">
        <PartInventoryList />
      </div>
    </div>
  );
}
