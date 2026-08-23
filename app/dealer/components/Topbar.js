"use client";
import { useState, useEffect } from "react";
import ChangePasswordModal from "./ChangePasswordModal";
import SanitizedDomainForm from "./SanitizedDomainForm";
import BrandingForm from "./BrandingForm";
import { Button, NavDropdown, Modal } from "react-bootstrap";
import ProfileModal from "./ProfileModal";
import { useRouter } from "next/navigation";
import PropTypes from "prop-types";
import Container from "react-bootstrap/Container";
import Navbar from "react-bootstrap/Navbar";
import { useUser } from "../context/UserContext";
import { useCan } from "../../hooks/PermissionsContext";

const Topbar = ({ toggleSidebar }) => {
  const manage_account_infor = useCan("Manage Account Information");
  const { user, dealerParent, loading, logout } = useUser();
  const [isPasswordModalOpen, setPasswordModalOpen] = useState(false);
  const [isProfileModalOpen, setProfileModalOpen] = useState(false);
  const [isSanitizedDomainModalOpen, setSanitizedDomainModalOpen] = useState(false);
  const [isBrandingModalOpen, setBrandingModalOpen] = useState(false);
  const [isDealerFormModalOpen, setDealerFormModalOpen] = useState(false);
  const [isFormSubmitted, setIsFormSubmitted] = useState(false);
  const router = useRouter();

  // Determine which account information to use (parent's if exists, otherwise user's)
  const accountInfoToUse = dealerParent?.dealer_account_information ?? user?.dealer_account_information;
  const brandingInfoToUse = dealerParent?.branding_information ?? user?.branding_information;
  const activeEntity = dealerParent;
const [copied, setCopied] = useState(false);

const handleCopy = async () => {
  const text = user?.parent_id ?? user?.id;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  } catch (e) {
    console.error("Copy failed", e);
  }
};


  // Check if we need to show the sanitized domain modal
  useEffect(() => {
    if (loading || !activeEntity) return;

    // Only show modal if dealer_account_information is missing or sanitized_domain is empty
    if (!accountInfoToUse?.sanitized_domain) {
      setSanitizedDomainModalOpen(true);
    }
  }, [loading, activeEntity, accountInfoToUse]);

  const handleSuccess = (updatedData) => {
    // Handle update based on whether we're dealing with parent or user data
    setIsFormSubmitted(true);
    setSanitizedDomainModalOpen(false);
    setDealerFormModalOpen(false);
    setBrandingModalOpen(false);
  };

  const handleSkip = () => {
    if (accountInfoToUse?.sanitized_domain) {
      setSanitizedDomainModalOpen(false);
      setDealerFormModalOpen(false);
      setBrandingModalOpen(false);
    }
  };

  const handleCloseModal = () => {
    if (accountInfoToUse?.sanitized_domain || isFormSubmitted) {
      setSanitizedDomainModalOpen(false);
      setDealerFormModalOpen(false);
      setBrandingModalOpen(false);
    }
  };

  const handleLogout = async () => {
    try {
      localStorage.removeItem("dealertoken");
      // Call logout API with type parameter
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'dealer' }), // or whatever type you need
      });

      if (!response.ok) {
        throw new Error('Logout failed');
      }

      // Redirect after successful logout
      router.push('/dealer');

    } catch (error) {
      console.error('Logout error:', error);
      // Optionally show error to user
      alert('Logout failed. Please try again.');
    }
  };

  if (loading || !activeEntity) {
    return (
      <Navbar className="topbar_main">
        <Container fluid>
          <Navbar.Brand href="#home" className="topbar_brand">
            <img src="/Images/logo-220.png" className="d-inline-block align-top" alt="Logo" />
          </Navbar.Brand>
          <div className="ms-auto">Loading user data...</div>
        </Container>
      </Navbar>
    );
  }

  return (
    <Navbar className="topbar_main">
      <Container fluid>
        <Button className="toggle_sidebar order-lg-2 me-lg-auto" onClick={toggleSidebar}>
          <i className="fa-solid fa-bars"></i>
        </Button>
        <Navbar.Brand href="#home" className="topbar_brand order-lg-1 me-lg-0 me-auto">
          <img src="/Images/logo-220.png" className="d-inline-block align-top" alt="Logo" />
        </Navbar.Brand>
        <Navbar.Toggle />

        <Navbar.Collapse className="justify-content-end order-lg-5">
          <NavDropdown
            title={
              <>
                <i className="fa-regular fa-circle-user"></i>
                {user.name}

              </>
            }
            align="end"
          >
            <li className="head_userinfo px-3">
              <b>{user.name}</b>
              <small className="d-flex justify-content-between align-items-center text-secondary cursor-pointer" onClick={handleCopy}>
                <span>{user?.parent_id ?? user?.id}</span>
                <i className={`fa-regular fa-${copied ? "check" : "copy"} ms-2`}></i>
              </small>              
            </li>
            <NavDropdown.Divider />
            <NavDropdown.Item onClick={() => setProfileModalOpen(true)}>
              <i className="fa-regular fa-pen-to-square me-2"></i>Update Profile
            </NavDropdown.Item>
            <NavDropdown.Item onClick={() => setPasswordModalOpen(true)}>
              <i className="fa-regular fa-key me-2"></i>Change Password
            </NavDropdown.Item>

            {manage_account_infor && (
              <>
                <NavDropdown.Item onClick={() => setDealerFormModalOpen(true)}>
                  <i className="fa-regular fa-circle-info me-2"></i>
                  {dealerParent ? "Dealer Setup" : "Account Info"}
                </NavDropdown.Item>
                <NavDropdown.Item onClick={() => setBrandingModalOpen(true)}>
                  <i className="fa-regular fa-paint-brush me-2"></i>Email Branding Setup
                </NavDropdown.Item>
              </>
            )}

            <NavDropdown.Divider />
            <NavDropdown.Item className="text-danger" onClick={handleLogout}>
              Logout
            </NavDropdown.Item>
          </NavDropdown>

          {/* Profile Modal */}
          {isProfileModalOpen && (
            <ProfileModal
              user={user}
              onClose={() => setProfileModalOpen(false)}
            />
          )}

          {/* Change Password Modal */}
          {isPasswordModalOpen && (
            <ChangePasswordModal
              userId={user?.id}
              onClose={() => setPasswordModalOpen(false)}
            />
          )}

          {/* Sanitized Domain Modal - Only shows if conditions are met */}
          <Modal
            show={isSanitizedDomainModalOpen || isDealerFormModalOpen}
            onHide={handleCloseModal}
            backdrop={!accountInfoToUse?.sanitized_domain ? "static" : true}
            keyboard={!accountInfoToUse?.sanitized_domain ? false : true}
            dialogClassName="modal-90w"
            centered
          >
            <Modal.Header closeButton={!!accountInfoToUse?.sanitized_domain || isFormSubmitted}>
              <Modal.Title>
                {dealerParent ? "Dealer Setup" : "Complete Your Dealer Setup"}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <SanitizedDomainForm
                onSuccess={handleSuccess}
                onSkip={handleSkip}
                dealerId={activeEntity._id}
                initialData={accountInfoToUse}
                canClose={!!accountInfoToUse?.sanitized_domain || isFormSubmitted}
              />
            </Modal.Body>
          </Modal>

          {/* Branding Modal */}
          <Modal
            show={isBrandingModalOpen}
            onHide={handleCloseModal}
            backdrop="static"
            keyboard={false}
            dialogClassName="modal-90w"
            centered
          >
            <Modal.Header closeButton>
              <Modal.Title>
                {dealerParent ? "Email Branding Setup" : "Email Branding Setup"}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <BrandingForm
                onSuccess={handleSuccess}
                dealerId={activeEntity._id}
                initialData={brandingInfoToUse}
              />
            </Modal.Body>
          </Modal>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

Topbar.propTypes = {
  toggleSidebar: PropTypes.func.isRequired,
};

export default Topbar;