"use client";
import { useEffect, useState } from "react";
import { Form, Button, Image, Row, Col } from "react-bootstrap";
import useFetch from "../../hooks/useFetch";
import { useUser } from "../context/UserContext";
import { useLoader } from "../../context/LoaderContext";

const formConfig = {
  brandingColors: [
    {
      id: "primaryColor",
      label: "Primary Color",
      type: "color",
      required: true,
      defaultValue: "#0272b4",
      errorMessage: "Primary Color is required."
    },
    // {
    //   id: "headerColor",
    //   label: "Header Color",
    //   type: "color",
    //   required: true,
    //   defaultValue: "#F9F9FC",
    //   errorMessage: "Header Color is required."
    // },
    {
      id: "titleColor",
      label: "Text Color",
      type: "color",
      required: true,
      defaultValue: "#262A2A",
      errorMessage: "Title Color is required."
    }
  ],
  images: [
    {
      id: "dealershipLogo",
      label: "Dealership Logo",
      type: "file",
      required: false, // Changed to not required if existing data
      errorMessage: "Dealership logo image is required.",
      previewKey: "dealershipLogoPreview",
      defaultImage: "/Images/dealershiplogo.png",
      accept: "image/png, image/jpeg, image/webp"
    },
    {
      id: "bannerImage",
      label: "Banner Image (Size: 550px * 150px)",
      type: "file",
      required: false, // Changed to not required if existing data
      errorMessage: "Banner image is required.",
      previewKey: "bannerPreview",
      defaultImage: "/Images/defaultbanner.png",
      accept: "image/png, image/jpeg, image/webp"
    }
  ],
  customerCare: [
    {
      id: "ccNumber",
      label: "Customer Care Number",
      type: "text",
      required: true,
      errorMessage: "Customer Care Number is required."
    },
    {
      id: "ccEmail",
      label: "Customer Care Email",
      type: "email",
      required: true,
      errorMessage: "Customer Care Email is required."
    }
  ],
  mailSignature: [
    {
      id: "signatureName",
      label: "Bot Name",
      type: "text",
      required: false,
      errorMessage: "Name is required."
    },
    {
      id: "signatureDesignation",
      label: "Designation",
      type: "text",
      required: false,
      errorMessage: "Designation is required."
    },
    {
      id: "signatureStore",
      label: "Store Name",
      type: "text",
      required: false,
      errorMessage: "Store is required."
    }
  ]
};

