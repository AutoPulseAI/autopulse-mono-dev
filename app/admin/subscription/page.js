"use client";
import { useState } from "react";
import SubscriptionRequestList from "./components/SubscriptionRequestList";
import SubscriptionRequestDetail from "./components/SubscriptionRequestDetail";
import { Button } from "react-bootstrap";

export default function SubscriptionRequestPage() {
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const handleRequestSelect = (request) => {
    setSelectedRequest(request);
    setShowNewForm(false);
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
                <h3 className="page_title mb-0">Subscription Requests</h3>
              </div>
              
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        {selectedRequest ? (
          <SubscriptionRequestDetail
            request={selectedRequest}
            onBack={() => setSelectedRequest(null)}
          />
        ) : showNewForm ? (
          <NewSubscriptionRequestForm
            onCancel={() => setShowNewForm(false)}
            onSuccess={() => {
              setShowNewForm(false);
              // You might want to refresh the request list here
            }}
          />
        ) : (
          <SubscriptionRequestList onRequestSelected={handleRequestSelect} />
        )}
      </div>
    </div>
  );
}