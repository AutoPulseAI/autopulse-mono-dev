"use client";
import { useState } from "react";
import { Form, Button, Row, Col, Alert, Spinner } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";
import ImageUpload from "../../../components/ImageUpload";

export default function NewTicketForm({ onCancel, onSuccess }) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "technical",
    priority: "medium"
  });
  const [images, setImages] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const { fetchData } = useFetch();

  const categories = [
    { value: "technical", label: "Technical" },
    { value: "billing", label: "Billing" },
    { value: "account", label: "Account" },
    { value: "general", label: "General" }
  ];

  const priorities = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "critical", label: "Critical" }
  ];

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleImagesChange = (newImages) => {
    setImages(newImages);
  };

  const uploadImages = async () => {
    const imageArray = Array.isArray(images) ? images : [];
    if (imageArray.length === 0) return [];

    setUploadingImages(true);
    const uploadedImages = [];

    try {
      for (const image of imageArray) {
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      // Upload images first
      let uploadedImages = [];
      if (Array.isArray(images) && images.length > 0) {
        uploadedImages = await uploadImages();
      }

      const payload = {
        ...formData,
        createdBy: "admin", // Admin creating ticket
        createdByModel: "admin",
        attachments: uploadedImages
      };

      const res = await fetchData("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create ticket");

      setSuccess("Ticket created successfully!");
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err) {
      setError(err.message || "Failed to create ticket");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w_card">
      <h3 className="w_card_title">Create New Ticket</h3>
      
      {error && <Alert variant="danger">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <Form onSubmit={handleSubmit}>
        <Row>
          <Form.Group as={Col} lg={12} className="mb-3" controlId="title">
            <Form.Label>Subject *</Form.Label>
            <Form.Control 
              type="text" 
              name="title" 
              value={formData.title} 
              onChange={handleChange} 
              required 
              maxLength={100}
            />
          </Form.Group>

          <Form.Group as={Col} lg={6} className="mb-3" controlId="category">
            <Form.Label>Category *</Form.Label>
            <Form.Select
              name="category"
              value={formData.category}
              onChange={handleChange}
              required
            >
              {categories.map(cat => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group as={Col} lg={6} className="mb-3" controlId="priority">
            <Form.Label>Priority *</Form.Label>
            <Form.Select
              name="priority"
              value={formData.priority}
              onChange={handleChange}
              required
            >
              {priorities.map(pri => (
                <option key={pri.value} value={pri.value}>{pri.label}</option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group as={Col} lg={12} className="mb-3" controlId="description">
            <Form.Label>Description *</Form.Label>
            <Form.Control
              as="textarea"
              rows={5}
              name="description"
              value={formData.description}
              onChange={handleChange}
              required
            />
          </Form.Group>

          {/* Image Upload Section */}
          <Form.Group as={Col} lg={12} className="mb-3" controlId="images">
            <Form.Label>Attach Images (Optional)</Form.Label>
            <ImageUpload
              onImagesChange={handleImagesChange}
              maxImages={5}
              maxFileSize={5 * 1024 * 1024} // 5MB
              acceptedTypes={['image/jpeg', 'image/png', 'image/gif', 'image/webp']}
            />
            <Form.Text className="text-muted">
              You can attach up to 5 images. Supported formats: JPEG, PNG, GIF, WebP. Max size: 5MB each.
            </Form.Text>
          </Form.Group>

          <Col lg={12} className="text-center mt-0 mt-xl-2">
            <Button variant="custom" type="submit" disabled={loading || uploadingImages} className="me-2">
              {loading ? (
                <>
                  <Spinner as="span" size="sm" animation="border" role="status" aria-hidden="true" />
                  <span className="ms-2">Creating...</span>
                </>
              ) : uploadingImages ? (
                <>
                  <Spinner as="span" size="sm" animation="border" role="status" aria-hidden="true" />
                  <span className="ms-2">Uploading Images...</span>
                </>
              ) : "Create Ticket"}
            </Button>
            <Button variant="secondary" type="button" onClick={onCancel}>
              Cancel
            </Button>
          </Col>
        </Row>
      </Form>
    </div>
  );
}