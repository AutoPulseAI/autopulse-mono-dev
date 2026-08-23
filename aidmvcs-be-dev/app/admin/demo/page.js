"use client";
import { useState } from "react";
import DemoRequestList from "./components/DemoRequestList";
import DemoRequestDetail from "./components/DemoRequestDetail";
import { Button } from "react-bootstrap";

export default function DemoRequestsPage() {
  const [selectedRequest, setSelectedRequest] = useState(null);

  const handleRequestSelect = (request) => {
    setSelectedRequest(request);
  };

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center">
                {selectedRequest && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelectedRequest(null)}
                    className="me-2"
                  >
                    <i className="fa-solid fa-arrow-left"></i>
                  </Button>
                )}
                <h3 className="page_title mb-0">Demo Requests</h3>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        {selectedRequest ? (
          <DemoRequestDetail
            request={selectedRequest}
            onBack={() => setSelectedRequest(null)}
          />
        ) : (
          <DemoRequestList onDemoRequestSelected={handleRequestSelect} />
        )}
      </div>
    </div>
  );
}