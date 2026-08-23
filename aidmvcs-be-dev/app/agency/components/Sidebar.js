"use client";
import Link from "next/link";
import { useCan } from "../../hooks/VendorPermissionsContext";
import { usePathname } from "next/navigation";  // Use usePathname instead of useRouter
import { useEffect, useRef, useState } from "react";

const Sidebar = ({ isOpen, onClose }) => {
  const manage_role = useCan("Manage Employee's  Role");
  const manage_staff = useCan("Manage Employee");
  const pathname = usePathname();  // Use pathname from usePathname hook
  const sidebarRef = useRef();

  // Automatically open collapse if current route matches admin links
  const adminLinks = ["/dealer/roles", "/dealer/staff", "/dealer/email-accounts", "/dealer/settings"];
  const isAdminActive = adminLinks.includes(pathname);
  const [adminOpen, setAdminOpen] = useState(isAdminActive);

  // Helper function to add 'active' class
  const getLinkClass = (href) => {
    return pathname === href ? "nav-link active" : "nav-link";
  };

    // Close sidebar on outside click
    useEffect(() => {
    const handleClick = (event) => {
      if (!isOpen || window.innerWidth >= 991) return;
  
      const target = event.target;
      const insideSidebar = sidebarRef.current?.contains(target);
  
      // Close if clicked outside the sidebar
      if (!insideSidebar) {
        onClose?.();
      }
  
      // Close if clicked a nav-link, except Admin toggle
      else if (target.closest(".nav-link")) {
        if (!target.closest(".submenu-toggle")) {
          onClose?.();
        }
      }
    };
  
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [isOpen, onClose]);

  return (
    <div ref={sidebarRef} className={`sidebar ${isOpen ? "open" : ""}`}>
      <ul className="list-unstyled">
        <li>
          <Link href="/agency/dashboard" className={getLinkClass("/agency/dashboard")}>
            <i className="fa-regular fa-chart-column"></i>Dashboard
          </Link>
        </li>

        {useCan("Manage Dealer") && (
          <li>
            <Link href="/agency/dealers" className={getLinkClass("/agency/dealers")}>
              <i className="fa-regular fa-users"></i>Dealer Setup
            </Link>
          </li>
        )}

        {useCan("Manage Email Accounts") && (
          <li>
            <Link href="/agency/email-accounts" className={getLinkClass("/agency/email-accounts")}>
              <i className="fa-regular fa-envelopes"></i>Email Accounts
            </Link>
          </li>

        )}
        {useCan("Manage Customer Conversation") && (
          <li>
            <Link href="/agency/conversations" className={getLinkClass("/agency/conversations")}>
              <i className="fa-regular fa-messages"></i>Conversations
            </Link>
          </li>
        )}
        {useCan("Manage Leads") && (

          <li>
            <Link href="/agency/leads" className={getLinkClass("/agency/leads")}>
              <i className="fa-regular fa-magnet"></i>Leads
            </Link>
          </li>
        )}

        {/* {useCan("Manage Subscription") && (

          <li>
            <Link href="/agency/subscriptions" className={getLinkClass("/agency/subscriptions")}>
              <i className="fa-regular fa-magnet"></i>My Subscription
            </Link>
          </li>
        )} */}

        {useCan("Manage Subscription") && (
          <li>
            <Link href="/agency/subscribe" className={getLinkClass("/agency/subscribe")}>
              <i className="fa-regular fa-calendar-range"></i>My Subscription
            </Link>
          </li>
        )}

        {useCan("Manage Support Ticket") && (
          <li>
            <Link href="/agency/support" className={getLinkClass("/agency/support")}>
              <i className="fa-regular fa-square-question"></i>Support Ticket
            </Link>
          </li>
        )}
        
        <li>
          <Link href="https://chat.autopulse.ai/login" target="_blank" className="nav-link">
            <i className="fa-regular fa-message-bot"></i>Autopulse Chat
          </Link>
        </li>

        {(manage_role || manage_staff) && (
          <li className="submenu">
            <button
              className={`nav-link submenu-toggle ${adminOpen ? "open" : ""}`}
              onClick={() => setAdminOpen(!adminOpen)}
            >
              <i className="fa-regular fa-user-gear"></i>Admin
              <i className={`fa-solid fa-chevron-${adminOpen ? "up" : "down"} ms-auto`}></i>
            </button>

            {adminOpen && (
              <ul className="submenu-list">
                {manage_role && (
                  <li>
                    <Link href="/agency/roles" className={getLinkClass("/agency/roles")}>
                      <i className="fa-regular fa-users-rays"></i>Employee Roles
                    </Link>
                  </li>
                )}

                {manage_staff && (
                  <li>
                    <Link href="/agency/staff" className={getLinkClass("/agency/staff")}>
                      <i className="fa-regular fa-users-line"></i>Employee Management
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </li>
        )}

      </ul>
    </div>
  );
}

export default Sidebar;
