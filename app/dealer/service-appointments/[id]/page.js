"use client";

import { useParams } from "next/navigation";
import ServiceAppointmentDetail from "./components/ServiceAppointmentDetail";

export default function ServiceAppointmentDetailPage() {
  const { id } = useParams();

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col-12">
            <h3 className="page_title mb-0">Service Appointment Details</h3>
          </div>
        </div>
      </div>
      <div className="page_body">
        <ServiceAppointmentDetail appointmentId={id} />
      </div>
    </div>
  );
}
