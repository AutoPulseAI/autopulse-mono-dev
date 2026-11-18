// The SOW's standard dealership roles (Deliverable G, G-054: "role-based access for rooftop admin, executive, manager,
// BDC/sales, service and read-only roles; least privilege"), built from the CRM's existing permissions. A dealer adds
// them in one click on Employee Roles (api/roles/standard) and can still edit or delete them like any role; nothing
// changes for staff until the dealer gives them one of these roles.
//
// READ_ONLY ("View All Leads (Read Only)"): sees every lead of the dealership and changes nothing. A staff member whose
// role has it and none of the WRITE permissions is refused every change (POST / PUT / PATCH / DELETE) by
// requireDealerAccess (app/lib/apiGuard.js), whatever screen sends it.
export const READ_ONLY = 'View All Leads (Read Only)';

// Permissions that let a staff member change something. A role with any of them is not read-only.
export const WRITE_PERMISSIONS = Object.freeze(['Manage Employee', "Manage Employee's  Role", 'Manage Email Accounts',
  'Manage Account Information', 'Manage Leads', 'View Assigned Leads', 'Assign Leads', 'Manage Appoinment',
  'Manage Follow-up setting', 'Manage Subscription', 'Manage Support Ticket', 'Manage Customer Conversation']);

export const STANDARD_ROLES = Object.freeze([
  { name: 'Rooftop Admin', permissions: [...WRITE_PERMISSIONS] },
  { name: 'Executive', permissions: [READ_ONLY] },
  { name: 'Sales Manager', permissions: ['Manage Leads', 'Assign Leads', 'Manage Appoinment', 'Manage Customer Conversation',
    'Manage Employee'] },
  { name: 'BDC / Sales', permissions: ['View Assigned Leads', 'Manage Appoinment', 'Manage Customer Conversation'] },
  { name: 'Service', permissions: ['View Assigned Leads', 'Manage Appoinment', 'Manage Customer Conversation'] },
  { name: 'Read-only', permissions: [READ_ONLY] },
]);

/** True when this staff member's role can only look (read-only and no write permission). `names`: permission names. */
export function isReadOnly(names = []) {
  return names.includes(READ_ONLY) && !names.some((n) => WRITE_PERMISSIONS.includes(n));
}
