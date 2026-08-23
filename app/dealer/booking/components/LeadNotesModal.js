"use client";
import { useState, useEffect } from "react";
import { Modal, Button, Form, Alert, Row, Col, Card, Badge } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";
import WriteWithAIModal from "../../components/WriteWithAIModal";

export default function LeadNotesModal({
  show,
  onHide,
  lead,
  dealer_id,
  agentViewLanguage = "English",
  showTranslationEnabled = false,
  selectedConversation,
  onNoteSaved,
  editNote = null, // If provided, we're in edit mode
  conversationThread = []
}) {
  const [content, setContent] = useState(editNote?.mail_content || "");
  const [internalUse, setInternalUse] = useState(editNote?.internal_use === true);
  const [showWriteWithAI, setShowWriteWithAI] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { fetchData } = useFetch();

  // Update content when editNote changes or modal opens
  useEffect(() => {
    if (editNote && show) {
      setContent(editNote.mail_content || "");
      setInternalUse(editNote.internal_use === true);
    } else if (!editNote && show) {
      setContent("");
      setInternalUse(false);
    }
  }, [editNote, show]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim()) {
      setError("Note content is required.");
      return;
    }
    
    setLoading(true);
    setError("");

    try {
      // Get dealertoken from localStorage
      const token = localStorage.getItem("dealertoken");
      const headers = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      let response;
      if (editNote) {
        // Update existing note
        response = await fetchData("/api/conversations/notes", {
          method: "PUT",
          headers: headers,
          body: JSON.stringify({
            note_id: editNote._id,
            dealer_id: dealer_id,
            content: content.trim(),
            internal_use: internalUse,
            user_language: String(agentViewLanguage || "English").toLowerCase(),
          }),
        });
      } else {
        // Create new note
        response = await fetchData("/api/conversations/notes", {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            lead_id: lead._id,
            dealer_id: dealer_id,
            content: content.trim(),
            internal_use: internalUse,
            user_language: String(agentViewLanguage || "English").toLowerCase(),
            parent_conversation_id: selectedConversation?.message_id || selectedConversation?._id
          }),
        });
      }

      const data = await response.json();
      
      if (response.ok) {
        setContent("");
        setInternalUse(false);
        onNoteSaved();
        onHide();
      } else {
        setError(data.message || `Failed to ${editNote ? 'update' : 'save'} note`);
      }
    } catch (err) {
      setError(`Failed to ${editNote ? 'update' : 'save'} note. Please try again.`);
      console.error(`Error ${editNote ? 'updating' : 'saving'} note:`, err);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setContent("");
    setInternalUse(false);
    setError("");
    onHide();
  };

  return (
    <>
    <Modal show={show} onHide={handleClose} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          {editNote ? 'Edit Lead Note' : 'Add Lead Note'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        
        <div className="mb-3">
          <Card className="bg-light">
            <Card.Body className="py-2">
              <div className="d-lg-flex justify-content-between align-items-center">
                <div>
                  <strong>{lead?.name || "N/A"}</strong>
                  <Badge bg="info" className="ms-2">{lead?.fe_lead_status || "N/A"}</Badge>
                </div>
                <div className="text-muted small">
                  {lead?.email || "N/A"} | {lead?.phone || "N/A"}
                </div>
              </div>
            </Card.Body>
          </Card>
        </div>

        <Form onSubmit={handleSubmit}>
          <div className="mb-3">
            <Button
              variant="outline-custom"
              size="sm"
              onClick={() => setShowWriteWithAI(true)}
            >
              <i className="fa-solid fa-wand-magic-sparkles me-2"></i>
              Write with AI
            </Button>
          </div>
          <Form.Group className="mb-3">
            <Form.Label>
              <i className="fa-solid fa-pen-to-square me-1"></i>
              Note Content
            </Form.Label>
            <Form.Control
              as="textarea"
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your note here... This will be used by AI to prepare better responses."
              isInvalid={!!error && !content.trim()}
            />
            <Form.Text className="text-muted">
              <i className="fa-solid fa-robot me-1"></i>
              This note will help AI understand context and prepare more relevant responses.
            </Form.Text>
            <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Check
              type="checkbox"
              id="internal-use-checkbox"
              label={
                <>
                  <i className="fa-solid fa-lock me-1"></i>
                  Internal Use Only
                </>
              }
              checked={internalUse}
              onChange={(e) => setInternalUse(e.target.checked)}
            />
            <Form.Text className="text-muted">
              <i className="fa-solid fa-info-circle me-1"></i>
              Check this box to mark the note as internal. Internal notes won't appear in the conversation view.
            </Form.Text>
          </Form.Group>

          <div className="d-flex justify-content-end gap-2">
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="warning" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin me-1"></i>
                  {editNote ? 'Updating...' : 'Saving...'}
                </>
              ) : (
                <>
                  Save Note
                </>
              )}
            </Button>
          </div>
        </Form>
      </Modal.Body>
    </Modal>

    {showWriteWithAI && lead?._id && (
      <WriteWithAIModal
        show={showWriteWithAI}
        onHide={() => setShowWriteWithAI(false)}
        leadId={lead._id}
        channel="note"
        dealerId={dealer_id}
        defaultLanguage={showTranslationEnabled ? agentViewLanguage : "English"}
        lockLanguage={showTranslationEnabled}
        conversationThread={conversationThread}
        onDraftReady={(draft) => {
          setContent(draft || "");
          setShowWriteWithAI(false);
        }}
      />
    )}
    </>
  );
}
