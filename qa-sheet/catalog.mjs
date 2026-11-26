// Hand-written part of the feature & test sheet. build-sheet.mjs joins it with:
//   - qa-sheet/inventory.json (every page, tab, pop-up, button, link and field qa/ui-check.mjs found)
//   - qa-sheet/automated.json (the latest UI check results)
// One SECTION per page (its key is the page's address without the leading slash, as in inventory.json). Everything
// the crawler found on that page - its tabs, the parts a button shows, the windows a button opens - is listed under it.
// status: "live" works now; "soon" = not built or not running yet (why says what is missing).
// access: "admin" = only AutoPulse super admins (or "Login as" from the admin portal) see it today
//         (app/lib/reporting/featureFlags.js); testers sign in that way to test it.

export const APP = {
  name: "AutoPulse CRM",
  url: "https://www.autopulse.ai",
  scope: "Dealer CRM: leads, customers, appointments, Desk Log, tasks, AI messages, campaigns, reports, forms, DMS data, dealership admin, and the AutoPulse super admin portal.",
  testStore: "Test only in the test dealership the lead developer gives you (or a local copy). Never message, book or change a real dealer's customer.",
};

export const AREAS = [
  { id: "chrome", title: "Menu & top bar (every page)" },
  { id: "sales", title: "Dealer · Leads, customers & appointments" },
  { id: "ai", title: "Dealer · Tasks & AI Assistant" },
  { id: "marketing", title: "Dealer · Campaigns, reports & messages" },
  { id: "dms", title: "Dealer · DMS data (sales, service, parts)" },
  { id: "dealer-admin", title: "Dealer · Administration & settings" },
  { id: "admin", title: "Super admin portal" },
  { id: "public", title: "Sign-in & public pages" },
];

const ADMIN_ONLY = "Only AutoPulse super admins see this today (feature flag); sign in as a super admin and use Login as this dealer to test it.";

