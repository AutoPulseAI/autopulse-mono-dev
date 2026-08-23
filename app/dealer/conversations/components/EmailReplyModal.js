"use client";
import { useState, useEffect } from "react";
import { Modal, Button, Form, Alert } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";

export default function EmailReplyModal({
    user,
    dealer_id,
    onClose,
    selectedConversation,
    communicationType = "email", // "email" or "sms",
    onReplySuccess
}) {
    const [content, setContent] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [subject, setSubject] = useState("");
    const { fetchData, loading } = useFetch();

    useEffect(() => {
        if (selectedConversation && communicationType === "email") {
            setSubject(`Re: ${selectedConversation.subject || ""}`);
        }
    }, [selectedConversation, communicationType]);

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
            const payload = {
                userId: user?.id,
                dealerId: dealer_id,
                leadId: selectedConversation.lead_id,
                parent_message_id: selectedConversation.message_id,
                content,
                communicationType,
                recipient: selectedConversation.sender,
                originalMessage: selectedConversation.mail_content || selectedConversation.sms_content
            };

            // Only add subject for emails
            if (communicationType === "email") {
                payload.subject = subject;
            }

            const res = await fetchData("/api/conversations/reply", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
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
        <Modal show={true} onHide={onClose} centered size={communicationType === "sms" ? "md" : "lg"}>
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

                    <Form.Group className="mb-3">
                        <Form.Label>{communicationType === "email" ? "Email Content" : "SMS Message"}</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={communicationType === "sms" ? 3 : 5}
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
                        <Button variant="custom" type="submit" disabled={loading}>
                            {loading ? "Sending..." : `Send ${communicationType.toUpperCase()}`}
                        </Button>
                        <Button variant="secondary" className="ms-2" onClick={onClose}>
                            Cancel
                        </Button>
                    </Form.Group>
                </Form>
            </Modal.Body>
        </Modal>
    );
}