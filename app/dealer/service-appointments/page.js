"use client";

import { Suspense } from "react";
import ServiceAppointmentList from "./components/ServiceAppointmentList";

export default function ServiceAppointmentsPage() {
  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col-12">
            <h3 className="page_title mb-0">Service Appointments</h3>
          </div>
        </div>
      </div>
      <div className="page_body">
        <Suspense fallback={<div className="w_card text-center py-4">Loading service appointments...</div>}>
          <ServiceAppointmentList />
        </Suspense>
      </div>
    </div>
  );
}