// Every section: id (inventory key), area, title, open (how a tester gets there), who, features[], tracker[] (rows of
// planning/P1-TRACKER.csv this page delivers; their 'where to see it' becomes a feature row).
export const SECTIONS = [
  // ---------- every page ----------
  { id: "dealer/_menu", area: "chrome", title: "Dealer menu and top bar", open: "Any dealer page: left menu and top bar", who: "Every dealer user (items depend on role)",
    features: [
      { id: "menu-links", title: "Every menu item opens its page", steps: ["Open each item of the left menu in turn (open the Sales, Service and Admin groups first).", "Use the browser Back button after each one."], expect: "Each item opens its page in the same tab; the open item is highlighted; Back returns to the page before." },
      { id: "menu-groups", title: "Sales and Service groups (shorter menu)", about: "Betsy / Bibi, 25 Nov 2026: everything for Sales under Sales, everything for Service under Service.", steps: ["Look at the menu.", "Close and open Sales, then Service.", "Open Service Appointments, then look at the menu again."], expect: "Sales holds Sales Dashboard, Desk Log, Tasks, Leads, Customers, Appointments, AI Messages, AI Insights; Service holds Service Dashboard, Service Customers, Service Appointments, Parts Inventory; Campaigns and Sold Customers are on their own; Report Scheduling is only under Admin; the group of the page on screen is open." },
      { id: "view-as-banner", title: "Viewing as an employee: banner and Back to my account", steps: ["From Admin → Employee Management press the eye on a test employee.", "Try to change anything (a lead's status).", "Press Back to my account."], expect: "A blue bar says whose view it is and that nothing can be changed; the change is refused; Back returns to your own account on Employee Management." },
      { id: "menu-collapse", title: "Menu button shows / hides the menu names", steps: ["Press Menu in the top bar twice."], expect: "The menu narrows to icons, then shows names again; the page stays usable." },
      { id: "store-switch", title: "Switch store", about: "Users who work for more than one rooftop pick the store at the top.", steps: ["Open the store menu in the top bar.", "Pick another store you may use."], expect: "Every page now shows the picked store's data; the store name in the top bar changes." },
      { id: "notifications", title: "Notifications bell", steps: ["Press the bell.", "Press See all."], expect: "The newest notifications list; See all opens the full list; opening one marks it read." },
      { id: "dept-dashboards", title: "Sales Dashboard / Service Dashboard", steps: ["Press Sales → Sales Dashboard, then Service → Service Dashboard."], expect: "The Dashboard opens filtered to that department (the address ends with ?department=sales / service)." },
      { id: "tasks-badge", title: "Tasks with the red count", steps: ["Look at the Tasks item.", "Press it."], expect: "The red number is the count of customers waiting on us; it opens Tasks on its Tasks tab." },
    ] },
  { id: "admin/_menu", area: "chrome", title: "Super admin menu and top bar", open: "Any /admin page", who: "AutoPulse super admins",
    features: [{ id: "menu-links", title: "Every admin menu item opens its page", steps: ["Open each item of the admin menu in turn."], expect: "Each opens its page in the same tab with no error." }] },

  // ---------- leads, customers, appointments ----------
  { id: "dealer/dashboard", area: "sales", title: "Dashboard", open: "Menu → Sales → Sales Dashboard (or Service → Service Dashboard)", who: "Everyone in the dealership",
    tracker: ["G-043", "G-049", "G-050", "G-051", "E-04", "E-07", "E-09", "M25-08"],
    features: [
      { id: "cards", title: "Headline cards and their numbers", steps: ["Open the Dashboard.", "Pick Today, then This month in the date picker.", "Click each card (Total Leads, Customer Replied, Messages Delivered, Dealer Action Required, Appointments made / for today / showed / sold)."], expect: "Each card's number changes with the dates; clicking a card opens the Leads (or Appointments / Tasks) page filtered to exactly those records, in the same tab; Back returns to the Dashboard; the list count equals the card number." },
      { id: "date-range", title: "Date range picker", about: "A component of its own: Today, Yesterday, This week, This month, Last month, custom range.", steps: ["Open the date picker.", "Pick each preset, then a custom range of two days."], expect: "The label shows the picked range; every card and chart reloads for it; the range survives a page refresh." },
      { id: "department", title: "Department filter (Sales / Service)", steps: ["Change Department."], expect: "Cards and charts count only that department's leads." },
      { id: "charts", title: "Charts: lead sources, lead status, leads received, messages sent", steps: ["Hover each chart; press Emails / SMS (Visible / Hidden) on the messages chart; click a bar or slice."], expect: "Hover shows the numbers; Emails / SMS toggles hide and show their series; a click opens the matching Leads list." },
      { id: "replies-by-age", title: "Customer replies by lead age", access: "admin", steps: ["Pick a date range (not All time).", "Read Replied from Today's Leads / Past Leads and the age cards.", "Click a number, then View customers and its CSV."], expect: "The age buckets add up as shown; every number opens its customers; the CSV has the same rows." },
      { id: "inventory-report", title: "Leads by car in stock (inventory report)", access: "admin", why: ADMIN_ONLY, about: "Betsy, 25 Nov 2026: how many leads came in on each car, and how long it has been in stock.", steps: ["Press the Lead sources tag.", "Read the chart Leads by car in stock; press Show all numbers and find the table Leads by car in stock.", "Click a count."], expect: "One row per car with a lead: stock #, year make model, days in stock, number of leads in the dates picked; cars no longer in stock are not listed; the count opens the Leads list with exactly those leads." },
      { id: "report-tags", title: "Report sections (click-to-load tags)", access: "admin", why: ADMIN_ONLY, steps: ["Press each tag: Lead sources, Leads & appointments, AI & staff, Sales & profit, Service, Data health, How numbers are counted.", "Press Hide.", "Use the In timeframe / From current leads switch.", "Download report → PDF, then CSV."], expect: "Only the pressed section loads; each number opens its Leads list; the PDF and CSV download with the same numbers as on screen." },
      { id: "calendar", title: "Lead calendar on the Dashboard", steps: ["Scroll to the calendar.", "Click a day with appointments."], expect: "The day's appointments open; each opens its lead." },
    ] },
  { id: "dealer/leads", area: "sales", title: "Leads", open: "Menu → Sales → Leads", who: "Everyone (Mine / All depends on role)",
    tracker: ["G-006", "G-009", "G-010", "G-027", "G-082", "G-083", "M25-03", "M25-07", "M25-10", "M25-11", "M25-12", "M25-16", "M25-17", "M25-18"],
    features: [
      { id: "list", title: "Lead list, search and filters", steps: ["Use All / Mine / Unassigned.", "Use All departments / Sales / Service / Parts.", "Type a name, email or phone and press Search; press Clear.", "Use each filter select (status, lead source, source, messages).", "Change the date range."], expect: "The list shows only matching leads; the count and pages update; Clear brings back the full list; filters stay after a refresh (they are in the address)." },
      { id: "one-search", title: "One search box: name, phone, email or stock #", about: "Betsy, 25 Nov 2026.", steps: ["Type a full phone number slowly, digit by digit, in the search box (e.g. 718-555-0101).", "Clear it; type a customer's name; then an email; then a stock number of a car in stock."], expect: "The cursor stays in the box while typing and nothing you typed is lost; each search lists the matching leads (by stock #: the leads about that car)." },
      { id: "assigned-to", title: "Assigned to filter (managers)", steps: ["Pick a person in Anyone (assigned to).", "Actions → Select leads → All leads matching your filters → Reassign to another test user."], expect: "Only that person's leads list; the reassignment moves them all and is in Bulk history with Undo." },
      { id: "bulk-reassign-permission", title: "Reassigning several leads needs Bulk Reassign Leads", steps: ["Sign in as a test user whose role has Assign Leads but not Bulk Reassign Leads.", "Select two leads."], expect: "Reassign is not offered for several leads (one lead can still be reassigned on its card); with the permission ticked in Employee Roles it is." },
      { id: "lead-tabs", title: "Open lead: header with tabs (Conversation / Lead details / AI Assistant)", about: "The user, 27 Nov 2026: one inbox screen instead of a middle column.", steps: ["Open a test lead.", "Press each tab; use the < > arrows, Customer profile and Back to list in the header."], expect: "The header shows the name, status, phone and email; Conversation fills the screen with the message box pinned at the bottom and only the messages scrolling; Lead details holds the lead card (edit, status, source, journey, manager override); AI Assistant holds the AI panel; Call, Add note, Update status and Check in are only in the message box's + menu." },
      { id: "chat-reply", title: "Chat-style conversation: oldest at the top, newest at the bottom", about: "The user, 27 Nov 2026.", steps: ["Open a test lead with several messages.", "Scroll up; press Load older messages at the top if shown."], expect: "The conversation opens at the newest message, right above the message box; the customer's messages are white bubbles on the left, the AI's green and staff's blue on the right, notes and status changes in the middle; each message has one short line (who, when, delivered) and From / To show on hover." },
      { id: "chat-plus", title: "The + menu: attach, car, link, template, Write with AI, note, call, status", steps: ["Press + in the message box.", "Attach a photo from your computer; send the text to your test phone.", "Open + again: Attach a car, Send a link, Template, Write with AI, Add note, Call, Update status."], expect: "Each opens its tool; an attached photo arrives as a picture message (by email: a link); Add note / Call / Update status open the same windows as the buttons on the lead card." },
      { id: "vehicle-photos", title: "Attach a car: photos and facts", steps: ["+ → Attach a car; search a stock # and pick the car.", "Tick two photos; click Miles, Drivetrain and Vehicle page.", "Send to your own test phone."], expect: "The car's photos show; the clicked facts are added as lines to the message; the text arrives with the two photos as a picture message (by email: photo links under the message)." },
      { id: "dealer-links", title: "Send a link (credit application...)", steps: ["+ → Send a link; press Full Credit Application (or another link shown)."], expect: "The link is added to the message as a line; only links set in Settings → AI → Links are shown." },
      { id: "open-lead", title: "Open a lead (lead card)", steps: ["Click View on a lead row.", "Read the lead card: contact, vehicle, source, status, owner, conversation.", "Use Prev / Next."], expect: "The lead opens beside the list; Prev / Next walk the list in its order; the address holds the lead so a refresh keeps it open." },
      { id: "reply", title: "Reply from the message box under the conversation", steps: ["Open a test lead; type in the box at the bottom of the conversation (Text or Email picked beside it) and press Enter (text) or the send arrow."], expect: "The message is added at the bottom of the conversation, tagged as staff, and reaches your test phone / inbox in the customer's language; there is no separate Reply button on the Leads page." },
      { id: "edit-lead", title: "Edit lead (saves by itself)", steps: ["Change status, owner, source and a contact field of a test lead.", "Open the same lead in a second browser."], expect: "Each change saves without a Save button and shows in the other browser within about 30 seconds; the change is in the lead's history." },
      { id: "actions-menu", title: "Actions menu: Add lead, Import CSV, Export CSV, Select leads, Bulk history", steps: ["Actions → Add lead: fill a test lead (pick Lead Source; try Edit list), save.", "Actions → Export CSV.", "Actions → Select leads: tick two test leads, Change status to …, confirm.", "Actions → Bulk history."], expect: "The new lead appears at the top; the CSV holds the filtered rows; the bulk change applies to the ticked leads only and is listed in Bulk history with Undo for reassignments." },
      { id: "staff-opted-out", title: "Opted Out set by staff stops everything (like DND)", about: "The user, 27 Nov 2026.", steps: ["On a test lead choose Update Status → Opted Out.", "Try to reply by text and by email.", "Text the lead's number from the test phone."], expect: "Both replies are refused with 'set to Opted Out by staff'; the AI sends nothing on any channel and does not move the lead off Opted Out when the customer writes; a customer's own STOP still stops only texts." },
      { id: "stopped", title: "Stopped (AI paused) filter", steps: ["Press Stopped."], expect: "Only leads whose AI messages are paused (staff took over, opted out, handed off) are listed." },
    ] },
  { id: "dealer/leads/bulk-history", area: "sales", title: "Bulk history", open: "Leads → Actions → Bulk history", who: "Managers", tracker: ["G-010"],
    features: [{ id: "history", title: "Every bulk change, its leads and Undo", steps: ["Filter by date and person.", "Open one change.", "Undo a test reassignment."], expect: "Each change shows when, who, what and how many; its leads show before → after and why one failed; Undo puts the owners back and is itself listed." }] },
  { id: "dealer/customers", area: "sales", title: "Customers", open: "Menu → Sales → Customers", who: "Everyone", tracker: ["G-004"],
    features: [
      { id: "list", title: "Customer list and search", steps: ["Search by name, phone and email.", "Open a customer."], expect: "Matching customers list; the profile opens." },
      { id: "duplicates", title: "Possible duplicates button", steps: ["Press Possible duplicates."], expect: "The duplicates page opens." },
    ] },
  { id: "dealer/customers/[id]", area: "sales", title: "Customer profile (Customer 360)", open: "Customers → click a customer", who: "Everyone", tracker: ["G-005", "G-007", "G-026", "G-059", "G-061", "G-062", "G-063", "G-066", "M-10.8", "M-10.9", "M25-01", "M25-02"],
    features: [
      { id: "tabs", title: "Every tab of the profile", steps: ["Open each tab: Overview, Leads, Trade In, Documents, Wish List, Value and the others shown."], expect: "Each tab shows that customer's data only; no error; Previous / Next at the top walk the customer list." },
      { id: "edit", title: "Edit contact details (phones, emails, addresses)", steps: ["Edit a test customer's phone, add a second email, mark one primary."], expect: "Saves by itself; the old value is kept in Change History." },
      { id: "call-text", title: "Call and message from the profile", steps: ["Press Call (on a test customer).", "Send a test SMS / email."], expect: "Call opens the phone; the message appears in Recent Activity." },
      { id: "possible-match", title: "Possible match (linked, not merged)", about: "Betsy, 25 Nov 2026: a new lead that matches a sales / service customer is not joined to them until a manager confirms it is the same person.", steps: ["Send a test lead with the phone and email of a test customer who has a DealerVault sale.", "Open the new lead's customer (as a manager).", "Press Review match."], expect: "The lead has its own customer; a yellow Possible match bar names the sales / service customer; nothing from that customer's sales shows on the new one; Review match opens Possible duplicates where Merge links them." },
      { id: "export-form", title: "Export to form / Print", steps: ["Press Export to form, pick a form, preview.", "Press Print."], expect: "The form fills with the customer's data; the export is logged in Documents; Print opens the browser print view." },
    ] },
  { id: "dealer/customers/duplicates", area: "sales", title: "Possible duplicate customers", open: "Customers → Possible duplicates", who: "Managers", tracker: ["G-008", "M25-02", "M25-06"],
    features: [{ id: "history-badge", title: "Sales / service customers marked; who merged", steps: ["Find a pair with a Sales / service customer badge.", "Merge a test pair; read Recent merges."], expect: "The badge marks customers with DealerVault sales or service; Recent merges shows By (the user who merged) and Undo." },
      { id: "merge", title: "Merge or mark not the same person", steps: ["Open a test pair.", "Pick the customer to keep → Preview → Confirm.", "Undo from Recent merges.", "On another pair press Not the same person."], expect: "Nothing merges without Confirm; the merge moves leads and history to the kept customer; Undo restores both; a pair marked not the same is not listed again." }] },
  { id: "dealer/booking", area: "sales", title: "Appointments", open: "Menu → Sales → Appointments", who: "Everyone", tracker: ["G-030", "G-031"],
    features: [
      { id: "list", title: "Appointment list and filters", steps: ["Filter Sales / Service, date range, status.", "Open an appointment's lead.", "Press the clock icon (history)."], expect: "Only matching appointments list; the lead opens in full; history shows booked / moved / cancelled with who and when." },
      { id: "book", title: "Book, move and cancel (test lead)", steps: ["Book a test lead for tomorrow.", "Move it to another time.", "Cancel it."], expect: "One appointment only (moving never makes a second); the customer gets one confirmation in their language; the history lists each step." },
    ] },
  { id: "dealer/booking/calendar", area: "sales", title: "Lead calendar", open: "Appointments → Calendar", who: "Everyone",
    features: [{ id: "calendar", title: "Month / week / day views", steps: ["Switch month, week, day; go to next and previous.", "Click an appointment."], expect: "Appointments sit on their dealer-local time; clicking one opens its lead." }] },
  { id: "dealer/desk-log", area: "sales", title: "Desk Log", open: "Menu → Sales → Desk Log", who: "Managers and sales staff", access: "admin", tracker: ["G-011", "G-012", "G-013", "G-014", "G-015", "G-016", "G-017", "G-018", "G-024", "G-056", "M25-13", "M25-14"],
    features: [
      { id: "cards", title: "Today / month-to-date cards and manager views", steps: ["Read the cards.", "Press each view (still open, stalled, no next step, unsold to follow up)."], expect: "Counts match the rows shown; each view lists only its visits." },
      { id: "check-in", title: "Customer check-in", steps: ["Customer Check-in → pick a test customer or one of today's appointments → check in."], expect: "A visit row appears at the top with time, salesperson and stage." },
      { id: "stage-outcome", title: "Change stage, people and outcome in place", steps: ["Change a test visit's stage (incl. Appraisal), salesperson, manager.", "Set an UNSOLD outcome (e.g. Price/Payment, Future F/U with a date)."], expect: "Saves by itself; UNSOLD reasons start their follow-up (AI Studio → Cadences → Unsold); a DND customer shows Do not contact and has no Call / Message buttons." },
      { id: "trade-from-conversation", title: "Trade column shows the trade from the conversation", steps: ["Check in a test customer who told the AI about a trade (e.g. 'I have a 2019 GMC Terrain') and has no trade-in record."], expect: "The Trade column shows the car with 'from the conversation' under it; a trade-in record, once added, is shown instead." },
      { id: "lead-type", title: "Lead type: Internet, Phone Up, Walk-In, Campaign (no Other)", about: "Betsy, 25 Nov 2026: there is no such thing as Other.", steps: ["Open All Lead Types."], expect: "The choices are Internet, Phone Up, Walk-In, Campaign and Not set (a lead whose type staff have not picked); there is no Other." },
      { id: "filters-print", title: "Filters, search, paging and Print", steps: ["Filter by Stage, Outcome, Lead Sources, dates; search; go to page 2.", "Press Print."], expect: "Rows narrow as filtered and paging restarts at page 1; Print shows the filtered list." },
    ] },

  // ---------- tasks and AI assistant ----------
  { id: "dealer/ai/actions", area: "ai", title: "Tasks (Dealer Action Required, Tasks, Stuck leads, Team board)", open: "Menu → Sales → Tasks", who: "Everyone (Team board: managers)", tracker: ["G-025", "G-028", "M-5.1"],
    features: [
      { id: "dar", title: "Dealer Action Required", steps: ["Open the tab.", "Filter by type.", "Open a test alert's lead; press Mark handled."], expect: "Alerts the AI raised (handoffs, call requests, bought elsewhere …); Mark handled removes it from the list for everyone without a refresh." },
      { id: "tasks", title: "Tasks: call tasks and reminders", steps: ["Switch status views.", "Call a test task, record the call outcome.", "Dismiss a task with a reason (only if your role may)."], expect: "A task closes only after its outcome is recorded; dismissing needs the permission and a reason." },
      { id: "stuck", title: "Stuck leads", steps: ["Assign an owner or add a next step on a test lead."], expect: "The lead leaves the stuck list; no customer is messaged." },
      { id: "board", title: "Team board", steps: ["Open Team board."], expect: "Each person with the items they are responsible for." },
    ] },
  { id: "dealer/ai/alerts", area: "ai", title: "AI alerts (Dealer Action Required list)", open: "Old link /dealer/ai/alerts", who: "Everyone",
    features: [{ id: "list", title: "Open and handled alerts", steps: ["Search, page and switch to grid view.", "Open ?all=1 for handled ones."], expect: "Open alerts first; handled ones only on the handled view." }] },
  { id: "dealer/ai/call-tasks", area: "ai", title: "Call tasks", open: "Old link /dealer/ai/call-tasks", who: "Everyone",
    features: [{ id: "views", title: "Now / upcoming / done / missed / cancelled", steps: ["Open each view.", "Call a test task and record the outcome."], expect: "Each view lists only its tasks; the outcome is required before the task closes." }] },
  { id: "dealer/ai/messages", area: "ai", title: "AI Messages (inbox)", open: "Menu → Sales → AI Messages", who: "Everyone",
    features: [{ id: "inbox", title: "Contacts, texts and emails", steps: ["Open a test customer.", "Switch Messages / Emails.", "Read a long email (it folds)."], expect: "AI messages are tagged; opening a conversation clears its red count; it opens on the channel the customer used last." }] },
  { id: "dealer/ai/settings", area: "ai", title: "AI settings (old link)", open: "/dealer/ai/settings", who: "—",
    features: [{ id: "redirect", title: "Old AI Settings link lands on Settings", steps: ["Open /dealer/ai/settings."], expect: "Settings opens on its AI tab (one Settings page since 8 Oct 2026)." }] },
  { id: "dealer/ai/insights", area: "ai", title: "AI Insights", open: "Menu → Sales → AI Insights", who: "Managers",
    features: [{ id: "insights", title: "Results, tests and price drops", steps: ["Change the period.", "Read results by bucket, source, angle and send time."], expect: "Rates show with their sample sizes; no error when a group has no data." }] },

  // ---------- campaigns, reports, messages ----------
  { id: "dealer/campaigns", area: "marketing", title: "Campaigns", open: "Menu → Campaigns", who: "Managers",
    features: [{ id: "list", title: "Campaign list and report", steps: ["Open a campaign's report."], expect: "The report opens with reach, engagement and top links." }] },
  { id: "dealer/campaigns/[id]/report", area: "marketing", title: "Campaign report", open: "Campaigns → a campaign → Report", who: "Managers",
    features: [{ id: "report", title: "Overview, reach, engagement, clicked links", steps: ["Read every block; change dates if shown."], expect: "Numbers add up (sent ≥ delivered ≥ opened); no error." }] },
  { id: "dealer/conversations", area: "marketing", title: "Conversations", open: "/dealer/conversations", who: "Everyone",
    features: [{ id: "search", title: "Search conversations", steps: ["Search by sender / recipient / text; clear."], expect: "Matching conversations list; the search stays in the address." }] },
  { id: "dealer/report-schedule", area: "marketing", title: "Report scheduling", open: "Menu → Admin → Report Scheduling", who: "Managers", tracker: ["G-048", "G-052", "G-053"],
    features: [{ id: "schedule", title: "Schedule rules and report email", steps: ["Add your own email as recipient.", "Pick days and time, save.", "Enter a wrong email."], expect: "Saved schedule shows after a refresh; a wrong email is refused with a message." }] },
  { id: "dealer/reports", area: "marketing", title: "Reports (old link)", open: "/dealer/reports", who: "—",
    features: [{ id: "redirect", title: "Old Reports link lands on the Dashboard", steps: ["Open /dealer/reports."], expect: "The Dashboard opens (reports are Dashboard sections now)." }] },

  // ---------- DMS ----------
  { id: "dealer/sales", area: "dms", title: "Sold Customers (DMS deals)", open: "Menu → Sold Customers", who: "Everyone", features: [{ id: "list", title: "Deal list and detail", steps: ["Search, filter, open a deal."], expect: "Deals from the DMS feed; the detail page opens." }] },
  { id: "dealer/sales/[id]", area: "dms", title: "Deal details", open: "Sales → a deal", who: "Everyone", features: [] },
  { id: "dealer/service", area: "dms", title: "Service (repair orders)", open: "Menu → Service → Service Customers", who: "Everyone", features: [{ id: "list", title: "Repair order list and detail", steps: ["Search, filter, open a repair order."], expect: "Repair orders from the DMS feed; the detail opens." }] },
  { id: "dealer/service/[id]", area: "dms", title: "Repair order details", open: "Service → a repair order", who: "Everyone", features: [] },
  { id: "dealer/service-appointments", area: "dms", title: "Service appointments (DMS)", open: "Menu → Service → Service Appointments", who: "Everyone", features: [] },
  { id: "dealer/service-appointments/[id]", area: "dms", title: "Service appointment details", open: "Service Appointments → one", who: "Everyone", features: [] },
  { id: "dealer/parts-inventory", area: "dms", title: "Parts inventory", open: "Menu → Service → Parts Inventory", who: "Everyone", features: [] },
  { id: "dealer/parts-inventory/[id]", area: "dms", title: "Part details", open: "Parts Inventory → a part", who: "Everyone", features: [] },
  { id: "dealer/vehicle", area: "dms", title: "Vehicles (inventory)", open: "Menu → Manage Vehicle", who: "Everyone", features: [{ id: "list", title: "Vehicle list, search and detail", steps: ["Search by make / model / stock number; open a vehicle."], expect: "The dealer's inventory; details open." }] },
  { id: "dealer/upsell", area: "dms", title: "Upsell recommendations", open: "/dealer/upsell", who: "Managers", features: [] },

  // ---------- dealer admin & settings ----------
  { id: "dealer/admin", area: "dealer-admin", title: "Administration", open: "Menu → Admin → Administration", who: "Dealer account and managers",
    features: [{ id: "links", title: "Every setup screen opens", steps: ["Press each link on the page."], expect: "Each opens its setup page; only what this person may use is shown." }] },
  { id: "dealer/settings", area: "dealer-admin", title: "Settings (follow-ups, reminders, AI, Dealer Intelligence, scheduler)", open: "Menu → Admin → Settings", who: "Dealers view; super admins edit", tracker: ["G-072", "G-075"],
    features: [
      { id: "tabs", title: "Every Settings tab", steps: ["Open each tab."], expect: "Dealers see the settings read-only; a super admin (Login as) can edit and save; other users' saves are refused." },
      { id: "intelligence", title: "Dealer Intelligence: Yes / No / Not configured", access: "admin", steps: ["Set a test fact, save, refresh."], expect: "The value stays after a refresh; Not configured is the default." },
    ] },
  { id: "dealer/settings/reminder-settings", area: "dealer-admin", title: "Reminder settings (old link)", open: "/dealer/settings/reminder-settings", who: "—", features: [] },
  { id: "dealer/forms", area: "dealer-admin", title: "Forms Library", open: "Menu → Admin → Forms Library", who: "Dealer account and managers", tracker: ["G-064", "G-065", "G-067", "FORMS-OCR"],
    features: [{ id: "upload", title: "Upload, check and manage a form", steps: ["Upload a test PDF form, then a phone photo of a paper form.", "Open it: check What fills each field; correct one blank.", "Rename, switch off / on, upload a new version, delete."], expect: "Every blank is found and matched to customer data; corrections stay; a switched-off form is not offered in Export to form." }] },
  { id: "dealer/staff", area: "dealer-admin", title: "Employee management", open: "Menu → Admin → Employee Management", who: "Dealer account and managers",
    tracker: ["M25-21"],
    features: [{ id: "staff", title: "Add, edit and switch off a user", steps: ["Add a test user with a role and department.", "Edit, then deactivate them."], expect: "The user can sign in with the role's menu only; a deactivated user cannot sign in." },
      { id: "view-as", title: "View as an employee (eye button)", about: "Betsy, 25 Nov 2026: see what an employee sees, for training and their questions.", steps: ["Press the eye on a test employee.", "Open the pages in the menu; try to change a lead's status.", "Press Back to my account."], expect: "The CRM shows exactly that employee's menu and data with a blue View as bar; every change is refused; Back returns to your own account. Only the dealership account and staff who manage employees have the eye; only for their own staff." }] },
  { id: "dealer/roles", area: "dealer-admin", title: "Employee roles", open: "Menu → Admin → Employee Roles", who: "Dealer account", tracker: ["G-054"],
    tracker: ["M25-12"],
    features: [{ id: "roles", title: "Roles and permissions", steps: ["Add standard roles.", "Edit a test role's permissions."], expect: "Users with the role see only what it allows (e.g. dismiss a task)." },
      { id: "bulk-reassign", title: "Bulk Reassign Leads permission", steps: ["Open Rooftop Admin and Sales Manager; open a BDC role."], expect: "Bulk Reassign Leads is ticked for Rooftop Admin and Sales Manager, not for other roles until an admin ticks it." }] },
  { id: "dealer/email-accounts", area: "dealer-admin", title: "Email setup", open: "Menu → Admin → Email Setup", who: "Dealer account", features: [] },
  { id: "dealer/email-domains", area: "dealer-admin", title: "Email domain validation", open: "Administration → Email domain validation", who: "Dealer account", features: [{ id: "check", title: "MX / SPF / DMARC check", steps: ["Open the page."], expect: "Each domain shows its records and what is missing; nothing can be changed here." }] },
  { id: "dealer/ip-restriction", area: "dealer-admin", title: "IP restriction", open: "Administration → IP restriction", who: "Dealer account; super admin switches blocking on", features: [{ id: "ips", title: "Allowed networks and Check an IP", steps: ["Add a test IP range; use Check an IP."], expect: "Test mode blocks no one and lists sign-ins from outside the list." }] },
  { id: "dealer/do-not-contact", area: "dealer-admin", title: "Do-Not-Contact list", open: "Administration → Do-Not-Contact list", who: "Everyone sees; managers change", tracker: ["G-071"], features: [{ id: "dnc", title: "Add and remove", steps: ["Add a test phone and email; remove one."], expect: "Entries list with who added them; removing keeps the history; the AI never messages a listed contact." }] },
  { id: "dealer/lead-sources", area: "dealer-admin", title: "Lead source maintenance", open: "Administration → Lead sources", who: "Managers", tracker: ["G-009", "M-4.4"], features: [{ id: "edit", title: "Add, rename, remove", steps: ["Add a test source, rename it, remove it."], expect: "Changes show in Leads → Add lead → Lead Source; history is kept." }] },
  { id: "dealer/subscribe", area: "dealer-admin", title: "My subscription", open: "Menu → My Subscription", who: "Dealer account", features: [] },
  { id: "dealer/subscriptions", area: "dealer-admin", title: "Subscriptions", open: "/dealer/subscriptions", who: "Dealer account", features: [] },
  { id: "dealer/subscribe/success", area: "dealer-admin", title: "Subscription success", open: "After paying", who: "Dealer account", features: [] },
  { id: "dealer/support", area: "dealer-admin", title: "Support tickets", open: "Menu → Support Ticket", who: "Everyone", features: [{ id: "ticket", title: "Open a ticket", steps: ["Open a test ticket and reply to it."], expect: "The ticket lists with its status; the reply shows." }] },
  { id: "dealer/vendors", area: "dealer-admin", title: "Vendor management", open: "/dealer/vendors", who: "Dealer account", features: [] },

  // ---------- super admin ----------
  { id: "admin/dashboard", area: "admin", title: "Admin dashboard", open: "Admin → Dashboard", who: "Super admins", features: [] },
  { id: "admin/dealers", area: "admin", title: "Dealers", open: "Admin → Dealers", who: "Super admins", tracker: ["M25-26"],
    features: [{ id: "pause", title: "Pause, deactivate and reactivate a dealership", about: "Betsy, 25 Nov 2026: turn a dealership off when it does not keep to its contract.", steps: ["On the TEST dealer: ... menu → Pause dealership; try without a reason, then with one.", "Try to sign in as one of its users (not Login as).", "Login as the dealer from here.", "... → Reactivate dealership; sign in again."], expect: "A reason is required; the row shows Paused; its users cannot sign in and see that the account is paused; Login as still opens it; while paused no text or email goes out for it (staff reply, campaign, AI, alerts, daily report are all stopped) and new leads are still saved; after Reactivate they sign in again and messages go again." },
      { id: "login-as", title: "Filter, export and Login as a dealer", steps: ["Filter by dates and status; export.", "Login as the test dealer."], expect: "The dealer's CRM opens as that dealer, with the super-admin-only parts visible; switching back returns to the admin portal." }] },
  { id: "admin/ai-studio", area: "admin", title: "AI Studio", open: "Admin → AI Studio", who: "Only Betsy edits (others look only)",
    features: [{ id: "view", title: "Sections and version history (look only)", steps: ["Open each section and an item's history. Do not save, publish or revert."], expect: "Every section lists its items with versions. Never edit here: only Betsy changes AI Studio." }] },
  { id: "admin/dms-feed", area: "admin", title: "DMS feed", open: "Admin → DMS feed", who: "Super admins", tracker: ["G-084", "G-085", "G-086", "G-087"],
    features: [{ id: "tabs", title: "Needs you, Feed health, Look up, Rules", steps: ["Pick a store; open each tab; open a record.", "Press Rules."], expect: "Every number opens what it counts; a record opens in a side panel with its field history; the view stays after Back / refresh." }] },
  { id: "admin/integration-health", area: "admin", title: "Integration health", open: "Admin → Integration health", who: "Super admins", tracker: ["G-058"],
    features: [{ id: "health", title: "Every store and connector", steps: ["Read the list; open a store with a problem."], expect: "Problems first; last good time in UTC with the dealer's time beside it." }] },
  { id: "admin/contact-compliance", area: "admin", title: "Contact compliance", open: "Admin → Contact compliance", who: "Super admins", tracker: ["G-068", "G-069", "G-070", "G-071", "M25-05"],
    features: [{ id: "dealer-list", title: "The dealer list shows dealerships only", steps: ["Open Choose a dealer."], expect: "Only dealerships are listed, no employees." },
      { id: "policy", title: "Policy, decisions and Do-Not-Contact per dealer", steps: ["Pick the test dealer; read decisions; add / remove a DNC entry; download."], expect: "Each text / email shows allowed / would block / needs review with reasons; the national DNC and reassigned-number checks show Not connected." }] },
  { id: "admin/cron", area: "admin", title: "Report cron service and daily email", open: "Admin → Report Cron Service", who: "Super admins", tracker: ["G-048"],
    features: [{ id: "daily-email", title: "Daily performance email: mode, Preview, delivery log", access: "admin", steps: ["Set the test dealer to Internal.", "Press Preview (it never sends)."], expect: "The preview shows the branded email; the log lists deliveries; Live is never switched on for a real dealer while testing." }] },
  { id: "admin/staff", area: "admin", title: "Admin staff", open: "Admin → Employee Management", who: "Super admins", features: [] },
  { id: "admin/roles", area: "admin", title: "Admin roles", open: "Admin → Roles", who: "Super admins", features: [] },
  { id: "admin/vendors", area: "admin", title: "Agency management", open: "Admin → Agencies", who: "Super admins", features: [] },
  { id: "admin/package", area: "admin", title: "Packages", open: "Admin → Packages", who: "Super admins", features: [] },
  { id: "admin/subscription", area: "admin", title: "Subscription requests", open: "Admin → Subscription requests", who: "Super admins", features: [] },
  { id: "admin/support", area: "admin", title: "Support tickets (admin)", open: "Admin → Support", who: "Super admins", features: [] },
  { id: "admin/contact", area: "admin", title: "Contact-us messages", open: "Admin → Contact", who: "Super admins", features: [] },
  { id: "admin/demo", area: "admin", title: "Demo requests", open: "Admin → Demo requests", who: "Super admins", features: [] },
  { id: "admin/vehicle", area: "admin", title: "Vehicles (admin)", open: "Admin → Vehicles", who: "Super admins", features: [] },
  { id: "admin/menu", area: "admin", title: "Website menu (CMS)", open: "Admin → Menu", who: "Super admins", features: [] },
  { id: "admin/pages", area: "admin", title: "Website pages (CMS)", open: "Admin → Pages", who: "Super admins", features: [] },
  { id: "admin/pages/[id]/edit", area: "admin", title: "Edit a website page", open: "Admin → Pages → Edit", who: "Super admins", features: [] },
  { id: "admin/pages-vvveb", area: "admin", title: "Page builder", open: "/admin/pages-vvveb", who: "Super admins", features: [] },
  { id: "admin/site-settings", area: "admin", title: "Site settings (CMS)", open: "Admin → Site settings", who: "Super admins", features: [] },

  // ---------- sign-in and public ----------
  { id: "dealer", area: "public", title: "Dealer sign-in", open: "https://www.autopulse.ai/dealer", who: "Everyone", tracker: ["SEC-7", "SEC-8"],
    features: [{ id: "login", title: "Sign in with email code", steps: ["Sign in with a test user: password, then the emailed code.", "Try a wrong code several times."], expect: "The code arrives by email (never shown in the browser); after too many wrong codes the code stops working; Remember device skips the code next time." }] },
  { id: "dealer/forgot-password", area: "public", title: "Dealer forgot password", open: "Dealer sign-in → Forgot password", who: "Everyone", features: [] },
  { id: "dealer/reset", area: "public", title: "Dealer reset password", open: "Link in the reset email", who: "Everyone", features: [] },
  { id: "dealer/register", area: "public", title: "Dealer registration", open: "/dealer/register", who: "Everyone", features: [] },
  { id: "dealer/two-factor-verification", area: "public", title: "Two-factor verification", open: "After the dealer password", who: "Everyone", features: [] },
  { id: "admin", area: "public", title: "Super admin sign-in", open: "https://www.autopulse.ai/admin", who: "Super admins", tracker: ["SEC-11"], features: [] },
  { id: "home", area: "public", title: "Public home page", open: "https://www.autopulse.ai", who: "Everyone", features: [] },
  { id: "privacy-policy", area: "public", title: "Privacy policy", open: "/privacy-policy", who: "Everyone", features: [] },
  { id: "terms-and-conditions", area: "public", title: "Terms and conditions", open: "/terms-and-conditions", who: "Everyone", features: [] },
  { id: "[slug]", area: "public", title: "CMS page", open: "/<page>", who: "Everyone", features: [] },
  { id: "booking/[dealerId]/[leadId]", area: "public", title: "Customer booking page", open: "Link in a customer message", who: "Customers", features: [] },
  { id: "iframe/lead/[leadId]", area: "public", title: "Lead iframe", open: "Embedded lead view", who: "Integrations", features: [] },
];

