"use client";
import Link from "next/link";
import { useCan } from "../../hooks/PermissionsContext";
import { usePathname, useSearchParams } from "next/navigation"; // Use usePathname instead of useRouter
import { Suspense, useEffect, useRef, useState } from "react";
import { useSidebarTitles } from "../../hooks/useSidebar";
import { ALERTS_CHANGED_EVENT, aiFetch } from "../ai/components/aiShared";
import { deskLogMenuVisible } from "../desk-log/deskLogAccess";

const AI_ALERT_COUNT_REFRESH_MS = 120_000;

const Sidebar = ({ isOpen, onClose }) => {
  // All permission hooks must run unconditionally (same order every render)
  const manage_role = useCan("Manage Employee's  Role");
  const manage_staff = useCan("Manage Employee");
  const hasManageLeads = useCan("Manage Leads");
  // A read-only role (SOW G-054, app/lib/standardRoles.js) sees the same pages; the server refuses its changes.
  const viewAssignedOnly = useCan("View Assigned Leads");
  const viewAllReadOnly = useCan("View All Leads (Read Only)");
  const hasViewAssigned = viewAssignedOnly || viewAllReadOnly;
  const canFollowupSettings = useCan("Manage Follow-up setting");
  const canMessageTemplate = useCan("Manage Message Template");
  const canSubscription = useCan("Manage Subscription");
  const canSupport = useCan("Manage Support Ticket");
  const canManageDealer = useCan("manage_dealer");
  const canEmailAccounts = useCan("Manage Email Accounts");
  // SOW Deliverable K: the dealership's Forms Library, managed by its administrators.
  const canForms = useCan("Manage Account Information");

  const pathname = usePathname(); // Use pathname from usePathname hook
  const sidebarRef = useRef();
  useSidebarTitles(sidebarRef, isOpen); // narrow menu: the name on hover

  const leadsHref = hasManageLeads ? "/dealer/leads" : "/dealer/leads?assignment=my";
  const bookingHref = hasManageLeads ? "/dealer/booking" : "/dealer/booking?assignment=my";

  // Automatically open collapse if current route matches admin links
  const adminLinks = ["/dealer/admin", "/dealer/roles", "/dealer/staff", "/dealer/email-accounts", "/dealer/settings",
    "/dealer/do-not-contact", "/dealer/email-domains", "/dealer/lead-sources", "/dealer/ip-restriction"];
  const isAdminActive = adminLinks.includes(pathname);
  const [adminOpen, setAdminOpen] = useState(isAdminActive);

  // AI Assistant menu (app/dealer/ai/**), with the number of open AI alerts.
  const canSeeAi = hasManageLeads || hasViewAssigned;
  const isAiActive = pathname?.startsWith("/dealer/ai/") && !pathname.startsWith("/dealer/ai/actions");
  const [aiOpen, setAiOpen] = useState(isAiActive);
  const [aiAlertCount, setAiAlertCount] = useState(0);
  useEffect(() => {
    if (!canSeeAi) return undefined;
    const loadCount = () => aiFetch("/api/dealer-ai/alerts?count_only=1")
      .then((data) => setAiAlertCount(data.unhandled_count || 0))
      .catch(() => setAiAlertCount(0)); // AI service down or no access: no badge
    loadCount();
    const timer = setInterval(loadCount, AI_ALERT_COUNT_REFRESH_MS);
    window.addEventListener(ALERTS_CHANGED_EVENT, loadCount);
    return () => {
      clearInterval(timer);
      window.removeEventListener(ALERTS_CHANGED_EVENT, loadCount);
    };
  }, [canSeeAi]);

  // Desk Log (Priority 3): shown only where the 'desk_log' feature is visible (app/dealer/desk-log/deskLogAccess.js).
  const [showDeskLog, setShowDeskLog] = useState(false);
  useEffect(() => { setShowDeskLog(deskLogMenuVisible()); }, []);

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
    <div ref={sidebarRef} className={`sidebar ${isOpen ? "open" : "narrow"}`}>
      <ul className="list-unstyled">
        {/* Betsy, 25 Nov 2026: Service has its own dashboard, so the other one is named "Sales Dashboard" and shows
            Sales leads only (?department=sales); "All departments" stays in the Dashboard's own department picker. */}
        <Suspense fallback={<DashboardLinks department={null} onDashboard={false} />}>
          <DashboardLinksFromUrl onDashboard={pathname === "/dealer/dashboard"} />
        </Suspense>

        {showDeskLog && (
          <li>
            <Link href="/dealer/desk-log" className={getLinkClass("/dealer/desk-log")}>
              <i className="fa-regular fa-clipboard-list"></i>Desk Log
            </Link>
          </li>
        )}

        {/* Bibi, 25 Nov 2026: "I'm not seeing anything on the side menu that says tasks" - the task list (AI calls
            and the team's reminders) was only inside AI Assistant > Actions. Same page, opened on its Tasks tab; it is no longer
            under AI Assistant (one place only, 25 Nov 2026). The red number: customers waiting on us. */}
        {canSeeAi && (
          <TasksLink active={pathname === "/dealer/ai/actions"} alerts={aiAlertCount} />
        )}

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

        {canSeeAi && (
          <li className="submenu">
            <button
              className={`nav-link submenu-toggle ${aiOpen ? "open" : ""}`}
              onClick={() => setAiOpen(!aiOpen)}
            >
              <i className="fa-regular fa-message-bot"></i>AI Assistant
              <i className={`fa-solid fa-chevron-${aiOpen ? "up" : "down"} ms-auto`}></i>
            </button>

            {aiOpen && (
              <ul className="submenu-list">
                <li>
                  <Link href="/dealer/ai/messages" className={getLinkClass("/dealer/ai/messages")}>
                    <i className="fa-regular fa-messages"></i>AI Messages
                  </Link>
                </li>
                <li>
                  <Link href="/dealer/ai/insights" className={getLinkClass("/dealer/ai/insights")}>
                    <i className="fa-regular fa-chart-line"></i>AI Insights
                  </Link>
                </li>
              </ul>
            )}
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

        {(manage_role || manage_staff || canForms) && (
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
                <li>
                  {/* Every setup screen in one place (19 Nov 2026, SOW references B7-B9). */}
                  <Link href="/dealer/admin" className={getLinkClass("/dealer/admin")}>
                    <i className="fa-regular fa-sliders"></i>Administration
                  </Link>
                </li>
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
                    {/* One page for follow-ups, appointment reminders and AI (client, 8 Oct 2026); view-only for
                        dealers, edited by AutoPulse super admins. */}
                    <Link href="/dealer/settings" className={getLinkClass("/dealer/settings")}>
                      <i className="fa-regular fa-gear"></i>Settings
                    </Link>
                  </li>
                )}
                {canForms && (
                  <li>
                    <Link href="/dealer/forms" className={getLinkClass("/dealer/forms")}>
                      <i className="fa-regular fa-file-pdf"></i>Forms Library
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

// The two dashboard links; the one for the department on screen is highlighted.
function DashboardLinksFromUrl({ onDashboard }) {
  const department = useSearchParams().get("department") || "";
  return <DashboardLinks department={department} onDashboard={onDashboard} />;
}

function DashboardLinks({ department, onDashboard }) {
  const cls = (d) => (onDashboard && department === d ? "nav-link active" : "nav-link");
  return (
    <>
      <li>
        <Link href="/dealer/dashboard?department=sales" className={cls("sales")}>
          <i className="fa-regular fa-chart-column"></i>Sales Dashboard
        </Link>
      </li>
      <li>
        <Link href="/dealer/dashboard?department=service" className={cls("service")}>
          <i className="fa-regular fa-screwdriver-wrench"></i>Service Dashboard
        </Link>
      </li>
    </>
  );
}

function TasksLink({ active, alerts }) {
  return (
    <li>
      <Link href="/dealer/ai/actions?tab=tasks" className={active ? "nav-link active" : "nav-link"}>
        <i className="fa-regular fa-list-check"></i>Tasks
        {alerts > 0 && (
          <span className="badge rounded-pill bg-danger ms-auto" title="Customers waiting on us">{alerts}</span>
        )}
      </Link>
    </li>
  );
}
