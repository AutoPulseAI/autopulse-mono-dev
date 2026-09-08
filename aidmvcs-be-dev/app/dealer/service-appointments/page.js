"use client";

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
        <ServiceAppointmentList />
      </div>
    </div>
  );
}