// Notes for buttons that need more than the label says, by "<page>|<label>" (or just "<label>" for every page).
// [about, expected]
export const BUTTONS = {
  "Search": ["Runs the search with what is typed in the search fields.", "Only matching rows show; the count updates; an empty search shows everything."],
  "Clear": ["Empties the search / filters.", "Every filter is back to its default and the full list shows."],
  "Date Range": ["The date range component: presets and a custom range.", "The list / numbers reload for the picked dates; the label shows the range."],
  "Apply": ["Applies the picked dates / filters.", "The page reloads its data for them; the picker closes."],
  "Actions": ["Opens the Actions menu.", "The menu opens with its items; Escape closes it."],
  "Export CSV": ["Downloads the list as a CSV file.", "A CSV downloads with the same rows and filters as on screen."],
  "Import CSV": ["Opens the CSV import.", "A file picker / import window opens; a wrong file is refused with a message."],
  "Print": ["Opens the browser print view of this page.", "The print preview shows the page's data without menus."],
  "Notifications": ["Opens the notifications list.", "The newest notifications show; See all opens the full list."],
  "Menu": ["Shows / hides the menu names.", "The left menu narrows to icons, then shows names again."],
  "Help Center": ["Opens the help / support page.", "Support opens in the same tab."],
  "Page buttons (previous / next / number)": ["Pages through a long list.", "The next / previous page of rows shows; the page number is highlighted."],
  "Row: # View": ["On each row: opens that record.", "The record opens (beside the list or on its page)."],
  "Row checkbox (select a row)": ["Selects the row for a bulk change.", "The selected count updates; bulk actions apply to the selected rows only."],
};

