"use client";
import { useState, useEffect } from "react";
import { Modal, Button, Form, Alert, Row, Col, Card, Badge, Spinner } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";
import WriteWithAIModal from "../../components/WriteWithAIModal";

export default function EmailReplyModal({
    dealer_id,
    onClose,
    selectedConversation,
    communicationType = "email", // "email" or "sms",
    agentViewLanguage = "English",
    leadUserLanguage = "English",
    showTranslationEnabled = false,
    onReplySuccess,
    conversationThread = []
}) {
    const [content, setContent] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [subject, setSubject] = useState("");
    const [showWriteWithAI, setShowWriteWithAI] = useState(false);
    const [translating, setTranslating] = useState(false);
    const [showVdpSearch, setShowVdpSearch] = useState(false);
    const [vehicles, setVehicles] = useState([]);
    const [vehicleSearch, setVehicleSearch] = useState("");
    const [selectedVehicle, setSelectedVehicle] = useState(null);
    const [vehicleLoading, setVehicleLoading] = useState(false);
    const [vehiclePage, setVehiclePage] = useState(1);
    const [vehicleTotalPages, setVehicleTotalPages] = useState(1);
    const { fetchData, loading } = useFetch();

    useEffect(() => {
        if (selectedConversation && communicationType === "email") {
            setSubject(`Re: ${selectedConversation.subject || ""}`);
        }
    }, [selectedConversation, communicationType]);

    const searchVehicles = async (searchTerm = "", page = 1) => {
        if (!dealer_id) return;
        
        setVehicleLoading(true);
        try {
            let queryParams = `dealer_id=${dealer_id}&page=${page}&limit=10`;
            if (searchTerm.trim()) {
                queryParams += `&search=${encodeURIComponent(searchTerm.trim())}`;
            }
            
            // Get dealertoken from localStorage for authentication
            const token = localStorage.getItem("dealertoken");
            const headers = {};
            if (token) {
                headers["Authorization"] = `Bearer ${token}`;
            }
            
            const response = await fetch(`/api/vehicles?${queryParams}`, {
                headers: headers
            });
            const data = await response.json();
            
            if (response.ok) {
                setVehicles(data.data || []);
                setVehicleTotalPages(data.pagination?.totalPages || 1);
                setVehiclePage(page);
            } else {
                console.error("Error fetching vehicles:", data.error);
                setError(data.error || "Failed to search vehicles");
            }
        } catch (err) {
            console.error("Error searching vehicles:", err);
            setError("Failed to search vehicles. Please try again.");
        } finally {
            setVehicleLoading(false);
        }
    };

    const handleVehicleSearch = () => {
        searchVehicles(vehicleSearch, 1);
    };

    const handleVehicleSelect = (vehicle) => {
        setSelectedVehicle(vehicle);
        setShowVdpSearch(false);
        
        // Use shortUrl from database, fallback to generated URL if not available
        const vdpLink = vehicle.shortUrl || `${window.location.origin}/vehicle/${vehicle._id}`;
        
        // Add VDP link to content
        const vdpText = `\n\nVehicle Details:\n${vehicle.year} ${vehicle.make} ${vehicle.model}\nView: ${vdpLink}`;
        setContent(prev => prev + vdpText);
    };

    const removeSelectedVehicle = () => {
        setSelectedVehicle(null);
        // Remove VDP link from content (basic removal)
        if (selectedVehicle) {
            const vdpLink = selectedVehicle.shortUrl || `${window.location.origin}/vehicle/${selectedVehicle._id}`;
            setContent(prev => prev.replace(new RegExp(`\\n\\nVehicle Details:.*?${vdpLink.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), ''));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!content.trim()) {
            setError("Content is required.");
            return;
        }
        if (communicationType === "email" && !subject.trim()) {
            setError("Subject is required for emails.");
            return;
        }
        setError("");
        setMessage("");

        try {
            let contentToSend = content;
            let subjectToSend = subject;

            const shouldTranslateOutgoing =
                (communicationType === "email" || communicationType === "sms") &&
                leadUserLanguage &&
                agentViewLanguage &&
                leadUserLanguage.toLowerCase() !== agentViewLanguage.toLowerCase();

            if (shouldTranslateOutgoing) {
                setTranslating(true);
                const token = localStorage.getItem("dealertoken");
                const headers = { "Content-Type": "application/json" };
                if (token) headers["Authorization"] = `Bearer ${token}`;

                const messages = [{ id: "body", text: contentToSend }];
                if (communicationType === "email") {
                    messages.push({ id: "subject", text: subjectToSend });
                }

                const trRes = await fetch("/api/conversations/translate", {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                        targetLanguage: leadUserLanguage,
                        sourceHint: agentViewLanguage,
                        messages
                    })
                });
                const trData = await trRes.json();
                if (!trRes.ok) {
                    throw new Error(trData?.error || "Failed to translate before sending.");
                }
                if (trData?.translations?.body) contentToSend = trData.translations.body;
                if (communicationType === "email" && trData?.translations?.subject) {
                    subjectToSend = trData.translations.subject;
                }

                if (communicationType === "sms" && contentToSend.length > 160) {
                    setError(
                        `Translated SMS is ${contentToSend.length}/160 characters. Please shorten the message before sending.`
                    );
                    return;
                }
            }

            const payload = {
                dealerId: dealer_id,
                leadId: selectedConversation.lead_id,
                parent_message_id: selectedConversation.message_id,
                content: contentToSend,
                communicationType,
                recipient: selectedConversation.sender,
                originalMessage: selectedConversation.mail_content || selectedConversation.sms_content
            };

            // Only add subject for emails
            if (communicationType === "email") {
                payload.subject = subjectToSend;
            }

            // Get dealertoken from localStorage
            const token = localStorage.getItem("dealertoken");
            const headers = { "Content-Type": "application/json" };
            if (token) {
                headers["Authorization"] = `Bearer ${token}`;
            }

            const res = await fetchData("/api/conversations/reply", {
                method: "POST",
                headers: headers,
                body: JSON.stringify(payload),
            });

            const data = await res.json();
            if (res.ok) {
                setMessage(`${communicationType.toUpperCase()} sent successfully!`);
                setTimeout(() => {
                    onClose();
                    onReplySuccess(); // Call the refresh callback
                }, 2000);
            } else {
                setError(data.message || "An error occurred while sending.");
            }
        } catch (err) {
            setError("Failed to send message. Please try again.");
            console.error("Error sending message:", err);
        } finally {
            setTranslating(false);
        }
    };

    // Determine recipient display name (extract from email format if needed)
    const getRecipientDisplay = () => {
        if (!selectedConversation) return "";

        // Determine which field to use based on message status
        const displayField = (selectedConversation.status === 'incoming' || selectedConversation.status === 'received')
            ? selectedConversation.sender
            : selectedConversation.recipient;

        // Extract name/email from the determined field
        const match = displayField?.match(/(.*)<(.*)>/);
        return match ? `${match[1].trim()} (${match[2]})` : displayField || "";
    };

    return (
    <>
        <Modal show={true} onHide={onClose} centered size={communicationType === "sms" ? "lg" : "xl"}>
            <Modal.Header closeButton>
                <Modal.Title>Reply via {communicationType.toUpperCase()}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                {message && <Alert variant="success">{message}</Alert>}
                {error && <Alert variant="danger">{error}</Alert>}

                <div className="mb-3">
                    <p><strong>Replying to:</strong> {getRecipientDisplay()}</p>
                    {communicationType === "email" && selectedConversation?.subject && (
                        <p><strong>Original Subject:</strong> {selectedConversation.subject}</p>
                    )}
                </div>

                <Form onSubmit={handleSubmit}>
                    {communicationType === "email" && (
                        <Form.Group className="mb-3">
                            <Form.Label>Subject</Form.Label>
                            <Form.Control
                                type="text"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder="Enter subject..."
                                isInvalid={!!error && !subject.trim()}
                            />
                        </Form.Group>
                    )}

                    <div className="mb-3">
                        <Button
                            variant="outline-custom"
                            size="sm"
                            className="mb-2"
                            onClick={() => setShowWriteWithAI(true)}
                        >
                            <i className="fa-solid fa-wand-magic-sparkles me-2"></i>
                            Write with AI
                        </Button>
                    </div>

                    {/* VDP Attachment Section */}
                    <div className="mb-3">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                            <Form.Label>Vehicle Details (Optional)</Form.Label>
                            <Button
                                variant="outline-custom"
                                size="sm"
                                onClick={() => {
                                    setShowVdpSearch(!showVdpSearch);
                                    if (!showVdpSearch && vehicles.length === 0) {
                                        searchVehicles();
                                    }
                                }}
                            >
                                {selectedVehicle ? "Change Vehicle" : "Attach Vehicle"}
                            </Button>
                        </div>
                        
                        {selectedVehicle && (
                            <Card className="mb-2">
                                <Card.Body className="py-2">
                                    <div className="d-flex justify-content-between align-items-center">
                                        <div>
                                            <strong>{selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</strong>
                                            {selectedVehicle.price && (
                                                <Badge bg="success" className="ms-2">${selectedVehicle.price.toLocaleString()}</Badge>
                                            )}
                                        </div>
                                        <Button variant="outline-danger" size="sm" onClick={removeSelectedVehicle}>
                                            <i className="fa-solid fa-times"></i>
                                        </Button>
                                    </div>
                                </Card.Body>
                            </Card>
                        )}

                        {showVdpSearch && (
                            <Card>
                                <Card.Header>
                                    <Row className="align-items-center">
                                        <Col md={8}>
                                            <Form.Control
                                                type="text"
                                                placeholder="Search vehicles by make, model, year, or VIN..."
                                                value={vehicleSearch}
                                                onChange={(e) => setVehicleSearch(e.target.value)}
                                                onKeyPress={(e) => e.key === 'Enter' && handleVehicleSearch()}
                                            />
                                        </Col>
                                        <Col md={4}>
                                            <div className="d-flex gap-1">
                                                <Button variant="custom" size="sm" onClick={handleVehicleSearch} disabled={vehicleLoading}>
                                                    {vehicleLoading ? <Spinner size="sm" /> : "Search"}
                                                </Button>
                                                <Button variant="secondary" size="sm" onClick={() => setShowVdpSearch(false)}>
                                                    Cancel
                                                </Button>
                                            </div>
                                        </Col>
                                    </Row>
                                </Card.Header>
                                <Card.Body style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                    {vehicleLoading ? (
                                        <div className="text-center py-3">
                                            <Spinner animation="border" size="sm" />
                                            <span className="ms-2">Searching vehicles...</span>
                                        </div>
                                    ) : vehicles.length > 0 ? (
                                        <>
                                            {vehicles.map(vehicle => (
                                                <div 
                                                    key={vehicle._id} 
                                                    className="border-bottom py-2 cursor-pointer"
                                                    onClick={() => handleVehicleSelect(vehicle)}
                                                    style={{ cursor: 'pointer' }}
                                                >
                                                    <div className="d-flex justify-content-between align-items-center">
                                                        <div>
                                                            <strong>{vehicle.year} {vehicle.make} {vehicle.model}</strong>
                                                            {vehicle.vin && <small className="text-muted ms-2">VIN: {vehicle.vin}</small>}
                                                        </div>
                                                        <div className="text-end">
                                                            {vehicle.price && (
                                                                <Badge bg="success">${vehicle.price.toLocaleString()}</Badge>
                                                            )}
                                                            <div className="text-muted small">
                                                                Stock: {vehicle.stock_number || 'N/A'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            
                                            {vehicleTotalPages > 1 && (
                                                <div className="d-flex justify-content-center mt-3">
                                                    <Button 
                                                        variant="outline-custom" 
                                                        size="sm" 
                                                        disabled={vehiclePage === 1}
                                                        onClick={() => searchVehicles(vehicleSearch, vehiclePage - 1)}
                                                    >
                                                        Previous
                                                    </Button>
                                                    <span className="mx-3 align-self-center">
                                                        Page {vehiclePage} of {vehicleTotalPages}
                                                    </span>
                                                    <Button 
                                                        variant="outline-custom" 
                                                        size="sm" 
                                                        disabled={vehiclePage === vehicleTotalPages}
                                                        onClick={() => searchVehicles(vehicleSearch, vehiclePage + 1)}
                                                    >
                                                        Next
                                                    </Button>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <div className="text-center py-3 text-muted">
                                            No vehicles found. Try a different search term.
                                        </div>
                                    )}
                                </Card.Body>
                            </Card>
                        )}
                    </div>

                    <Form.Group className="mb-3">
                        <Form.Label>{communicationType === "email" ? "Email Content" : "SMS Message"}</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={communicationType === "sms" ? 4 : 6}
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder={`Enter your ${communicationType} content here...`}
                            isInvalid={!!error && !content.trim()}
                            maxLength={communicationType === "sms" ? 160 : undefined}
                        />
                        {communicationType === "sms" && (
                            <Form.Text className="text-muted">
                                {content.length}/160 characters
                            </Form.Text>
                        )}
                        <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group className="text-center mt-4">
                        <Button variant="custom" type="submit" disabled={loading || translating}>
                            {translating ? "Translating..." : loading ? "Sending..." : `Send ${communicationType.toUpperCase()}`}
                        </Button>
                        <Button variant="secondary" className="ms-2" onClick={onClose}>
                            Cancel
                        </Button>
                    </Form.Group>
                </Form>
            </Modal.Body>
        </Modal>

        {showWriteWithAI && selectedConversation?.lead_id && (
            <WriteWithAIModal
                show={showWriteWithAI}
                onHide={() => setShowWriteWithAI(false)}
                leadId={selectedConversation.lead_id}
                channel={communicationType}
                dealerId={dealer_id}
                defaultLanguage={showTranslationEnabled ? agentViewLanguage : "English"}
                lockLanguage={showTranslationEnabled}
                conversationThread={conversationThread}
                onDraftReady={(draft, subjectLine) => {
                    setContent(draft || "");
                    if (communicationType === "email" && subjectLine != null) setSubject(subjectLine);
                    setShowWriteWithAI(false);
                }}
            />
        )}
    </>
    );
}