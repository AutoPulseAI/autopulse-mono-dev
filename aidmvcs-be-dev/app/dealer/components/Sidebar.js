"use client";
import Link from "next/link";
import { useCan } from "../../hooks/PermissionsContext";
import { usePathname } from "next/navigation"; // Use usePathname instead of useRouter
import { useEffect, useRef, useState } from "react";

const Sidebar = ({ isOpen, onClose }) => {
  // All permission hooks must run unconditionally (same order every render)
  const manage_role = useCan("Manage Employee's  Role");
  const manage_staff = useCan("Manage Employee");
  const hasManageLeads = useCan("Manage Leads");
  const hasViewAssigned = useCan("View Assigned Leads");
  const canFollowupSettings = useCan("Manage Follow-up setting");
  const canMessageTemplate = useCan("Manage Message Template");
  const canSubscription = useCan("Manage Subscription");
  const canSupport = useCan("Manage Support Ticket");
  const canManageDealer = useCan("manage_dealer");
  const canEmailAccounts = useCan("Manage Email Accounts");

  const pathname = usePathname(); // Use pathname from usePathname hook
  const sidebarRef = useRef();

  const leadsHref = hasManageLeads ? "/dealer/leads" : "/dealer/leads?assignment=my";
  const bookingHref = hasManageLeads ? "/dealer/booking" : "/dealer/booking?assignment=my";

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
          <Link href="/dealer/dashboard" className={getLinkClass("/dealer/dashboard")}>
            <i className="fa-regular fa-chart-column"></i>Dashboard
          </Link>
        </li>

        {(hasManageLeads || hasViewAssigned) && (
          <li>
            <Link href={leadsHref} className={getLinkClass("/dealer/leads")}>
              <i className="fa-regular fa-magnet"></i>Leads
            </Link>
          </li>
        )}

        {(hasManageLeads || hasViewAssigned) && (
          <li>
            <Link href="/dealer/customers" className={getLinkClass("/dealer/customers")}>
              <i className="fa-regular fa-users"></i>Customers
            </Link>
          </li>
        )}

        {hasManageLeads && (
          <li>
            <Link href="/dealer/campaigns" className={getLinkClass("/dealer/campaigns")}>
              <i className="fa-regular fa-bullhorn"></i>Campaigns
            </Link>
          </li>
        )}

        {/*
        
       
        {useCan("Manage Customer Conversation") && (
          <li>
            <Link href="/dealer/conversations" className={getLinkClass("/dealer/conversations")}>
              <i className="fa-regular fa-messages"></i>Conversations
            </Link>
          </li>
        )}
        */}

        {(hasManageLeads || hasViewAssigned) && (
          <li>
            <Link href={bookingHref} className={getLinkClass("/dealer/booking")}>
              <i className="fa-regular fa-calendar-check"></i>Appointments
            </Link>
          </li>
        )}

        {canFollowupSettings && (
          <li>
            <Link href="/dealer/report-schedule" className={getLinkClass("/dealer/report-schedule")}>
              <i className="fa-regular fa-calendar-days"></i>Report Scheduling
            </Link>
          </li>
        )}

        {canMessageTemplate && (
          <li>
            <Link href="/dealer/message-template" className={getLinkClass("/dealer/message-template")}>
              <i className="fa-regular fa-gear"></i>Message Template
            </Link>
          </li>
        )}

        {canSubscription && (
          <>
            {/* <li>
              <Link href="/dealer/subscriptions" className={getLinkClass("/dealer/subscriptions")}>
                <i className="fa-regular fa-envelopes"></i>My Subscription
              </Link>
            </li> */}
            <li>
              <Link href="/dealer/subscribe" className={getLinkClass("/dealer/subscribe")}>
                <i className="fa-regular fa-calendar-range"></i>My Subscription
              </Link>
            </li>
          </>
        )}

        {canSupport && (
          <li>
            <Link href="/dealer/support" className={getLinkClass("/dealer/support")}>
              <i className="fa-regular fa-square-question"></i>Support Ticket
            </Link>
          </li>
        )}

        {/*useCan("Manage Leads") && (
          <li>
            <Link href="/dealer/vehicle" className={getLinkClass("/dealer/vehicle")}>
              <i className="fa-regular fa-garage-car"></i>Vendor
            </Link>
          </li>
        )*/}

        {canManageDealer && (
          <li>
            <Link href="/dealer/dealers" className={getLinkClass("/dealer/dealers")}>
              <i className="fa-regular fa-users"></i>Dealer
            </Link>
          </li>
        )}

        <li>
          <Link href="/dealer/vehicle" className={getLinkClass("/dealer/vehicle")}>
            <i className="fa-regular fa-car"></i>Manage Vehicle
          </Link>
        </li>

        <li>
          <Link href="/dealer/sales" className={getLinkClass("/dealer/sales")}>
            <i className="fa-regular fa-file-invoice-dollar"></i>Sales
          </Link>
        </li>

        <li>
          <Link href="/dealer/service" className={getLinkClass("/dealer/service")}>
            <i className="fa-regular fa-screwdriver-wrench"></i>Service
          </Link>
        </li>

        <li>
          <Link href="/dealer/service-appointments" className={getLinkClass("/dealer/service-appointments")}>
            <i className="fa-regular fa-calendar-clock"></i>Service Appointments
          </Link>
        </li>

        <li>
          <Link href="/dealer/parts-inventory" className={getLinkClass("/dealer/parts-inventory")}>
            <i className="fa-regular fa-boxes-stacked"></i>Parts Inventory
          </Link>
        </li>

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
                    <Link href="/dealer/roles" className={getLinkClass("/dealer/roles")}>
                      <i className="fa-regular fa-users-rays"></i>Employee Roles
                    </Link>
                  </li>
                )}

                {manage_staff && (
                  <li>
                    <Link href="/dealer/staff" className={getLinkClass("/dealer/staff")}>
                      <i className="fa-regular fa-users-line"></i>Employee Management
                    </Link>
                  </li>
                )}

                {canEmailAccounts && (
                  <li>
                    <Link href="/dealer/email-accounts" className={getLinkClass("/dealer/email-accounts")}>
                      <i className="fa-regular fa-envelopes"></i>Email Setup
                    </Link>
                  </li>
                )}

                {canFollowupSettings && (
                  <li>
                    <Link href="/dealer/settings" className={getLinkClass("/dealer/settings")}>
                      <i className="fa-regular fa-gear"></i>Followup Setting
                    </Link>
                  </li>
                )}

                {canFollowupSettings && (
                  <li>
                    <Link
                      href="/dealer/settings/reminder-settings"
                      className={getLinkClass("/dealer/settings/reminder-settings")}
                    >
                      <i className="fa-regular fa-alarm-clock"></i>Reminder Setting
                    </Link>
                  </li>
                )}
                {canFollowupSettings && (
                  <li>
                    <Link href="/dealer/report-schedule" className={getLinkClass("/dealer/report-schedule")}>
                      <i className="fa-regular fa-calendar"></i>Report Scheduling
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
