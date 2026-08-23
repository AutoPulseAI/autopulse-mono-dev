"use client";
import { useState, useEffect } from "react";
import { Form, Button, Alert, Row, Col, Modal } from "react-bootstrap";
import useFetch from "../../../hooks/useFetch";
import { useUser } from "../../context/UserContext";
import { useLoader } from "../../../context/LoaderContext";

export default function DealerForm({ fetchDealers, editDealer, handleClose }) {
  const { user, updateUser, logout } = useUser();
  const { setLoading } = useLoader();
  const { fetchData, error: fetchError, loading } = useFetch();
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

  const [step, setStep] = useState(1);
  const [dealerId, setDealerId] = useState(null);
  const [message, setMessage] = useState(null);
  const [showWarning, setShowWarning] = useState(false);
  const [submissionData, setSubmissionData] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Step 1 fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [vendorId, setVendorId] = useState("");

  // Step 2 fields (using formData structure from SanitizedDomainForm)
  const [formData, setFormData] = useState({
    organization_name: "",
    store_name: "",
    store_address: "",
    // store_contact_mail: "",
    // store_contact_number: "",
    alternative_contact_number: "",
    // contact_person: "",
    // contact_person_role: "",
    general_manager_email: "",
    general_manager_phone: "",
    ai_bot_name: "",
    domain_name: "",
    sms_conversion_phone: "",
    general_manager: "",
    // time_zone: "",
    time_zone: "America/New_York",
    // fi_manager: "",
    store_city: "",
    store_state: "",
    store_postal: "",
    store_country: "",
    store_website: "",
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

  useEffect(() => {
    if (!editDealer) {
      setVendorId(user.id);
    } else {
      setDealerId(editDealer._id || null);
      setName(editDealer.name || "");
      setEmail(editDealer.email || "");
      setVendorId(editDealer.vendor_id?._id || user.id);

      // Set step based on edit mode
      if (editDealer.editonlyprofile) {
        setStep(1);
      } else if (editDealer.editAccount) {
        setStep(2);
      } else {
        setStep(editDealer.dealer_account_information ? 2 : 1);
      }

      // Populate formData if account info exists
      if (editDealer.dealer_account_information) {
        setFormData({
          organization_name: editDealer.dealer_account_information.organization_name || "",
          store_name: editDealer.dealer_account_information.store_name || "",
          store_address: editDealer.dealer_account_information.store_address || "",
          // store_contact_mail: editDealer.dealer_account_information.store_contact_mail || "",
          // store_contact_number: editDealer.dealer_account_information.store_contact_number || "",
          alternative_contact_number: editDealer.dealer_account_information.alternative_contact_number || "",
          // contact_person: editDealer.dealer_account_information.contact_person || "",
          // contact_person_role: editDealer.dealer_account_information.contact_person_role || "",
          general_manager_email: editDealer.dealer_account_information.general_manager_email || "",
          general_manager_phone: editDealer.dealer_account_information.general_manager_phone || "",
          domain_name: editDealer.dealer_account_information.domain_name || "",
          ai_bot_name: editDealer.dealer_account_information.ai_bot_name || "",
          sms_conversion_phone: editDealer.dealer_account_information.sms_conversion_phone || "",
          general_manager: editDealer.dealer_account_information.general_manager || "",
          // time_zone: editDealer.dealer_account_information.time_zone || "",
          // fi_manager: editDealer.dealer_account_information.fi_manager || "",
          store_city: editDealer.dealer_account_information.store_city || "",
          store_state: editDealer.dealer_account_information.store_state || "",
          store_postal: editDealer.dealer_account_information.store_postal || "",
          store_country: editDealer.dealer_account_information.store_country || "",
          store_website: editDealer.dealer_account_information.store_website || "",
          // facebook_link: editDealer.dealer_account_information.facebook_link || "",
          // twitter_link: editDealer.dealer_account_information.twitter_link || "",
          // youtube_link: editDealer.dealer_account_information.youtube_link || "",
           time_zone: editDealer.dealer_account_information.time_zone || "America/New_York",
          weekly_availability: {
            monday: editDealer.dealer_account_information.weekly_availability?.monday || { active: false, start: "", end: "" },
            tuesday: editDealer.dealer_account_information.weekly_availability?.tuesday || { active: false, start: "", end: "" },
            wednesday: editDealer.dealer_account_information.weekly_availability?.wednesday || { active: false, start: "", end: "" },
            thursday: editDealer.dealer_account_information.weekly_availability?.thursday || { active: false, start: "", end: "" },
            friday: editDealer.dealer_account_information.weekly_availability?.friday || { active: false, start: "", end: "" },
            saturday: editDealer.dealer_account_information.weekly_availability?.saturday || { active: false, start: "", end: "" },
            sunday: editDealer.dealer_account_information.weekly_availability?.sunday || { active: false, start: "", end: "" },
          }
        });
      }
    }
  }, [editDealer, user]);

  // Time formatting functions from SanitizedDomainForm
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

  // Handlers from SanitizedDomainForm
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

  const handleTimeChange = (e) => {
    const { name, value } = e.target;
    const [_, day, key] = name.split('.');
    const formattedValue = value ? formatTimeToAMPM(value) : '';

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
    }
  };

  // Validation
  const validateStep1 = () => {
    let newErrors = {};
    if (!name.trim()) newErrors.name = "Name is required.";
    else if (!/^[a-zA-Z\s]+$/.test(name)) newErrors.name = "Name should only contain letters and spaces.";
    if (!email.trim()) newErrors.email = "Dealer Email is required.";
    if (!password.trim() && !editDealer) newErrors.password = "Password is required.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep2 = () => {
    let newErrors = {};
    const requiredFields = [
      'organization_name',
      'store_name',
      'store_address',
      // 'store_contact_mail',
      // 'store_contact_number',
      // 'contact_person',
      // 'contact_person_role',
      'general_manager',
      'general_manager_email',
      'general_manager_phone',
      'domain_name',
      'ai_bot_name',
      'sms_conversion_phone',
      // 'fi_manager',
      'store_city',
      'store_state',
      'store_postal',
      'store_country'
    ];

    requiredFields.forEach(field => {
      if (!formData[field]?.trim()) {
        newErrors[field] = `${field.replace(/_/g, ' ')} is required.`;
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Step 1 submission
  const handleSubmitStep1 = async (e) => {
    e.preventDefault();
    if (!validateStep1()) return;

    setIsSubmitting(true);
    setMessage(null);

    const payload = {
      name,
      email,
      password,
      type: "dealer",
      vendor_id: vendorId,
      dealer_id: editDealer?._id
    };

    const method = editDealer?.editonlyprofile ? "PUT" : "POST";

    try {
      const res = await fetchData("/api/dealers", {
        method,
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`},
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({
          text: "Dealer information saved! Proceed to Account Information.",
          variant: "success"
        });
        setDealerId(data.dealer?._id);
        setStep(2);
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
      setIsSubmitting(false);
    }
  };

  // Domain/SMS validation check
  const checkForExistingDomainAndSMS = async () => {
    setLoading(true);
    try {
      const res = await fetchData("/api/dealers/check-domain-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" ,'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`},
        body: JSON.stringify({
          dealerId: dealerId || editDealer?._id,
          domain_name: formData.domain_name,
          sms_conversion_phone: formData.sms_conversion_phone
        }),
      });

      return await res.json();
    } catch (error) {
      console.error("Validation error:", error);
      return { hasExisting: false, existingFields: {} };
    } finally {
      setLoading(false);
    }
  };

  // Step 2 submission
  const handleSubmitStep2 = async (e) => {
    e.preventDefault();
    if (!validateStep2()) return;

    setIsSubmitting(true);
    setMessage(null);

    const payload = {
      dealerId: dealerId || editDealer?._id,
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
      const isDomainChanging = editDealer?.dealer_account_information?.domain_name !== formData.domain_name;
      const isSMSPhoneChanging = editDealer?.dealer_account_information?.sms_conversion_phone !== formData.sms_conversion_phone;

      if (isDomainChanging || isSMSPhoneChanging) {
        const validationResult = await checkForExistingDomainAndSMS();

        if (validationResult.hasExisting) {
          setErrors(prev => ({
            ...prev,
            ...validationResult.existingFields
          }));
          return;
        } else if (editDealer?.dealer_account_information?.domain_name || editDealer?.dealer_account_information?.sms_conversion_phone) {
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
      const res = await fetchData("/api/dealers/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('vendortoken')}`},
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({
          text: "Dealer account information saved successfully!",
          variant: "success"
        });
        fetchDealers();
        handleClose();
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

  const handleSkipStep2 = () => {
    setMessage({
      text: "You can complete dealer account information later.",
      variant: "info"
    });
    handleClose();
    fetchDealers();
  };

  return (
    <>
      {message && (
        <Alert variant={message.variant || "success"} onClose={() => setMessage(null)} dismissible>
          {message.text || message}
        </Alert>
      )}

      <Modal show={showWarning} onHide={() => setShowWarning(false)}>
        <button
          type="button"
          className="btn-close position-absolute"
          aria-label="Close"
          onClick={() => setShowWarning(false)}
          style={{ top: "1rem", right: "1rem", zIndex: 1051, backgroundColor: "transparant" }}
        ></button>
        <Modal.Body className="text-center">
          <div className="mb-2">
            <i className="fa-regular fa-triangle-exclamation fa-2x text-danger" style={{ background: "#FFEEEC", width: "3.8rem", height: "3.8rem", fontSize: "1.6rem", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}></i>
          </div>
          <Modal.Title className="mb-1">Important Notice</Modal.Title>
          <p className="mb-1">You are updating your domain or SMS contact information.</p>
          <p className="mb-1">Please note that these changes will be used for all future email and SMS communications.</p>
          <p className="mb-0">Are you sure you want to proceed with these changes?</p>
        </Modal.Body>
        <Modal.Footer className="border-0 pt-0 justify-content-center">
          <Button variant="custom" onClick={handleConfirmSubmit} disabled={isSubmitting} className="btn-sm">
            {isSubmitting ? "Processing..." : "Proceed"}
          </Button>
          <Button variant="secondary" onClick={() => setShowWarning(false)} className="btn-sm">
            Cancel
          </Button>
        </Modal.Footer>
      </Modal>

      {step === 1 ? (
        <div className="w_card">
          <Form onSubmit={handleSubmitStep1}>
            <Form.Control type="text" value={vendorId} onChange={(e) => setVendorId(e.target.value)} hidden />

            <Form.Group className="mb-3">
              <Form.Label>Dealer Name</Form.Label>
              <Form.Control
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                isInvalid={!!errors.name}
              />
              <Form.Control.Feedback type="invalid">{errors.name}</Form.Control.Feedback>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Dealer Email</Form.Label>
              <Form.Control
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                isInvalid={!!errors.email}
              />
              <Form.Control.Feedback type="invalid">{errors.email}</Form.Control.Feedback>
            </Form.Group>

            {!editDealer?.editonlyprofile ? (
              <Form.Group className="mb-3 position-relative">
                <Form.Label>Password</Form.Label>
                <div className="position-relative">
                  <Form.Control
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    isInvalid={!!errors.password}
                  />
                  <span
                    className="position-absolute end-0 translate-middle-y text-secondary pass_eye"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    <i className={showPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye"}></i>
                  </span>
                  <Form.Control.Feedback type="invalid">{errors.password}</Form.Control.Feedback>
                </div>
              </Form.Group>
            ) : (
              <Form.Group className="mb-3 position-relative">
                <Form.Label>Change Password</Form.Label>
                <div className="position-relative">
                <Form.Control
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  isInvalid={!!errors.password}
                />
                <span
                    className="position-absolute end-0 translate-middle-y text-secondary pass_eye"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    <i className={showPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye"}></i>
                  </span>
                <Form.Control.Feedback type="invalid">{errors.password}</Form.Control.Feedback>
                </div>
              </Form.Group>
            )}

            <Button variant="custom" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : (editDealer?.editonlyprofile ? "Save Changes" : "Create Dealer")}
            </Button>
          </Form>
        </div>
      ) : (
        <Form onSubmit={handleSubmitStep2}>
          <Row className="gx-3">
            {/* Franchise Details */}
            <Col lg={12}>
              <div className="w_card">
                <h3 className="w_card_title">Dealership Details</h3>
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
                    <Form.Control
                      type="text"
                      name="sms_conversion_phone"
                      value={formData.sms_conversion_phone}
                      onChange={handleChange}
                      isInvalid={!!errors.sms_conversion_phone}
                    />
                    <Form.Control.Feedback type="invalid">
                      {errors.sms_conversion_phone}
                    </Form.Control.Feedback>
                  </Form.Group>

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
              </div>
            </Col>

            {/* Account Holder Contact Details */}
            {/* <Col lg={12}>
              <div className="w_card">
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

                  <Form.Group className="mb-2" as={Col} lg={12} md={12}>
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
                  </Form.Group>
                </Row>
              </div>
            </Col> */}

            {/* Address */}
            <Col lg={12}>
              <div className="w_card">
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

            {/* Manager Contact Details */}
            <Col lg={12}>
              <div className="w_card">
                <h3 className="w_card_title">Manager Contact Details</h3>
                <Row className="gx-3">
                  <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                    <Form.Label>Name</Form.Label>
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

                  <Form.Group className="mb-2" as={Col} lg={12} md={12}>
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

                  <Form.Group className="mb-2" as={Col} lg={12} md={12}>
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
            <Col lg={12}>
              <div className="w_card">
                <h3 className="w_card_title">AI Bot Name</h3>
                <Row className="gx-3">
                  <Form.Group className="mb-2" as={Col} lg={12} md={12}>
                    <Form.Label>AI Bot Name</Form.Label>
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
            </Col>

            {/* Weekly Availability */}
            <Col lg={12}>
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

                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => {
                  const dayKey = day.toLowerCase();
                  return (
                    <Row className="gx-2" key={dayKey}>
                      <Form.Group className="mb-2" as={Col} lg={4} xs={4}>
                        <Form.Check
                          type="checkbox"
                          id={`check-${dayKey}`}
                          label={day}
                          name={`weekly_availability.${dayKey}.active`}
                          checked={formData.weekly_availability[dayKey]?.active || false}
                          onChange={handleCheckChange}
                        />
                      </Form.Group>
                      <Form.Group className="mb-2" as={Col} lg={4} xs={4}>
                        <Form.Control
                          type="time"
                          name={`weekly_availability.${dayKey}.start`}
                          value={formatTimeTo24Hour(formData.weekly_availability[dayKey]?.start) || ''}
                          onChange={handleTimeChange}
                          disabled={!formData.weekly_availability[dayKey]?.active}
                          step="1800"
                        />
                      </Form.Group>
                      <Form.Group className="mb-2" as={Col} lg={4} xs={4}>
                        <Form.Control
                          type="time"
                          name={`weekly_availability.${dayKey}.end`}
                          value={formatTimeTo24Hour(formData.weekly_availability[dayKey]?.end) || ''}
                          onChange={handleTimeChange}
                          disabled={!formData.weekly_availability[dayKey]?.active}
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

          <div className="d-flex justify-content-between mt-3">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <div>
              <Button variant="secondary" onClick={handleSkipStep2} className="me-2">
                Skip & Do It Later
              </Button>
              <Button variant="custom" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </Form>
      )}
    </>
  );
}