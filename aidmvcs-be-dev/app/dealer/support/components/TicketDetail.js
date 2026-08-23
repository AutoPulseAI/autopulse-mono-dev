"use client";
import { useState, useEffect } from "react";
import { formatTimestamp } from "../../../utils/dateUtils";
import { Row, Col, Button, Alert, Badge, Form, Image, Modal } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";
import TicketStatusModal from "./TicketStatusModal";
import { useUser } from "../../context/UserContext";
import ImageUpload from "../../../components/ImageUpload";

export default function TicketDetail({ ticket }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [newMessageImages, setNewMessageImages] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const { fetchData } = useFetch();
  const { dealerParent } = useUser();
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    if (ticket?._id) fetchMessages(ticket._id);
  }, [ticket]);

  // Auto-hide alerts after 3 sec
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError("");
        setSuccess("");
      }, 3000); // 3 sec

      return () => clearTimeout(timer); // cleanup
    }
  }, [error, success]);

  const fetchMessages = async (ticketId) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/tickets/${ticketId}/messages`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to fetch messages");
      setMessages(data.messages || []);
    } catch (err) {
      setError(err.message || "Failed to load messages");
    } finally {
      setLoading(false);
    }
  };

  const uploadMessageImages = async () => {
    const images = Array.isArray(newMessageImages) ? newMessageImages : [];
    if (images.length === 0) return [];

    setUploadingImages(true);
    const uploadedImages = [];

    try {
      for (const image of images) {
        if (image.file) {
          // Upload new image
          const formData = new FormData();
          formData.append('images', image.file);

          const response = await fetch('/api/upload/image', {
            method: 'POST',
            body: formData
          });

          const result = await response.json();
          if (result.success) {
            // Handle single file upload response (has 'url' property)
            if (result.url) {
              uploadedImages.push({
                url: result.url,
                originalName: result.filename || image.name,
                fileName: result.filename,
                size: result.size,
                type: result.type
              });
            } 
            // Handle multiple file upload response (has 'images' array)
            else if (result.images && Array.isArray(result.images) && result.images.length > 0) {
              uploadedImages.push(result.images[0]);
            }
          }
        } else if (image.url) {
          // Image already uploaded
          uploadedImages.push(image);
        }
      }
    } catch (error) {
      console.error('Error uploading images:', error);
      throw new Error('Failed to upload images');
    } finally {
      setUploadingImages(false);
    }

    return uploadedImages;
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const hasImages = Array.isArray(newMessageImages) && newMessageImages.length > 0;
    if (!newMessage.trim() && !hasImages) return;

    try {
      setLoading(true);
      setError("");
      setSuccess("");

      // Upload images first
      let uploadedImages = [];
      if (hasImages) {
        uploadedImages = await uploadMessageImages();
      }

      const res = await fetchData(`/api/tickets/${ticket._id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          content: newMessage, 
          user_id: dealerParent.id, 
          type: 'dealer',
          attachments: uploadedImages
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to send message");

      setNewMessage("");
      setNewMessageImages([]);
      setShowUpload(false);
      setSuccess("Message sent successfully!");
      fetchMessages(ticket._id);
    } catch (err) {
      setError(err.message || "Failed to send message");
    } finally {
      setLoading(false);
    }
  };

  const handleImageClick = (image) => {
    setSelectedImage(image);
    setShowImageModal(true);
  };

  const renderAttachments = (attachments) => {
    if (!attachments || attachments.length === 0) return null;

    return (
      <div className="message-attachments mt-2">
        <Row className="g-1">
          {attachments.map((attachment, index) => {
            // Handle both URL strings and attachment objects for backward compatibility
            const url = typeof attachment === 'string' ? attachment : attachment.url;
            const originalName = typeof attachment === 'string' ? 'Image' : (attachment.originalName || 'Image');
            
            return (
              <Col key={index} xs={4} sm={4} md={4}>
                <div 
                  className="attachment-thumbnail position-relative cursor-pointer"
                  onClick={() => handleImageClick({ url, originalName })}
                  style={{ cursor: 'pointer' }}
                >
                  <Image
                    src={url}
                    alt={originalName}
                    fluid
                    className="rounded border p-1"
                    style={{ 
                      width: '100%', 
                      objectFit: 'cover',
                      background: 'rgba(255, 255, 255, 0.5)'
                    }}
                  />
                  <div className="attachment-overlay">
                    <small className="text-white bg-dark bg-opacity-75 rounded px-1">
                      Image
                    </small>
                  </div>
                </div>
              </Col>
            );
          })}
        </Row>
      </div>
    );
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'open': return <Badge bg="custom">Open</Badge>;
      case 'in_progress': return <Badge bg="warning">In Progress</Badge>;
      case 'resolved': return <Badge bg="success">Resolved</Badge>;
      case 'closed': return <Badge bg="secondary">Closed</Badge>;
      default: return <Badge bg="light">Unknown</Badge>;
    }
  };

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'low': return <Badge bg="info">Low</Badge>;
      case 'medium': return <Badge bg="custom">Medium</Badge>;
      case 'high': return <Badge bg="warning">High</Badge>;
      case 'critical': return <Badge bg="danger">Critical</Badge>;
      default: return <Badge bg="light">Unknown</Badge>;
    }
  };

  if (!ticket) return null;

  return (
    <>
      <Row className="justify-content-center gx-3">
        <Col xl={3} md={4}>
          <div className="w_card mb-3 dealer_info position-sticky">
            <p>
              <strong>Ticket No:</strong>{" "}
              {ticket.ticketNumber ? `#${ticket.ticketNumber}` : ticket._id}
            </p>
            <p><strong>Subject:</strong> {ticket.title}</p>
            <p><strong>Status:</strong> {getStatusBadge(ticket.status)}</p>
            <p><strong>Priority:</strong> {getPriorityBadge(ticket.priority)}</p>
            <p><strong>Category:</strong> <span className="text-capitalize">{ticket.category}</span></p>
            <p><strong>Description:</strong> {ticket.description}</p>
            <p><strong>Created At:</strong> {formatTimestamp(ticket.createdAt)}</p>

            {/* Display ticket attachments if any */}
            {ticket.attachments && ticket.attachments.length > 0 && (
              <div className="mt-3">
                <p><strong>Attachments:</strong></p>
                {renderAttachments(ticket.attachments)}
              </div>
            )}

            <Button
              variant="custom"
              className="mt-xl-3 mt-1 w-100"
              onClick={() => setShowStatusModal(true)}
            >
              Update Status
            </Button>
          </div>
        </Col>

        <Col xl={9} md={8}>
          <div className="d-flex align-items-center mb-3">
            <h3 className="w_card_title mb-0">Conversation</h3>
          </div>

          <div className="w_card mt-3">
            {messages.length > 0 ? (
              messages.map((msg, i) => (
                <div key={i} className="position-relative mb-3">
                  {msg.senderType === "admin" ? (
                    <div className="position-relative text-start">
                      <div className="msg_left">
                        <div className="msg_card">
                          {msg.content}
                          {renderAttachments(msg.attachments)}
                        </div>
                        <div className="msg_from_time">
                          <p><small>{msg.sender?.name || "System"}, <span className="text-muted">{formatTimestamp(msg.createdAt)}</span></small></p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="position-relative text-end">
                      <div className="msg_right">
                        <div className="msg_card">
                          {msg.content}
                          {renderAttachments(msg.attachments)}
                        </div>
                        <div className="msg_from_time">
                          <p><small>{msg.sender?.name || "System"}, <span className="text-muted">{formatTimestamp(msg.createdAt)}</span></small></p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-center py-4">No messages yet</div>
            )}
          </div>

          <div className="w_card msg_txt_input mt-2">
            <Form onSubmit={handleSendMessage}>
              {/* Conditionally Render Image Upload */}
              {showUpload && (
                <Form.Group className="mb-3">
                  <Form.Label className="small text-muted">Attach Images (Optional)</Form.Label>
                  <ImageUpload
                  onImagesChange={setNewMessageImages}
                  maxImages={3}
                  maxFileSize={5 * 1024 * 1024} // 5MB
                  acceptedTypes={['image/jpeg', 'image/png', 'image/gif', 'image/webp']}
                  />
                </Form.Group>
              )}

              <div className="d-flex align-items-start">
                <Form.Control
                  as="textarea"
                  rows={2}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type your message here..."
                />

                <div className="d-flex align-items-center ms-1">
                  {/* Toggle Button for Upload */}
                  <Button
                    variant="outline-secondary"
                    className="me-1"
                    onClick={() => {
                      setShowUpload((prev) => {
                        if (prev) {
                          // if closing, reset images
                          setNewMessageImages([]);
                        }
                        return !prev;
                      });
                    }}
                    aria-label="Upload Images"
                  >
                    <i className={`fa-regular ${showUpload ? 'fa-xmark' : 'fa-paperclip'}`}></i></Button>
                  <Button
                    variant="custom"
                    type="submit"
                    disabled={
                      loading ||
                      uploadingImages ||
                      (!newMessage.trim() &&
                        !(Array.isArray(newMessageImages) && newMessageImages.length > 0))
                    }
                  >
                    {loading ? "Sending..." : uploadingImages ? "Uploading..." : "Send"}
                  </Button>
                </div>
              </div>
            </Form>
          </div>
        </Col>
      </Row>

      {error && (
        <Alert variant="danger" className="mt-3 fixed_alert">
          {error}
        </Alert>
      )}
      {success && (
        <Alert variant="success" className="mt-3 fixed_alert">
          {success}
        </Alert>
      )}

      <TicketStatusModal
        show={showStatusModal}
        onHide={() => setShowStatusModal(false)}
        ticket={ticket}
        onStatusUpdate={() => {
          fetchMessages(ticket._id);
          setSuccess("Status updated successfully!");
        }}
      />

      {/* Image Modal */}
      <Modal show={showImageModal} onHide={() => setShowImageModal(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>Image Preview</Modal.Title>
        </Modal.Header>
        <Modal.Body className="text-center">
          {selectedImage && (
            <Image
              src={selectedImage.url}
              alt={selectedImage.originalName || 'Image'}
              fluid
              className="img-fluid"
            />
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowImageModal(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}