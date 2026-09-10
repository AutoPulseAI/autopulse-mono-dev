"use client";

import { Suspense } from "react";
import RepairOrderList from "./components/RepairOrderList";

export default function ServicePage() {
  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col-12">
            <h3 className="page_title mb-0">Service</h3>
          </div>
        </div>
      </div>
      <div className="page_body">
        <Suspense fallback={<div className="w_card text-center py-4">Loading repair orders...</div>}>
          <RepairOrderList />
        </Suspense>
      </div>
    </div>
  );
}
