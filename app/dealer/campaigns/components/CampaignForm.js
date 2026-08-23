"use client";
import { useState, useEffect } from "react";
import { Form, Button, Row, Col, Alert, Spinner, Card, Badge, Modal, Dropdown } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import CampaignLeadList from "./CampaignLeadList";
import RichTextEditor from "./RichTextEditor";

export default function CampaignForm({ setEditCampaign, editCampaign, onCancel, onSuccess }) {
  const { user, dealerParent } = useUser();
  const activeEntity = dealerParent || user;
  const isEditMode = !!editCampaign?.id || !!editCampaign?._id;
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    message_type: "email", // 'email' or 'sms'
    scheduled_date: "",
    scheduled_time: "",
    dealer_id: "",
    ...editCampaign // Spread existing campaign data if editing
  });

  const [campaignLeads, setCampaignLeads] = useState([]); // Temporary leads for this campaign
  const [template, setTemplate] = useState({
    subject: "",
    body: ""
  });
  const [attachments, setAttachments] = useState([]); // Array of attachment objects
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(1); // 1: Campaign Details, 2: Add Leads
  const [dealerTimezone, setDealerTimezone] = useState("America/New_York");
  const [utcScheduledDate, setUtcScheduledDate] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [seedingTemplates, setSeedingTemplates] = useState(false);
  const [campaignSettings, setCampaignSettings] = useState({
    lead_handling: "create_new", // "create_new" or "override_conversation"
    use_replies_for_ai: false // Use replies from this campaign to inform future AI conversations
  });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [confirmModalType, setConfirmModalType] = useState('checked'); // 'checked' or 'unchecked'

  // Fetch dealer timezone
  useEffect(() => {
    const fetchDealerTimezone = async () => {
      if (activeEntity?.id) {
        try {
          const res = await fetch(`/api/test/timezone-reminders?dealerId=${activeEntity.id}`, {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
            }
          });
          const data = await res.json();
          if (res.ok && data.dealer?.timezone) {
            setDealerTimezone(data.dealer.timezone);
          }
        } catch (err) {
          console.error("Error fetching dealer timezone:", err);
        }
      }
    };
    fetchDealerTimezone();
  }, [activeEntity]);

  // Fetch templates when message type changes
  useEffect(() => {
    const fetchTemplates = async () => {
      if (!activeEntity?.id || !formData.message_type) return;

      setLoadingTemplates(true);
      try {
        const token = localStorage.getItem('dealertoken');
        const res = await fetch(`/api/campaign-templates?dealer_id=${activeEntity.id}&message_type=${formData.message_type}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const data = await res.json();
        if (res.ok && data.data) {
          setTemplates(data.data);
        }
      } catch (err) {
        console.error("Error fetching templates:", err);
      } finally {
        setLoadingTemplates(false);
      }
    };
    fetchTemplates();
  }, [activeEntity?.id, formData.message_type]);

  useEffect(() => {
    // Wait for dealerParent to load and timezone to be fetched
    if (activeEntity?.id && dealerTimezone) {
      // Parse scheduled_date and scheduled_time from editCampaign
      // Convert from UTC (stored in DB) to dealer's local timezone for display
      let parsedDate = "";
      let parsedTime = "";
      
      if (editCampaign?.scheduled_date) {
        const scheduledDate = new Date(editCampaign.scheduled_date);
        if (!isNaN(scheduledDate.getTime())) {
          // Convert UTC date to dealer's timezone for display
          const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: dealerTimezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          });
          
          const parts = formatter.formatToParts(scheduledDate);
          const year = parts.find(p => p.type === 'year').value;
          const month = parts.find(p => p.type === 'month').value;
          const day = parts.find(p => p.type === 'day').value;
          const hour = parts.find(p => p.type === 'hour').value;
          const minute = parts.find(p => p.type === 'minute').value;
          
          // Format date as YYYY-MM-DD for input[type="date"]
          parsedDate = `${year}-${month}-${day}`;
          
          // Format time as HH:MM for input[type="time"]
          parsedTime = `${hour}:${minute}`;
        }
      }
      
      setFormData(prev => ({
        ...prev,
        dealer_id: activeEntity.id,
        name: editCampaign?.name || prev.name || "",
        description: editCampaign?.description || prev.description || "",
        message_type: editCampaign?.message_type || prev.message_type || "email",
        scheduled_date: parsedDate || prev.scheduled_date || "",
        scheduled_time: parsedTime || prev.scheduled_time || ""
      }));
      setIsLoading(false);
    }
  }, [activeEntity, editCampaign, dealerTimezone]);

  // Calculate UTC time when date/time changes
  useEffect(() => {
    if (formData.scheduled_date && formData.scheduled_time && dealerTimezone) {
      // Use API endpoint to convert timezone (same logic as backend)
      const convertTimezone = async () => {
        try {
          const dateTimeStr = `${formData.scheduled_date}T${formData.scheduled_time}:00`;
          
          const token = localStorage.getItem('dealertoken');
          const response = await fetch('/api/campaigns/convert-timezone', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              dateTime: dateTimeStr,
              timezone: dealerTimezone
            })
          });
          
          const data = await response.json();
          
          if (response.ok && data.success) {
            setUtcScheduledDate(new Date(data.utcDate));
          } else {
            console.error("Error converting timezone:", data.error);
            setUtcScheduledDate(null);
          }
        } catch (err) {
          console.error("Error calculating UTC time:", err);
          setUtcScheduledDate(null);
        }
      };
      
      convertTimezone();
    } else {
      setUtcScheduledDate(null);
    }
  }, [formData.scheduled_date, formData.scheduled_time, dealerTimezone]);

  // Fetch leads from separate collection when editing
  useEffect(() => {
    const fetchCampaignLeads = async () => {
      if (editCampaign?._id || editCampaign?.id) {
        try {
          const campaignId = editCampaign._id || editCampaign.id;
          const res = await fetch(`/api/campaigns/${campaignId}/leads?limit=10000`, {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
            }
          });
          const data = await res.json();
          
          if (res.ok && data.data) {
            setCampaignLeads(
              data.data.map(lead => ({
                name: lead.name,
                email: lead.email || "",
                phone: lead.phone || "",
                lead_id: lead.lead_id || null,
                _id: lead.lead_id || null, // For compatibility
                id: lead._id || lead.lead_id || `${lead.name}-${lead.email || lead.phone}-${Math.random()}`
              }))
            );
          } else {
            setCampaignLeads([]);
          }
        } catch (err) {
          console.error("Error fetching campaign leads:", err);
          setCampaignLeads([]);
        }
      } else {
        setCampaignLeads([]);
      }
    };

    fetchCampaignLeads();
  }, [editCampaign]);

  useEffect(() => {
    if (editCampaign) {
      setTemplate({
        subject: editCampaign?.message_content?.subject || "",
        body: editCampaign?.message_content?.body || ""
      });
      // Load attachments if they exist
      if (editCampaign?.attachments && Array.isArray(editCampaign.attachments)) {
        setAttachments(editCampaign.attachments);
      }
      // Load campaign settings if they exist
      if (editCampaign?.settings) {
        setCampaignSettings({
          lead_handling: editCampaign.settings.lead_handling || "create_new",
          use_replies_for_ai: editCampaign.settings.use_replies_for_ai || false
        });
      }
    } else {
      setTemplate({
        subject: "",
        body: ""
      });
      setAttachments([]);
      setCampaignSettings({ 
        lead_handling: "create_new",
        use_replies_for_ai: false
      });
    }
  }, [editCampaign]);

  // Handle attachment upload
  const handleAttachmentUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setErrors(prev => ({ ...prev, attachments: "File size must be less than 10MB" }));
      return;
    }

    setUploadingAttachment(true);
    setErrors(prev => ({ ...prev, attachments: "" }));

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "campaign-attachment");

      const token = localStorage.getItem("dealertoken");
      const response = await fetch("/api/upload/file", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (response.ok && data.url) {
        const newAttachment = {
          filename: file.name,
          url: data.url,
          size: file.size,
          mimeType: file.type,
          contentId: `attachment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        };
        setAttachments(prev => [...prev, newAttachment]);
      } else {
        setErrors(prev => ({ ...prev, attachments: data.error || "Failed to upload attachment" }));
      }
    } catch (error) {
      console.error("Error uploading attachment:", error);
      setErrors(prev => ({ ...prev, attachments: "Failed to upload attachment. Please try again." }));
    } finally {
      setUploadingAttachment(false);
      // Reset file input
      e.target.value = "";
    }
  };

  // Remove attachment
  const handleRemoveAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // Load template
  const handleLoadTemplate = (templateId) => {
    const selectedTemplate = templates.find(t => t._id === templateId);
    if (selectedTemplate) {
      setTemplate({
        subject: selectedTemplate.subject || "",
        body: selectedTemplate.body || ""
      });
      setSelectedTemplateId(templateId);
      setErrors(prev => ({ ...prev, templateSubject: "", templateBody: "" }));
    }
  };

  // Seed default templates
  const handleSeedDefaultTemplates = async () => {
    if (!activeEntity?.id) {
      alert("Please wait for dealer information to load");
      return;
    }

    if (!confirm("This will create 4 professional default email templates. Continue?")) {
      return;
    }

    setSeedingTemplates(true);
    try {
      const token = localStorage.getItem('dealertoken');
      const res = await fetch('/api/campaign-templates/seed-defaults', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          dealer_id: activeEntity.id
        })
      });

      const data = await res.json();
      if (res.ok) {
        // Refresh templates list
        const templatesRes = await fetch(`/api/campaign-templates?dealer_id=${activeEntity.id}&message_type=${formData.message_type}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const templatesData = await templatesRes.json();
        if (templatesRes.ok && templatesData.data) {
          setTemplates(templatesData.data);
        }
        alert(`Success! ${data.count || 4} default templates have been created. You can now load them from the dropdown.`);
      } else {
        alert(data.error || "Failed to seed default templates");
      }
    } catch (err) {
      console.error("Error seeding templates:", err);
      alert("Failed to seed default templates. Please try again.");
    } finally {
      setSeedingTemplates(false);
    }
  };

  // Save as template
  const handleSaveAsTemplate = async () => {
    if (!templateName.trim()) {
      alert("Please enter a template name");
      return;
    }

    if (!template.body || !template.body.toString().trim()) {
      alert("Template body cannot be empty");
      return;
    }

    setSavingTemplate(true);
    try {
      const token = localStorage.getItem('dealertoken');
      const payload = {
        name: templateName.trim(),
        description: templateDescription.trim() || "",
        message_type: formData.message_type,
        dealer_id: activeEntity.id,
        subject: formData.message_type === "email" ? template.subject : "",
        body: template.body
      };

      const res = await fetch('/api/campaign-templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok) {
        // Refresh templates list
        const templatesRes = await fetch(`/api/campaign-templates?dealer_id=${activeEntity.id}&message_type=${formData.message_type}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const templatesData = await templatesRes.json();
        if (templatesRes.ok && templatesData.data) {
          setTemplates(templatesData.data);
        }

        setShowTemplateModal(false);
        setTemplateName("");
        setTemplateDescription("");
        alert("Template saved successfully!");
      } else {
        alert(data.error || "Failed to save template");
      }
    } catch (err) {
      console.error("Error saving template:", err);
      alert("Failed to save template. Please try again.");
    } finally {
      setSavingTemplate(false);
    }
  };

  const validateField = (name, value, isDraft = false) => {
    const stringValue = value ? value.toString().trim() : "";
    
    switch (name) {
      case "name":
        if (!stringValue) return "Campaign name is required";
        if (stringValue.length < 3) return "Campaign name must be at least 3 characters";
        return "";
      case "description":
        // Description is optional
        return "";
      case "scheduled_date":
        // Only validate if not saving as draft
        if (!isDraft) {
          if (!stringValue) return "Scheduled date is required";
          const selectedDate = new Date(stringValue);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (selectedDate < today) {
            return "Scheduled date cannot be in the past";
          }
        }
        return "";
      case "scheduled_time":
        // Only validate if not saving as draft
        if (!isDraft && !stringValue) {
          return "Scheduled time is required";
        }
        return "";
      default:
        return "";
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear error when user types
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: "" }));
    }
  };

  const validateForm = (isDraft = false) => {
    const newErrors = {
      name: validateField("name", formData.name, isDraft),
      scheduled_date: validateField("scheduled_date", formData.scheduled_date, isDraft),
      scheduled_time: validateField("scheduled_time", formData.scheduled_time, isDraft)
    };

    setErrors(newErrors);
    return !Object.values(newErrors).some(error => error);
  };

  const handleNext = () => {
    if (currentStep === 1) {
      if (validateForm()) {
        setCurrentStep(2);
      }
    }
  };

  const handleBack = () => {
    if (currentStep === 2) {
      setCurrentStep(1);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (currentStep === 1) {
      handleNext();
      return;
    }

    // Final validation
    if (!validateForm()) {
      setCurrentStep(1);
      return;
    }

    if (campaignLeads.length === 0) {
      setErrors(prev => ({ ...prev, form: "Please add at least one lead to the campaign" }));
      return;
    }

    // Show confirmation modal - different content based on checkbox state
    if (campaignSettings.use_replies_for_ai) {
      // Checkbox is checked - show agreement confirmation
      setConfirmModalType('checked');
      setPendingSubmit(true);
      setShowConfirmModal(true);
      return;
    } else {
      // Checkbox is not checked - show confirmation asking if they want to proceed without it
      setConfirmModalType('unchecked');
      setPendingSubmit(true);
      setShowConfirmModal(true);
      return;
    }
  };

  const proceedWithSubmission = async (saveAsDraft = false) => {
    setShowConfirmModal(false);
    setPendingSubmit(false);

    // For non-draft campaigns, validate template content
    if (!saveAsDraft) {
      const templateErrors = {};
      if (!template.body || !template.body.toString().trim()) {
        templateErrors.templateBody = formData.message_type === "sms"
          ? "SMS template body is required"
          : "Email body is required";
      }
      if (formData.message_type === "email" && (!template.subject || !template.subject.toString().trim())) {
        templateErrors.templateSubject = "Email subject is required";
      }
      if (Object.values(templateErrors).some(Boolean)) {
        setErrors(prev => ({ ...prev, ...templateErrors }));
        setIsSubmitting(false);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const campaignId = editCampaign?._id || editCampaign?.id;
      const url = campaignId ? `/api/campaigns/${campaignId}` : "/api/campaigns";
      
      // Combine scheduled_date and scheduled_time if both are provided
      // Send as ISO string - backend will convert to dealer timezone
      let scheduledDateTime = null;
      if (formData.scheduled_date) {
        if (formData.scheduled_time) {
          // Create date string in format that represents local time (not UTC)
          // Format: "YYYY-MM-DDTHH:mm:ss" (no Z suffix means local time interpretation)
          scheduledDateTime = `${formData.scheduled_date}T${formData.scheduled_time}:00`;
        } else {
          scheduledDateTime = `${formData.scheduled_date}T00:00:00`;
        }
      }

      // Prepare leads for submission - validation will be handled by API based on env config
      // Just ensure basic formatting, let API handle strict validation
      const validLeads = campaignLeads
        .filter(lead => {
          // At minimum, ensure at least email or phone exists
          const hasContact = (lead.email && lead.email.toString().trim().length > 0) || 
                            (lead.phone && lead.phone.toString().trim().length > 0);
          return hasContact;
        })
        .map(lead => ({
          name: (lead.name || "").toString().trim() || "N/A",
          email: (lead.email || "").toString().trim(),
          phone: (lead.phone || "").toString().trim(),
          // lead_id: Only set if lead was selected from database (has _id from Lead collection)
          // For CSV imports, lead_id will be null (they're not existing leads)
          lead_id: lead.lead_id || lead._id || null
        }));

      // For non-draft campaigns, require at least one lead
      if (!saveAsDraft && validLeads.length === 0) {
        setErrors(prev => ({ 
          ...prev, 
          form: "All leads must have at least one contact method (email or phone)" 
        }));
        setIsSubmitting(false);
        return;
      }

      // Build clean payload - don't spread formData entirely to avoid sending old/unwanted fields
      const payload = {
        name: formData.name,
        description: formData.description,
        message_type: formData.message_type,
        dealer_id: activeEntity.id,
        scheduled_date: scheduledDateTime, // Send as string "YYYY-MM-DDTHH:mm:ss" for backend to interpret in dealer timezone
        status: saveAsDraft ? "draft" : "scheduled", // Set status based on button clicked
        leads: validLeads,
        message_content: {
          subject: formData.message_type === "email" ? template.subject.toString().trim() : "",
          body: template.body.toString().trim()
        },
        attachments: attachments, // Include attachments
        settings: campaignSettings // Include campaign settings
      };

      console.log("📤 Submitting campaign:", {
        campaignId,
        isEdit: !!campaignId,
        saveAsDraft,
        status: payload.status,
        hasSchedule: !!scheduledDateTime,
        scheduledDateTime,
        leadsCount: validLeads.length,
        method: campaignId ? "PUT" : "POST",
        url
      });

      // Use a try-catch to handle potential serialization errors with iframes
      let jsonPayload;
      try {
        jsonPayload = JSON.stringify(payload);
      } catch (serializationError) {
        console.error("Serialization error (possibly from iframe):", serializationError);
        // If serialization fails, it might be due to circular references or cross-origin iframes
        // Try to clone the payload without problematic properties
        const cleanPayload = {
          ...payload,
          // Ensure template content is a clean string
          message_content: {
            subject: typeof payload.message_content.subject === 'string' ? payload.message_content.subject : String(payload.message_content.subject || ''),
            body: typeof payload.message_content.body === 'string' ? payload.message_content.body : String(payload.message_content.body || '')
          }
        };
        jsonPayload = JSON.stringify(cleanPayload);
      }

      const response = await fetch(url, {
        method: campaignId ? "PUT" : "POST",
        headers: { 
          "Content-Type": "application/json",
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        },
        body: jsonPayload
      });

      const data = await response.json();

      console.log("📥 Server response:", {
        ok: response.ok,
        status: response.status,
        campaign: data.campaign,
        campaignStatus: data.campaign?.status,
        message: data.message
      });

      if (!response.ok) {
        throw new Error(data.error || "Failed to save campaign");
      }

      // Success - reset form and go back to list
      setFormData({
        name: "",
        description: "",
        message_type: "email",
        scheduled_date: "",
        scheduled_time: "",
        dealer_id: activeEntity.id
      });
      setCampaignLeads([]);
      setTemplate({ subject: "", body: "" });
      setAttachments([]);
      setCurrentStep(1);
      setEditCampaign(null);
      if (onSuccess) {
        onSuccess();
      } else if (onCancel) {
        onCancel();
      }
    } catch (err) {
      setErrors(prev => ({ ...prev, form: err.message || "Submission failed" }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveAsDraft = async (e) => {
    e.preventDefault();

    // For draft, we only need basic validation (name is required)
    // Leads, schedule, and template can be optional for draft
    if (!formData.name || formData.name.trim().length < 3) {
      setErrors(prev => ({ ...prev, name: "Campaign name is required (min 3 characters)" }));
      if (currentStep === 2) setCurrentStep(1);
      return;
    }

    // For draft: template content is optional, but if provided, validate it
    if (template.body && template.body.toString().trim()) {
      const templateErrors = {};
      if (formData.message_type === "email" && template.subject && !template.subject.toString().trim()) {
        templateErrors.templateSubject = "Email subject cannot be empty if body is provided";
      }
      if (Object.values(templateErrors).some(Boolean)) {
        setErrors(prev => ({ ...prev, ...templateErrors }));
        return;
      }
    }

    // Proceed with saving as draft (leads can be 0 for draft)
    await proceedWithSubmission(true);
  };

  if (isLoading) {
    return (
      <div className="w_card">
        <div className="text-center py-4">
          <Spinner animation="border" role="status">
            <span className="visually-hidden">Loading dealer information...</span>
          </Spinner>
          <p className="mt-2">Loading dealer information...</p>
        </div>
      </div>
    );
  }

  return (
    <Row className="justify-content-center">
      <Col lg={10} xl={9}>
        <div className="w_card">
          <div className="mb-3">
            <h3 className="w_card_title mb-0">
              {isEditMode ? "Edit Campaign" : "Create New Campaign"}
            </h3>
            <div className="mt-1">
              <small className="text-muted">
                Step {currentStep} of 2: {currentStep === 1 ? "Campaign Details" : "Add Leads & Templates"}
              </small>
            </div>
          </div>
          
          {errors.form && (
            <Alert variant="danger" dismissible onClose={() => setErrors(prev => ({ ...prev, form: "" }))}>
              {errors.form}
            </Alert>
          )}

          <Form onSubmit={handleSubmit}>
            {currentStep === 1 ? (
              <Row>
                {/* Campaign Name */}
                <Form.Group as={Col} lg={12} className="mb-3">
                  <Form.Label>Campaign Name <span className="text-danger">*</span></Form.Label>
                  <Form.Control
                    name="name"
                    value={formData.name || ""}
                    onChange={handleChange}
                    isInvalid={!!errors.name}
                    placeholder="e.g., Summer Sale 2024"
                    required
                  />
                  <Form.Control.Feedback type="invalid">
                    {errors.name}
                  </Form.Control.Feedback>
                </Form.Group>

                {/* Description */}
                <Form.Group as={Col} lg={12} className="mb-3">
                  <Form.Label>Description</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    name="description"
                    value={formData.description || ""}
                    onChange={handleChange}
                    placeholder="Describe the purpose of this campaign..."
                  />
                </Form.Group>

                {/* Message Type */}
                <Form.Group as={Col} lg={6} md={6} className="mb-3">
                  <Form.Label>Message Type <span className="text-danger">*</span></Form.Label>
                  <Form.Select
                    name="message_type"
                    value={formData.message_type}
                    onChange={handleChange}
                    required
                  >
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                  </Form.Select>
                </Form.Group>

                {/* Scheduled Date */}
                <Form.Group as={Col} lg={6} md={6} className="mb-3">
                  <Form.Label>Scheduled Date <span className="text-danger">*</span></Form.Label>
                  <Form.Control
                    type="date"
                    name="scheduled_date"
                    value={formData.scheduled_date || ""}
                    onChange={handleChange}
                    isInvalid={!!errors.scheduled_date}
                    min={new Date().toISOString().split('T')[0]}
                    required
                  />
                  <Form.Control.Feedback type="invalid">
                    {errors.scheduled_date}
                  </Form.Control.Feedback>
                </Form.Group>

                {/* Scheduled Time (required) */}
                <Form.Group as={Col} lg={6} md={6} className="mb-3">
                  <Form.Label>Scheduled Time <span className="text-danger">*</span></Form.Label>
                  <Form.Control
                    type="time"
                    name="scheduled_time"
                    value={formData.scheduled_time || ""}
                    onChange={handleChange}
                    isInvalid={!!errors.scheduled_time}
                    required
                  />
                  <Form.Control.Feedback type="invalid">
                    {errors.scheduled_time}
                  </Form.Control.Feedback>
                </Form.Group>

                {/* Show time preview if both date and time are set */}
                {formData.scheduled_date && formData.scheduled_time && (
                  <>
                    <Form.Group as={Col} lg={6} md={6}>
                    </Form.Group>

                    <div as={Col} lg={12} md={12} className="mb-3">
                      {formData.scheduled_time && utcScheduledDate && (
                        <div className="mt-2">
                          <small className="text-muted">
                            <i className="fa-solid fa-info-circle me-1 text-custom"></i>
                            <strong>Campaign will run at:</strong> {formData.scheduled_date && formData.scheduled_time ? 
                              `${formData.scheduled_date.split('-').reverse().join('/')} at ${formData.scheduled_time}` : 
                              'your selected time'
                            } (your local timezone)
                            <br />
                            <span className="text-muted" style={{ fontSize: '0.85em' }}>
                              (Server time: {String(utcScheduledDate.getUTCDate()).padStart(2, '0')}/{String(utcScheduledDate.getUTCMonth() + 1).padStart(2, '0')}/{utcScheduledDate.getUTCFullYear()} at {String(utcScheduledDate.getUTCHours()).padStart(2, '0')}:{String(utcScheduledDate.getUTCMinutes()).padStart(2, '0')} UTC - for technical purposes only)
                            </span>
                          </small>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Campaign Settings */}
                {/* <Form.Group as={Col} lg={12} className="mb-3">
                  <Form.Label>Lead Handling <span className="text-danger">*</span></Form.Label>
                  <Form.Select
                    value={campaignSettings.lead_handling}
                    onChange={(e) => setCampaignSettings(prev => ({ ...prev, lead_handling: e.target.value }))}
                  >
                    <option value="create_new">Create New Lead</option>
                    <option value="override_conversation">Override Conversation</option>
                  </Form.Select>
                  <Form.Text className="text-muted">
                    {campaignSettings.lead_handling === "create_new" 
                      ? "Creates a new lead record if the lead doesn't exist in the database."
                      : "Updates existing lead conversation if the lead already exists, otherwise creates a new lead."}
                  </Form.Text>
                </Form.Group> */}

                {/* Form Actions */}
                <Col lg={12} className="text-end mt-2">
                  <Button 
                    variant="secondary" 
                    onClick={onCancel}
                    className="me-2"
                  >
                    Cancel
                  </Button>
                  <Button 
                    variant="custom" 
                    type="button"
                    onClick={handleNext}
                  >
                    Next: Add Leads <i className="fa-solid fa-arrow-right ms-1"></i>
                  </Button>
                </Col>
              </Row>
            ) : (
              <div className="position-relative">
                <h6 className="w_card_title mb-md-3 mb-2">Campaign Summary</h6>
                <div className="px-md-3 px-2 pt-md-3 py-2 bg-light rounded border mb-md-2 mb-2">
                  <Row>
                    <Col md={6}>
                      <p className="mb-2"><strong>Name:</strong> {formData.name}</p>
                    </Col>
                    <Col md={6}>
                      <p className="mb-2"><strong>Type:</strong> {formData.message_type.toUpperCase()}</p>
                    </Col>
                    <Col md={12}>
                      {formData.description && (
                        <p className="mb-2"><strong>Description:</strong> {formData.description}</p>
                      )}
                    </Col>
                    <Col md={12}>
                      {formData.scheduled_date && (
                        <p className="mb-md-2 mb-1">
                          <strong>Scheduled:</strong>{" "}
                          {new Date(formData.scheduled_date).toLocaleDateString()}
                          {formData.scheduled_time && ` at ${formData.scheduled_time}`}
                          {utcScheduledDate && formData.scheduled_date && formData.scheduled_time && (
                            <>
                            <small className="text-muted d-block mt-1">
                              <i className="fa-solid fa-check-circle me-1 text-custom"></i>
                              <strong>Campaign will execute at:</strong> {formData.scheduled_date.split('-').reverse().join('/')} at {formData.scheduled_time} (your local timezone)
                              <br />
                              <span style={{ fontSize: '0.85em' }}>
                                Server execution time: {String(utcScheduledDate.getUTCDate()).padStart(2, '0')}/{String(utcScheduledDate.getUTCMonth() + 1).padStart(2, '0')}/{utcScheduledDate.getUTCFullYear()} at {String(utcScheduledDate.getUTCHours()).padStart(2, '0')}:{String(utcScheduledDate.getUTCMinutes()).padStart(2, '0')} UTC
                              </span>
                            </small>
                            </>
                          )}
                        </p>
                      )}
                    </Col>
                  </Row>
                </div>

                {/* Use Replies for AI Checkbox - Above Campaign Leads */}
                <div className="position-relative p-md-3 p-2 rounded-2 mb-3" style={{ backgroundColor: '#fff8e1' }}>
                  <Form.Check
                    type="checkbox"
                    id="use-replies-ai-step2"
                    className="mb-0"
                  >
                    <Form.Check.Input
                      type="checkbox"
                      checked={campaignSettings.use_replies_for_ai || false}
                      onChange={(e) => setCampaignSettings(prev => ({ ...prev, use_replies_for_ai: e.target.checked }))}
                    />
                    <Form.Check.Label className="align-middle text-dark">
                      <b>Use replies from this campaign to inform future AI conversations</b>
                    </Form.Check.Label>
                  </Form.Check>
                  <Form.Text className="text-muted">
                    <i className="fa-solid fa-circle-info me-1"></i>
                    When enabled, replies received from this campaign will be used to improve AI conversation quality for future interactions.
                  </Form.Text>
                </div>

                {/* Lead List Component */}
                <CampaignLeadList
                  leads={campaignLeads}
                  setLeads={setCampaignLeads}
                  dealerId={activeEntity?.id}
                />

                {/* Template Editor */}
                <Card className="mt-md-4 mt-3">
                  <Card.Header className="d-flex justify-content-between align-items-center px-md-3 p-2">
                    <div>
                      <h5 className="w_card_title mb-1">Message Template</h5>
                      <small className="text-muted">
                        {formData.message_type === "email"
                          ? "Craft the email template that will be sent to the selected leads."
                          : "Craft the SMS template (max 500 characters) that will be sent to the selected leads."}
                      </small>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <Badge bg="custom" className="text-uppercase">
                        {formData.message_type === "email" ? "Email" : "SMS"}
                      </Badge>
                    </div>
                  </Card.Header>
                  <Card.Body className="p-md-3 p-2">
                    {/* Template Selection */}
                    <Form.Group className="mb-3">
                      <div className="d-md-flex gap-2 align-items-end">
                        <div className="flex-grow-1">
                          <Form.Label>Load Template (Optional)</Form.Label>
                          <Form.Select
                            value={selectedTemplateId}
                            onChange={(e) => {
                              setSelectedTemplateId(e.target.value);
                              if (e.target.value) {
                                handleLoadTemplate(e.target.value);
                              } else {
                                setTemplate({ subject: "", body: "" });
                              }
                            }}
                            disabled={loadingTemplates}
                          >
                            <option value="">Select a template...</option>
                            {templates.map((t) => (
                              <option key={t._id} value={t._id}>
                                {t.name} {t.is_default && "(Default)"}
                              </option>
                            ))}
                          </Form.Select>
                        </div>

                        <div className="d-flex gap-2 align-items-end mt-md-0 mt-1">
                          {formData.message_type === "email" && (
                            <Button
                              variant="outline-success"
                              onClick={handleSeedDefaultTemplates}
                              disabled={seedingTemplates || !activeEntity?.id}
                              title="Load 4 professional default email templates"
                            >
                              {seedingTemplates ? (
                                <>
                                  <Spinner size="sm" className="me-1" />
                                  Seeding...
                                </>
                              ) : (
                                <>
                                  <i className="fa-solid fa-seedling me-1"></i>
                                  Load Defaults
                                </>
                              )}
                            </Button>
                          )}
                          <Button
                            variant="outline-custom"
                            onClick={() => setShowTemplateModal(true)}
                            disabled={!template.body || !template.body.toString().trim()}
                          >
                            <i className="fa-solid fa-save me-1"></i>
                            Save as Template
                          </Button>
                        </div>
                      </div>
                      {templates.length === 0 && !loadingTemplates && formData.message_type === "email" && (
                        <Form.Text className="text-muted">
                          No templates saved yet. Click "Load Defaults" to add 4 professional templates, or create one by filling the form below and clicking "Save as Template".
                        </Form.Text>
                      )}
                      {templates.length === 0 && !loadingTemplates && formData.message_type === "sms" && (
                        <Form.Text className="text-muted">
                          No templates saved yet. Create one by filling the form below and clicking "Save as Template".
                        </Form.Text>
                      )}
                    </Form.Group>
                    {formData.message_type === "email" && (
                      <Form.Group className="mb-3">
                        <Form.Label>Email Subject <span className="text-danger">*</span></Form.Label>
                        <Form.Control
                          type="text"
                          value={template.subject}
                          onChange={(e) => {
                            setTemplate(prev => ({ ...prev, subject: e.target.value }));
                            if (errors.templateSubject) {
                              setErrors(prev => ({ ...prev, templateSubject: "" }));
                            }
                          }}
                          isInvalid={!!errors.templateSubject}
                          placeholder="e.g., Exclusive Offer Just For You"
                        />
                        <Form.Control.Feedback type="invalid">
                          {errors.templateSubject}
                        </Form.Control.Feedback>
                      </Form.Group>
                    )}

                    <Form.Group>
                      <Form.Label>
                        {formData.message_type === "email" ? "Email Body" : "SMS Body"} <span className="text-danger">*</span>
                      </Form.Label>
                      {formData.message_type === "email" ? (
                        <RichTextEditor
                          value={template.body}
                          onChange={(value) => {
                            setTemplate(prev => ({ ...prev, body: value }));
                            if (errors.templateBody) {
                              setErrors(prev => ({ ...prev, templateBody: "" }));
                            }
                          }}
                          placeholder="Hi {name},&#10;&#10;We're excited to share..."
                          disabled={isSubmitting}
                        />
                      ) : (
                        <>
                          <Form.Control
                            as="textarea"
                            rows={4}
                            value={template.body}
                            onChange={(e) => {
                              const value = e.target.value.slice(0, 500);
                              setTemplate(prev => ({ ...prev, body: value }));
                              if (errors.templateBody) {
                                setErrors(prev => ({ ...prev, templateBody: "" }));
                              }
                            }}
                            isInvalid={!!errors.templateBody}
                            placeholder="Hi {name}, we have a special offer waiting for you!"
                          />
                          <Form.Text muted>
                            {template.body.length}/500 characters
                          </Form.Text>
                        </>
                      )}
                      <Form.Control.Feedback type="invalid">
                        {errors.templateBody}
                      </Form.Control.Feedback>
                    </Form.Group>

                    {/* Attachments Section (for Email and SMS/MMS) */}
                    <Form.Group className="mt-3">
                      <Form.Label>
                        Attachments (Optional)
                        {formData.message_type === "sms" && (
                          <span className="text-muted ms-2" style={{ fontSize: "0.85rem" }}>
                            (Will be sent as MMS)
                          </span>
                        )}
                      </Form.Label>
                        <div className="mb-2">
                          <input
                            type="file"
                            id="attachment-upload"
                            style={{ display: "none" }}
                            onChange={handleAttachmentUpload}
                            accept="*/*"
                            disabled={uploadingAttachment}
                          />
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={() => document.getElementById("attachment-upload")?.click()}
                            disabled={uploadingAttachment}
                          >
                            {uploadingAttachment ? (
                              <>
                                <Spinner animation="border" size="sm" className="me-2" />
                                Uploading...
                              </>
                            ) : (
                              <>
                                <i className="fa-solid fa-paperclip me-2"></i>
                                Add Attachment
                              </>
                            )}
                          </Button>
                        </div>
                        {errors.attachments && (
                          <Alert variant="danger" className="py-2 mt-2">
                            {errors.attachments}
                          </Alert>
                        )}
                        {attachments.length > 0 && (
                          <div className="mt-2">
                            {attachments.map((att, index) => (
                              <div key={index} className="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
                                <div className="d-flex align-items-center">
                                  <i className="fa-solid fa-file me-2 text-muted"></i>
                                  <div>
                                    <div className="small fw-semibold">{att.filename}</div>
                                    <div className="text-muted" style={{ fontSize: "0.75rem" }}>
                                      {(att.size / 1024).toFixed(2)} KB
                                    </div>
                                  </div>
                                </div>
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="text-danger text-decoration-none"
                                  onClick={() => handleRemoveAttachment(index)}
                                  disabled={isSubmitting}
                                >
                                  <i className="fa-solid fa-times"></i>
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                        <Form.Text className="text-muted">
                          <i className="fa-solid fa-circle-info me-1"></i>
                          Maximum file size: 10MB per attachment
                        </Form.Text>
                        {formData.message_type === "sms" && (
                          <Form.Text className="text-info d-block mt-2">
                            <i className="fa-solid fa-info-circle me-1"></i>
                            {attachments.length > 0 ? (
                              <>
                                SMS attachments will be sent as MMS. Supported formats: Images (JPEG, PNG, GIF), Videos (MP4), Audio (MP3, WAV). Max 5MB per file, up to 10 files. Some carriers may charge extra for MMS.
                              </>
                            ) : (
                              <>
                                You can add attachments to send as MMS. Supported: Images, Videos, Audio. Max 5MB per file.
                              </>
                            )}
                          </Form.Text>
                        )}
                      </Form.Group>
                  </Card.Body>
                </Card>

                {/* Form Actions */}
                <div className="d-flex justify-content-between mt-4">
                  <Button 
                    variant="secondary" 
                    onClick={handleBack}
                    disabled={isSubmitting}
                  >
                    <i className="fa-solid fa-arrow-left me-1"></i>Back
                  </Button>
                  <div>
                    <Button 
                      variant="outline-secondary" 
                      type="button"
                      onClick={handleSaveAsDraft}
                      className="me-2"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <i className="fa-solid fa-save me-1"></i>
                          Save as Draft
                        </>
                      )}
                    </Button>
                    <Button 
                      variant="custom" 
                      type="submit" 
                      disabled={isSubmitting || campaignLeads.length === 0}
                    >
                      {isSubmitting ? (
                        <>
                          <Spinner animation="border" size="sm" className="me-2" />
                          Creating Campaign...
                        </>
                      ) : (
                        <>
                          <i className="fa-solid fa-check me-1"></i>
                          {isEditMode ? "Update Campaign" : "Create Campaign"}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Form>

          {/* Save Template Modal */}
          <Modal show={showTemplateModal} onHide={() => setShowTemplateModal(false)} centered>
            <Modal.Header closeButton>
              <Modal.Title>Save as Template</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Form.Group className="mb-3">
                <Form.Label>Template Name <span className="text-danger">*</span></Form.Label>
                <Form.Control
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g., Welcome Email, Follow-up SMS"
                />
              </Form.Group>
              <Form.Group>
                <Form.Label>Description (Optional)</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={templateDescription}
                  onChange={(e) => setTemplateDescription(e.target.value)}
                  placeholder="Brief description of when to use this template..."
                />
              </Form.Group>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onClick={() => setShowTemplateModal(false)} disabled={savingTemplate}>
                Cancel
              </Button>
              <Button variant="custom" onClick={handleSaveAsTemplate} disabled={savingTemplate || !templateName.trim()}>
                {savingTemplate ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />
                    Saving...
                  </>
                ) : (
                  "Save Template"
                )}
              </Button>
            </Modal.Footer>
          </Modal>

          {/* Confirmation Modal for AI Replies */}
          <Modal show={showConfirmModal} onHide={() => {
            setShowConfirmModal(false);
            setPendingSubmit(false);
          }} centered>
            <Modal.Header closeButton>
              <Modal.Title>
                <i className={`fa-solid ${confirmModalType === 'checked' ? 'fa-circle-check' : 'fa-exclamation-triangle'} me-2 ${confirmModalType === 'checked' ? 'text-warning' : 'text-info'}`}></i>
                {confirmModalType === 'checked' ? 'Confirm AI Replies Usage' : 'Confirm Campaign Creation'}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              {confirmModalType === 'checked' ? (
                <>
                  <p className="mb-3">
                    You have selected to <strong>"Use replies from this campaign to inform future AI conversations"</strong>.
                  </p>
                  <p className="mb-3">
                    By confirming, you agree that:
                  </p>
                  <ul className="mb-3">
                    <li>Replies received from this campaign will be collected and analyzed</li>
                    <li>These replies will be used to improve AI conversation quality</li>
                    <li>This data will help enhance future AI interactions with your leads</li>
                  </ul>
                  <Alert variant="info" className="mb-0">
                    <i className="fa-solid fa-info-circle me-2"></i>
                    <strong>Note:</strong> This setting helps improve the AI's understanding of your communication style and customer responses.
                  </Alert>
                </>
              ) : (
                <>
                  <p className="mb-3">
                    You have <strong>not selected</strong> the option to <strong>"Use replies from this campaign to inform future AI conversations"</strong>.
                  </p>
                  <p className="mb-3">
                    By proceeding without this option:
                  </p>
                  <ul className="mb-3">
                    <li>Replies from this campaign will not be used to improve future AI conversations</li>
                    <li>You may miss out on improving AI conversation quality based on customer responses</li>
                    <li>The AI will not learn from replies received in this campaign</li>
                  </ul>
                  <Alert variant="warning" className="mb-0">
                    <i className="fa-solid fa-exclamation-triangle me-2"></i>
                    <strong>Note:</strong> Enabling this feature helps improve the AI's understanding of your communication style and customer responses. You can still proceed without it.
                  </Alert>
                </>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button 
                variant="secondary" 
                onClick={() => {
                  setShowConfirmModal(false);
                  setPendingSubmit(false);
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button 
                variant="custom"
                type="button"
                onClick={() => proceedWithSubmission(false)}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />
                    Processing...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-check me-2"></i>
                    {confirmModalType === 'checked' ? 'I Agree, Continue' : 'Yes, Proceed Without It'}
                  </>
                )}
              </Button>
            </Modal.Footer>
          </Modal>
        </div>
      </Col>
    </Row>
  );
}

