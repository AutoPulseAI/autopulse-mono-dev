import React, { useState, useEffect } from "react";
import { Form, Button, Alert, Row, Col, Modal } from "react-bootstrap";
import useFetch from "../../hooks/useFetch";
import { useUser } from "../context/UserContext";
import { useLoader } from "../../context/LoaderContext";
import PhoneNumberSelector from "./PhoneNumberSelector";

const SanitizedDomainForm = ({ onSuccess, onSkip, dealerId, initialData, canClose }) => {
  const { user, dealerParent, updateUser, logout } = useUser();
  const { setLoading } = useLoader();
  const TIME_ZONES = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Phoenix", label: "Mountain Time (MT - Arizona)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)" },
  { value: "America/Honolulu", label: "Hawaii Time (HT)" },
  { value: "America/Adak", label: "Hawaii-Aleutian Time (HAT)" },
  { value: "Pacific/Honolulu", label: "Hawaii Standard Time (HST)" },
  { value: "America/Toronto", label: "Eastern Time - Toronto (ET)" },
  { value: "America/Vancouver", label: "Pacific Time - Vancouver (PT)" },
];
  const [formData, setFormData] = useState({
    organization_name: "",
    store_name: "",
    store_website: "",
    trade_in_appraisal_url: "",
    credit_finance_application_url: "",
    store_address: "",
    store_contact_mail: "",
    store_contact_number: "",
    alternative_contact_number: "",
    contact_person: "",
    contact_person_role: "",
    general_manager_email: "",
    dealersocket_frenchiseid:  "",
    dealersocket_dealerid:  "",

    general_manager_phone: "",
    time_zone: "America/New_York", // Default time zone
    ai_bot_name: "",
    domain_name: "",
    sms_conversion_phone: "",
    general_manager: "",
    // time_zone: "",
    // fi_manager: "",
    store_city: "",
    store_state: "",
    store_postal: "",
    store_country: "",
    // website_url: "",
    // facebook_link: "",
    // twitter_link: "",
    // youtube_link: "",
    weekly_availability: {
      monday: { active: false, start: "", end: "" },
      tuesday: { active: false, start: "", end: "" },
      wednesday: { active: false, start: "", end: "" },
      thursday: { active: false, start: "", end: "" },
      friday: { active: false, start: "", end: "" },
      saturday: { active: false, start: "", end: "" },
      sunday: { active: false, start: "", end: "" }
    }
  });

  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [showWarning, setShowWarning] = useState(false);
  const [submissionData, setSubmissionData] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { fetchData, error: fetchError, loading: fetchLoading } = useFetch();
  const [showPhoneSelector, setShowPhoneSelector] = useState(false);

  useEffect(() => {
    if (initialData) {
      setFormData({
        organization_name: initialData.organization_name || "",
        store_name: initialData.store_name || "",
        store_website: initialData.store_website || "",
        trade_in_appraisal_url: initialData.trade_in_appraisal_url || "",
        credit_finance_application_url: initialData.credit_finance_application_url || "",
        store_address: initialData.store_address || "",
        store_contact_mail: initialData.store_contact_mail || "",
        store_contact_number: initialData.store_contact_number || "",
        alternative_contact_number: initialData.alternative_contact_number || "",
        contact_person: initialData.contact_person || "",
        contact_person_role: initialData.contact_person_role || "",
        general_manager_email: initialData.general_manager_email || "",
        dealersocket_frenchiseid: initialData.dealersocket_frenchiseid || "",
        dealersocket_dealerid: initialData.dealersocket_dealerid || "",

        general_manager_phone: initialData.general_manager_phone || "",
        domain_name: initialData.domain_name || "",
        ai_bot_name: initialData.ai_bot_name || "",
        sms_conversion_phone: initialData.sms_conversion_phone || "",
        general_manager: initialData.general_manager || "",
        time_zone: initialData.time_zone || "America/New_York",
        // time_zone: initialData.time_zone || "",
        // fi_manager: initialData.fi_manager || "",
        store_city: initialData.store_city || "",
        store_state: initialData.store_state || "",
        store_postal: initialData.store_postal || "",
        store_country: initialData.store_country || "",
        // website_url: initialData.website_url || "",
        // facebook_link: initialData.facebook_link || "",
        // twitter_link: initialData.twitter_link || "",
        // youtube_link: initialData.youtube_link || "",
        weekly_availability: {
          monday: initialData.weekly_availability?.monday || { active: false, start: "", end: "" },
          tuesday: initialData.weekly_availability?.tuesday || { active: false, start: "", end: "" },
          wednesday: initialData.weekly_availability?.wednesday || { active: false, start: "", end: "" },
          thursday: initialData.weekly_availability?.thursday || { active: false, start: "", end: "" },
          friday: initialData.weekly_availability?.friday || { active: false, start: "", end: "" },
          saturday: initialData.weekly_availability?.saturday || { active: false, start: "", end: "" },
          sunday: initialData.weekly_availability?.sunday || { active: false, start: "", end: "" },
        }
      });
    }
  }, [initialData]);

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name.startsWith("weekly_availability.")) {
      const [_, day, key] = name.split(".");
      setFormData(prev => ({
        ...prev,
        weekly_availability: {
          ...prev.weekly_availability,
          [day]: {
            ...prev.weekly_availability?.[day],
            [key]: value
          }
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const formatTimeTo24Hour = (timeStr) => {
    if (!timeStr) return '';

    if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
      const [h, m] = timeStr.split(':');
      return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
    }

    if (timeStr.includes('AM') || timeStr.includes('PM')) {
      const [time, period] = timeStr.split(' ');
      let [hours, minutes = '00'] = time.split(':');

      hours = hours.padStart(2, '0');
      minutes = minutes.padStart(2, '0');

      if (period === 'PM' && hours !== '12') {
        hours = String(parseInt(hours, 10) + 12).padStart(2, '0');
      } else if (period === 'AM' && hours === '12') {
        hours = '00';
      }

      return `${hours}:${minutes}`;
    }

    return '';
  };

  const formatTimeToAMPM = (time24) => {
    if (!time24) return '';

    if (time24.includes('AM') || time24.includes('PM')) {
      return time24;
    }

    const [hours, minutes] = time24.split(':');
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes.padStart(2, '0')} ${ampm}`;
  };

  const handleTimeChange = (e) => {
    const { name, value } = e.target;
    const [_, day, key] = name.split('.');

    const formattedValue = value ? (value) : '';

    setFormData(prev => ({
      ...prev,
      weekly_availability: {
        ...prev.weekly_availability,
        [day]: {
          ...prev.weekly_availability?.[day],
          [key]: formattedValue
        }
      }
    }));
  };

  const handleCheckChange = (e) => {
    const { name, checked } = e.target;

    if (name.startsWith("weekly_availability.")) {
      const [_, day, key] = name.split(".");
      setFormData(prev => ({
        ...prev,
        weekly_availability: {
          ...prev.weekly_availability,
          [day]: {
            ...prev.weekly_availability?.[day],
            [key]: checked
          }
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: checked
      }));
    }
  };

  const validateForm = () => {
    const requiredFields = [
      'organization_name',
      'store_name',
      'store_website',
      'store_address',
      'store_contact_mail',
      'store_contact_number',
      'contact_person',
      'contact_person_role',
      'general_manager',
      'general_manager_email',
      'general_manager_phone',
      'domain_name',
      'ai_bot_name',
      'sms_conversion_phone',
      'time_zone',
      //'dealersocket_frenchiseid',
      //'dealersocket_dealerid',
      // 'fi_manager',
      'store_city',
      'store_state',
      'store_postal',
      'store_country'
    ];

    const newErrors = {};
    requiredFields.forEach(field => {
      if (!formData[field]?.trim()) {
        newErrors[field] = `${field.replace(/_/g, ' ')} is required.`;
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const checkForExistingDomainAndSMS = async () => {
    const token = localStorage.getItem("dealertoken");
    setLoading(true);
    try {
      const res = await fetch("/api/dealers/check-domain-sms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dealerId: dealerParent.id,
          domain_name: formData.domain_name,
          sms_conversion_phone: formData.sms_conversion_phone
        }),
      });

      const data = await res.json();
      return data;
    } catch (error) {
      console.error("Validation error:", error);
      return { hasExisting: false, existingFields: {} };
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    setMessage(null);

    const payload = {
      dealerId: dealerParent.id,
      dealer_account_information: {
        ...formData,
        weekly_availability: Object.entries(formData.weekly_availability).reduce((acc, [day, values]) => {
          acc[day] = {
            ...values,
            start: formatTimeToAMPM(values.start),
            end: formatTimeToAMPM(values.end)
          };
          return acc;
        }, {})
      }
    };

    try {
      const isDomainChanging = initialData?.domain_name !== formData.domain_name;
      const isSMSPhoneChanging = initialData?.sms_conversion_phone !== formData.sms_conversion_phone;

      if (isDomainChanging || isSMSPhoneChanging) {
        const validationResult = await checkForExistingDomainAndSMS();

        if (validationResult.hasExisting) {
          setErrors(prev => ({
            ...prev,
            ...validationResult.existingFields
          }));
          return;
        } else if (initialData?.domain_name || initialData?.sms_conversion_phone) {
          setSubmissionData(payload);
          setShowWarning(true);
          return;
        }
      }

      await submitData(payload);
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitData = async (payload) => {
    try {
      setLoading(true);
      const token = localStorage.getItem("dealertoken");
      const res = await fetchData("/api/dealers/account", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({
          text: "Dealer account information saved successfully!",
          variant: "success"
        });
        if (dealerParent) {
          updateUser({
            ...dealerParent,
            dealer_account_information: {
              ...dealerParent.dealer_account_information,
              ...payload.dealer_account_information
            }
          });
        }
      } else {
        setMessage({
          text: data.message || "Failed to save dealer information",
          variant: "danger"
        });
      }
    } catch (error) {
      setMessage({
        text: "An error occurred while saving the information",
        variant: "danger"
      });
      console.error("Submission error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSubmit = async () => {
    setShowWarning(false);
    setIsSubmitting(true);
    try {
      if (submissionData) {
        await submitData(submissionData);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhoneNumberSelect = (phoneNumber) => {
    setFormData(prev => ({
      ...prev,
      sms_conversion_phone: phoneNumber
    }));
    setShowPhoneSelector(false);
  };

  return (
    <div>
      {message && (
        <Alert variant={message.variant} onClose={() => setMessage(null)} dismissible>
          {message.text}
        </Alert>
      )}
      <Modal show={showWarning} onHide={() => setShowWarning(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Important Notice</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>You are updating your domain or SMS contact information.</p>
          <p>Please note that these changes will be used for all future email and SMS communications.</p>
          <p>Are you sure you want to proceed with these changes?</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowWarning(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirmSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Processing..." : "Proceed"}
          </Button>
        </Modal.Footer>
      </Modal>

      <Form onSubmit={handleSubmit}>
        <Row className="gx-3">
          <Col xl={9} lg={8}>
            <Row className="g-3">
              {/* Franchise Details */}
              <Col xl={8} lg={12}>
                <div className="w_card mb-0 h-100">
                  <h3 className="w_card_title">Dealership Details</h3>
                  <Row className="gx-3">
                    <Col xl={6} lg={6}>
                      <Row className="gx-3">
                        <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                          <Form.Label>Company Name</Form.Label>
                          <Form.Control
                            type="text"
                            name="organization_name"
                            value={formData.organization_name}
                            onChange={handleChange}
                            isInvalid={!!errors.organization_name}
                          />
                          <Form.Control.Feedback type="invalid">
                            {errors.organization_name}
                          </Form.Control.Feedback>
                        </Form.Group>

                        <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                          <Form.Label>Store Name</Form.Label>
                          <Form.Control
                            type="text"
                            name="store_name"
                            value={formData.store_name}
                            onChange={handleChange}
                            isInvalid={!!errors.store_name}
                          />
                          <Form.Control.Feedback type="invalid">
                            {errors.store_name}
                          </Form.Control.Feedback>
                        </Form.Group>

                        <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                          <Form.Label>Domain Name</Form.Label>
                          <Form.Control
                            type="text"
                            name="domain_name"
                            value={formData.domain_name}
                            onChange={handleChange}
                            isInvalid={!!errors.domain_name}
                          />
                          <Form.Control.Feedback type="invalid">
                            {errors.domain_name}
                          </Form.Control.Feedback>
                        </Form.Group>

                        <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                          <Form.Label>SMS Conversation Phone No</Form.Label>
                          <div className="d-flex gap-2">
                            <Form.Control
                              type="text"
                              name="sms_conversion_phone"
                              value={formData.sms_conversion_phone}
                              onChange={handleChange}
                              isInvalid={!!errors.sms_conversion_phone}
                              placeholder="Enter phone number or browse available Twilio numbers"
                            />
                            <Button
                              variant="outline-custom"
                              onClick={() => setShowPhoneSelector(true)}
                              title="Select from your existing Twilio phone numbers"
                            ><i className="fa-regular fa-address-book"></i></Button>
                          </div>
                          <Form.Control.Feedback type="invalid">
                            {errors.sms_conversion_phone}
                          </Form.Control.Feedback>
                          <Form.Text className="text-muted mt-1 d-block">
                            💡 Click "Select Number" to choose from your existing Twilio phone numbers
                          </Form.Text>
                        </Form.Group>
                      </Row>
                    </Col>
                        
                    <Col xl={6} lg={6}>
                      <Row className="gx-3">
                        <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                          <Form.Label>Website URL</Form.Label>
                          <Form.Control
                            type="text"
                            name="store_website"
                            value={formData.store_website}
                            onChange={handleChange}
                            isInvalid={!!errors.store_website}
                          />
                          <Form.Control.Feedback type="invalid">
                            {errors.store_website}
                          </Form.Control.Feedback>
                        </Form.Group>

                        <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                          <Form.Label>Trade-In Appraisal URL</Form.Label>
                          <Form.Control
                            type="url"
                            name="trade_in_appraisal_url"
                            value={formData.trade_in_appraisal_url}
                            onChange={handleChange}
                            placeholder="https://..."
                            isInvalid={!!errors.trade_in_appraisal_url}
                          />
                          <Form.Control.Feedback type="invalid">
                            {errors.trade_in_appraisal_url}
                          </Form.Control.Feedback>
                          <Form.Text className="text-muted">
                            Used by AI to share with leads for trade-in valuation questions
                          </Form.Text>
                        </Form.Group>

                        <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                          <Form.Label>Credit / Finance Application URL</Form.Label>
                          <Form.Control
                            type="url"
                            name="credit_finance_application_url"
                            value={formData.credit_finance_application_url}
                            onChange={handleChange}
                            placeholder="https://..."
                            isInvalid={!!errors.credit_finance_application_url}
                          />
                          <Form.Control.Feedback type="invalid">
                            {errors.credit_finance_application_url}
                          </Form.Control.Feedback>
                          <Form.Text className="text-muted">
                            Used by AI to share with leads for finance and credit application questions
                          </Form.Text>
                        </Form.Group>

                        {/* <Form.Group className="mb-2" as={Col} lg={6} md={12}>
                          <Form.Label>Time Zone</Form.Label>
                          <Form.Control
                            type="text"
                            name="time_zone"
                            value={formData.time_zone}
                            onChange={handleChange}
                            isInvalid={!!errors.time_zone}
                          />
                          <Form.Control.Feedback type="invalid">
                            {errors.time_zone}
                          </Form.Control.Feedback>
                        </Form.Group> */}
                      </Row>
                    </Col>
                  </Row>
                </div>
              </Col>

              {/* Management */}
              <Col xl={4} lg={6}>
                <div className="w_card mb-0 h-100">
                  <h3 className="w_card_title">Account Holder Contact Details</h3>
                  <Row className="gx-3">
                    <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                      <Form.Label>Contact Person Name</Form.Label>
                      <Form.Control
                        type="text"
                        name="contact_person"
                        value={formData.contact_person}
                        onChange={handleChange}
                        isInvalid={!!errors.contact_person}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.contact_person}
                      </Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                      <Form.Label>Role</Form.Label>
                      <Form.Control
                        type="text"
                        name="contact_person_role"
                        value={formData.contact_person_role}
                        onChange={handleChange}
                        isInvalid={!!errors.contact_person_role}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.contact_person_role}
                      </Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                      <Form.Label>Email</Form.Label>
                      <Form.Control
                        type="email"
                        name="store_contact_mail"
                        value={formData.store_contact_mail}
                        onChange={handleChange}
                        isInvalid={!!errors.store_contact_mail}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.store_contact_mail}
                      </Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                      <Form.Label>Phone Number</Form.Label>
                      <Form.Control
                        type="text"
                        name="store_contact_number"
                        value={formData.store_contact_number}
                        onChange={handleChange}
                        isInvalid={!!errors.store_contact_number}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.store_contact_number}
                      </Form.Control.Feedback>
                    </Form.Group>

                    {/* <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                      <Form.Label>F & I Manager</Form.Label>
                      <Form.Control
                        type="text"
                        name="fi_manager"
                        value={formData.fi_manager}
                        onChange={handleChange}
                        isInvalid={!!errors.fi_manager}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.fi_manager}
                      </Form.Control.Feedback>
                    </Form.Group> */}
                  </Row>
                </div>
              </Col>

              {/* Address */}
              <Col xl={4} lg={6}>
                <div className="w_card mb-0 h-100">
                  <h3 className="w_card_title">Store Address</h3>
                  <Row className="gx-3">
                    <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                      <Form.Label>Address</Form.Label>
                      <Form.Control
                        type="text"
                        name="store_address"
                        value={formData.store_address}
                        onChange={handleChange}
                        isInvalid={!!errors.store_address}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.store_address}
                      </Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group className="mb-2" as={Col} lg={6} md={12}>
                      <Form.Label>City</Form.Label>
                      <Form.Control
                        type="text"
                        name="store_city"
                        value={formData.store_city}
                        onChange={handleChange}
                        isInvalid={!!errors.store_city}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.store_city}
                      </Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group className="mb-2" as={Col} lg={6} md={12}>
                      <Form.Label>State</Form.Label>
                      <Form.Control
                        type="text"
                        name="store_state"
                        value={formData.store_state}
                        onChange={handleChange}
                        isInvalid={!!errors.store_state}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.store_state}
                      </Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group className="mb-2" as={Col} lg={6} md={12}>
                      <Form.Label>Zip Code</Form.Label>
                      <Form.Control
                        type="text"
                        name="store_postal"
                        value={formData.store_postal}
                        onChange={handleChange}
                        isInvalid={!!errors.store_postal}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.store_postal}
                      </Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group className="mb-2" as={Col} lg={6} md={12}>
                      <Form.Label>Country</Form.Label>
                      <Form.Control
                        type="text"
                        name="store_country"
                        value={formData.store_country}
                        onChange={handleChange}
                        isInvalid={!!errors.store_country}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.store_country}
                      </Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                      <Form.Label>Contact Number</Form.Label>
                      <Form.Control
                        type="text"
                        name="alternative_contact_number"
                        value={formData.alternative_contact_number}
                        onChange={handleChange}
                      />
                    </Form.Group>
                  </Row>
                </div>
              </Col>

              {/* Dealership Contact */}
              <Col xl={4} lg={6}>
                <div className="w_card mb-0 h-100">
                  <h3 className="w_card_title">Manager Contact Details</h3>
                  <Row className="gx-3">
                    <Form.Group className="mb-2" as={Col} xl={12} lg={12} md={12}>
                      <Form.Label>General Manager</Form.Label>
                      <Form.Control
                        type="text"
                        name="general_manager"
                        value={formData.general_manager}
                        onChange={handleChange}
                        isInvalid={!!errors.general_manager}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.general_manager}
                      </Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group className="mb-2" as={Col} xl={12} lg={12} md={12}>
                      <Form.Label>Email</Form.Label>
                      <Form.Control
                        type="text"
                        name="general_manager_email"
                        value={formData.general_manager_email}
                        onChange={handleChange}
                        isInvalid={!!errors.general_manager_email}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.general_manager_email}
                      </Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group className="mb-2" as={Col} xl={12} lg={12} md={12}>
                      <Form.Label>Contact Number</Form.Label>
                      <Form.Control
                        type="text"
                        name="general_manager_phone"
                        value={formData.general_manager_phone}
                        onChange={handleChange}
                        isInvalid={!!errors.general_manager_phone}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.general_manager_phone}
                      </Form.Control.Feedback>
                    </Form.Group>

                  </Row>
                </div>
              </Col>

              {/* Ai Bot Name */}
              <Col xl={4} lg={6}>
                <div className="w_card">
                  <h3 className="w_card_title">Bot Name</h3>
                  <Row className="gx-3">
                    <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                      <Form.Label>Bot Name</Form.Label>
                      <Form.Control
                        type="text"
                        name="ai_bot_name"
                        value={formData.ai_bot_name}
                        onChange={handleChange}
                        isInvalid={!!errors.ai_bot_name}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.ai_bot_name}
                      </Form.Control.Feedback>
                    </Form.Group>

                  </Row>
                </div>

                <div className="w_card mb-0">
                  <h3 className="w_card_title">Dealer Socket</h3>
                  <Row className="gx-3">
                    <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                      <Form.Label>Site ID(Dealer ID)</Form.Label>
                      <Form.Control
                        type="text"
                        name="dealersocket_dealerid"
                        value={formData.dealersocket_dealerid}
                        onChange={handleChange}
                        isInvalid={!!errors.dealersocket_dealerid}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.dealersocket_dealerid}
                      </Form.Control.Feedback>
                    </Form.Group>
                    <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                      <Form.Label>Franchise ID</Form.Label>
                      <Form.Control
                        type="text"
                        name="dealersocket_frenchiseid"
                        value={formData.dealersocket_frenchiseid}
                        onChange={handleChange}
                        isInvalid={!!errors.dealersocket_frenchiseid}
                      />
                      <Form.Control.Feedback type="invalid">
                        {errors.dealersocket_frenchiseid}
                      </Form.Control.Feedback>
                    </Form.Group>
                  </Row>
                </div>
              </Col>              
            </Row>
          </Col>

          {/* Store Opening Time */}
          <Col xl={3} lg={4}>
            <div className="w_card">
              <h3 className="w_card_title">Store Opening Time</h3>
              <Row className="gx-3">
                <Form.Group className="mb-2" as={Col} lg={4} xs={4}>
                  <Form.Label>Day</Form.Label>
                </Form.Group>

                <Form.Group className="mb-2" as={Col} lg={4} xs={4}>
                  <Form.Label>Openning Time</Form.Label>
                </Form.Group>

                <Form.Group className="mb-2" as={Col} lg={4} xs={4}>
                  <Form.Label>Close Time</Form.Label>
                </Form.Group>
              </Row>

              {[
                'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
              ].map((day, index) => {
                const dayKey = day.toLowerCase();
                return (
                  <Row className="gx-2" key={index}>
                    <Form.Group className="mb-2" as={Col} lg={4} xs={4}>
                      <Form.Check
                        type="checkbox"
                        id={`check-${dayKey}`}
                        label={day}
                        name={`weekly_availability.${dayKey}.active`}
                        checked={formData.weekly_availability?.[dayKey]?.active || false}
                        onChange={handleCheckChange}
                      />
                    </Form.Group>
                    <Form.Group className="mb-2" as={Col} lg={4} xs={4}>
                      <Form.Control
                        type="time"
                        placeholder="HH:MM AM/PM"
                        name={`weekly_availability.${dayKey}.start`}
                        value={formatTimeTo24Hour(formData.weekly_availability?.[dayKey]?.start) || ''}
                        onChange={handleTimeChange}
                        disabled={!formData.weekly_availability?.[dayKey]?.active}
                        step="1800"
                      />
                    </Form.Group>
                    <Form.Group className="mb-2" as={Col} lg={4} xs={4}>
                      <Form.Control
                        type="time"
                        placeholder="HH:MM AM/PM"
                        name={`weekly_availability.${dayKey}.end`}
                        value={formatTimeTo24Hour(formData.weekly_availability?.[dayKey]?.end) || ''}
                        onChange={handleTimeChange}
                        disabled={!formData.weekly_availability?.[dayKey]?.active}
                        step="1800"
                      />
                    </Form.Group>
                  </Row>
                );
              })}
              <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                      <Form.Label>Time Zone</Form.Label>
                      <Form.Select
                        name="time_zone"
                        value={formData.time_zone}
                        onChange={handleChange}
                        isInvalid={!!errors.time_zone}
                      >
                        {TIME_ZONES.map((tz) => (
                          <option key={tz.value} value={tz.value}>
                            {tz.label}
                          </option>
                        ))}
                      </Form.Select>
                      <Form.Control.Feedback type="invalid">
                        {errors.time_zone}
                      </Form.Control.Feedback>
                    </Form.Group>
            </div>
          </Col>
        </Row>

        <Form.Group className="text-center mt-4">
          <Button
            variant="custom"
            type="submit"
            disabled={isSubmitting || fetchLoading}
          >
            {isSubmitting ? "Saving..." : "Save Details"}
          </Button>
          {message?.variant === "success" && (
            <Button
              variant="success"
              className="ms-2"
              onClick={() => onSuccess(formData)}
            >
              Done
            </Button>
          )}
        </Form.Group>
      </Form>

      {/* Phone Number Selector Modal */}
      <PhoneNumberSelector
        show={showPhoneSelector}
        onHide={() => setShowPhoneSelector(false)}
        onSelect={handlePhoneNumberSelect}
        currentPhoneNumber={formData.sms_conversion_phone}
        userId={user?._id}
      />
    </div>
  );
};

export default SanitizedDomainForm;