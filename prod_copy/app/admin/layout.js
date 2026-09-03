"use client";
import { UserProvider } from "./context/UserContext";
import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import { AdminPermissionsProvider } from '../hooks/AdminPermissionsContext';
import "../styles.css"; // Dashboard styles

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
       <UserProvider>
            <AdminPermissionsProvider>
                <Topbar toggleSidebar={toggleSidebar} />
                <Sidebar isOpen={isOpen} onClose={() => setIsOpen(false)} />
                <div className={`content_main ${isOpen ? "shifted" : ""}`}>
                  {children}
                </div>
            </AdminPermissionsProvider>
        </UserProvider>
    </div>
  );
}
