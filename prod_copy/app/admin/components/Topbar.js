"use client";
import { useState, useEffect } from "react";
import ChangePasswordModal from "./ChangePasswordModal";
import { Button, Image, NavDropdown } from "react-bootstrap";
import ProfileModal from "./ProfileModal";
import { useRouter } from "next/navigation";
import PropTypes from "prop-types";

import Container from 'react-bootstrap/Container';
import Navbar from 'react-bootstrap/Navbar';

const Topbar = ({ toggleSidebar }) => {
  const [user, setUser] = useState(null);
  const [isPasswordModalOpen, setPasswordModalOpen] = useState(false);
  const [isProfileModalOpen, setProfileModalOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const fetchUser = async () => {
      const token = localStorage.getItem("token");

      if (!token) {
        console.warn("No token found in localStorage");
        router.push("/admin");
        return;
      }

      console.log("Token from localStorage:", token); //  Debugging

      try {
        const res = await fetch("/api/auth/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });

        const data = await res.json();
        console.log("API Response:", data); //  Debugging

        if (res.ok) {
          setUser(data);
        } else {
          console.error("Failed to fetch user:", data.message);
          //router.push("/admin");
        }
      } catch (error) {
        console.error("Error fetching user:", error);
        router.push("/admin");
      }
    };

    fetchUser();
  }, [router]);

  const handleLogout = async () => {
    localStorage.removeItem("token");
    try {
      // Call logout API with type parameter
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'admin' }), // or whatever type you need
      });
  
      if (!response.ok) {
        throw new Error('Logout failed');
      }
  
      // Redirect after successful logout
      router.push('/admin');
      
    } catch (error) {
      console.error('Logout error:', error);
      // Optionally show error to user
      alert('Logout failed. Please try again.');
    }
  };


  return (
    <Navbar className="topbar_main">
      <Container fluid>
        <Button className="toggle_sidebar order-lg-2 me-lg-auto" onClick={toggleSidebar}>
          <i className="fa-solid fa-bars"></i>
        </Button>
        <Navbar.Brand href="#home" className="topbar_brand order-lg-1 me-lg-0 me-auto">
          <Image 
            src="/Images/logo-220.png"
            className="d-inline-block align-top"
            alt="Logo"
          />{' '}
        </Navbar.Brand>
        <Navbar.Toggle />
        {user && (
          <Navbar.Collapse className="justify-content-end order-lg-5">
            <NavDropdown title={<><i className="fa-regular fa-circle-user"></i>{user.name}</>} align="end">
              <NavDropdown.Item onClick={() => setProfileModalOpen(true)}><i className="fa-regular fa-pen-to-square me-2"></i>Update Profile</NavDropdown.Item>
              <NavDropdown.Item onClick={() => setPasswordModalOpen(true)}><i className="fa-regular fa-key me-2"></i>Change Password</NavDropdown.Item>
              <NavDropdown.Divider />
              <NavDropdown.Item href="/admin/cron"><i className="fa-regular fa-chart-simple me-2"></i>Report Cron Service</NavDropdown.Item>
              <NavDropdown.Divider />
              <NavDropdown.Item className="text-danger" onClick={handleLogout}>Logout</NavDropdown.Item>
            </NavDropdown>

            {/* Profile Modal */}
            {isProfileModalOpen && <ProfileModal user={user} onClose={() => setProfileModalOpen(false)} />}

            {/* Change Password Modal */}
            {isPasswordModalOpen && <ChangePasswordModal userId={user?._id} onClose={() => setPasswordModalOpen(false)} />}

          </Navbar.Collapse>
        )}
      </Container>
    </Navbar>

    // <nav className="navbar header_main">
    //   <div className="container-fluid">
    //     <button className="btn btn-light" onClick={toggleSidebar}>
    //       ☰ Menu
    //     </button>
    //     <span className="navbar-brand mx-auto">Admin Dashboard</span>

    //     <div className="topbar-actions">
    //       {user && (
    //         <button className="profile-button" onClick={() => setProfileModalOpen(true)}>
    //           {user.name} ▼
    //         </button>
    //       )}

    //       <button className="profile-button" onClick={() => setPasswordModalOpen(true)}>
    //         Change Password
    //       </button>
    //       <button className="logout-button" onClick={handleLogout}>Logout</button>
    //     </div>

    //     {/* Profile Modal */}
    //     {isProfileModalOpen && <ProfileModal user={user} onClose={() => setProfileModalOpen(false)} />}

    //     {/* Change Password Modal */}
    //     {isPasswordModalOpen && <ChangePasswordModal userId={user?._id} onClose={() => setPasswordModalOpen(false)} />}

    //   </div>
    // </nav>

    // <header className="topbar">
    //   <h2 className="topbar-title">Admin Dashboard</h2>
    //   <div className="topbar-actions">
    //     {user && (
    //       <button className="profile-button" onClick={() => setProfileModalOpen(true)}>
    //         {user.name} ▼
    //       </button>
    //     )}

    //     <button className="profile-button" onClick={() => setPasswordModalOpen(true)}>
    //       Change Password
    //     </button>
    //     <button className="logout-button" onClick={handleLogout}>Logout</button>
    //   </div>

    //   {/* Profile Modal */}
    //   {isProfileModalOpen && <ProfileModal user={user} onClose={() => setProfileModalOpen(false)} />}

    //   {/* Change Password Modal */}
    //   {isPasswordModalOpen && <ChangePasswordModal userId={user?._id} onClose={() => setPasswordModalOpen(false)} />}
    // </header>
  );
}

// Prop validation
Topbar.propTypes = {
  toggleSidebar: PropTypes.func.isRequired,
};

export default Topbar;