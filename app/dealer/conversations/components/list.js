"use client";
import { useState, useEffect } from "react";
import { Button, ListGroup, Row, Col, Offcanvas, Form, Modal } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
export default function List({ setEditLead }) {
    const { user } = useUser(); // Get dealer_id from context
    const [leads, setLeads] = useState([]);
    const [selectedLead, setSelectedLead] = useState(null);
    const [show, setShow] = useState(false);
    const [showConversations, setShowConversations] = useState(false);
    const [conversations, setConversations] = useState([]);
    const [searchSender, setSearchSender] = useState("");
    const [searchRecipient, setSearchRecipient] = useState("");

    // Fetch leads
    useEffect(() => {
        const fetchLeads = async () => {
            try {
                const response = await fetch("/api/conversations");
                const data = await response.json();
                setLeads(data);
            } catch (error) {
                console.error("Error fetching leads:", error);
            }
        };
        fetchLeads();
    }, []);

    // Open lead details
    const handleShow = (lead) => {
        setSelectedLead(lead);
        setShow(true);
    };

    // Fetch conversations
    const handleViewConversation = async (lead) => {
        try {
            const response = await fetch(
                `/api/conversations?parent_conversation=${lead.email}&sender=${searchSender}&recipient=${searchRecipient}`
            );
            const data = await response.json();
            setConversations(data);
            setShowConversations(true);
        } catch (error) {
            console.error("Error fetching conversations:", error);
        }
    };

    return (
        <>
            <div className="w_card w_card_with_chk">
                <div className="d-flex align-items-center mb-2">
                    <h3 className="w_card_title mb-0">Lead List</h3>
                </div>

                <div className="w_card_list">
                    <ListGroup as="ul" variant="flush">
                        {leads.length > 0 ? (
                            leads.map((lead) => (
                                <ListGroup.Item key={lead._id} className="w_card_list_box d-flex align-items-center">
                                    <Row className="align-items-center w-100">
                                        <Col xl={3}><p>{lead.name}</p></Col>
                                        <Col xl={3}><p>{lead.email}</p></Col>
                                        <Col xl={3}><p>{lead.phone}</p></Col>
                                        <Col xl={3}><p>{lead.source}</p></Col>
                                        <Col xl={3} className="text-end">
                                            <Button size="sm" onClick={() => handleShow(lead)}>👁 View</Button>
                                            <Button size="sm" onClick={() => handleViewConversation(lead)}>📩 Conversation</Button>
                                        </Col>
                                    </Row>
                                </ListGroup.Item>
                            ))
                        ) : (
                            <div className="text-center py-4">No leads found.</div>
                        )}
                    </ListGroup>
                </div>
            </div>

            {/* Conversation Modal */}
            <Modal show={showConversations} onHide={() => setShowConversations(false)} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>Email Conversation</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <div className="mb-3">
                        <Form.Control
                            type="text"
                            placeholder="Search by Sender"
                            value={searchSender}
                            onChange={(e) => setSearchSender(e.target.value)}
                        />
                        <Form.Control
                            type="text"
                            placeholder="Search by Recipient"
                            value={searchRecipient}
                            onChange={(e) => setSearchRecipient(e.target.value)}
                        />
                        <Button onClick={() => handleViewConversation(selectedLead)}>Search</Button>
                    </div>

                    {conversations.length > 0 ? (
                        conversations.map((email) => (
                            <div key={email._id} className="email_card">
                                <p><strong>From:</strong> {email.sender}</p>
                                <p><strong>To:</strong> {email.recipient}</p>
                                <p><strong>Subject:</strong> {email.subject}</p>
                                <p><strong>Date:</strong> {new Date(email.date).toLocaleString()}</p>
                                <div className="email_body">{email.mail_content}</div>
                            </div>
                        ))
                    ) : (
                        <p>No conversations found.</p>
                    )}
                </Modal.Body>
            </Modal>
        </>
    );
}
