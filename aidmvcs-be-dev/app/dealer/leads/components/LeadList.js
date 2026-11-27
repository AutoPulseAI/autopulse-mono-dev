"use client";
import { leadStatusLabel, statusLabel } from "@lib/statusLabels";
import { forwardRef,
  useImperativeHandle, useState, useEffect, Suspense, useCallback, useRef } from "react";
import { formatTimestamp } from "../../../utils/dateUtils";
import { avatarStyle, initialsOf } from "../../../lib/avatarColor";
import { Button, ListGroup, Row, Col, Offcanvas, Modal, Form, Alert, Badge, Pagination, Spinner, Dropdown } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import { useCan } from "../../../hooks/PermissionsContext";
import DateRangePickerComponent from "../../components/DateRangePicker";
import ImportLeadsModal from "./ImportLeadsModal";
import StatusModal from "./StatusModal";
import LeadDetailsSidebar from "./LeadDetailsSidebar";
import AppIcon, { Avatar, IconLabel, statusIconName } from "../../components/AppIcon";
import { useRouter, useSearchParams } from "next/navigation";
import { backFor } from "../../components/backLink";
import Customer360Panel from "../../components/Customer360Panel";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";
import { BulkBar, BulkScope, BulkPanel, BulkNotice, undoBulk, exportBulk } from "./BulkAssign";
import LeadDetailsPanel from "./LeadDetailsPanel";
// Source type (24 Nov 2026: it listed the same names as Lead source): how the lead came in, as on each row.
// Inbox time: today = the time, this week = the day, else the date (dealer time zone).
function inboxTime(at, tz) {
  if (!at) return "";
  const d = new Date(at);
  const opt = (o) => d.toLocaleString("en-US", { timeZone: tz || undefined, ...o });
  const day = (x) => x.toLocaleDateString("en-US", { timeZone: tz || undefined });
  const now = new Date();
  if (day(d) === day(now)) return opt({ hour: "numeric", minute: "2-digit" });
  if (now - d < 6 * 864e5) return opt({ weekday: "short" });
  return opt({ month: "numeric", day: "numeric", year: "2-digit" });
}

