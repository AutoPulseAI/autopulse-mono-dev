"use client";
import { UserProvider } from "./context/UserContext";

// Import GlobalLoader
import { useSidebar } from "../hooks/useSidebar";
import Sidebar from "./components/Sidebar";
import AiPausedBanner from "../components/AiPausedBanner";
import ViewAsBanner from "./components/ViewAsBanner";
import Topbar from "./components/Topbar";
import { PermissionsProvider } from '../hooks/PermissionsContext';
import "../styles.css";

export default function AdminLayout({ children }) {
  // The side menu: open or narrow (icons only) on wide screens, slides in on small ones (app/hooks/useSidebar.js).
  const [isOpen, toggleSidebar, closeSidebar] = useSidebar();

  return (
    <div className="main-wrapper">
      {/* Wrap with LoaderProvider */}
      
        <UserProvider>
          <PermissionsProvider>
            <Topbar toggleSidebar={toggleSidebar} />
            <Sidebar isOpen={isOpen} onClose={closeSidebar} />
            <div className={`content_main ${isOpen ? "shifted" : ""}`}>
              <ViewAsBanner />
              <AiPausedBanner />
              {children}
            </div>
          </PermissionsProvider>
        </UserProvider>
     
    </div>
  );
}