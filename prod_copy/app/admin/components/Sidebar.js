"use client";
import Link from "next/link";
//import { useCan } from "../../hooks/usecan";
import { useCan } from "../../hooks/AdminPermissionsContext";
import { usePathname } from "next/navigation";  // Use usePathname instead of useRouter
import { useEffect, useRef, useState } from "react";

const Sidebar = ({ isOpen, onClose }) => {
  const manage_role = useCan("Manage Employee's  Role");
  const manage_staff = useCan("Manage Employee");
  const pathname = usePathname();  // Use pathname from usePathname hook
  const sidebarRef = useRef();

  // Automatically open collapse if current route matches admin links
  const adminLinks = ["/admin/roles", "/admin/staff"];
  const isAdminActive = adminLinks.includes(pathname);
  const [adminOpen, setAdminOpen] = useState(isAdminActive);

  const cmsLinks = ["/admin/pages", "/admin/menu", "/admin/site-settings"];
  const isCmsActive = cmsLinks.some((link) => pathname === link || pathname.startsWith(`${link}/`));
  const [cmsOpen, setCmsOpen] = useState(isCmsActive);
  const managePages = useCan("Manage Pages");

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
          <Link href="/admin/dashboard" className={getLinkClass("/admin/dashboard")}>
            <i className="fa-regular fa-chart-column"></i>Dashboard
          </Link>
        </li>

        {useCan("Manage Agency") && (
          <li>
            <Link href="/admin/vendors" className={getLinkClass("/admin/vendors")}>
              <i className="fa-regular fa-car-building"></i>Agency
            </Link>
          </li>
        )}

        {useCan("Manage Dealer") && (
          <li>
            <Link href="/admin/dealers" className={getLinkClass("/admin/dealers")}>
              <i className="fa-regular fa-users"></i>Dealers
            </Link>
          </li>
        )}

        {useCan("Manage Support Ticket") && (
          <li>
            <Link href="/admin/support" className={getLinkClass("/admin/support")}>
              <i className="fa-regular fa-square-question"></i>Support Tickets
            </Link>
          </li>
        )}
        {useCan("Manage Contact Us") && (
          <li>
            <Link href="/admin/contact" className={getLinkClass("/admin/contact")}>
              <i className="fa-regular fa-message-text"></i>Contact Us
            </Link>
          </li>
        )}
        {useCan("Manage Contact Us") && (
          <li>
            <Link href="/admin/demo" className={getLinkClass("/admin/demo")}>
              <i className="fa-regular fa-laptop"></i>Demo Requests
            </Link>
          </li>
        )}
        {useCan("Manage Subscription") && (
          <li>
            <Link href="/admin/package" className={getLinkClass("/admin/package")}>
              <i className="fa-regular fa-calendar-range"></i>Subscription Packages
            </Link>
          </li>
        )}
        {useCan("Manage Subscription") && (
          <li>
            <Link href="/admin/subscription" className={getLinkClass("/admin/subscription")}>
              <i className="fa-regular fa-hand-wave"></i>Subscription Requests
            </Link>
          </li>
        )}

        {managePages && (
          <li className="submenu">
            <button
              className={`nav-link submenu-toggle ${cmsOpen ? "open" : ""}${isCmsActive ? " active" : ""}`}
              onClick={() => setCmsOpen(!cmsOpen)}
            >
              <i className="fa-regular fa-browser"></i>Website CMS
              <i className={`fa-solid fa-chevron-${cmsOpen ? "up" : "down"} ms-auto`}></i>
            </button>

            {cmsOpen && (
              <ul className="submenu-list">
                <li>
                  <Link href="/admin/pages" className={getLinkClass("/admin/pages")}>
                    <i className="fa-regular fa-file-lines"></i>Pages
                  </Link>
                </li>
                <li>
                  <Link href="/admin/menu" className={getLinkClass("/admin/menu")}>
                    <i className="fa-regular fa-bars"></i>Menu
                  </Link>
                </li>
                <li>
                  <Link href="/admin/site-settings" className={getLinkClass("/admin/site-settings")}>
                    <i className="fa-regular fa-gear"></i>Site Settings
                  </Link>
                </li>
              </ul>
            )}
          </li>
        )}

        <li>
            <Link href="/admin/vehicle" className={getLinkClass("/admin/vehicle")}>
              <i className="fa-regular fa-car"></i>Manage Vehicle
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
                    <Link href="/admin/roles" className={getLinkClass("/admin/roles")}>
                      <i className="fa-regular fa-users-rays"></i>Employee Roles
                    </Link>
                  </li>
                )}

                {manage_staff && (
                  <li>
                    <Link href="/admin/staff" className={getLinkClass("/admin/staff")}>
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
};

export default Sidebar;
