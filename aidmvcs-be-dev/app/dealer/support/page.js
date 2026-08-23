"use client";
import { useState } from "react";
import TicketList from "./components/TicketList";
import NewTicketForm from "./components/NewTicketForm";
import TicketDetail from "./components/TicketDetail";
import { Button } from "react-bootstrap";

export default function SupportPage() {
  const [editTicket, setEditTicket] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const handleTicketSelect = (ticket) => {
    setSelectedTicket(ticket);
    setShowNewForm(false);
  };

  const handleNewTicketClick = () => {
    setShowNewForm(true);
    setSelectedTicket(null);
    setEditTicket(null);
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

              {!selectedTicket && !showNewForm && (
                <Button
                  variant="custom"
                  size="sm"
                  onClick={handleNewTicketClick}
                >
                  <i className="fa-solid fa-plus me-1"></i>Create New Ticket
                </Button>
              )}
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
        ) : showNewForm ? (
          <NewTicketForm
            setEditTicket={setEditTicket}
            onCancel={() => setShowNewForm(false)}
            onSuccess={() => {
              setShowNewForm(false);
              // You might want to refresh the ticket list here
            }}
          />
        ) : (
          <TicketList
            setEditTicket={setEditTicket}
            onTicketSelected={handleTicketSelect}
          />
        )}
      </div>
    </div>
  );
}