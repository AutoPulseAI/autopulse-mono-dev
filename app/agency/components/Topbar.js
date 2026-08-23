"use client";
import { useState, useEffect } from "react";
import ChangePasswordModal from "./ChangePasswordModal";

import { Button, NavDropdown, Modal } from "react-bootstrap";
import ProfileModal from "./ProfileModal";
import { useRouter } from "next/navigation";
import PropTypes from "prop-types";
import Container from "react-bootstrap/Container";
import Navbar from "react-bootstrap/Navbar";
import { useUser } from "../context/UserContext";
import { useCan } from "../../hooks/VendorPermissionsContext";

const Topbar = ({ toggleSidebar }) => {
  const manage_account_info = useCan("manage_account_info");
  const { user, dealerParent, loading, logout } = useUser();
  const [isPasswordModalOpen, setPasswordModalOpen] = useState(false);
  const [isProfileModalOpen, setProfileModalOpen] = useState(false);

  const [isFormSubmitted, setIsFormSubmitted] = useState(false);
  const router = useRouter();

  // Determine which account information to use (parent's if exists, otherwise user's)
  const accountInfoToUse = dealerParent?.dealer_account_information ?? user?.dealer_account_information;

  const activeEntity = dealerParent;

  // Check if we need to show the sanitized domain modal





  const handleLogout = async () => {
    try {
      localStorage.removeItem("vendortoken");
      // Call logout API with type parameter
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'vendor' }), // or whatever type you need
      });
  
      if (!response.ok) {
        throw new Error('Logout failed');
      }
  
      // Redirect after successful logout
      router.push('/agency');
      
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
            <NavDropdown.Item onClick={() => setProfileModalOpen(true)}>
              <i className="fa-regular fa-pen-to-square me-2"></i>Update Profile
            </NavDropdown.Item>
            <NavDropdown.Item onClick={() => setPasswordModalOpen(true)}>
              <i className="fa-regular fa-key me-2"></i>Change Password
            </NavDropdown.Item>

            {manage_account_info && (
              <>
                <NavDropdown.Item onClick={() => setDealerFormModalOpen(true)}>
                  <i className="fa-regular fa-circle-info me-2"></i>
                  {dealerParent ? "View Parent Account" : "Account Info"}
                </NavDropdown.Item>
                <NavDropdown.Item onClick={() => setBrandingModalOpen(true)}>
                  <i className="fa-regular fa-paint-brush me-2"></i>Branding
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



        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

Topbar.propTypes = {
  toggleSidebar: PropTypes.func.isRequired,
};

export default Topbar;