"use client";
import { Suspense } from "react";
import { Container, Row, Col, Spinner } from "react-bootstrap";
import LeadCalendar from "../components/LeadCalendar";
import "../components/LeadCalendar.css";

// Main page component with Suspense boundary
export default function LeadCalendarPage() {
  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center">
              <h3 className="page_title mb-0">Lead Calendar</h3>
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        <Suspense fallback={
          <div className="d-flex justify-content-center align-items-center" style={{ height: '400px' }}>
            <Spinner animation="border" variant="dark" />
            <span className="ms-3">Loading calendar...</span>
          </div>
        }>
          <LeadCalendar />
        </Suspense>
      </div>
    </div>
  );
}
