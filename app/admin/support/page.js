"use client";
import { useState } from "react";
import TicketList from "./components/TicketList";
import TicketDetail from "./components/TicketDetail";
import { Button } from "react-bootstrap";

export default function SupportPage() {
  const [selectedTicket, setSelectedTicket] = useState(null);

  const handleTicketSelect = (ticket) => {
    setSelectedTicket(ticket);
  };

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center">
                {selectedTicket && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelectedTicket(null)}
                    className="me-2"
                  >
                    <i className="fa-solid fa-arrow-left"></i>
                  </Button>
                )}
                <h3 className="page_title mb-0">Support Tickets</h3>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        {selectedTicket ? (
          <TicketDetail
            ticket={selectedTicket}
            onBack={() => setSelectedTicket(null)}
          />
        ) : (
          <TicketList
            onTicketSelected={handleTicketSelect}
          />
        )}
      </div>
    </div>
  );
}