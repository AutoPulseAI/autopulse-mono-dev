"use client";
import { useState } from "react";
import ContactList from "./components/ContactList";
import ContactDetail from "./components/ContactDetail";
import { Button } from "react-bootstrap";

export default function ContactPage() {
  const [selectedContact, setSelectedContact] = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const handleContactSelect = (contact) => {
    setSelectedContact(contact);
    setShowNewForm(false);
  };

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center">
                {selectedContact && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelectedContact(null)}
                    className="me-2"
                  >
                    <i className="fa-solid fa-arrow-left"></i>
                  </Button>
                )}
                <h3 className="page_title mb-0">Contact Us</h3>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        {selectedContact ? (
          <ContactDetail
            contact={selectedContact}
            onBack={() => setSelectedContact(null)}
          />
        ) : showNewForm ? (
          <NewContactForm
            onCancel={() => setShowNewForm(false)}
            onSuccess={() => {
              setShowNewForm(false);
              // You might want to refresh the contact list here
            }}
          />
        ) : (
          <ContactList onContactSelected={handleContactSelect} />
        )}
      </div>
    </div>
  );
}