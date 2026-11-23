"use client";
// Administration (19 Nov 2026, SOW references B7-B9 - DealerSocket's System Administration: Dealership Setup,
// Dealership Data, Email / Lead & Text, Sales, Marketing, Service). One page that lists every setup screen the
// dealership has, grouped the same way, each opening where the work is done. Only what this person may use is shown.
import { useMemo, useState } from "react";
import Link from "next/link";
import { Form } from "react-bootstrap";
import { useCan } from "../../hooks/PermissionsContext";

const fire = (name) => () => window.dispatchEvent(new Event(name));

export default function AdministrationPage() {
  const viewAssigned = useCan("View Assigned Leads");
  const viewAll = useCan("View All Leads (Read Only)");
  const can = {
    roles: useCan("Manage Employee's  Role"),
    staff: useCan("Manage Employee"),
    leads: useCan("Manage Leads"),
    viewLeads: viewAssigned || viewAll,
    account: useCan("Manage Account Information"),
    settings: useCan("Manage Follow-up setting"),
    templates: useCan("Manage Message Template"),
    email: useCan("Manage Email Accounts"),
    conversations: useCan("Manage Customer Conversation"),
    support: useCan("Manage Support Ticket"),
  };
  const [q, setQ] = useState("");

  const sections = useMemo(() => [
    ["Dealership setup", "fa-store", [
      { label: "Dealership contact information and store hours", onClick: fire("open-dealer-setup"), show: can.account,
        about: "Name, address, phone, website, time zone and opening hours" },
      { label: "Teams / roles and role-based permissions", href: "/dealer/roles", show: can.roles,
        about: "Roles and what each one may see and do" },
      { label: "Dealership users and work schedules", href: "/dealer/staff", show: can.staff,
        about: "Staff accounts, departments and each person's working hours" },
      { label: "IP restriction", href: "/dealer/ip-restriction", show: can.account,
        about: "Allow the CRM only from the dealership's own networks" },
      { label: "Do-Not-Contact list", href: "/dealer/do-not-contact", show: can.leads || can.viewLeads || can.account,
        about: "Phones and emails this dealership must not contact" },
      { label: "My links (links the AI shares)", href: "/dealer/settings?tab=ai", show: can.settings,
        about: "Trade estimate, credit application, hours & map, specials..." },
      { label: "AI, follow-ups and appointment reminders", href: "/dealer/settings", show: can.settings,
        about: "Turn the AI on or off, follow-up and reminder settings" },
    ]],
    ["Dealership data", "fa-database", [
      { label: "Customer reassignment", href: "/dealer/leads", show: can.leads,
        about: "Tick leads on the Leads page, then Assign - with preview, history and undo" },
      { label: "Merge duplicate customers", href: "/dealer/customers/duplicates", show: can.leads,
        about: "Possible duplicates side by side; merge or mark as different people" },
      { label: "Import contacts / leads", href: "/dealer/leads", show: can.leads,
        about: "Leads page > Import (CSV)" },
      { label: "Customers", href: "/dealer/customers", show: can.leads || can.viewLeads,
        about: "Every customer, searchable by last name; DMS details on each profile" },
    ]],
    ["Email, lead and text", "fa-envelopes", [
      { label: "Email / lead account setup", href: "/dealer/email-accounts", show: can.email,
        about: "The mailboxes leads and customer emails arrive in" },
      { label: "Email domain validation", href: "/dealer/email-domains", show: can.email || can.account,
        about: "Checks your email domains' MX, SPF and DMARC records" },
      { label: "Email branding and footer", onClick: fire("open-email-branding"), show: can.account,
        about: "Logo, colours and the footer on the dealership's emails" },
      { label: "Email and text templates", href: "/dealer/message-template", show: can.templates,
        about: "Saved messages staff send" },
      { label: "Lead source maintenance", href: "/dealer/lead-sources", show: can.leads,
        about: "The sources staff pick on a lead entered by hand; rename or remove" },
      { label: "Conversations inbox", href: "/dealer/conversations", show: can.conversations,
        about: "Every text and email with customers" },
    ]],
    ["Sales", "fa-handshake", [
      { label: "Desk Log", href: "/dealer/desk-log", show: can.leads || can.viewLeads,
        about: "Showroom visits; Rules: manager alerts and the delivery checklist" },
      { label: "Forms library", href: "/dealer/forms", show: can.account,
        about: "The dealership's own PDF forms, filled from customer data" },
      { label: "Reports", href: "/dealer/reports", show: can.leads,
        about: "Executive, BDC, sales and source reports" },
    ]],
    ["Marketing", "fa-bullhorn", [
      { label: "Campaigns", href: "/dealer/campaigns", show: can.leads,
        about: "Text and email campaigns, their lists and results" },
      { label: "Scheduled reports", href: "/dealer/report-schedule", show: can.leads || can.settings,
        about: "Reports emailed on a schedule" },
    ]],
    ["Service", "fa-wrench", [
      { label: "Service scheduler settings", href: "/dealer/settings?tab=scheduler", show: can.settings,
        about: "Scheduler provider, services, advisors and booking rules" },
      { label: "Service appointments", href: "/dealer/service-appointments", show: can.leads || can.viewLeads,
        about: "Appointments from the DMS" },
    ]],
    ["Help", "fa-circle-question", [
      { label: "Support tickets", href: "/dealer/support", show: can.support, about: "Ask AutoPulse for help" },
    ]],
  ], [can.roles, can.staff, can.leads, can.viewLeads, can.account, can.settings, can.templates, can.email,
    can.conversations, can.support]);

  const needle = q.trim().toLowerCase();
  const shown = sections.map(([title, icon, items]) => [title, icon, items.filter((i) => i.show
    && (!needle || `${i.label} ${i.about} ${title}`.toLowerCase().includes(needle)))]).filter(([, , items]) => items.length);

  return (
    <div className="page_content">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <h2 className="mb-0 me-auto fs-4">Administration</h2>
        <Form.Control size="sm" style={{ maxWidth: 260 }} placeholder="Find a setting" value={q}
          onChange={(e) => setQ(e.target.value)} aria-label="Find a setting" />
      </div>
      <div className="row g-3">
        {shown.map(([title, icon, items]) => (
          <div key={title} className="col-12 col-lg-6">
            <div className="w_card h-100">
              <h3 className="w_card_title mb-2"><i className={`fa-regular ${icon} me-2`} />{title}</h3>
              <ul className="list-unstyled mb-0">
                {items.map((i) => (
                  <li key={i.label} className="py-1 border-bottom">
                    {i.href ? <Link href={i.href} className="fw-semibold">{i.label}</Link>
                      : <button type="button" className="btn btn-link p-0 fw-semibold text-start" onClick={i.onClick}>{i.label}</button>}
                    <div className="small text-muted">{i.about}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
        {!shown.length && <div className="text-muted">Nothing matches.</div>}
      </div>
    </div>
  );
}
