"use client";
import { UserProvider } from "./context/UserContext";
import { useSidebar } from "../hooks/useSidebar";
import Sidebar from "./components/Sidebar";
import AiPausedBanner from "../components/AiPausedBanner";
import Topbar from "./components/Topbar";
import { AdminPermissionsProvider } from '../hooks/AdminPermissionsContext';
import "../styles.css"; // Dashboard styles

export default function AdminLayout({ children }) {
  // The side menu: open or narrow (icons only) on wide screens, slides in on small ones (app/hooks/useSidebar.js).
  const [isOpen, toggleSidebar, closeSidebar] = useSidebar();

  return (
    <div className="main-wrapper">
       <UserProvider>
            <AdminPermissionsProvider>
                <Topbar toggleSidebar={toggleSidebar} />
                <Sidebar isOpen={isOpen} onClose={closeSidebar} />
                <div className={`content_main ${isOpen ? "shifted" : ""}`}>
                  <AiPausedBanner />
                  {children}
                </div>
            </AdminPermissionsProvider>
        </UserProvider>
    </div>
  );
}
