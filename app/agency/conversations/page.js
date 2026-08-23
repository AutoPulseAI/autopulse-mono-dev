"use client";
import { useState, useEffect } from "react";
import { Row, Col, Form, Button, Spinner } from "react-bootstrap";
import { useUser } from "../context/UserContext";
import EmailConversationsList from "./components/EmailConversationsList";
import ViewConversations from "./components/viewConversations";
import EmailReplyModal from "./components/EmailReplyModal";

export default function EmailConversations() {
    const { user, dealerParent, loading } = useUser();
    const [selectedEmail, setSelectedEmail] = useState(null);
    const [searchSender, setSearchSender] = useState("");
    const [searchRecipient, setSearchRecipient] = useState("");
    const [searchText, setSearchText] = useState("");
    const [isEmailReplyModalOpen, setEmailReplyModalOpen] = useState(false);
    const [isReady, setIsReady] = useState(false);

    // Determine which dealer ID to use and check readiness
    useEffect(() => {
        if (loading) return;

        // If dealerParent should exist but isn't loaded yet, don't proceed
        if (!dealerParent) {
            return;
        }

        setIsReady(true);
    }, [loading, user, dealerParent]);

    // Get the active dealer ID (only when ready)
    const activeDealerId = isReady ? ( dealerParent?.id || user?.id) : null;

    if (loading || !isReady) {
        return (
            <div className="page_content">
                <div className="d-flex justify-content-center align-items-center" style={{ height: '300px' }}>
                    <Spinner animation="border" variant="dark" />
                    <span className="ms-3">Loading dealer information...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="page_content">
            {/* Page Header */}
            <div className="page_head">
                <Row className="align-items-start">
                    <Col lg={6}>
                        <div className="d-flex align-items-start">
                            {selectedEmail && (
                                <Button variant="secondary" size="sm" onClick={() => setSelectedEmail(null)} className="me-2">
                                    <i className="fa-solid fa-arrow-left"></i>
                                </Button>
                            )}
                            <div className="position-relative">
                                <div className="d-flex">
                                    <h3 className="page_title mb-0 me-1">
                                        {selectedEmail?.api_response?.Lead_Name || "Email Conversations"}
                                    </h3>
                                    {selectedEmail?.api_response?.Lead_Mail && (
                                        <p className="text-secondary fw-normal mb-1">
                                            &lt;{selectedEmail.api_response.Lead_Mail}&gt;
                                        </p>
                                    )}
                                </div>
                                {selectedEmail?.api_response?.Lead_Mail && (
                                    <p className="text-secondary mb-0">
                                        You:&nbsp;&lt;{selectedEmail.api_response.Lead_Mail}&gt;
                                    </p>
                                )}
                            </div>
                        </div>
                    </Col>

                    {selectedEmail ? (
                        <Col lg={6}>
                            <div className="text-end">
                                <Button 
                                    variant="custom" 
                                    size="sm" 
                                    className="ms-1" 
                                    onClick={() => setEmailReplyModalOpen(true)}
                                >
                                    <i className="fa-regular fa-reply me-md-2"></i>Email
                                </Button>
                                <Button variant="custom" size="sm" className="ms-1">
                                    <i className="fa-regular fa-reply me-md-2"></i>Text
                                </Button>
                            </div>
                        </Col>
                    ) : (
                        <Col lg={6}>
                            <Row className="search_filters gx-1">
                                <Col md={3}>
                                    <Form.Control 
                                        type="text" 
                                        placeholder="Search by Sender" 
                                        value={searchSender} 
                                        onChange={(e) => setSearchSender(e.target.value)} 
                                        size="sm" 
                                    />
                                </Col>
                                <Col md={3}>
                                    <Form.Control 
                                        type="text" 
                                        placeholder="Search by Recipient" 
                                        value={searchRecipient} 
                                        onChange={(e) => setSearchRecipient(e.target.value)} 
                                        size="sm" 
                                    />
                                </Col>
                                <Col md={4}>
                                    <Form.Control 
                                        type="text" 
                                        placeholder="Search by Subject / Content" 
                                        value={searchText} 
                                        onChange={(e) => setSearchText(e.target.value)} 
                                        size="sm" 
                                    />
                                </Col>
                                <Col md={2}>
                                    <Button variant="custom" size="sm">Search</Button>
                                </Col>
                            </Row>
                        </Col>
                    )}
                </Row>
            </div>

            <div className="page_body">
                {selectedEmail ? (
                    <ViewConversations 
                        selectedEmail={selectedEmail} 
                        dealer_id={activeDealerId} 
                    />
                ) : (
                    <EmailConversationsList 
                        dealer_id={activeDealerId}
                        searchSender={searchSender}
                        searchRecipient={searchRecipient}
                        searchText={searchText}
                        onEmailSelect={setSelectedEmail} 
                    />
                )}

                {isEmailReplyModalOpen && (
                    <EmailReplyModal 
                        user={user} 
                        dealer_id={activeDealerId}
                        onClose={() => setEmailReplyModalOpen(false)} 
                    />
                )}
            </div>
        </div>
    );
}