export default function BrandingForm({ onSuccess, dealerId, initialData }) {
  const { user, dealerParent, updateUser } = useUser();
  const { setLoading } = useLoader();
  const { fetchData, loading: fetchLoading } = useFetch();

  const [formData, setFormData] = useState(() => {
    const initialState = {};
    
    // Initialize form with existing data or defaults
    formConfig.brandingColors.forEach(field => {
      initialState[field.id] = dealerParent?.branding_information?.[field.id] || 
                             initialData?.[field.id] || 
                             field.defaultValue;
    });
    
    formConfig.images.forEach(field => {
      const existingFile = dealerParent?.branding_information?.[field.id];
      initialState[field.previewKey] = existingFile?.url || 
                                     initialData?.[field.id]?.url || 
                                     field.defaultImage;
      initialState[field.id] = null; // File object starts as null
    });
    
    [...formConfig.customerCare, ...formConfig.mailSignature].forEach(field => {
      // Special case for signatureName
      if (field.id === "signatureName") {
        initialState[field.id] = dealerParent?.dealer_account_information?.ai_bot_name || dealerParent?.branding_information?.[field.id] || 
                              "";
      } else {
        initialState[field.id] = dealerParent?.branding_information?.[field.id] || 
                              initialData?.[field.id] || 
                              "";
      }
    });
    
    return initialState;
  });

  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState({ text: "", isError: false });
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!dealerParent) {
    return <div className="text-center py-4">Loading dealer information...</div>;
  }

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e, fieldId, previewKey) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setErrors(prev => ({ ...prev, [fieldId]: "File size must be less than 5MB" }));
      return;
    }

    // Validate file type
    const validTypes = formConfig.images.find(f => f.id === fieldId)?.accept;
    if (validTypes && !validTypes.includes(file.type)) {
      setErrors(prev => ({ ...prev, [fieldId]: "Invalid file type. Please upload an image." }));
      return;
    }

    setFormData(prev => ({ 
      ...prev, 
      [fieldId]: file,
      [previewKey]: URL.createObjectURL(file) 
    }));
    setErrors(prev => ({ ...prev, [fieldId]: undefined }));
  };

  const validateForm = () => {
    let newErrors = {};
    let isValid = true;
    
    Object.values(formConfig).forEach(section => {
      section.forEach(field => {
        // Skip validation for images if they already exist in branding_information
        if (field.type === "file" && dealerParent?.branding_information?.[field.id]?.url) {
          return;
        }
        
        if (field.required && !formData[field.id]?.toString().trim()) {
          newErrors[field.id] = field.errorMessage;
          isValid = false;
        }
      });
    });

    setErrors(newErrors);
    return isValid;
  };

  const uploadImageToServer = async (file, fieldId) => {
    if (!file) {
      // If no new file but existing URL, return existing data
      const existingUrl = dealerParent?.branding_information?.[fieldId]?.url;
      if (existingUrl) {
        return { 
          key: dealerParent.branding_information[fieldId].key,
          url: existingUrl
        };
      }
      return null;
    }

    try {
      setLoading(true);
      
      const formData = new FormData();
      formData.append(fieldId, file);

      const response = await fetch("/api/dealers/branding", { 
        method: "POST",
        body: formData,
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Upload failed");
      }

      const result = await response.json();
      return result[fieldId]; // Returns { key, url }

    } catch (error) {
      console.error("Upload error:", error);
      setMessage({ text: `Upload failed: ${error.message}`, isError: true });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    setMessage({ text: "", isError: false });

    try {
      // Upload images to server (only if new file selected)
      const imageData = {};
      
      for (const field of formConfig.images) {
        if (formData[field.id] || dealerParent?.branding_information?.[field.id]) {
          const result = await uploadImageToServer(formData[field.id], field.id);
          if (result) {
            imageData[field.id] = result;
          }
        }
      }

      // Prepare payload with existing or new data
      const payload = {
        dealerId: dealerParent.id,
        branding_information: {
          ...(dealerParent?.branding_information || {}), // Preserve existing data
          ...formConfig.brandingColors.reduce((acc, field) => {
            acc[field.id] = formData[field.id];
            return acc;
          }, {}),
          ...imageData,
          ...formConfig.customerCare.reduce((acc, field) => {
            acc[field.id] = formData[field.id];
            return acc;
          }, {}),
          ...formConfig.mailSignature.reduce((acc, field) => {
            acc[field.id] = formData[field.id];
            return acc;
          }, {})
        }
      };

      // Save to database
      const res = await fetchData("/api/dealers/branding", {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({ 
          text: "Branding information saved successfully!", 
          isError: false 
        });
        updateUser({
          ...dealerParent,
          branding_information: payload.branding_information
        });
        onSuccess?.(data);
      } else {
        setMessage({ 
          text: data.message || "Error saving branding information.", 
          isError: true 
        });
      }
    } catch (error) {
      setMessage({ 
        text: "An error occurred while saving the information.", 
        isError: true 
      });
      console.error("Submission error:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    return () => {
      // Clean up object URLs
      formConfig.images.forEach(field => {
        if (formData[field.previewKey]?.startsWith('blob:')) {
          URL.revokeObjectURL(formData[field.previewKey]);
        }
      });
    };
  }, []);

  useEffect(() => {
    if (errors && Object.keys(errors).length > 0) {
      const timer = setTimeout(() => {
        setErrors({});
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [errors]);

  const renderFormSection = (sectionKey) => {
    const section = formConfig[sectionKey];
    if (!section) return null;

    return (
      <div className="w_card">
        <h3 className="w_card_title">
          {sectionKey === "brandingColors" && "Branding Color"}
          {sectionKey === "images" && "Dealership Logo/Banner"}
          {sectionKey === "customerCare" && "Customer Care"}
          {sectionKey === "mailSignature" && "Mail Signature"}
        </h3>
        <Row className="gx-3">
          {section.map((field) => (
            <Form.Group 
              key={field.id}
              controlId={field.id}
              className="mb-3" 
              as={Col} 
              lg={field.colSize || (sectionKey === "mailSignature" ? 4 : 6)} 
              md={12}
            >
              <Form.Label>
                {field.label}
                {field.required && !dealerParent?.branding_information?.[field.id]?.url && (
                  <span className="text-danger"> *</span>
                )}
              </Form.Label>
              {field.type === "file" ? (
                <>
                  <Form.Control 
                    type="file" 
                    accept={field.accept || "image/*"}
                    onChange={(e) => handleFileChange(e, field.id, field.previewKey)} 
                    isInvalid={!!errors[field.id]}
                  />
                  <Form.Control.Feedback type="invalid">
                    {errors[field.id]}
                  </Form.Control.Feedback>
                  <div className="d-flex align-items-center mt-2">
                    {formData[field.previewKey] && (
                      <>
                        <Image 
                          src={formData[field.previewKey]} 
                          alt={`${field.label} Preview`} 
                          thumbnail 
                          className="me-2" 
                          style={{ maxHeight: '72px' }}
                        />
                        <Button 
                          variant="outline-danger" 
                          size="sm" 
                          onClick={() => {
                            setFormData(prev => ({
                              ...prev,
                              [field.id]: null,
                              [field.previewKey]: field.defaultImage
                            }));
                          }}
                        ><i className="fa-regular fa-trash"></i></Button>
                      </>
                    )}
                  </div>
                  {dealerParent?.branding_information?.[field.id]?.url && (
                    <Form.Text className="text-muted">
                      Current file will be kept if no new file is selected
                    </Form.Text>
                  )}
                </>
              ) : (
                <>
                  <Form.Control 
                    type={field.type || "text"} 
                    name={field.id}
                    value={formData[field.id]} 
                    onChange={handleChange} 
                    isInvalid={!!errors[field.id]} 
                  />
                  <Form.Control.Feedback type="invalid">
                    {errors[field.id]}
                  </Form.Control.Feedback>
                </>
              )}
            </Form.Group>
          ))}
        </Row>
      </div>
    );
  };

  return (
    <Form onSubmit={handleSubmit} encType="multipart/form-data">
      <Row className="gx-3">
        <Col lg={3}>{renderFormSection("brandingColors")}</Col>
        <Col lg={9}>{renderFormSection("images")}</Col>
        <Col lg={5}>{renderFormSection("customerCare")}</Col>
        <Col lg={7}>{renderFormSection("mailSignature")}</Col>
      </Row>

      <Form.Group className="text-center mt-4">
        <Button 
          variant="custom" 
          type="submit" 
          disabled={isSubmitting || fetchLoading}
          className="px-4"
        >
          {isSubmitting || fetchLoading ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              Saving...
            </>
          ) : "Save"}
        </Button>
      </Form.Group>

      {message.text && (
        <p className={`mt-3 text-center ${message.isError ? "text-danger" : "text-success"}`}>
          {message.text}
        </p>
      )}
    </Form>
  );
}