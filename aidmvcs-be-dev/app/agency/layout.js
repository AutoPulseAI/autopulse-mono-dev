"use client";
import { UserProvider } from "./context/UserContext";

// Import GlobalLoader
import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import { VendorPermissionsProvider } from '../hooks/VendorPermissionsContext';
import "../styles.css";

export default function AdminLayout({ children }) {
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    // Set sidebar state based on screen width
    const handleResize = () => {
      setIsOpen(window.innerWidth > 991);
    };

    handleResize(); // Call initially to set the correct state
    window.addEventListener("resize", handleResize); // Listen for window resize

    return () => window.removeEventListener("resize", handleResize); // Cleanup on unmount
  }, []);

  const toggleSidebar = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className="main-wrapper">
      {/* Wrap with LoaderProvider */}
      
        <UserProvider>
          <VendorPermissionsProvider>
            <Topbar toggleSidebar={toggleSidebar} />
            <Sidebar isOpen={isOpen} onClose={() => setIsOpen(false)} />
            <div className={`content_main ${isOpen ? "shifted" : ""}`}>
              {children}
            </div>
          </VendorPermissionsProvider>
        </UserProvider>
     
    </div>
  );
}