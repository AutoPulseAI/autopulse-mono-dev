"use client";
import { useState, useEffect, Suspense } from "react";
import { Row, Col, Form, Button, Spinner } from "react-bootstrap";
import { useUser } from "../context/UserContext";
import EmailConversationsList from "./components/EmailConversationsList";
import ViewConversations from "./components/viewConversations";
import { useRouter, useSearchParams } from "next/navigation";

// Component that uses useSearchParams - needs to be wrapped in Suspense
function EmailConversationsContent() {
    const { user, dealerParent, loading } = useUser();
    const router = useRouter();
    const urlSearchParams = useSearchParams();
    const [selectedEmail, setSelectedEmail] = useState(null);
    const [searchParams, setSearchParams] = useState({
        sender: "",
        recipient: "",
        text: ""
    });
    const [appliedSearchParams, setAppliedSearchParams] = useState({
        sender: "",
        recipient: "",
        text: ""
    });
    const [isReady, setIsReady] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    // Initialize search parameters from URL
    useEffect(() => {
        const urlSender = urlSearchParams.get("sender");
        const urlRecipient = urlSearchParams.get("recipient");
        const urlText = urlSearchParams.get("text");
        
        if (urlSender || urlRecipient || urlText) {
            const newSearchParams = {
                sender: urlSender || "",
                recipient: urlRecipient || "",
                text: urlText || ""
            };
            setSearchParams(newSearchParams);
            setAppliedSearchParams(newSearchParams);
        }
    }, [urlSearchParams]);

    const handleReplySuccess = () => {
        setRefreshKey(prev => prev + 1);
    };

    useEffect(() => {
        if (loading) return;
        if (!dealerParent) return;
        setIsReady(true);
    }, [loading, user, dealerParent]);

    const activeDealerId = isReady ? (dealerParent?.id || user?.id) : null;

    const clearFilters = () => {
        const emptyParams = {
            sender: "",
            recipient: "",
            text: ""
        };
        setSearchParams(emptyParams);
        setAppliedSearchParams(emptyParams);
        
        // Update URL to remove search parameters
        const params = new URLSearchParams(urlSearchParams.toString());
        params.delete('sender');
        params.delete('recipient');
        params.delete('text');
        params.delete('page'); // Reset to page 1
        router.push(`/dealer/conversations?${params.toString()}`, undefined, { shallow: true });
    };

    const handleSearch = () => {
        // Remove '+' signs from sender and recipient before applying search
        const newAppliedParams = {
            sender: searchParams.sender.replace(/\+/g, ''),
            recipient: searchParams.recipient.replace(/\+/g, ''),
            text: searchParams.text
        };
        setAppliedSearchParams(newAppliedParams);
        
        // Update URL with search parameters
        const params = new URLSearchParams(urlSearchParams.toString());
        params.set('sender', newAppliedParams.sender);
        params.set('recipient', newAppliedParams.recipient);
        params.set('text', newAppliedParams.text);
        params.delete('page'); // Reset to page 1 when searching
        router.push(`/dealer/conversations?${params.toString()}`, undefined, { shallow: true });
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setSearchParams(prev => ({
            ...prev,
            [name]: value
        }));
    };

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
            <div className="page_head">
                <Row className="align-items-center">
                    <Col xl={7} md={4}>
                        <div className="d-flex align-items-center">
                            {selectedEmail && (
                                <Button variant="secondary" size="sm" onClick={() => setSelectedEmail(null)} className="me-2">
                                    <i className="fa-solid fa-arrow-left"></i>
                                </Button>
                            )}
                            <div className="position-relative">
                                <div className="d-flex align-items-center">
                                    <h3 className="page_title mb-0">
                                        {selectedEmail?.communication_type === 'email'
                                            ? 'Email Conversations'
                                            : selectedEmail?.communication_type === 'sms'
                                                ? 'SMS Conversations'
                                                : 'Conversation List'}
                                    </h3>
                                </div>
                            </div>
                        </div>
                    </Col>

                    {selectedEmail ? (
                        <Col lg={6}>
                            {/* Reply button can be added here if needed */}
                        </Col>
                    ) : (
                        <Col xl={5} md={8}>
                            <Row className="search_filters gx-1 gy-md-0 gy-1 mt-md-0 mt-1">
                                <Col xl={5} md={5} xs={5}>
                                    <Form.Control
                                        type="text"
                                        name="sender"
                                        placeholder="Search by Sender"
                                        value={searchParams.sender}
                                        onChange={handleInputChange}
                                        size="sm"
                                    />
                                </Col>
                                <Col xl={4} md={5} xs={4}>
                                    <Form.Control
                                        type="text"
                                        name="recipient"
                                        placeholder="Search by Recipient"
                                        value={searchParams.recipient}
                                        onChange={handleInputChange}
                                        size="sm"
                                    />
                                </Col>
                                <Col xl={3} md={2} xs={3}>
                                    <div className="d-flex gap-1">
                                        <Button 
                                            variant="custom" 
                                            size="sm"
                                            onClick={handleSearch}
                                            className="w-50"
                                        >
                                            Apply
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={clearFilters}
                                            disabled={!searchParams.sender && !searchParams.recipient && !searchParams.text}
                                            className="text-nowrap w-50"
                                        >
                                            Clear
                                        </Button>
                                    </div>
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
                        refresh={refreshKey}
                    />
                ) : (
                    <EmailConversationsList
                        dealer_id={activeDealerId}
                        searchSender={appliedSearchParams.sender}
                        searchRecipient={appliedSearchParams.recipient}
                        searchText={appliedSearchParams.text}
                        onEmailSelect={setSelectedEmail}
                        user={user}
                    />
                )}
            </div>
        </div>
    );
}

// Main page component with Suspense boundary
export default function EmailConversations() {
    return (
        <Suspense fallback={
            <div className="page_content">
                <div className="d-flex justify-content-center align-items-center" style={{ height: '300px' }}>
                    <Spinner animation="border" variant="dark" />
                    <span className="ms-3">Loading conversations...</span>
                </div>
            </div>
        }>
            <EmailConversationsContent />
        </Suspense>
    );
}