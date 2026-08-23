'use client';

import { useState, useRef } from 'react';
import { Button, Image, Alert, Spinner, Row, Col } from 'react-bootstrap';
// import { FaUpload, FaTimes } from 'react-icons/fa';

export default function ImageUpload({ 
  onImagesChange, 
  maxImages = 5, 
  maxFileSize = 5 * 1024 * 1024, // 5MB
  acceptedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  existingImages = []
}) {
  const [images, setImages] = useState(existingImages || []);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const validateFile = (file) => {
    // Check file size
    if (file.size > maxFileSize) {
      throw new Error(`File size must be less than ${Math.round(maxFileSize / 1024 / 1024)}MB`);
    }

    // Check file type
    if (!acceptedTypes.includes(file.type)) {
      throw new Error(`File type ${file.type} is not supported. Please use: ${acceptedTypes.join(', ')}`);
    }

    return true;
  };

  const handleFileSelect = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    // Check if adding these files would exceed maxImages
    if (images.length + files.length > maxImages) {
      setError(`Maximum ${maxImages} images allowed. You can add ${maxImages - images.length} more.`);
      return;
    }

    setError('');
    setUploading(true);

    try {
      const newImages = [];
      
      for (const file of files) {
        try {
          validateFile(file);
          
          // Create preview URL
          const previewUrl = URL.createObjectURL(file);
          
          // Create image object
          const imageObj = {
            file,
            preview: previewUrl,
            name: file.name,
            size: file.size,
            type: file.type,
            id: Date.now() + Math.random() // Temporary ID
          };
          
          newImages.push(imageObj);
        } catch (err) {
          setError(err.message);
          break;
        }
      }

      if (newImages.length > 0) {
        const updatedImages = [...images, ...newImages];
        setImages(updatedImages);
        onImagesChange(updatedImages);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removeImage = (index) => {
    const updatedImages = images.filter((_, i) => i !== index);
    setImages(updatedImages);
    onImagesChange(updatedImages);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.currentTarget.classList.add('border-primary');
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-custom');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-custom');
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const event = { target: { files } };
      handleFileSelect(event);
    }
  };

  return (
    <div className="image-upload-container">
      {error && (
        <Alert variant="danger" onClose={() => setError('')} dismissible>
          {error}
        </Alert>
      )}

      {/* Upload Area */}
      <div
        className="upload-area border-2 border-dashed border-secondary rounded p-3 text-center mb-3"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ 
          minHeight: '120px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          cursor: 'pointer',
          transition: 'all 0.3s ease'
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        {/* <FaUpload size={24} className="text-muted mb-2" /> */}
        <i className="fa-regular fa-upload"></i>
        <p className="mb-2">
          <strong>Click to upload</strong> or drag and drop images here
        </p>
        <p className="text-muted small mb-0">
          Supported formats: JPEG, PNG, GIF, WebP (Max: {Math.round(maxFileSize / 1024 / 1024)}MB each)
        </p>
        <p className="text-muted small mb-0">
          Maximum {maxImages} images allowed
        </p>
        
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={acceptedTypes.join(',')}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
      </div>

      {/* Upload Progress */}
      {uploading && (
        <div className="text-center mb-3">
          <Spinner animation="border" size="sm" className="me-2" />
          <span>Processing images...</span>
        </div>
      )}

      {/* Image Preview Grid */}
      {images.length > 0 && (
        <div className="image-preview-grid">
          <Row className="g-2">
            {images.map((image, index) => (
              <Col key={image.id || index} xs={6} sm={4} md={3} lg={2}>
                <div className="image-preview-item position-relative">
                  <Image
                    src={image.preview || image.url}
                    alt={image.name}
                    fluid
                    className="rounded border"
                  />
                  
                  {/* Image Info Overlay */}
                  <div className="image-info-overlay">
                    <div className="d-flex justify-content-between align-items-start py-1">
                      <p className="mb-0"><small className="text-muted d-block mb-1" title={image.name}>
                      {image.name}
                      </small>
                      <small className="text-white bg-dark bg-opacity-75 rounded px-1">
                        {Math.round(image.size / 1024)}KB
                      </small></p>
                      <Button
                        variant="danger"
                        size="sm"
                        className="close_sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeImage(index);
                        }}
                      >
                        {/* <FaTimes size={12} /> */}
                        <i className="fa-regular fa-xmark"></i>
                      </Button>
                    </div>
                  </div>
                  
                  {/* Image Name */}
                  {/* <div className="mt-1">
                    <small className="text-muted d-block text-truncate" title={image.name}>
                      {image.name}
                    </small>
                  </div> */}
                </div>
              </Col>
            ))}
          </Row>
        </div>
      )}

      {/* Upload Button */}
      {images.length < maxImages && (
        <div className="text-center mt-3">
          <Button
            variant="outline-custom"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {/* <FaUpload className="me-2" /> */}
            <i className="fa-regular fa-upload me-2"></i>
            Add More Images
          </Button>
        </div>
      )}
    </div>
  );
}