// "Waiting" (the user, 27 Nov 2026 - inbox ideas): the customer wrote last and nobody has answered for 5+ minutes.
function waitingFor(last) {
  if (last?.from !== "customer" || !last.at) return "";
  const m = Math.floor((Date.now() - new Date(last.at).getTime()) / 60000);
  if (!(m >= 5)) return "";
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

const UP_TYPE_OPTIONS = [["up:internet", "Internet"], ["up:phone", "Phone-up"], ["up:walk_in", "Walk-in"], ["up:not_set", "Not set"]];
const DEPT_TABS = [["", "All departments", "fa-layer-group"], ["sales", "Sales", "fa-car"], ["service", "Service", "fa-screwdriver-wrench"], ["parts", "Parts", "fa-gears"]];

import moment from 'moment-timezone';
import { throwIfStatusFailed } from "../../../lib/bookingConflict"; // stream R: full-slot answer
import { contactTypeLabel, leadContactType } from "../../../lib/leadContactType";

// The lead's source for the list: the source staff picked or the provider sent; a follow-up channel is not a source.
const CHANNEL_WORDS = new Set(["email", "sms", "manual", ""]);
function leadSourceName(lead) {
  const picked = String(lead?.lead_source || "").trim();
  if (picked) return picked;
  const raw = String(lead?.source || "").trim();
  return CHANNEL_WORDS.has(raw.toLowerCase()) ? "Not set" : raw;
}
import useLiveRefresh from "../../../hooks/useLiveRefresh";

// The dashboard's admin "Customer replies by lead age" / "Appointments made" links and the Reports page's numbers
// (report_kpi, with its part / breakdown group / filters) (app/api/leads/route.js drillFilter): carried on every list
// fetch and on Export CSV, so the CSV rows are the list.
const REPORT_PARAMS = { report_kpi: 'reportKpi', report_part: 'reportPart', report_by: 'reportBy',
  report_group: 'reportGroup', report_filters: 'reportFilters' };
const drillQuery = (f) => (f.replyCohort ? `&reply_cohort=${encodeURIComponent(f.replyCohort)}` : '')
  + (f.apptAttribution ? `&appt_attribution=${encodeURIComponent(f.apptAttribution)}` : '')
  + (f.reportKpi ? Object.entries(REPORT_PARAMS).filter(([, key]) => f[key])
    .map(([param, key]) => `&${param}=${encodeURIComponent(f[key])}`).join('') : '');
const DRILL_KEYS = { reply_cohort: ['replyCohort'], appt_attribution: ['apptAttribution'],
  report_kpi: Object.values(REPORT_PARAMS) };
const drillRangeText = (range) => {
  if (!range?.from) return '';
  const from = moment(range.from, 'YYYY-MM-DD');
  const to = moment(range.to || range.from, 'YYYY-MM-DD');
  if (from.isSame(to, 'day')) return from.format('MMM D, YYYY');
  return from.isSame(to, 'year') ? `${from.format('MMM D')} – ${to.format('MMM D, YYYY')}`
    : `${from.format('MMM D, YYYY')} – ${to.format('MMM D, YYYY')}`;
};

// Component that uses useSearchParams - needs to be wrapped in Suspense
const LeadList = forwardRef(({ setEditLead, onLeadSelected, activeLeadId, selectedLeadId, compact = false, ...props }, ref) => {
  // All hooks must be called unconditionally at the top level
  const canAssignLeads = useCan("Assign Leads");
  // Reassigning several leads at once needs its own permission (Betsy, 25 Nov 2026; app/lib/bulkPermission.js).
  const canBulkReassign = useCan("Bulk Reassign Leads") && canAssignLeads;
  // SOW B b5 (G-010), the user's design of 24 Nov 2026: Actions > Select leads turns on bulk mode (a tick column, the
  // bulk bar and the scope line). `selected` is the truth: lead id -> { _id, name, owner, status }. `scope` only says
  // how it was made (all matching / this page / first N / pages / ticked one by one); `unticked` counts leads taken
  // out of a scope by hand.
  const [selectMode, setSelectMode] = useState(false);
  // Phones: the filters fold behind a button. Beside the conversation (compact) they are shown; the button folds them.
  const [filtersOpen, setFiltersOpen] = useState(false); // folded behind the filter button until someone opens it
  const shownOnce = useRef(false); // the list has been on screen once (later loads keep the filters mounted)
  const [selected, setSelected] = useState(() => new Map());
  const [scope, setScope] = useState("page");
  const [unticked, setUnticked] = useState(0);
  const [matching, setMatching] = useState({ total: 0, capped: false, leads: null, key: null });
  const [scopeLoading, setScopeLoading] = useState(false);
  const [bulkPanel, setBulkPanel] = useState(null); // 'reassign' | 'status'
  const [bulkResult, setBulkResult] = useState(null);
  const closeBulkNotice = useCallback(() => setBulkResult(null), []);
  const canManageLeads = useCan("Manage Leads");
  const canViewAllReadOnly = useCan("View All Leads (Read Only)"); // SOW G-054: sees every lead, changes nothing
  const canViewAssignedOnly = useCan("View Assigned Leads");
  const canViewAssignedLeads = canViewAssignedOnly || canViewAllReadOnly;
  const [leads, setLeads] = useState([]);
  const [drill, setDrill] = useState(null); // the list's drill-filter chips, from /api/leads (null = none applied)
  const [paginationDirection, setPaginationDirection] = useState(null);
  const paginationDirectionRef = useRef(null); // Use ref to hold direction reliably across renders
  const lastSelectedLeadIdRef = useRef(null); // Track last selected lead to prevent re-selection
  const justHandledDirectionRef = useRef(false); // Flag to prevent PRIORITY 2 from running after direction-based selection
  const isPageChangeFetchingRef = useRef(false); // Flag to prevent useEffect from calling fetchLeads when handlePageChange is fetching
  const [openLeadId, setOpenLeadId] = useState(null);

  const [selectedLead, setSelectedLead] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ show: false, message: "", variant: "success" });
  const { user, dealerParent } = useUser();
  const [panel360, setPanel360] = useState(null); // the 360 View side panel (19 Nov 2026)
  const activeEntity = dealerParent || user;
  const orignalDealer = user;
  const router = useRouter();
  const urlSearchParams = useSearchParams();
  
  // Get dealer timezone
  const dealerTimezone = activeEntity?.dealer_account_information?.time_zone || 'America/New_York';
  
  // Refs for router and onLeadSelected to avoid unnecessary fetchLeads recreations
  const routerRef = useRef(router);
  const onLeadSelectedRef = useRef(onLeadSelected);
  
  // Keep refs updated
  useEffect(() => {
    routerRef.current = router;
    onLeadSelectedRef.current = onLeadSelected;
  }, [router, onLeadSelected]);
  // The starting filters come from useSearchParams(), the URL of the page being opened. Not window.location: on a
  // same-tab link (the dashboard cards, 11 Nov 2026) the address bar still holds the previous page's URL while this
  // first renders, so every card opened the full unfiltered list (the user, 12 Nov 2026). Next.js keeps
  // useSearchParams() in step with the replaceState calls below.
  const [staffList, setStaffList] = useState([]);
  const [assignmentFilter, setAssignmentFilter] = useState(() => urlSearchParams.get('assignment') || 'all');
  const setAssignmentAndSync = (value) => {
    setAssignmentFilter(value);
    try {
      const params = new URLSearchParams(window.location.search);
      if (value && value !== 'all') {
        params.set('assignment', value);
      } else {
        params.delete('assignment');
      }
      // reset page when changing filter
      params.set('page', '1');
      const query = params.toString();
      window.history.replaceState(window.history.state, '', `/dealer/leads${query ? `?${query}` : ''}`);
    } catch (e) {
      // no-op if window not available
    }
  };

  // Initialize filters and pagination from the URL of the page being opened
  const [filters, setFilters] = useState(() => {
    const params = urlSearchParams;
    return {
      q: params.get('q') || '', // the one search box: name, phone, email or stock # (Betsy, 25 Nov 2026)
      name: params.get('name') || '',
      email: params.get('email') || '',
      phone: params.get('phone') || '',
      status: params.get('status') || '',
      lead_source: params.get('lead_source') || '',
      department: params.get('department') || '', // Betsy, 14 Nov 2026: Sales / Service / Parts
      owner: params.get('owner') || '', // one staff member's leads (Betsy, 25 Nov 2026: bulk reassign a rep's leads)
      source: params.get('source') || '',
      message_filter: params.get('message_filter') || '',
      messages: params.get('messages') || '', // the dashboard's Messages card: who we messaged in the range
      messagesChannel: params.get('channel') || '', // ...by text, picture text or email (28 Oct 2026 meeting)
      repliedBy: params.get('replied_by') || '', // Customer Replied by text or email (Betsy, 2 Nov 2026 meeting)
      sort: params.get('sort') || '', // created_desc | created_asc (Betsy, 2 Nov 2026 meeting)
      stopped: params.get('stopped') || '', // leads with a stop (app/lib/ai/stopLabels.js)
      replyCohort: params.get('reply_cohort') || '', // dashboard: customers replied by lead age (admins)
      apptAttribution: params.get('appt_attribution') || '', // dashboard: appointments made by AI / staff (admins)
      ...Object.fromEntries(Object.entries(REPORT_PARAMS).map(([param, key]) => [key, params.get(param) || ''])), // Reports page (admins)
      dateRange: {
        startDate: params.get('startDate') ? new Date(params.get('startDate')) : null,
        endDate: params.get('endDate') ? new Date(params.get('endDate')) : null
      },
      page: parseInt(params.get('page')) || 1
    };
  });

  const [pagination, setPagination] = useState({
    currentPage: filters.page,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 10,
    hasNextPage: false,
    hasPreviousPage: false
  });
  // The side list fills its column (the user, 28 Nov 2026: "a lot of gap above the pager - 3 to 4 more leads fit"):
  // beside the conversation on a desktop, a page holds as many leads as the screen has room for (5-50).
  const listBoxRef = useRef(null);
  useEffect(() => {
    if (!compact || typeof ResizeObserver === "undefined") return undefined;
    const box = listBoxRef.current?.querySelector(".list-group");
    if (!box) return undefined;
    let timer = null;
    const fit = () => {
      if (window.innerWidth < 993) return; // tablet / phone: the list slides in and scrolls; 10 a page
      const rows = box.querySelectorAll(":scope > .lead-item");
      if (rows.length < 2) return;
      const pitch = rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top;
      if (!(pitch > 20)) return;
      const n = Math.max(5, Math.min(50, Math.floor((box.clientHeight + 2) / pitch)));
      setPagination((p) => (p.itemsPerPage === n ? p : { ...p, itemsPerPage: n }));
    };
    const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(fit, 250); });
    ro.observe(box);
    return () => { clearTimeout(timer); ro.disconnect(); };
  }, [compact, leads.length > 1]); // eslint-disable-line react-hooks/exhaustive-deps

  const [inputValues, setInputValues] = useState({
    q: filters.q,
    name: filters.name,
    email: filters.email,
    phone: filters.phone,
    status: filters.status,
    lead_source: filters.lead_source,
    department: filters.department,
    owner: filters.owner,
    source: filters.source,
    message_filter: filters.message_filter
  });

  // State for page input (separate from actual page)
  const [pageInputValue, setPageInputValue] = useState('1');
  
  // State for lead source options
  const [leadSourceOptions, setLeadSourceOptions] = useState([]);
  // State for source options
  const [sourceOptions, setSourceOptions] = useState([]);

  const statusOptions = [
    // In the order of the client's status list (scope §16; Betsy, 12 Oct 2026: "statuses do not look exactly as I
    // specified" - no plain "Contacted" or "Sold", which her workflows don't have). Shown with app/lib/statusLabels.js.
    "Lead",
    "Lead Not Contacted",
    "Contacted - No Next Action",
    "Contacted - Specific Follow-up",
    "Appointment Booked",
    "No Show",
    "Visited",
    "DND",
    "Managerial Review",
    "Sold Pending",
    "Sold Delivered",
    "Unsold",
    "Closed - Lost",
    "Closed - No Longer Owns",
  ];

  const getStatusVariant = (status) => {
    switch (status?.toLowerCase()) {
      case 'contacted': return 'info';
      case 'appointment booked': return 'warning';
      case 'visited': return 'success';
      case 'managerial review': return 'warning';
      case 'sold': return 'danger';
      case 'sold pending': return 'warning';
      case 'sold delivered': return 'danger';
      case 'unsold': return 'secondary';
      case 'closed - lost': return 'dark';
      case 'closed - no longer owns': return 'dark';
      case 'lead': return 'custom';
      case 'dnd': return 'secondary';
      default: return 'secondary';
    }
  };

  const showAlert = useCallback((message, variant = "success") => {
    setAlert({ show: true, message, variant });
    setTimeout(() => setAlert(prev => ({ ...prev, show: false })), 5000);
  }, []);

  const fetchStaffList = useCallback(async () => {
    if (!activeEntity?.id) return;
    try {
      const token = localStorage.getItem('dealertoken');
      const res = await fetch(`/api/staff/list?dealer_id=${dealerParent.id}`,{
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (res.ok) {
        setStaffList(data.staff || []);
      }
    } catch (err) {
      // Error fetching staff
    }
  }, [activeEntity?.id]);

  // Helper function to fetch leads for a specific page
  const fetchLeadsForPage = useCallback(async (page, { silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);

      // Build query parameters including page
      let queryParams = `dealer_id=${activeEntity.id}&page=${page}&limit=${pagination.itemsPerPage}${compact ? '&preview=1' : ''}`;

      // Add assignment filter (only when not 'all')
      if (assignmentFilter && assignmentFilter !== 'all') {
        queryParams += `&assignment=${assignmentFilter}`;
      }

      // Add filters to query
      if (filters.q) queryParams += `&q=${encodeURIComponent(filters.q)}`;
    if (filters.name) queryParams += `&name=${encodeURIComponent(filters.name)}`;
      if (filters.email) queryParams += `&email=${encodeURIComponent(filters.email)}`;
      if (filters.phone) queryParams += `&phone=${encodeURIComponent(filters.phone)}`;
      if (filters.status) queryParams += `&fe_lead_status=${encodeURIComponent(filters.status)}`;
      if (filters.stopped) queryParams += '&stopped=1';
      if (filters.lead_source) queryParams += `&lead_source=${encodeURIComponent(filters.lead_source)}`;
      if (filters.department) queryParams += `&department=${encodeURIComponent(filters.department)}`;
      if (filters.owner) queryParams += `&owner=${encodeURIComponent(filters.owner)}`;
      if (filters.source) queryParams += `&source=${encodeURIComponent(filters.source)}`;
      if (filters.message_filter) queryParams += `&message_filter=${encodeURIComponent(filters.message_filter)}`;
      if (filters.messages) queryParams += `&messages=${encodeURIComponent(filters.messages)}`;
      if ((filters.messages || filters.message_filter === 'unread') && filters.messagesChannel) queryParams += `&channel=${encodeURIComponent(filters.messagesChannel)}`;
      if (filters.status === 'Contacted' && filters.repliedBy) queryParams += `&replied_by=${encodeURIComponent(filters.repliedBy)}`;
      if (filters.sort) queryParams += `&sort=${encodeURIComponent(filters.sort)}`;
      queryParams += drillQuery(filters);
      if (filters.dateRange.startDate) queryParams += `&startDate=${filters.dateRange.startDate.toISOString()}`;
      if (filters.dateRange.endDate) queryParams += `&endDate=${filters.dateRange.endDate.toISOString()}`;

      const res = await fetch(`/api/leads?${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to fetch leads");

      const newLeads = data.data || [];
      const newCurrentPage = data.pagination?.currentPage || page;
      setDrill(data.drill || null);
      
      setLeads(newLeads);
      setPagination({
        currentPage: newCurrentPage,
        totalPages: data.pagination?.totalPages || 1,
        totalItems: data.pagination?.totalItems || 0,
        itemsPerPage: data.pagination?.itemsPerPage || 10,
        hasNextPage: data.pagination?.hasNextPage || false,
        hasPreviousPage: data.pagination?.hasPreviousPage || false
      });
      
      // Sync pageInputValue with the current page after API call
      setPageInputValue(newCurrentPage.toString());
      
      return { leads: newLeads, pagination: data.pagination, currentPage: newCurrentPage };
    } catch (err) {
      if (!silent) showAlert("Failed to load leads", "danger");
      throw err;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeEntity?.id, assignmentFilter, pagination.itemsPerPage, filters, showAlert]);

  // Bulk mode, "All matching": the filters changed (a chip's x) -> select what now matches.
  useEffect(() => {
    if (selectMode && scope === 'all' && matching.key && matching.key !== listFilterQuery()) selectScope('all');
  }, [filters, assignmentFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // G-083: what other users change shows up without a manual refresh (same page, filters and scroll); paused while
  // a lead, a modal or a selection is open.
  useLiveRefresh(() => (activeEntity?.id ? fetchLeadsForPage(filters.page, { silent: true }) : null), {
    paused: loading || showDetails || showStatusModal || showDeleteModal || showImportModal || selectMode,
  });

  const fetchLeads = useCallback(async () => {
    try {
      const result = await fetchLeadsForPage(filters.page);
      setLeads(result.leads);
      setPagination({
        currentPage: result.currentPage,
        totalPages: result.pagination?.totalPages || 1,
        totalItems: result.pagination?.totalItems || 0,
        itemsPerPage: result.pagination?.itemsPerPage || 10,
        hasNextPage: result.pagination?.hasNextPage || false,
        hasPreviousPage: result.pagination?.hasPreviousPage || false
      });
    } catch (err) {
      // Error already handled in fetchLeadsForPage
    }
  }, [filters.page, fetchLeadsForPage]);

  const fetchLeadSourceOptions = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/stats?dealer_id=${activeEntity.id}`,
        {headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }
      });
      
      const data = await res.json();
      
      if (res.ok) {
        // Fetch lead_source options
        if (data.lead_sources) {
          // Group lead sources by case-insensitive matching
          const sourceMap = new Map();
          let hasEmptySource = false;
          
          data.lead_sources.forEach(source => {
            const originalName = source._id;
            
            // Check for empty/null/whitespace-only values (including \n\n\n)
            if (!originalName || !originalName.trim() || originalName.trim() === '') {
              hasEmptySource = true;
            } else {
              // Only add non-empty, non-whitespace values to the map
              const trimmedName = originalName.trim();
              const normalizedName = trimmedName.toLowerCase();
              
              if (sourceMap.has(normalizedName)) {
                // If we already have this source (case-insensitive), keep the better capitalization
                const existing = sourceMap.get(normalizedName);
                if (trimmedName !== trimmedName.toLowerCase() && existing === existing.toLowerCase()) {
                  sourceMap.set(normalizedName, trimmedName);
                }
              } else {
                // New source
                sourceMap.set(normalizedName, trimmedName);
              }
            }
          });
          
          let options = Array.from(sourceMap.values()).sort();
          
          // Extra safety: Filter out any whitespace-only values that might have slipped through
          options = options.filter(opt => opt && opt.trim() !== '');
          
          // Add "Unknown" option if there are leads with empty/null lead_source
          if (hasEmptySource) {
            options.unshift('Unknown');
          }
          
          setLeadSourceOptions(options);
        }

        // Fetch source options (communication type: email, sms, campaign, etc.)
        if (data.sources) {
          // Group sources by case-insensitive matching
          const sourceTypeMap = new Map();
          let hasEmptySourceType = false;
          
          data.sources.forEach(source => {
            const originalName = source._id;
            
            // Check for empty/null/whitespace-only values (including \n\n\n)
            if (!originalName || !originalName.trim() || originalName.trim() === '') {
              hasEmptySourceType = true;
            } else {
              // Only add non-empty, non-whitespace values to the map
              const trimmedName = originalName.trim();
              const normalizedName = trimmedName.toLowerCase();
              
              if (sourceTypeMap.has(normalizedName)) {
                // If we already have this source (case-insensitive), keep the better capitalization
                const existing = sourceTypeMap.get(normalizedName);
                if (trimmedName !== trimmedName.toLowerCase() && existing === existing.toLowerCase()) {
                  sourceTypeMap.set(normalizedName, trimmedName);
                }
              } else {
                // New source
                sourceTypeMap.set(normalizedName, trimmedName);
              }
            }
          });
          
          let options = Array.from(sourceTypeMap.values()).sort();
          
          // Extra safety: Filter out any whitespace-only values that might have slipped through
          options = options.filter(opt => opt && opt.trim() !== '');
          
          // Add "Unknown" option if there are leads with empty/null source
          if (hasEmptySourceType) {
            options.unshift('Unknown');
          }
          
          setSourceOptions(options);
        }
      }
    } catch (err) {
      // Error fetching lead source options
    }
  }, [activeEntity?.id]);

  useEffect(() => {
    if (!activeEntity?.id) return;
    fetchStaffList();
  }, [activeEntity?.id, fetchStaffList]);

  useEffect(() => {
    if (!activeEntity?.id) return;
    
    // Skip fetchLeads if handlePageChange is currently fetching (prevents duplicate calls)
    if (isPageChangeFetchingRef.current) {
      isPageChangeFetchingRef.current = false; // Reset flag
      fetchLeadSourceOptions(); // Still fetch lead source options
      return;
    }
    
    fetchLeads();
    fetchLeadSourceOptions();
  }, [activeEntity?.id, filters, assignmentFilter, fetchLeads, fetchLeadSourceOptions]);

  // Handle lead selection when leads update - ONLY when selectedLead=true in URL
  // SINGLE PLACE for all selection logic - no duplicates
  useEffect(() => {
    // Check if selectedLead=true is in URL
    const urlParams = new URLSearchParams(window.location.search);
    const selectedLeadInUrl = urlParams.get('selectedLead') === 'true';
    const leadIdInUrl = urlParams.get('leadId');
    
    // Only execute if selectedLead=true is in URL
    if (!selectedLeadInUrl) {
      // Clear direction if selectedLead is not in URL
      if (paginationDirectionRef.current) {
        paginationDirectionRef.current = null;
        setPaginationDirection(null);
      }
      return;
    }

    if (!leads || leads.length === 0) return;

    try {
      // Check if direction exists (from ref/state, NOT from URL)
      

      // PRIORITY 2: If there's a leadId in URL, check if it exists in current leads
      if (leadIdInUrl) {
        // Skip if this is the same lead we just selected
       
        
        const leadExists = leads.some(lead => lead._id === leadIdInUrl);
        if (leadExists) {
          // Lead exists in current page - select it
          const lead = leads.find(l => l._id === leadIdInUrl);
          if (lead) {
            lastSelectedLeadIdRef.current = lead._id;
            onLeadSelected(lead);
          }
          return;
        }
        // Lead doesn't exist in current page - clear it
        const params = new URLSearchParams(window.location.search);
        params.delete('leadId');
        replaceUrl(`/dealer/leads?${params.toString()}`);
        lastSelectedLeadIdRef.current = null;
        // Fall through to PRIORITY 3
      }

      // PRIORITY 3: No leadId in URL and no direction - select first lead (initial load)
     
    } catch (err) {
      // Error auto-selecting lead
    }
  }, [leads, paginationDirection, onLeadSelected, pagination.currentPage]);

  const exportToCSV = async () => {
    try {
      let url = `/api/leads?format=csv&dealer_id=${activeEntity.id}`;
      
      // Add applied filters to export URL
      if (filters.q) url += `&q=${encodeURIComponent(filters.q)}`;
    if (filters.name) url += `&name=${encodeURIComponent(filters.name)}`;
      if (filters.email) url += `&email=${encodeURIComponent(filters.email)}`;
      if (filters.phone) url += `&phone=${encodeURIComponent(filters.phone)}`;
      if (filters.status) url += `&fe_lead_status=${encodeURIComponent(filters.status)}`;
      if (filters.stopped) url += '&stopped=1';
      if (filters.messages) url += `&messages=${encodeURIComponent(filters.messages)}`;
      if ((filters.messages || filters.message_filter === 'unread') && filters.messagesChannel) url += `&channel=${encodeURIComponent(filters.messagesChannel)}`;
      if (filters.status === 'Contacted' && filters.repliedBy) url += `&replied_by=${encodeURIComponent(filters.repliedBy)}`;
      if (filters.sort) url += `&sort=${encodeURIComponent(filters.sort)}`;
      url += drillQuery(filters);
      if (filters.lead_source) url += `&lead_source=${encodeURIComponent(filters.lead_source)}`;
      if (filters.department) url += `&department=${encodeURIComponent(filters.department)}`;
      if (filters.owner) url += `&owner=${encodeURIComponent(filters.owner)}`;
      if (filters.source) url += `&source=${encodeURIComponent(filters.source)}`;
      if (filters.dateRange.startDate) url += `&startDate=${filters.dateRange.startDate.toISOString()}`;
      if (filters.dateRange.endDate) url += `&endDate=${filters.dateRange.endDate.toISOString()}`;

      // Fetch with Authorization header
      const token = localStorage.getItem('dealertoken');
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          showAlert("Unauthorized. Please log in again.", "danger");
        } else {
          showAlert("Failed to export leads", "danger");
        }
        return;
      }

      // Get CSV content
      const csvContent = await response.text();
      
      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `leads_export_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("Export error:", error);
      showAlert("Failed to export leads", "danger");
    }
  };

  // The list's own filters as a query string (the same parameters fetchLeadsForPage sends, without page / limit):
  // "All leads matching your filters" asks /api/leads?format=ids with exactly these.
  const listFilterQuery = () => {
    let q = `dealer_id=${activeEntity.id}`;
    if (assignmentFilter && assignmentFilter !== 'all') q += `&assignment=${assignmentFilter}`;
    if (filters.q) q += `&q=${encodeURIComponent(filters.q)}`;
    if (filters.name) q += `&name=${encodeURIComponent(filters.name)}`;
    if (filters.email) q += `&email=${encodeURIComponent(filters.email)}`;
    if (filters.phone) q += `&phone=${encodeURIComponent(filters.phone)}`;
    if (filters.status) q += `&fe_lead_status=${encodeURIComponent(filters.status)}`;
    if (filters.stopped) q += '&stopped=1';
    if (filters.lead_source) q += `&lead_source=${encodeURIComponent(filters.lead_source)}`;
    if (filters.department) q += `&department=${encodeURIComponent(filters.department)}`;
    if (filters.owner) q += `&owner=${encodeURIComponent(filters.owner)}`;
    if (filters.source) q += `&source=${encodeURIComponent(filters.source)}`;
    if (filters.message_filter) q += `&message_filter=${encodeURIComponent(filters.message_filter)}`;
    if (filters.messages) q += `&messages=${encodeURIComponent(filters.messages)}`;
    if ((filters.messages || filters.message_filter === 'unread') && filters.messagesChannel) q += `&channel=${encodeURIComponent(filters.messagesChannel)}`;
    if (filters.status === 'Contacted' && filters.repliedBy) q += `&replied_by=${encodeURIComponent(filters.repliedBy)}`;
    if (filters.sort) q += `&sort=${encodeURIComponent(filters.sort)}`;
    q += drillQuery(filters);
    if (filters.dateRange.startDate) q += `&startDate=${filters.dateRange.startDate.toISOString()}`;
    if (filters.dateRange.endDate) q += `&endDate=${filters.dateRange.endDate.toISOString()}`;
    return q;
  };
  const filtersActive = Boolean(filters.q || filters.name || filters.email || filters.phone || filters.status || filters.lead_source
    || filters.department || filters.owner || filters.source || filters.message_filter || filters.messages || filters.stopped
    || filters.replyCohort || filters.apptAttribution || filters.reportKpi || filters.dateRange.startDate
    || (assignmentFilter && assignmentFilter !== 'all'));
  const lightRow = (l) => ({ _id: String(l._id), name: l.name || null, owner: l.assigned_to?.name || null,
    status: l.fe_lead_status || null, department: l.department || null, lead_source: l.lead_source || null,
    campaign: l.campaign || null, sub_source: l.sub_source || null, contact_type: l.contact_type || null });
  const [bulkExporting, setBulkExporting] = useState(false);
  const bulkAction = async (kind) => {
    if (kind !== 'export') { setBulkPanel(kind); return; }
    setBulkExporting(true);
    try { await exportBulk(dealerParent?.id || activeEntity?.id, [...selected.keys()]); }
    catch (e) { showAlert(e.message || 'Export failed', 'danger'); }
    finally { setBulkExporting(false); }
  };

  // Every lead matching the filters, in the list's order (one call, capped at 2,000 by the API).
  const loadMatching = async () => {
    const key = listFilterQuery();
    if (matching.leads && matching.key === key) return matching.leads;
    setScopeLoading(true);
    try {
      const res = await fetch(`/api/leads?format=ids&${key}`, { headers: { Authorization: `Bearer ${localStorage.getItem('dealertoken')}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Could not load the leads');
      setMatching({ total: data.total || 0, capped: Boolean(data.capped), leads: data.leads || [], key });
      return data.leads || [];
    } finally {
      setScopeLoading(false);
    }
  };
  const selectScope = async (kind, a, b) => {
    try {
      let rows;
      if (kind === 'page') rows = leads.map(lightRow);
      else {
        const all = await loadMatching();
        const per = pagination.itemsPerPage || 10;
        rows = kind === 'first' ? all.slice(0, a) : kind === 'pages' ? all.slice((a - 1) * per, b * per) : all;
      }
      setSelected(new Map(rows.map((r) => [r._id, r])));
      setScope(kind);
      setUnticked(0);
    } catch (e) {
      showAlert(e.message || 'Could not select the leads', 'danger');
    }
  };
  const startSelecting = () => {
    setSelectMode(true);
    setBulkResult(null);
    selectScope(filtersActive ? 'all' : 'page');
  };
  const stopSelecting = () => {
    setSelectMode(false);
    setSelected(new Map());
    setUnticked(0);
    setBulkPanel(null);
  };
  const toggleLead = (lead) => {
    const id = String(lead._id);
    setSelected((cur) => {
      const next = new Map(cur);
      if (next.has(id)) {
        next.delete(id);
        if (scope !== 'manual') setUnticked((n) => n + 1);
      } else {
        next.set(id, lightRow(lead));
        if (scope !== 'manual') setScope('manual');
      }
      return next;
    });
  };
  const dropLead = (id) => {
    setSelected((cur) => { const next = new Map(cur); next.delete(id); return next; });
    if (scope !== 'manual') setUnticked((n) => n + 1);
  };
  // "Filters on": each applied filter as a chip; its x clears that filter only (the same way the field does).
  const FILTER_CHIPS = [
    ['q', 'Search'], ['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['status', 'Status'], ['lead_source', 'Lead source'],
    ['department', 'Department'], ['owner', 'Assigned to'], ['source', 'Source type'], ['message_filter', 'Messages'],
  ];
  const filterChips = [
    ...FILTER_CHIPS.filter(([key]) => filters[key]).map(([key, label]) => ({ key, text: `${label}: ${key === 'status' ? statusLabel(filters[key]) : key === 'source' ? (UP_TYPE_OPTIONS.find(([v]) => v === filters[key])?.[1] || filters[key]) : key === 'department' ? (DEPT_TABS.find(([v]) => v === filters[key])?.[1] || filters[key]) : key === 'owner' ? (staffList.find((st) => String(st._id) === filters[key])?.name || 'Staff member') : filters[key]}` })),
    ...(filters.dateRange.startDate ? [{ key: 'dateRange', text: `Dates: ${moment(filters.dateRange.startDate).format('MMM D')} – ${moment(filters.dateRange.endDate || filters.dateRange.startDate).format('MMM D, YYYY')}` }] : []),
    ...(filters.stopped ? [{ key: 'stopped', text: 'Stopped' }] : []),
  ];
  const clearChip = (key) => {
    if (key === 'dateRange') handleDateRangeChange({ startDate: null, endDate: null });
    else if (key === 'stopped') setFilters((prev) => ({ ...prev, stopped: '', page: 1 }));
    else setInputValues((prev) => ({ ...prev, [key]: '' }));
  };
  const bulkSaved = (result) => {
    setBulkPanel(null);
    setBulkResult(result);
    setSelectMode(false);
    setSelected(new Map());
    setUnticked(0);
    setMatching({ total: 0, capped: false, leads: null, key: null });
    fetchLeads();
  };
  const bulkUndo = async (batchId) => {
    // Lead details saves one change per field: Undo takes them all back.
    const batches = bulkResult?.batchId === batchId && bulkResult.batchIds?.length ? bulkResult.batchIds : [batchId];
    const res = { restored: 0, changed_since: 0, failed: 0, reasons: [] };
    for (const id of batches) {
      const one = await undoBulk(id);
      res.action = one.action; res.restored = Math.max(res.restored, one.restored || 0); res.changed_since += one.changed_since || 0;
      res.failed += one.failed || 0; res.reasons.push(...(one.reasons || []));
    }
    setBulkResult((r) => (r && r.batchId === batchId ? { ...r, undone: res } : r));
    fetchLeads();
    return res;
  };
  const bulkRetry = (result) => {
    const byId = new Map((result.failed || []).map((f) => [f.lead_id, { _id: f.lead_id, name: f.name || null, owner: null, status: null }]));
    setBulkResult(null);
    setSelectMode(true);
    setSelected(new Map(result.retryIds.map((id) => [id, byId.get(id) || { _id: id, name: null }])));
    setScope('manual');
    setUnticked(0);
    setBulkPanel(result.kind);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setInputValues(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const replaceUrl = (url) => {
    try {
      window.history.replaceState(window.history.state, '', url);
    } catch (e) {
      // fallback
    }
  };

  const applyFilters = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const textKeys = ['q', 'name', 'email', 'phone', 'status', 'lead_source', 'department', 'owner', 'source', 'message_filter'];
    textKeys.forEach(key => {
      if (inputValues[key]) params.set(key, inputValues[key]);
      else params.delete(key);
    });
    if (filters.dateRange.startDate) params.set('startDate', filters.dateRange.startDate.toISOString());
    else params.delete('startDate');
    if (filters.dateRange.endDate) params.set('endDate', filters.dateRange.endDate.toISOString());
    else params.delete('endDate');
    params.set('page', '1');

    replaceUrl(`/dealer/leads?${params.toString()}`);

    setFilters(prev => ({
      ...prev,
      q: inputValues.q,
      name: inputValues.name,
      email: inputValues.email,
      phone: inputValues.phone,
      status: inputValues.status,
      lead_source: inputValues.lead_source,
      department: inputValues.department,
      owner: inputValues.owner,
      source: inputValues.source,
      message_filter: inputValues.message_filter,
      page: 1
    }));
  }, [inputValues, filters.dateRange]);

  const handleSearch = () => {
    clearTimeout(searchDebounceRef.current);
    applyFilters();
  };

  // Auto-filter as the user types/selects, instead of requiring the Search button
  // click. Skips the initial mount so it doesn't re-apply the filters already
  // seeded from the URL on load. Watches the individual text/select fields (not
  // applyFilters itself) so a dateRange-only change - handled separately by
  // handleDateRangeChange - doesn't also trigger a redundant debounced re-fetch.
  const isFirstInputRender = useRef(true);
  const searchDebounceRef = useRef(null);
  useEffect(() => {
    if (isFirstInputRender.current) {
      isFirstInputRender.current = false;
      return;
    }
    searchDebounceRef.current = setTimeout(() => {
      applyFilters();
    }, 400);
    return () => clearTimeout(searchDebounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    inputValues.q,
    inputValues.name,
    inputValues.email,
    inputValues.phone,
    inputValues.status,
    inputValues.lead_source,
    inputValues.department,
    inputValues.owner,
    inputValues.source,
    inputValues.message_filter,
  ]);

  const handleDateRangeChange = ({ startDate, endDate }) => {
    const params = new URLSearchParams(window.location.search);
    if (startDate) params.set('startDate', startDate.toISOString());
    else params.delete('startDate');
    if (endDate) params.set('endDate', endDate.toISOString());
    else params.delete('endDate');
    params.set('page', '1');

    replaceUrl(`/dealer/leads?${params.toString()}`);

    setFilters({
      ...filters,
      dateRange: { startDate, endDate },
      page: 1
    });
  };

  // The × on a dashboard drill chip: drop that filter only (URL and list).
  const clearDrill = (param) => {
    const params = new URLSearchParams(window.location.search);
    const keys = DRILL_KEYS[param] || [];
    for (const [p, key] of Object.entries(REPORT_PARAMS)) if (keys.includes(key)) params.delete(p);
    params.delete(param);
    params.set('page', '1');
    replaceUrl(`/dealer/leads?${params.toString()}`);
    setFilters((prev) => ({ ...prev, ...Object.fromEntries(keys.map((key) => [key, ''])), page: 1 }));
  };

  const clearFilters = () => {
    clearTimeout(searchDebounceRef.current);
    setInputValues({
      q: "",
      name: "",
      email: "",
      phone: "",
      status: "",
      lead_source: "",
      department: "",
      owner: "",
      source: "",
      message_filter: ""
    });
    const newFilters = {
      q: "",
      name: "",
      email: "",
      phone: "",
      status: "",
      lead_source: "",
      department: "",
      owner: "",
      source: "",
      message_filter: "",
      dateRange: {
        startDate: null,
        endDate: null
      },
      page: 1
    };
    setFilters(newFilters);
    
    const params = new URLSearchParams();
    if (assignmentFilter && assignmentFilter !== 'all') {
      params.set('assignment', assignmentFilter);
    }
    const query = params.toString();
    replaceUrl(`/dealer/leads${query ? `?${query}` : ''}`);
  };

  // Helper function to handle lead click and update URL with selectedLead=true and leadId
  const handleLeadClick = useCallback(async (lead) => {
    // Bibi, 25 Nov 2026: from the Dashboard's Customer Replied numbers, a lead opens on its customer's profile, on that
    // lead's conversation (Leads & Communications), to read the reply there. Back returns to this list.
    const cameFrom = backFor(window.location);
    if (cameFrom?.back === '/dealer/dashboard' && new URLSearchParams(window.location.search).get('status') === 'Contacted'
      && lead?.customer_id) {
      router.push(`/dealer/customers/${lead.customer_id}?tab=leads&lead=${lead._id}`);
      return;
    }
    // Clear the direction flag since this is a manual click
    justHandledDirectionRef.current = false;
    
    // Clear direction from ref and state (manual click overrides direction)
    paginationDirectionRef.current = null;
    setPaginationDirection(null);
    
    const params = new URLSearchParams(window.location.search);
    params.set('selectedLead', 'true');
    params.set('leadId', lead._id);
    // Remove direction from URL since this is a manual click
    params.delete('direction');
    replaceUrl(`/dealer/leads?${params.toString()}`);
    lastSelectedLeadIdRef.current = lead._id; // Track this selection
    
    // Mark all messages for this lead as read
    if (lead?._id) {
      try {
        const token = localStorage.getItem('dealertoken');
        await fetch('/api/conversations/mark-read', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ lead_id: lead._id })
        });
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    }
    
    onLeadSelected(lead);
  }, [onLeadSelected, router]);

  // Function to clear selectedLead from URL (close sidebar)
  const clearSelectedLead = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete('selectedLead');
    params.delete('leadId');
    params.delete('direction');
    replaceUrl(`/dealer/leads?${params.toString()}`);
    lastSelectedLeadIdRef.current = null;
    paginationDirectionRef.current = null;
    setPaginationDirection(null);
  }, []);

   const handlePageChange = async (page) => {
    if (page < 1) return;
    
    // Get direction from ref or state (NOT from URL - we don't store it in URL anymore)
    let direction = paginationDirectionRef.current || paginationDirection;
    
    // If no direction is set but selectedLead=true is in URL, determine direction from page change
    if (!direction) {
      const urlParams = new URLSearchParams(window.location.search);
      const selectedLeadInUrl = urlParams.get('selectedLead') === 'true';
      
      if (selectedLeadInUrl) {
        // Determine direction based on page change
        if (page > pagination.currentPage) {
          direction = "next";
        } else if (page < pagination.currentPage) {
          direction = "prev";
        }
        
        // Store detected direction in ref and state (NOT in URL)
        if (direction) {
          paginationDirectionRef.current = direction;
          setPaginationDirection(direction);
        }
      }
    }
    
    // Reset tracking when page changes (unless it's a direction-based change)
    if (!direction) {
      lastSelectedLeadIdRef.current = null;
    }
    
    // Update URL FIRST - NO direction in URL, just page and selectedLead
    const params = new URLSearchParams(window.location.search);
    
    // Preserve filters
    if (filters.q) params.set('q', filters.q);
    else params.delete('q');
    if (filters.name) params.set('name', filters.name);
    else params.delete('name');
    if (filters.email) params.set('email', filters.email);
    else params.delete('email');
    if (filters.phone) params.set('phone', filters.phone);
    else params.delete('phone');
    if (filters.status) params.set('status', filters.status);
    else params.delete('status');
    if (filters.lead_source) params.set('lead_source', filters.lead_source);
    else params.delete('lead_source');
    if (filters.owner) params.set('owner', filters.owner);
    else params.delete('owner');
    if (filters.department) params.set('department', filters.department);
    else params.delete('department');
    if (filters.source) params.set('source', filters.source);
    else params.delete('source');
    if (filters.message_filter) params.set('message_filter', filters.message_filter);
    else params.delete('message_filter');
    if (filters.dateRange.startDate) params.set('startDate', filters.dateRange.startDate.toISOString());
    else params.delete('startDate');
    if (filters.dateRange.endDate) params.set('endDate', filters.dateRange.endDate.toISOString());
    else params.delete('endDate');
    
    // Always set page number
    params.set('page', page);
    
    // If selectedLead=true, remove old leadId (new one will be set after leads load)
    if (params.get('selectedLead') === 'true') {
      params.delete('leadId');
      params.delete('direction');
    }
    
    // Update URL (NO direction in URL)
    const newUrl = `/dealer/leads?${params.toString()}`;
    replaceUrl(newUrl);
    
    // Set flag FIRST to prevent useEffect from calling fetchLeads
    isPageChangeFetchingRef.current = true;
    
    // Update pagination state
    setPagination(prev => ({ ...prev, currentPage: page }));
    
    // Update filters with new page (useEffect will see flag and skip fetchLeads)
    const newFilters = {
      ...filters,
      page
    };
    setFilters(newFilters);
    
    // NOW: Fetch leads directly for this page and select lead based on direction
    try {
      setLoading(true);
      
      // Build query parameters including page
      let queryParams = `dealer_id=${activeEntity.id}&page=${page}&limit=${pagination.itemsPerPage}${compact ? '&preview=1' : ''}`;
      
      // Add assignment filter (only when not 'all')
      if (assignmentFilter && assignmentFilter !== 'all') {
        queryParams += `&assignment=${assignmentFilter}`;
      }
      
      // Add filters to query
      if (filters.q) queryParams += `&q=${encodeURIComponent(filters.q)}`;
    if (filters.name) queryParams += `&name=${encodeURIComponent(filters.name)}`;
      if (filters.email) queryParams += `&email=${encodeURIComponent(filters.email)}`;
      if (filters.phone) queryParams += `&phone=${encodeURIComponent(filters.phone)}`;
      if (filters.status) queryParams += `&fe_lead_status=${encodeURIComponent(filters.status)}`;
      if (filters.stopped) queryParams += '&stopped=1';
      if (filters.lead_source) queryParams += `&lead_source=${encodeURIComponent(filters.lead_source)}`;
      if (filters.department) queryParams += `&department=${encodeURIComponent(filters.department)}`;
      if (filters.owner) queryParams += `&owner=${encodeURIComponent(filters.owner)}`;
      if (filters.source) queryParams += `&source=${encodeURIComponent(filters.source)}`;
      if (filters.message_filter) queryParams += `&message_filter=${encodeURIComponent(filters.message_filter)}`;
      if (filters.messages) queryParams += `&messages=${encodeURIComponent(filters.messages)}`;
      if ((filters.messages || filters.message_filter === 'unread') && filters.messagesChannel) queryParams += `&channel=${encodeURIComponent(filters.messagesChannel)}`;
      if (filters.status === 'Contacted' && filters.repliedBy) queryParams += `&replied_by=${encodeURIComponent(filters.repliedBy)}`;
      if (filters.sort) queryParams += `&sort=${encodeURIComponent(filters.sort)}`;
      queryParams += drillQuery(filters);
      if (filters.dateRange.startDate) queryParams += `&startDate=${filters.dateRange.startDate.toISOString()}`;
      if (filters.dateRange.endDate) queryParams += `&endDate=${filters.dateRange.endDate.toISOString()}`;
      
      const res = await fetch(`/api/leads?${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || "Failed to fetch leads");
      
      const newLeads = data.data || [];
      const newCurrentPage = data.pagination?.currentPage || page;
      setDrill(data.drill || null);
      
      setLeads(newLeads);
      setPagination({
        currentPage: newCurrentPage,
        totalPages: data.pagination?.totalPages || 1,
        totalItems: data.pagination?.totalItems || 0,
        itemsPerPage: data.pagination?.itemsPerPage || 10,
        hasNextPage: data.pagination?.hasNextPage || false,
        hasPreviousPage: data.pagination?.hasPreviousPage || false
      });
      
      setPageInputValue(newCurrentPage.toString());
      
      // IMMEDIATELY select lead based on direction (if exists and selectedLead=true)
      // Use the NEW leads array that was just fetched for this page
      const urlParams = new URLSearchParams(window.location.search);
      const selectedLeadInUrl = urlParams.get('selectedLead') === 'true';
      const currentDirection = paginationDirectionRef.current || paginationDirection;
      
      if (selectedLeadInUrl && currentDirection && newLeads.length > 0) {
        let leadToSelect;
        if (currentDirection === "prev") {
          leadToSelect = newLeads[newLeads.length - 1]; // Last lead of NEW page
        } else {
          leadToSelect = newLeads[0]; // First lead of NEW page
        }
        
        if (leadToSelect) {
          // Update URL with leadId from NEW page
          const finalParams = new URLSearchParams(window.location.search);
          finalParams.set('selectedLead', 'true');
          finalParams.set('leadId', leadToSelect._id);
          finalParams.set('page', newCurrentPage.toString());
          finalParams.delete('direction');
          replaceUrl(`/dealer/leads?${finalParams.toString()}`);
          
          // Mark all messages for this lead as read
          if (leadToSelect?._id) {
            try {
              const token = localStorage.getItem('dealertoken');
              await fetch('/api/conversations/mark-read', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ lead_id: leadToSelect._id })
              });
              // Silently mark as read
            } catch (error) {
              console.error('Error marking messages as read:', error);
            }
          }
          
          // Select the lead from NEW page
          lastSelectedLeadIdRef.current = leadToSelect._id;
          onLeadSelectedRef.current(leadToSelect);
          
          // Clear direction after selection
          paginationDirectionRef.current = null;
          setPaginationDirection(null);
        }
      } else if (selectedLeadInUrl && !currentDirection) {
        // If selectedLead=true but no direction, clear any stale direction
        if (paginationDirectionRef.current || paginationDirection) {
          paginationDirectionRef.current = null;
          setPaginationDirection(null);
        }
      }
      
      setLoading(false);
      isPageChangeFetchingRef.current = false; // Reset flag after successful fetch
    } catch (err) {
      showAlert("Failed to load leads", "danger");
      setLoading(false);
      isPageChangeFetchingRef.current = false; // Reset flag on error
    }
  };

  const handleShowDetails = (lead) => {
    // Only open details sidebar, close viewConversations if open
    // Clear viewConversations URL params to close it
    const params = new URLSearchParams(window.location.search);
    if (params.get('selectedLead') === 'true') {
      params.delete('selectedLead');
      params.delete('leadId');
      params.delete('direction');
      replaceUrl(`/dealer/leads?${params.toString()}`);
      // Also call onLeadSelected with null to close viewConversations in parent
      if (onLeadSelected) {
        onLeadSelected(null);
      }
    }
    setSelectedLead(lead);
    setShowDetails(true);
  };

  const handleCloseDetails = () => {
    setShowDetails(false);
    setSelectedLead(null);
  };

  const handleLeadUpdated = (updatedLead) => {
    setLeads(prev => prev.map(l => 
      l._id === updatedLead._id ? { ...l, ...updatedLead } : l
    ));
  };

  const handleShowDeleteModal = (lead) => {
    setSelectedLead(lead);
    setShowDeleteModal(true);
  };

  const handleAssignmentChange = async (leadId, assignedToId) => {
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('dealertoken')}` },
        body: JSON.stringify({ assigned_to: assignedToId || null })
      });

      if (res.ok) {
        // Undo a reassignment (BB, 14 Nov 2026): one click puts the lead back with whoever had it.
        showAlert(<span className="d-inline-flex align-items-center flex-wrap gap-2">Lead assignment updated.
          <Button size="sm" variant="outline-success" className="py-0" onClick={() => undoReassign(leadId)}>
            <i className="fa-solid fa-rotate-left me-1" />Undo</Button></span>, 'success');
        fetchLeads(); // Refresh leads
      } else {
        showAlert('Failed to update assignment', 'danger');
      }
    } catch (err) {
      showAlert('Error updating assignment', 'danger');
    }
  };

  const undoReassign = async (leadId) => {
    try {
      const res = await fetch(`/api/leads/${leadId}/undo-reassign`, { method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('dealertoken')}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not undo');
      showAlert(`Undone - the lead is back with ${data.name || 'nobody (unassigned)'}.`, 'success');
      fetchLeads();
    } catch (err) { showAlert(err.message, 'danger'); }
  };

  const handleCloseDeleteModal = () => {
    setShowDeleteModal(false);
    setSelectedLead(null);
  };

  const handleImportSuccess = () => {
    fetchLeads();
    setShowImportModal(false);
    showAlert("Leads imported successfully");
  };

  const handleDelete = async () => {
    if (!selectedLead) return;

    try {
      const response = await fetch("/api/leads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('dealertoken')}` },
        body: JSON.stringify({ id: selectedLead._id }),
      });

      if (!response.ok) throw new Error("Failed to delete lead");

      setLeads(prev => prev.filter(l => l._id !== selectedLead._id));
      showAlert("Lead deleted successfully");
      handleCloseDeleteModal();

      // Refresh leads
      if (leads.length === 1 && pagination.currentPage > 1) {
        setPagination(prev => ({ ...prev, currentPage: prev.currentPage - 1 }));
      } else {
        fetchLeads();
      }
    } catch (err) {
      showAlert("Failed to delete lead", "danger");
    }
  };

  const handleStatusChange = async (newStatus, extra = {}) => {
    if (!selectedLead) return;

    try {
      const payload = { id: selectedLead._id, status: newStatus, ...extra };
      const response = await fetch("/api/conversations/lead/status", {
        method: "PUT",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${localStorage.getItem('dealertoken')}` },
        body: JSON.stringify(payload),
      });

      // A full slot keeps the modal open with "Book {next available}" (stream R, app/lib/bookingConflict.js).
      await throwIfStatusFailed(response, extra);

      setLeads(prev => prev.map(l =>
        l._id === selectedLead._id ? { ...l, fe_lead_status: newStatus } : l
      ));
      showAlert("Status updated successfully");
      setShowStatusModal(false);
    } catch (err) {
      if (err?.slotConflict) throw err; // shown in the StatusModal (stream R)
      showAlert(err?.message || "Failed to update status", "danger");
    }
  };

  const createPaginationItems = () => {
    const items = [];
    const { totalPages, currentPage } = pagination;

    const addPageItem = (page) => {
      items.push(
        <Pagination.Item
          key={page}
          active={page === currentPage}
          onClick={() => handlePageChange(page)}
        >
          {page}
        </Pagination.Item>
      );
    };

    const addEllipsis = (key) => {
      items.push(
        <Pagination.Item key={key} disabled className="disabled">
          &hellip;
        </Pagination.Item>
      );
    };

    // Always show first 2 pages
    addPageItem(1);
    if (totalPages >= 2) addPageItem(2);

    // Show ellipsis if currentPage is beyond page 4
    if (currentPage > 3) {
      addEllipsis("start-ellipsis");
    }

    // Show currentPage neighbors if not near start or end
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 2, currentPage + 1);

    for (let i = start; i <= end; i++) {
      if (i > 2 && i < totalPages - 1) {
        addPageItem(i);
      }
    }

    // Show ellipsis if currentPage is before totalPages - 3
    if (currentPage < totalPages - 3) {
      addEllipsis("end-ellipsis");
    }

    // Always show last 2 pages
    if (totalPages > 3) addPageItem(totalPages - 1);
    if (totalPages > 2) addPageItem(totalPages);

    return items;
  };

useImperativeHandle(ref, () => ({
  async moveToNextLead(currentLead) {
    const idx = leads.findIndex(l => l._id === currentLead._id);
    
    if (idx < leads.length - 1) {
      // Same page - use handleLeadClick
      handleLeadClick(leads[idx + 1]);
    } else if (pagination.hasNextPage) {
      // Cross page - fetch next page leads first, then select first lead
      const nextPage = pagination.currentPage + 1;
      try {
        isPageChangeFetchingRef.current = true;
        setLoading(true);
        
        // Fetch leads for next page FIRST
        const result = await fetchLeadsForPage(nextPage);
        const newLeads = result.leads;
        
        if (newLeads.length === 0) {
          isPageChangeFetchingRef.current = false;
          setLoading(false);
          return;
        }
        
        // Select first lead of new page
        const firstLead = newLeads[0];
        
        // Update URL with page only (handleLeadClick will set leadId and selectedLead)
        const params = new URLSearchParams(window.location.search);
        params.set('page', nextPage.toString());
        // Preserve selectedLead if it exists (handleLeadClick will set leadId)
        if (params.get('selectedLead') === 'true') {
          // Keep selectedLead, but remove old leadId (handleLeadClick will set new one)
          params.delete('leadId');
        }
        params.delete('direction');
        replaceUrl(`/dealer/leads?${params.toString()}`);
        
        // Update state
        setPagination(prev => ({ ...prev, currentPage: nextPage }));
        setFilters(prev => ({ ...prev, page: nextPage }));
        
        setLeads(newLeads);
        setPagination({
          currentPage: result.currentPage,
          totalPages: result.pagination?.totalPages || 1,
          totalItems: result.pagination?.totalItems || 0,
          itemsPerPage: result.pagination?.itemsPerPage || 10,
          hasNextPage: result.pagination?.hasNextPage || false,
          hasPreviousPage: result.pagination?.hasPreviousPage || false
        });
        
        // handleLeadClick will set leadId in URL
        handleLeadClick(firstLead);
        
        isPageChangeFetchingRef.current = false;
      } catch (err) {
        isPageChangeFetchingRef.current = false;
        setLoading(false);
      }
    }
  },
  async moveToPrevLead(currentLead) {
    const idx = leads.findIndex(l => l._id === currentLead._id);
    
    if (idx > 0) {
      handleLeadClick(leads[idx - 1]);
    } else if (pagination.hasPreviousPage) {
      const prevPage = pagination.currentPage - 1;
      
      try {
        isPageChangeFetchingRef.current = true;
        setLoading(true);
        
        const result = await fetchLeadsForPage(prevPage);
        const newLeads = result.leads;
        
        if (newLeads.length === 0) {
          isPageChangeFetchingRef.current = false;
          setLoading(false);
          return;
        }
        
        const lastLead = newLeads[newLeads.length - 1];
        
        const params = new URLSearchParams(window.location.search);
        params.set('page', prevPage.toString());
        if (params.get('selectedLead') === 'true') {
          params.delete('leadId');
        }
        params.delete('direction');
        replaceUrl(`/dealer/leads?${params.toString()}`);
        
        setPagination(prev => ({ ...prev, currentPage: prevPage }));
        setFilters(prev => ({ ...prev, page: prevPage }));
        
        setLeads(newLeads);
        setPagination({
          currentPage: result.currentPage,
          totalPages: result.pagination?.totalPages || 1,
          totalItems: result.pagination?.totalItems || 0,
          itemsPerPage: result.pagination?.itemsPerPage || 10,
          hasNextPage: result.pagination?.hasNextPage || false,
          hasPreviousPage: result.pagination?.hasPreviousPage || false
        });
        
        handleLeadClick(lastLead);
        
        isPageChangeFetchingRef.current = false;
      } catch (err) {
        console.error('Error in moveToPrevLead:', err);
        isPageChangeFetchingRef.current = false;
        setLoading(false);
      }
    }
  },
  clearSelectedLead() {
    clearSelectedLead();
  }
}), [leads, pagination, handleLeadClick, fetchLeadsForPage, clearSelectedLead]);


  // Only the first load replaces the page. Later loads (typing in a search box, changing a filter) keep the filters on
  // screen, so the box keeps its cursor and what was typed (Betsy, 25 Nov 2026: typing a phone number refreshed the page
  // after three digits and she had to click back into the box).
  if (loading && !shownOnce.current) {
    return (
      <div className="w_card">
        <div className="text-center py-4">Loading leads...</div>
      </div>
    );
  }
  if (!loading) shownOnce.current = true;

  return (
    <>
      {alert.show && (
        <Alert variant={alert.variant} onClose={() => setAlert({ ...alert, show: false })} dismissible>
          {alert.message}
        </Alert>
      )}

      <div className="w_card">
        {drill?.filters?.length > 0 && (
          // From the dashboard's "Customer replies by lead age" / "Appointments made" (admins): the leads behind the
          // number; the note says who is counted there but not listed.
          <div className="mb-3">
            {drill.filters.map((f) => (
              <div key={f.param} className="mb-1">
                <Badge bg="light" text="dark" className="border d-inline-flex align-items-center gap-2 py-2 px-2">
                  <span>{f.label}{drill.range ? ` · ${drillRangeText(drill.range)}` : ''}</span>
                  <button type="button" className="btn-close" style={{ fontSize: '0.6rem' }}
                    aria-label={`Clear ${f.label}`} onClick={() => clearDrill(f.param)} />
                </Badge>
                {f.note && <small className="text-muted d-block mt-1">{f.card_count != null ? `${f.card_count} on the ${f.where || 'dashboard'} · ${f.lead_count} ${f.lead_count === 1 ? 'lead' : 'leads'} listed · ` : ''}{f.note}</small>}
              </div>
            ))}
          </div>
        )}
        {filters.messages === 'sent' && (
          // The Messages card's list by channel (28 Oct 2026 meeting: "how can I see which ones were emails?").
          <div className="d-flex gap-2 mb-3 align-items-center">
            <span className="small text-muted">Messages sent by:</span>
            {[['', 'All'], ['sms', 'SMS'], ['mms', 'MMS'], ['email', 'Email']].map(([value, label]) => (
              <Button key={label} size="sm" className="text-nowrap"
                variant={(filters.messagesChannel || '') === value ? 'custom' : 'outline-custom'}
                onClick={() => setFilters((prev) => ({ ...prev, messagesChannel: value, page: 1 }))}>
                {label}
              </Button>
            ))}
          </div>
        )}
        {filters.message_filter === 'unread' && !filters.messages && (
          // The top bar's mail / chat icons open this (19 Nov 2026): unread customer messages by channel.
          <div className="d-flex gap-2 mb-3 align-items-center">
            <span className="small text-muted">Unread:</span>
            {[['', 'All'], ['sms', 'Texts'], ['email', 'Emails']].map(([value, label]) => (
              <Button key={label} size="sm" className="text-nowrap"
                variant={(filters.messagesChannel || '') === value ? 'custom' : 'outline-custom'}
                onClick={() => setFilters((prev) => ({ ...prev, messagesChannel: value, page: 1 }))}>
                {label}
              </Button>
            ))}
          </div>
        )}
        {filters.status === 'Contacted' && (
          // Betsy, 2 Nov 2026 meeting: "there must be a filter - filter by SMS, filter by email" (a customer who replied
          // both ways is in both).
          <div className="d-flex gap-2 mb-3 align-items-center">
            <span className="small text-muted">Customer replied by:</span>
            {[['', 'All'], ['sms', 'SMS'], ['email', 'Email']].map(([value, label]) => (
              <Button key={label} size="sm" className="text-nowrap"
                variant={(filters.repliedBy || '') === value ? 'custom' : 'outline-custom'}
                onClick={() => setFilters((prev) => ({ ...prev, repliedBy: value, page: 1 }))}>
                {label}
              </Button>
            ))}
          </div>
        )}
        {/* Sort, and Stopped (an extra filter, on or off) beside it; then whose leads, as one segmented control
            (17 Nov 2026: the four buttons overlapped in the narrow list). */}
        <div className="d-flex gap-2 mb-2 align-items-center">
          <span className="small text-muted">Sort:</span>
          <Form.Select size="sm" style={{ flex: '1 1 0', minWidth: 0, maxWidth: 240 }} value={filters.sort || ''}
            onChange={(e) => setFilters((prev) => ({ ...prev, sort: e.target.value, page: 1 }))}>
            <option value="">{filters.status === 'Contacted' ? 'Latest reply first' : 'Newest lead first'}</option>
            <option value="created_desc">Created: newest first</option>
            <option value="created_asc">Created: oldest first</option>
          </Form.Select>
          <Button size="sm" className="text-nowrap ms-auto flex-shrink-0" variant={filters.stopped ? 'danger' : 'outline-secondary'}
            aria-pressed={Boolean(filters.stopped)} title="Leads the AI has stopped messaging"
            onClick={() => setFilters((prev) => ({ ...prev, stopped: prev.stopped ? '' : '1', page: 1 }))}>
            <i className="fa-regular fa-ban me-1"></i>Stopped
          </Button>
        </div>
        {(canManageLeads || canViewAssignedLeads) && (
          <div className={`btn-group mb-3 lead_fltr ${compact ? "w-100" : ""}`} role="group" aria-label="Whose leads">
            {[
              ['all', 'All', 'fa-users', canManageLeads, 'All leads'],
              ['my', 'Mine', 'fa-user', canManageLeads || canViewAssignedLeads, 'My leads'],
              ['unassigned', 'Unassigned', 'fa-user-slash', canManageLeads, 'Unassigned leads'],
            ].filter(([, , , allowed]) => allowed).map(([key, label, icon, , title]) => (
              <Button key={key} size="sm" title={title} aria-pressed={assignmentFilter === key}
                variant={assignmentFilter === key ? 'custom' : 'outline-custom'} onClick={() => setAssignmentAndSync(key)}>
                <i className={`fa-regular ${icon} me-1`}></i>{label}
              </Button>
            ))}
          </div>
        )}
        {/* Sales vs service (24 Nov 2026): the same Department filter, as tabs above the list. */}
        {!compact && (
          <div className="btn-group mb-3 ms-md-2 lead_fltr" role="group" aria-label="Department">
            {DEPT_TABS.map(([key, label, icon]) => (
              <Button key={key || "all"} size="sm" aria-pressed={(inputValues.department || "") === key}
                variant={(inputValues.department || "") === key ? "custom" : "outline-custom"}
                onClick={() => setInputValues((prev) => ({ ...prev, department: key }))}>
                <i className={`fa-solid ${icon} me-1`} aria-hidden="true"></i>{label}
              </Button>
            ))}
          </div>
        )}

      {!compact && (
        <Row className="align-items-center g-0">
          <Col lg={9} md={3} xs={12}>
            <div className="d-flex flex-md-column mb-2">
              <h3 className="w_card_title mb-0 me-2">
                Lead List                
              </h3>
              <p className="mb-0">
                {pagination.totalItems !== undefined && (
                    <small className="text-muted fw-normal">
                      ({pagination.totalItems.toLocaleString()} {pagination.totalItems === 1 ? 'lead' : 'leads'})
                    </small>
                  )}
                {dealerParent && (
                  <small className="ms-2 text-muted"></small>
                )}
              </p>
            </div>
          </Col>
          <Col lg={3} md={9} xs={12}>
            <div className="d-flex justify-content-end align-items-center mb-2">
              {/* One Actions menu (24 Nov 2026) in place of Add Lead / Import CSV / Export CSV: Leads and Bulk. */}
              <Dropdown align="end" className="leads_actions">
                <Dropdown.Toggle size="sm" variant="outline-custom" className="text-nowrap" id="leads-actions">
                  <i className="fa-solid fa-sliders me-1"></i>Actions
                </Dropdown.Toggle>
                <Dropdown.Menu className="leads_actions_menu">
                  <Dropdown.Header>Leads</Dropdown.Header>
                  <Dropdown.Item onClick={() => setEditLead({})}><i className="fa-solid fa-plus"></i>Add lead</Dropdown.Item>
                  <Dropdown.Item onClick={() => setShowImportModal(true)}><i className="fa fa-upload"></i>Import CSV</Dropdown.Item>
                  <Dropdown.Item onClick={exportToCSV} disabled={loading || leads.length === 0}>
                    <i className="fa fa-download"></i>Export CSV
                    <small>{pagination.totalItems.toLocaleString()} with your filters</small>
                  </Dropdown.Item>
                  {(canAssignLeads || canManageLeads) && (
                    <>
                      <Dropdown.Divider />
                      <Dropdown.Header>Bulk</Dropdown.Header>
                      <Dropdown.Item onClick={startSelecting} disabled={selectMode || !leads.length}>
                        <i className="fa-solid fa-list-check"></i><strong>Select leads</strong><small>change many at once</small>
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => router.push('/dealer/leads/bulk-history')}>
                        <i className="fa-solid fa-clock-rotate-left"></i>Bulk history<small>who changed what, undo</small>
                      </Dropdown.Item>
                    </>
                  )}
                </Dropdown.Menu>
              </Dropdown>
            </div>
          </Col>
        </Row>
      )}

      {compact ? (
        <Row className="align-items-center g-0">
          <Col lg={12}>
            {/* Inbox list (27 Nov 2026): the search box stays; the other filters fold behind Filters so the list of
                conversations gets the height. */}
            <Row className={`search_filters gx-1 gy-1${filtersOpen ? "" : " inbox_filters_closed"}`}>
              <Col xxl={12} xl={12} lg={12} md={12} className="d-flex gap-1">
                <Button variant={filtersOpen ? "custom" : "outline-custom"} size="sm" aria-expanded={filtersOpen}
                  onClick={() => setFiltersOpen(!filtersOpen)} title="Status, source, department, dates">
                  <i className="fa-solid fa-filter" aria-hidden="true"></i>
                  {filterChips.length > 0 && <span className="ms-1">{filterChips.length}</span>}
                </Button>
                {/* Bulk actions beside the conversation too (the user, 27 Nov 2026): Select ticks leads in this list. */}
                {(canAssignLeads || canManageLeads) && (
                  <Button variant={selectMode ? "custom" : "outline-custom"} size="sm" aria-pressed={selectMode}
                    title={selectMode ? "Stop selecting" : "Select leads - change many at once"} disabled={!selectMode && !leads.length}
                    onClick={() => (selectMode ? stopSelecting() : startSelecting())}>
                    <i className="fa-solid fa-list-check" aria-hidden="true"></i>
                  </Button>
                )}
                <Form.Control
                  type="search"
                  placeholder="Search name, phone, email or stock #"
                  aria-label="Search name, phone, email or stock number"
                  name="q"
                  value={inputValues.q || ""}
                  onChange={handleInputChange}
                  size="sm"
                />
              </Col>
              <Col xxl={5} xl={5} lg={5} md={5} xs={5}>
                <Form.Select
                  name="status"
                  value={inputValues.status}
                  onChange={handleInputChange}
                  size="sm"
                >
                  <option value="">All Status</option>
                  {statusOptions.map(status => (
                    <option key={status} value={status}>{statusLabel(status)}</option>
                  ))}
                </Form.Select>
              </Col>
              <Col xxl={6} xl={6} lg={6} md={6} xs={6}>
                <Form.Select
                  name="lead_source"
                  value={inputValues.lead_source}
                  onChange={handleInputChange}
                  size="sm"
                >
                  <option value="">All Lead Sources</option>
                  {leadSourceOptions.map(source => (
                    <option key={source} value={source}>{source}</option>
                  ))}
                </Form.Select>
              </Col>
              <Col xxl={6} xl={6} lg={6} md={6} xs={6}>
                <Form.Select name="department" value={inputValues.department || ""} onChange={handleInputChange} size="sm"
                  aria-label="Department">
                  <option value="">All Departments</option>
                  <option value="sales">Sales</option>
                  <option value="service">Service</option>
                  <option value="parts">Parts</option>
                </Form.Select>
              </Col>
              <Col xxl={6} xl={6} lg={6} md={6} xs={6}>
                <Form.Select
                  name="source"
                  value={inputValues.source}
                  onChange={handleInputChange}
                  size="sm"
                >
                  <option value="">All Source Types</option>
                  {UP_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  {inputValues.source && !inputValues.source.startsWith("up:") && <option value={inputValues.source}>{inputValues.source}</option>}
                </Form.Select>
              </Col>
              {/*<Col xxl={6} xl={6} lg={6} md={6} xs={6}>
                <Form.Select
                  name="message_filter"
                  value={inputValues.message_filter}
                  onChange={handleInputChange}
                  size="sm"
                >
                  <option value="">All Messages</option>
                  <option value="unread">Unread Messages</option>
                  <option value="read">Read Messages</option>
                </Form.Select>
              </Col>*/}
              <Col xxl={6} xl={6} lg={6} md={6} xs={6}>
                <DateRangePickerComponent
                  onDateRangeChange={handleDateRangeChange}
                  dateRange={filters.dateRange}
                  timezone={dealerTimezone}
                  className="w-100"
                />
              </Col>
              <Col xxl={6} xl={6} lg={6} md={6} xs={6}>
                <div className="d-flex gap-1">
                  <Button
                    variant="custom"
                    onClick={handleSearch}
                    size="sm"
                    className="w-50"
                  >
                    Search
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={clearFilters}
                    disabled={!inputValues.q && !inputValues.name && !inputValues.email && !inputValues.phone && !inputValues.status && !inputValues.lead_source && !inputValues.source && !filters.dateRange.startDate}
                    size="sm"
                    className="w-50"
                  >
                    Clear
                  </Button>
                </div>
              </Col>
            </Row>
          </Col>
        </Row>
      ) : selectMode ? null : (
        <Row className="align-items-center g-0">
          <Col lg={12}>
            {/* Filter Controls (folded behind a button on phones) */}
            <Button variant="outline-custom" size="sm" className="d-md-none w-100 mb-1" aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((v) => !v)}>
              <i className="fa-solid fa-filter me-1" aria-hidden="true"></i>{filtersOpen ? "Hide filters" : "Search and filter"}
            </Button>
            <Row className={`search_filters gx-1 gy-xxl-0 gy-1${filtersOpen ? "" : " d-none d-md-flex"}`}>
              <Col xxl={3} xl={3} lg={3} md={3} xs={12}>
                <Form.Control
                  type="search"
                  placeholder="Search name, phone, email or stock #"
                  aria-label="Search name, phone, email or stock number"
                  name="q"
                  value={inputValues.q || ""}
                  onChange={handleInputChange}
                  size="sm"
                />
              </Col>
              <Col xxl={1} xl={3} lg={3} md={3} xs={6}>
                <Form.Select
                  name="status"
                  value={inputValues.status}
                  onChange={handleInputChange}
                  size="sm"
                >
                  <option value="">All Status</option>
                  {statusOptions.map(status => (
                    <option key={status} value={status}>{statusLabel(status)}</option>
                  ))}
                </Form.Select>
              </Col>
              <Col xxl={1} xl={3} lg={3} md={3} xs={6}>
                <Form.Select
                  name="lead_source"
                  value={inputValues.lead_source}
                  onChange={handleInputChange}
                  size="sm"
                >
                  <option value="">All Lead Sources</option>
                  {leadSourceOptions.map(source => (
                    <option key={source} value={source}>{source}</option>
                  ))}
                </Form.Select>
              </Col>
              <Col xxl={1} xl={3} lg={3} md={3} xs={6}>
                <Form.Select
                  name="source"
                  value={inputValues.source}
                  onChange={handleInputChange}
                  size="sm"
                >
                  <option value="">All Source Types</option>
                  {UP_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  {inputValues.source && !inputValues.source.startsWith("up:") && <option value={inputValues.source}>{inputValues.source}</option>}
                </Form.Select>
              </Col>
              {canManageLeads && (
                <Col xxl={2} xl={2} lg={2} md={2} xs={6}>
                  <Form.Select name="owner" value={inputValues.owner || ""} onChange={handleInputChange} size="sm"
                    aria-label="Assigned to">
                    <option value="">Anyone (assigned to)</option>
                    {staffList.map((st) => <option key={st._id} value={st._id}>{st.name}</option>)}
                  </Form.Select>
                </Col>
              )}
              <Col xxl={1} xl={2} lg={2} md={2} xs={6}>
                <Form.Select
                  name="message_filter"
                  value={inputValues.message_filter}
                  onChange={handleInputChange}
                  size="sm"
                >
                  <option value="">All Messages</option>
                  <option value="unread">Unread Messages</option>
                  <option value="read">Read Messages</option>
                </Form.Select>
              </Col>
              <Col xxl={1} xl={2} lg={2} md={2} xs={6}>
                <DateRangePickerComponent
                  onDateRangeChange={handleDateRangeChange}
                  dateRange={filters.dateRange}
                  timezone={dealerTimezone}
                  className="w-100"
                />
              </Col>
              <Col xxl={1} xl={2} lg={2} md={2} xs={6}>
                <div className="d-flex gap-1">
                  <Button
                    variant="custom"
                    onClick={handleSearch}
                    size="sm"
                    className="w-50"
                  >
                    Search
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={clearFilters}
                    disabled={!inputValues.q && !inputValues.name && !inputValues.email && !inputValues.phone && !inputValues.status && !inputValues.lead_source && !inputValues.source && !filters.dateRange.startDate}
                    size="sm"
                    className="w-50"
                  >
                    Clear
                  </Button>
                </div>
              </Col>
            </Row>
          </Col>
        </Row>
      )}

        {/* Active filters display */}
        {/* <div className="mt-2 mb-3">
          {Object.entries(filters).some(([key, value]) => 
            (typeof value === 'string' && value) || 
            (typeof value === 'object' && value.startDate)
          ) && (
            <>
              <small className="text-muted me-2">Active filters:</small>
              {filters.name && (
                <Badge bg="light" text="dark" className="me-2">
                  name: {filters.name}
                </Badge>
              )}
              {filters.email && (
                <Badge bg="light" text="dark" className="me-2">
                  email: {filters.email}
                </Badge>
              )}
              {filters.phone && (
                <Badge bg="light" text="dark" className="me-2">
                  phone: {filters.phone}
                </Badge>
              )}
              {filters.status && (
                <Badge bg="light" text="dark" className="me-2">
                  status: {filters.status}
                </Badge>
              )}
              {filters.dateRange.startDate && filters.dateRange.endDate && (
                <Badge bg="light" text="dark" className="me-2">
                  date: {filters.dateRange.startDate.toLocaleDateString()} - {filters.dateRange.endDate.toLocaleDateString()}
                </Badge>
              )}
              <Button 
                variant="link" 
                size="sm" 
                onClick={clearFilters}
                className="p-0 ms-2"
              >
                Clear all
              </Button>
            </>
          )}
        </div> */}

        {!compact && filterChips.length > 0 && (
          <div className="leads_filters_on d-flex flex-wrap align-items-center gap-1">
            <small className="text-muted me-1">Filters on:</small>
            {filterChips.map((c) => (
              <span key={c.key} className="leads_filter_chip">
                {c.text}
                <button type="button" aria-label={`Clear ${c.text}`} onClick={() => clearChip(c.key)}>
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </span>
            ))}
          </div>
        )}
        {selectMode && (
          <div className={compact ? "mt-2 inbox_bulk" : "mt-2"}>
            <BulkBar count={selected.size} canAssign={canBulkReassign} canChangeStatus={canManageLeads}
              busy={scopeLoading} exporting={bulkExporting} onAction={bulkAction} onClose={stopSelecting} />
            <BulkScope scope={scope} count={selected.size} pageCount={leads.length} perPage={pagination.itemsPerPage || 10}
              matching={matching.leads ? matching.total : pagination.totalItems} capped={matching.capped}
              loading={scopeLoading} selected={[...selected.values()]} unticked={unticked}
              onScope={(k) => selectScope(k)} onFirst={(n) => selectScope('first', n)}
              onPages={(a, b) => selectScope('pages', a, b)} onDrop={dropLead} />
          </div>
        )}

        {loading && <div className="text-muted small mt-2" role="status">Loading leads...</div>}
        <div className="w_card_list mt-3" ref={listBoxRef} style={loading ? { opacity: 0.5 } : undefined}>
          <ListGroup as="ul" variant="flush">
            {!compact && (
            <ListGroup.Item as="li" className={`w_card_list_head lead_list_head border-bottom-0${selectMode ? ' d-flex align-items-center' : ''}`}>
              {selectMode && <div className="bulk_tick_col"></div>}
              <Row className="align-items-center w-100 g-0">
                <Col xl={10} lg={9} sm={9} xs={12} className="lead_main_col">
                  <Row className="align-items-center gx-2">
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="label">
                        <small><IconLabel name="customer">Name</IconLabel></small>
                      </p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="label"><small><IconLabel name="email">Email</IconLabel></small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="label"><small><IconLabel name="phone">Phone</IconLabel></small></p>
                    </Col>
                    <Col xl={1} lg={1} sm={1} xs={12}>
                      <p className="label"><small><IconLabel name="source">Source</IconLabel></small></p>
                    </Col>
                    <Col xl={1} lg={2} sm={2} xs={12}>
                      <p className="label"><small><IconLabel name="sender">Sender</IconLabel></small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="label"><small><IconLabel name="owner">Assigned To</IconLabel></small></p>
                    </Col>
                    <Col xl={2} lg={1} sm={1} xs={12}>
                      <p className="label"><small><IconLabel name="date">Created</IconLabel></small></p>
                    </Col>
                  </Row>
                </Col>
                <Col xl={1} lg={1} sm={1} xs={12} className="lead_status_col">
                  <p className="label"><small><IconLabel name="status">Status</IconLabel></small></p>
                </Col>
                <Col xl={1} lg={2} sm={2} xs={12} className="lead_action_col">
                  <p className="p_bold text-center"><small><IconLabel name="action">Action</IconLabel></small></p>
                </Col>
              </Row>
            </ListGroup.Item>
            )}

            {leads.length > 0 ? (
              leads.map(lead => (
                <ListGroup.Item as="li" key={lead._id} className={`lead-item ${activeLeadId === lead._id ? 'active-lead' : ''} w_card_list_box d-flex align-items-center${selectMode && selected.has(String(lead._id)) ? ' bulk_picked' : ''}`} onClick={(e) => {
                  // Don't trigger if clicking on buttons or interactive elements
                  if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) return;
                  if (compact && selectMode) { toggleLead(lead); return; }
                  handleLeadClick(lead);
                }}>
                  {compact ? (
                    // ✅ Compact view (used in ViewConversations)
                    <div className="position-relative w-100">
                      {/* Inbox row, like WhatsApp (the user, 27 Nov 2026): who, the last message, when, unread. */}
                      <div className="inbox_row">
                        {selectMode && (
                          <span className="inbox_tick" onClick={(e) => e.stopPropagation()}>
                            <Form.Check type="checkbox" aria-label={`Select ${lead.name || "lead"}`}
                              checked={selected.has(String(lead._id))} onChange={() => toggleLead(lead)} />
                          </span>
                        )}
                        <span className="inbox_avatar" aria-hidden="true" style={avatarStyle(lead.name)}>
                          {initialsOf(lead.name)}
                          {lead.inbox?.last?.from === "ai" && <span className="inbox_avatar_badge ai" title="The AI wrote last"><i className="fa-solid fa-robot"></i></span>}
                          {lead.inbox?.last?.from === "customer" && <span className="inbox_avatar_badge cust" title="The customer wrote last"></span>}
                        </span>
                        <span className="inbox_main">
                          <span className="inbox_top">
                            <span className={`inbox_title${lead.inbox?.unread ? " unread" : ""}`}>{lead.name || "No name"}</span>
                            {lead.hot === true && <span className="inbox_hot" title="Marked hot"><i className="fa-solid fa-fire" aria-hidden="true"></i></span>}
                            <span className="inbox_time">{inboxTime(lead.inbox?.last?.at || lead.createdAt, dealerTimezone)}</span>
                          </span>
                          <span className="inbox_bottom">
                            <span className="inbox_snip">
                              {lead.inbox?.last ? (
                                <>
                                  {lead.inbox.last.from === "ai" && <b>AI: </b>}
                                  {lead.inbox.last.from === "staff" && <b>You: </b>}
                                  {lead.inbox.last.failed && <i className="fa-solid fa-circle-exclamation text-danger me-1" aria-hidden="true"></i>}
                                  {lead.inbox.last.channel === "email" && <i className="fa-regular fa-envelope me-1" aria-hidden="true"></i>}
                                  {lead.inbox.last.text || "(no text)"}
                                </>
                              ) : <span className="text-muted">{statusLabel(lead.fe_lead_status) || "New lead"}</span>}
                            </span>
                            {waitingFor(lead.inbox?.last) && <span className="inbox_wait" title="The customer is waiting for an answer">
                              <i className="fa-regular fa-hourglass-half me-1" aria-hidden="true"></i>{waitingFor(lead.inbox.last)}</span>}
                            {lead.inbox?.unread > 0 && <span className="inbox_unread">{lead.inbox.unread}</span>}
                          </span>
                        </span>
                      <button type="button" className="inbox_more" aria-label={`More for ${lead.name || "this lead"}`}
                          aria-expanded={openLeadId === lead._id}
                          onClick={(e) => { e.stopPropagation(); setOpenLeadId(openLeadId === lead._id ? null : lead._id); }}>
                          <i className="fa-regular fa-ellipsis-vertical"></i>
                        </button>
                      </div>
                      {openLeadId === lead._id && (
                        // The lead's quick actions, under its row (27 Nov 2026: was squeezed and broken).
                        <div className="inbox_actions" onClick={(e) => e.stopPropagation()}>
                          <label className="inbox_actions_label" htmlFor={`assign-${lead._id}`}>Assigned to</label>
                          {canAssignLeads ? (
                            <Form.Select id={`assign-${lead._id}`} size="sm" value={lead.assigned_to?._id || ''}
                              onChange={(e) => handleAssignmentChange(lead._id, e.target.value)}>
                              <option value="">Unassigned</option>
                              {staffList.map((staff) => <option key={staff._id} value={staff._id}>{staff.name}</option>)}
                            </Form.Select>
                          ) : (
                            <span className="inbox_actions_value">{lead.assigned_to?.name || "Unassigned"}</span>
                          )}
                          <Button variant="outline-danger" size="sm" title="Delete lead" aria-label="Delete lead"
                            onClick={() => handleShowDeleteModal(lead)}>
                            <i className="fa-regular fa-trash"></i>
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                  <>
                  {selectMode && (
                    <div className="bulk_tick_col" onClick={(e) => e.stopPropagation()}>
                      <Form.Check type="checkbox" aria-label={`Select ${lead.name || "lead"}`}
                        checked={selected.has(String(lead._id))} onChange={() => toggleLead(lead)} />
                    </div>
                  )}
                  <Row className="align-items-center w-100 g-0">
                    <Col xl={10} lg={9} sm={9} xs={12} className="lead_main_col">
                      <Row className="align-items-center gx-2">
                        <Col xl={2} lg={2} sm={2} xs={12} onClick={() => handleLeadClick(lead)} className="a_link">
                          <p className="p_bold ap_person">
                            <Avatar name={lead.name} /><span>{lead.name || "N/A"}</span>
                          </p>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12} onClick={() => handleLeadClick(lead)} className="a_link">
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Email:</small></p>
                            <p className="ap_field"><AppIcon name="email" /><span className="text-truncate">{lead.email || "N/A"}</span></p>
                          </div>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12} onClick={() => handleLeadClick(lead)} className="a_link">
                          <div className="w_card_list_box_label">
                          <p className="label"><small>Phone:</small></p>
                          <p className="ap_field"><AppIcon name="phone" /><span>{lead.phone || "N/A"}</span></p>
                          </div>
                        </Col>
                        <Col xl={1} lg={1} sm={1} xs={12} onClick={() => handleLeadClick(lead)} className="a_link">
                          <div className="w_card_list_box_label">
                          <p className="label"><small>Source:</small></p>
                          {/* 19 Nov 2026 ("still not seeing the source"): the lead's source (Cars.com, Google...) and the
                              provider's sub-source - not the follow-up channel ("email" / "sms") a hand-entered lead keeps
                              in `source`. */}
                          <p className="text-truncate" title={[leadSourceName(lead), lead.sub_source].filter(Boolean).join(" · ")}>
                            {leadSourceName(lead)}{lead.sub_source ? <small className="text-muted d-block text-truncate">{lead.sub_source}</small> : null}</p>
                          <small className={`badge ${leadContactType(lead) ? 'bg-light text-dark border' : 'bg-warning text-dark'}`}
                            title="How the lead came in">{contactTypeLabel(lead)}</small>
                          </div>
                        </Col>
                        <Col xl={1} lg={2} sm={2} xs={12} onClick={() => handleLeadClick(lead)} className="a_link">
                          <div className="w_card_list_box_label">
                          <p className="label"><small>Sender:</small></p>
                          <p className="text-truncate">
                            {lead.source === "email"
                              ? lead.sender || "N/A"
                              : dealerParent?.dealer_account_information?.sms_conversion_phone || "N/A"
                            }
                          </p>
                          </div>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12}>
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Assigned To:</small></p>
                            {canAssignLeads ? (
                              <Form.Select
                                size="sm"
                                value={lead.assigned_to?._id || ''}
                                onChange={(e) => handleAssignmentChange(lead._id, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <option value="">Unassigned</option>
                                {staffList.map(staff => (
                                  <option key={staff._id} value={staff._id}>
                                    {staff.name}
                                  </option>
                                ))}
                              </Form.Select>
                            ) : (
                              <div className="w_card_list_box_label">
                                <p className="label"><small>Assigned:</small></p>
                                <p className="text-truncate">{lead.assigned_to?.name || "Unassigned"}</p>
                              </div>
                            )}
                          </div>
                        </Col>
                        <Col xl={2} lg={1} sm={1} xs={12} onClick={() => handleLeadClick(lead)} className="a_link">
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Created:</small></p>
                            <p className="ap_field ap_wrap" title={formatTimestamp(lead.createdAt, dealerTimezone)}><AppIcon name="date" /><span>{moment(lead.createdAt).tz(dealerTimezone).format("MMM D, YYYY")}<small className="d-block text-muted">{moment(lead.createdAt).tz(dealerTimezone).format("h:mm A")}</small></span></p>
                            {lead.last_reply_at && (
                              <small className="text-success d-block text-truncate"><AppIcon name="reply" className="me-1" />Replied {formatTimestamp(lead.last_reply_at, dealerTimezone)}</small>
                            )}
                            {lead.last_sent_at && (
                              <small className="text-primary d-block text-truncate"><AppIcon name="sent" className="me-1" />Messaged {formatTimestamp(lead.last_sent_at, dealerTimezone)}</small>
                            )}
                          </div>
                        </Col>
                      </Row>
                    </Col>

                    <Col xl={1} lg={1} sm={1} xs={7} className="lead_status_col">
                      <Badge
                        bg={getStatusVariant(lead.fe_lead_status)}
                        onClick={() => {
                          setSelectedLead(lead);
                          setShowStatusModal(true);
                        }}
                        className="cursor-pointer text-wrap"
                      >
                        <AppIcon name={statusIconName(lead.fe_lead_status)} plain className="me-1" />{leadStatusLabel(lead) || "N/A"} <i className="fa-solid fa-pen-to-square"></i>
                      </Badge>
                      {lead.ai_stop_label && (
                        // What the customer stopped (app/lib/ai/stopLabels.js): beside the status, never instead of it.
                        <div className="mt-1"><Badge bg="danger">{lead.ai_stop_label}</Badge></div>
                      )}
                      {/* Betsy, 2 Nov 2026 meeting ("it's either Manager Review or No Next Action - which one is it?"): one
                          status on the lead. The AI's own stage is shown to AutoPulse admins only (ai_admin below). */}
                      {lead.ai_admin && (
                        // AutoPulse super admins only (the API leaves this out for anyone else): bucket and next AI message.
                        <div className="small mt-1 text-info" title="AutoPulse admin view: the AI's bucket and its next scheduled message">
                          <i className="fa-solid fa-user-shield"></i>{' '}
                          {[lead.ai_admin.bucket && `Bucket: ${lead.ai_admin.bucket}`,
                            lead.ai_admin.agent && `Agent: ${lead.ai_admin.agent}`,
                            lead.ai_admin.next && `Next: ${String(lead.ai_admin.next.step || lead.ai_admin.next.kind).replace(/_/g, ' ')} ${formatTimestamp(lead.ai_admin.next.due_at, dealerTimezone)}`]
                            .filter(Boolean).join(' · ') || 'No AI timer'}
                        </div>
                      )}
                    </Col>

                    <Col xl={1} lg={2} sm={2} xs={5} className="lead_action_col">
                      <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                        <Button variant="custom" size="sm" title="360 View: history, tasks, call / text" aria-label="360 View"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPanel360({ customerId: lead.customer_id ? String(lead.customer_id?._id || lead.customer_id) : null,
                              leadId: lead._id, name: lead.name, dnd: lead.fe_lead_status === 'DND' });
                          }}>
                          <i className="fa-regular fa-id-card"></i>
                        </Button>
                        <Button variant="custom" size="sm" onClick={(e) => {
                          e.stopPropagation();
                          handleShowDetails(lead);
                        }}>
                          <i className="fa-regular fa-eye"></i>
                        </Button>
                        <Button variant="custom" size="sm" onClick={(e) => {
                          e.stopPropagation();
                          handleLeadClick(lead);
                        }}>
                          <i className="fa-regular fa-envelope-open"></i>
                        </Button>
                        <Button variant="danger" size="sm" onClick={(e) => {
                          e.stopPropagation();
                          handleShowDeleteModal(lead);
                        }}>
                          <i className="fa-regular fa-trash"></i>
                        </Button>
                      </div>
                    </Col>
                  </Row>
                  </>
                  )}
                </ListGroup.Item>
              ))
            ) : (
              <div className="text-center py-4">No leads found.</div>
            )}
          </ListGroup>

          {compact && leads.length > 0 && (
            // Beside the conversation the list pages like an inbox: one line, Previous / page of pages / Next.
            <div className="inbox_pager">
              <Button variant="outline-custom" size="sm" aria-label="Previous page" disabled={pagination.currentPage === 1}
                onClick={() => handlePageChange(pagination.currentPage - 1)}><i className="fa-solid fa-chevron-left"></i></Button>
              <span>Page <strong>{pagination.currentPage.toLocaleString("en-US")}</strong> of {pagination.totalPages.toLocaleString("en-US")}
                <small className="text-muted d-block">{(pagination.totalItems || 0).toLocaleString("en-US")} leads</small></span>
              <Button variant="outline-custom" size="sm" aria-label="Next page" disabled={pagination.currentPage === pagination.totalPages}
                onClick={() => handlePageChange(pagination.currentPage + 1)}><i className="fa-solid fa-chevron-right"></i></Button>
            </div>
          )}
          {!compact && pagination.totalPages > 1 && (
            <div className={!compact ? "d-md-flex justify-content-center mt-3" : "justify-content-center mt-2"}>
              <Pagination className="mb-md-0 justify-content-center flex-wrap">
                <Pagination.Prev
                  onClick={() => handlePageChange(pagination.currentPage - 1)}
                  disabled={pagination.currentPage === 1}
                />
                {createPaginationItems()}
                <Pagination.Next
                  onClick={() => handlePageChange(pagination.currentPage + 1)}
                  disabled={pagination.currentPage === pagination.totalPages}
                />
              </Pagination>
              
              {!compact && (
              <div className="d-flex align-items-center justify-content-center gap-1 ms-md-3 mt-1">
                <span className="text-muted small">Go to page:</span>
                <input
                  type="number"
                  min="1"
                  value={pageInputValue}
                  onChange={(e) => {
                    setPageInputValue(e.target.value);
                  }}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      const page = parseInt(e.target.value);
                      if (page >= 1) {
                        handlePageChange(page);
                      }
                    }
                  }}
                  className="form-control form-control-sm text-center"
                  style={{ width: '50px' }}
                  placeholder="Page"
                />
                <span className="text-muted small">of {pagination.totalPages}</span>
                <Button
                  size="sm"
                  variant="outline-custom"
                  onClick={() => {
                    const page = parseInt(pageInputValue);
                    if (page >= 1) {
                      handlePageChange(page);
                    }
                  }}
                  disabled={!pageInputValue || parseInt(pageInputValue) < 1}
                >
                  Go
                </Button>
              </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bulk actions (24 Nov 2026): the side panel, and the notice after saving */}
      {bulkPanel && (
        bulkPanel === "source" ? <LeadDetailsPanel show dealerId={dealerParent?.id || activeEntity?.id} leads={[...selected.values()]} onHide={() => setBulkPanel(null)} onSaved={bulkSaved} /> : (
        <BulkPanel key={bulkPanel} kind={bulkPanel} show={Boolean(bulkPanel)} dealerId={dealerParent?.id || activeEntity?.id}
          leads={[...selected.values()]} staffList={staffList} timezone={dealerTimezone} userName={user?.name}
          onHide={() => setBulkPanel(null)} onSaved={bulkSaved} />
        )
      )}
      <BulkNotice result={bulkResult} onClose={closeBulkNotice} onUndo={bulkUndo} onRetry={bulkRetry} />

      {/* Lead Details Sidebar */}
      <LeadDetailsSidebar
        show={showDetails}
        onHide={handleCloseDetails}
        lead={selectedLead}
        onLeadUpdated={handleLeadUpdated}
      />

      <ImportLeadsModal 
        show={showImportModal}
        onHide={() => setShowImportModal(false)}
        dealerId={activeEntity?.id}
        onSuccess={handleImportSuccess}
      />
      
      {/* Status Update Modal */}
      {showStatusModal && selectedLead && (
        <StatusModal
          show={showStatusModal}
          onHide={() => setShowStatusModal(false)}
          currentStatus={selectedLead.fe_lead_status}
          onStatusChange={handleStatusChange}
        />
      )}

      <Customer360Panel show={!!panel360} onHide={() => setPanel360(null)} customerId={panel360?.customerId}
        leadId={panel360?.leadId} name={panel360?.name} dnd={panel360?.dnd} />

      {/* Delete Confirmation Modal */}
      {/* modal */}
      <DeleteConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete Lead?"
        body="Are you sure you want to delete this lead? This action cannot be undone."
      />

      {/* <Modal show={showDeleteModal} onHide={handleCloseDeleteModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Delete</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Are you sure you want to delete this lead? This action cannot be undone.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseDeleteModal}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            Delete Lead
          </Button>
        </Modal.Footer>
      </Modal> */}
    </>
  );
});

export default LeadList;

// export default function LeadList({ setEditLead, onLeadSelected, activeLeadId, ...props }, ref) {
//   return (
//     <Suspense fallback={<Spinner animation="border" role="status" />}>
//       <LeadListContent setEditLead={setEditLead} onLeadSelected={onLeadSelected} activeLeadId={activeLeadId} />
//     </Suspense>
//   );
// }