/** Expected result for a button the notes above don't cover, from its label and where it goes. */
export function guess(b, pageTitle) {
  const l = b.label.replace(/^Row:\s*/, "");
  const onRow = /^Row:/.test(b.label) ? " for that row only" : "";
  if (b.kind === "tab") return [`Tab: shows the '${l}' part of ${pageTitle}.`, "That part shows; the other tabs' contents hide; no error message."];
  if (b.href && /^https?:/.test(b.href)) return [`Opens ${b.href}.`, "The page opens (in a new tab for outside sites)."];
  if (b.href) return [`Goes to ${b.href}.`, "That page opens in the same tab with the right data; the browser Back button returns here."];
  if (/^\+?\s*(add|new|create)\b/i.test(l)) return [`${l}.`, `A form opens; required fields are checked; Save adds it${onRow} and it shows in the list; Cancel adds nothing.`];
  if (/\b(edit|change)\b/i.test(l)) return [`${l}.`, `The edit form opens with the current values${onRow}; saving keeps the change after a refresh.`];
  if (/\b(delete|remove)\b/i.test(l)) return [`${l}.`, `Asks to confirm first; confirming removes it${onRow}; cancelling keeps it. Test on test data only.`];
  if (/\b(save|update|submit)\b/i.test(l)) return [`${l}.`, "Saves; a success message shows and the value stays after a refresh; a wrong value is refused with a message."];
  if (/\b(cancel|close)\b|^×$/i.test(l)) return [`${l}.`, "The window closes without saving anything."];
  if (/\b(export|download|csv|pdf)\b/i.test(l)) return [`${l}.`, "A file downloads with the same data as on screen."];
  if (/\b(send|reply|message|sms|email)\b/i.test(l)) return [`${l}.`, "Only to a test contact: it is sent once, shows in the conversation, in the customer's language."];
  if (/\bcall\b/i.test(l)) return [`${l}.`, "Opens the phone / dialler for the number; nothing is logged until the outcome is recorded."];
  if (/\b(filter|all|mine|unassigned|sales|service|parts|today|week|month|status|stopped)\b/i.test(l)) return [`Filter: ${l}.`, "The list / numbers narrow to it; the active choice is highlighted; refresh keeps it."];
  if (/\(.+ icon\)/.test(l)) return [`Icon button${onRow}: ${l}.`, "Does what its tooltip says; no error message."];
  return [`${l}${onRow}.`, "Works; no error message."];
}
