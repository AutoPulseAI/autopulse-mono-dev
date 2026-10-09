"use client";
import { forwardRef,
  useImperativeHandle, useState, useEffect, Suspense, useCallback, useRef } from "react";
import { formatTimestamp } from "../../../utils/dateUtils";
import { Button, ListGroup, Row, Col, Offcanvas, Modal, Form, Alert, Badge, Pagination, Spinner } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import { useCan } from "../../../hooks/PermissionsContext";
import DateRangePickerComponent from "../../components/DateRangePicker";
import ImportLeadsModal from "./ImportLeadsModal";
import StatusModal from "./StatusModal";
import LeadDetailsSidebar from "./LeadDetailsSidebar";
import { useRouter, useSearchParams } from "next/navigation";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";
import moment from 'moment-timezone';
import { throwIfStatusFailed } from "../../../lib/bookingConflict"; // stream R: full-slot answer

// Component that uses useSearchParams - needs to be wrapped in Suspense
const LeadList = forwardRef(({ setEditLead, onLeadSelected, activeLeadId, selectedLeadId, compact = false, ...props }, ref) => {
  // All hooks must be called unconditionally at the top level
  const canAssignLeads = useCan("Assign Leads");
import { statusLabel } from "@lib/statusLabels";
  const canManageLeads = useCan("Manage Leads");
  const canViewAssignedLeads = useCan("View Assigned Leads");
  const [leads, setLeads] = useState([]);
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
  // Use window.location.search when available (always up-to-date) instead of
  // useSearchParams() which can be stale when URL was updated via replaceState
  const getUrlParams = () => typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : urlSearchParams;

  const [staffList, setStaffList] = useState([]);
  const [assignmentFilter, setAssignmentFilter] = useState(() => getUrlParams().get('assignment') || 'all');
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

  // Initialize filters and pagination from the actual browser URL
  const [filters, setFilters] = useState(() => {
    const params = getUrlParams();
    return {
      name: params.get('name') || '',
      email: params.get('email') || '',
      phone: params.get('phone') || '',
      status: params.get('status') || '',
      lead_source: params.get('lead_source') || '',
      source: params.get('source') || '',
      message_filter: params.get('message_filter') || '',
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

  const [inputValues, setInputValues] = useState({
    name: filters.name,
    email: filters.email,
    phone: filters.phone,
    status: filters.status,
    lead_source: filters.lead_source,
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
    "Contacted",
    "Appointment Booked",
    "Visited",
    "Managerial Review",
    "Sold",
    "Sold Pending",
    "Sold Delivered",
    "Unsold",
    "Closed - Lost",
    "Lead",
    // The SOW's working stages (client, 8 Oct 2026): the AI also sets them as the lead moves.
    "Lead Not Contacted",
    "Contacted - No Next Action",
    "DND",
    "No Show",
    // Set only by the AI (ownership ended; PLAN_4 stream S): filterable, never picked in the status modal.
    "Closed - No Longer Owns",
    // Set only by the AI: the customer gave a date to get back to them (it carries that date).
    "Contacted - Specific Follow-up"

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
  const fetchLeadsForPage = useCallback(async (page) => {
    try {
      setLoading(true);

      // Build query parameters including page
      let queryParams = `dealer_id=${activeEntity.id}&page=${page}&limit=${pagination.itemsPerPage}`;

      // Add assignment filter (only when not 'all')
      if (assignmentFilter && assignmentFilter !== 'all') {
        queryParams += `&assignment=${assignmentFilter}`;
      }

      // Add filters to query
      if (filters.name) queryParams += `&name=${encodeURIComponent(filters.name)}`;
      if (filters.email) queryParams += `&email=${encodeURIComponent(filters.email)}`;
      if (filters.phone) queryParams += `&phone=${encodeURIComponent(filters.phone)}`;
      if (filters.status) queryParams += `&fe_lead_status=${encodeURIComponent(filters.status)}`;
      if (filters.lead_source) queryParams += `&lead_source=${encodeURIComponent(filters.lead_source)}`;
      if (filters.source) queryParams += `&source=${encodeURIComponent(filters.source)}`;
      if (filters.message_filter) queryParams += `&message_filter=${encodeURIComponent(filters.message_filter)}`;
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
      showAlert("Failed to load leads", "danger");
      throw err;
    } finally {
      setLoading(false);
    }
  }, [activeEntity?.id, assignmentFilter, pagination.itemsPerPage, filters, showAlert]);

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
      if (filters.name) url += `&name=${encodeURIComponent(filters.name)}`;
      if (filters.email) url += `&email=${encodeURIComponent(filters.email)}`;
      if (filters.phone) url += `&phone=${encodeURIComponent(filters.phone)}`;
      if (filters.status) url += `&fe_lead_status=${encodeURIComponent(filters.status)}`;
      if (filters.lead_source) url += `&lead_source=${encodeURIComponent(filters.lead_source)}`;
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
    const textKeys = ['name', 'email', 'phone', 'status', 'lead_source', 'source', 'message_filter'];
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
      name: inputValues.name,
      email: inputValues.email,
      phone: inputValues.phone,
      status: inputValues.status,
      lead_source: inputValues.lead_source,
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
    inputValues.name,
    inputValues.email,
    inputValues.phone,
    inputValues.status,
    inputValues.lead_source,
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

  const clearFilters = () => {
    clearTimeout(searchDebounceRef.current);
    setInputValues({
      name: "",
      email: "",
      phone: "",
      status: "",
      lead_source: "",
      source: "",
      message_filter: ""
    });
    const newFilters = {
      name: "",
      email: "",
      phone: "",
      status: "",
      lead_source: "",
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
  }, [onLeadSelected]);

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
      let queryParams = `dealer_id=${activeEntity.id}&page=${page}&limit=${pagination.itemsPerPage}`;
      
      // Add assignment filter (only when not 'all')
      if (assignmentFilter && assignmentFilter !== 'all') {
        queryParams += `&assignment=${assignmentFilter}`;
      }
      
      // Add filters to query
      if (filters.name) queryParams += `&name=${encodeURIComponent(filters.name)}`;
      if (filters.email) queryParams += `&email=${encodeURIComponent(filters.email)}`;
      if (filters.phone) queryParams += `&phone=${encodeURIComponent(filters.phone)}`;
      if (filters.status) queryParams += `&fe_lead_status=${encodeURIComponent(filters.status)}`;
      if (filters.lead_source) queryParams += `&lead_source=${encodeURIComponent(filters.lead_source)}`;
      if (filters.source) queryParams += `&source=${encodeURIComponent(filters.source)}`;
      if (filters.message_filter) queryParams += `&message_filter=${encodeURIComponent(filters.message_filter)}`;
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
        showAlert('Lead assignment updated successfully', 'success');
        fetchLeads(); // Refresh leads
      } else {
        showAlert('Failed to update assignment', 'danger');
      }
    } catch (err) {
      showAlert('Error updating assignment', 'danger');
    }
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


  if (loading) {
    return (
      <div className="w_card">
        <div className="text-center py-4">Loading leads...</div>
      </div>
    );
  }

  return (
    <>
      {alert.show && (
        <Alert variant={alert.variant} onClose={() => setAlert({ ...alert, show: false })} dismissible>
          {alert.message}
        </Alert>
      )}

      <div className="w_card">
        {/* Assignment Filter Tabs */}
        <div className="d-flex gap-2 mb-3 lead_fltr">
        {canManageLeads && (
          <Button
            size="sm"
            variant={assignmentFilter === 'all' ? 'custom' : 'outline-custom'}
            onClick={() => setAssignmentAndSync('all')}
            className="text-nowrap"
          >
            <i className="fa-regular fa-users me-1"></i>
            All Leads
          </Button>
        )}
        {(canManageLeads || canViewAssignedLeads) && (
          <Button
            size="sm"
            variant={assignmentFilter === 'my' ? 'custom' : 'outline-custom'}
            onClick={() => setAssignmentAndSync('my')}
            className="text-nowrap"
          >
            <i className="fa-regular fa-user me-1"></i>
            My Leads
          </Button>
        )}
        {canManageLeads && (
          <Button
            size="sm"
            variant={assignmentFilter === 'unassigned' ? 'custom' : 'outline-custom'}
            onClick={() => setAssignmentAndSync('unassigned')}
            className="text-nowrap"
          >
            <i className="fa-regular fa-user-slash me-1"></i>
            Unassigned
          </Button>
        )}
        </div>
      
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
              <div className="d-flex gap-1">
                <Button 
                  variant="custom" 
                  size="sm"
                  onClick={() => setEditLead({})}
                  className="text-nowrap"
                >
                  <i className="fa-solid fa-plus me-1"></i>Add Lead
                </Button>
                <Button 
                  variant="outline-custom" 
                  size="sm"
                  onClick={() => setShowImportModal(true)}
                  className="text-nowrap"
                >
                  <i className="fa fa-upload me-1"></i>Import CSV
                </Button>
                <Button 
                  variant="outline-custom" 
                  size="sm"
                  onClick={exportToCSV}
                  disabled={loading || leads.length === 0}
                  className="text-nowrap"
                >
                  <i className="fa fa-download me-1"></i>Export CSV
                </Button>
              </div>
            </div>
          </Col>
        </Row>
      )}

      {compact ? (
        <Row className="align-items-center g-0">
          <Col lg={12}>
            {/* Filter Controls */}
            <Row className="search_filters gx-1 gy-1">
              <Col xxl={12} xl={12} lg={12} md={12}>
                <Form.Control
                  type="text"
                  placeholder="Name"
                  name="name"
                  value={inputValues.name}
                  onChange={handleInputChange}
                  size="sm"
                />
              </Col>
              <Col xxl={12} xl={12} lg={12} md={12}>
                <Form.Control
                  type="text"
                  placeholder="Email"
                  name="email"
                  value={inputValues.email}
                  onChange={handleInputChange}
                  size="sm"
                />
              </Col>
              <Col xxl={7} xl={7} lg={7} md={7} xs={7}>
                <Form.Control
                  type="text"
                  placeholder="Phone"
                  name="phone"
                  value={inputValues.phone}
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
                <Form.Select
                  name="source"
                  value={inputValues.source}
                  onChange={handleInputChange}
                  size="sm"
                >
                  <option value="">All Source Types</option>
                  {sourceOptions.map(source => (
                    <option key={source} value={source}>
                      {source.charAt(0).toUpperCase() + source.slice(1).toLowerCase()}
                    </option>
                  ))}
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
                    disabled={!inputValues.name && !inputValues.email && !inputValues.phone && !inputValues.status && !inputValues.lead_source && !inputValues.source && !filters.dateRange.startDate}
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
      ) : (
        <Row className="align-items-center g-0">
          <Col lg={12}>
            {/* Filter Controls */}
            <Row className="search_filters gx-1 gy-xxl-0 gy-1">
              <Col xxl={2} xl={3} lg={3} md={3} xs={12}>
                <Form.Control
                  type="text"
                  placeholder="Name"
                  name="name"
                  value={inputValues.name}
                  onChange={handleInputChange}
                  size="sm"
                />
              </Col>
              <Col xxl={2} xl={3} lg={3} md={3} xs={12}>
                <Form.Control
                  type="text"
                  placeholder="Email"
                  name="email"
                  value={inputValues.email}
                  onChange={handleInputChange}
                  size="sm"
                />
              </Col>
              <Col xxl={2} xl={3} lg={3} md={3} xs={6}>
                <Form.Control
                  type="text"
                  placeholder="Phone"
                  name="phone"
                  value={inputValues.phone}
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
                  {sourceOptions.map(source => (
                    <option key={source} value={source}>
                      {source.charAt(0).toUpperCase() + source.slice(1).toLowerCase()}
                    </option>
                  ))}
                </Form.Select>
              </Col>
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
                    disabled={!inputValues.name && !inputValues.email && !inputValues.phone && !inputValues.status && !inputValues.lead_source && !inputValues.source && !filters.dateRange.startDate}
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

        <div className="w_card_list mt-3">
          <ListGroup as="ul" variant="flush">
            {!compact && (
            <ListGroup.Item as="li" className="w_card_list_head border-bottom-0">
              <Row className="align-items-center w-100 g-0">
                <Col xl={10} lg={9} sm={9} xs={12}>
                  <Row className="align-items-center gx-2">
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="label"><small>Name</small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="label"><small>Email</small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="label"><small>Phone</small></p>
                    </Col>
                    <Col xl={1} lg={1} sm={1} xs={12}>
                      <p className="label"><small>Source</small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="label"><small>Sender</small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="label"><small>Assigned To</small></p>
                    </Col>
                    <Col xl={1} lg={1} sm={1} xs={12}>
                      <p className="label"><small>Created</small></p>
                    </Col>
                  </Row>
                </Col>
                <Col xl={1} lg={1} sm={1} xs={12}>
                  <p className="label"><small>Status</small></p>
                </Col>
                <Col xl={1} lg={2} sm={2} xs={12}>
                  <p className="p_bold text-center"><small>Action</small></p>
                </Col>
              </Row>
            </ListGroup.Item>
            )}

            {leads.length > 0 ? (
              leads.map(lead => (
                <ListGroup.Item as="li" key={lead._id} className={`lead-item ${activeLeadId === lead._id ? 'active-lead' : ''} w_card_list_box d-flex align-items-center`} onClick={(e) => {
                  // Don't trigger if clicking on buttons or interactive elements
                  if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) return;
                  handleLeadClick(lead);
                }}>
                  {compact ? (
                    // ✅ Compact view (used in ViewConversations)
                    <div className="position-relative w-100">
                      <p className="fw-semibold d-flex align-items-center">
                        <span>{lead.name}</span>
                        <Button variant="outline-secondary" size="xs" className="ms-auto"
                          onClick={(e) => {
                            e.stopPropagation(); // prevent triggering onLeadSelected
                            setOpenLeadId(openLeadId === lead._id ? null : lead._id);
                          }} >
                          <i className="fa-regular fa-ellipsis-vertical lead_action_icon px-1"></i>
                        </Button>
                      </p>
                      {openLeadId === lead._id && (
                      <div className="d-flex align-items-center justify-content-between w-100 mt-1 lead_action">
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
                        <div className="d-flex gap-1 w_card_list_btns justify-content-end">
                          {!compact && (
                          <Button variant="custom" size="sm" onClick={(e) => {
                            e.stopPropagation();
                            handleLeadClick(lead);
                          }}>
                            <i className="fa-regular fa-envelope-open"></i>
                          </Button>
                          )}
                          <Button variant="danger" size="sm" onClick={(e) => {
                            e.stopPropagation();
                            handleShowDeleteModal(lead);
                          }}>
                            <i className="fa-regular fa-trash"></i>
                          </Button>
                        </div>
                      </div>
                      )}
                    </div>
                  ) : (
                  <Row className="align-items-center w-100 g-0">
                    <Col xl={10} lg={9} sm={9} xs={12}>
                      <Row className="align-items-center gx-2">
                        <Col xl={2} lg={2} sm={2} xs={12} onClick={() => handleLeadClick(lead)} className="a_link">
                          <p className="p_bold">{lead.name || "N/A"}</p>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12} onClick={() => handleLeadClick(lead)} className="a_link">
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Email:</small></p>
                            <p className="text-truncate">{lead.email || "N/A"}</p>
                          </div>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12} onClick={() => handleLeadClick(lead)} className="a_link">
                          <div className="w_card_list_box_label">
                          <p className="label"><small>Phone:</small></p>
                          <p>{lead.phone || "N/A"}</p>
                          </div>
                        </Col>
                        <Col xl={1} lg={1} sm={1} xs={12} onClick={() => handleLeadClick(lead)} className="a_link">
                          <div className="w_card_list_box_label">
                          <p className="label"><small>Source:</small></p>
                          <p>{lead.source || "N/A"}</p>
                          </div>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12} onClick={() => handleLeadClick(lead)} className="a_link">
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
                        <Col xl={1} lg={1} sm={1} xs={12} onClick={() => handleLeadClick(lead)} className="a_link">
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Created:</small></p>
                            <p className="text-truncate">{formatTimestamp(lead.createdAt, dealerTimezone)}</p>
                          </div>
                        </Col>
                      </Row>
                    </Col>

                    <Col xl={1} lg={1} sm={1} xs={7}>
                      <Badge
                        bg={getStatusVariant(lead.fe_lead_status)}
                        onClick={() => {
                          setSelectedLead(lead);
                          setShowStatusModal(true);
                        }}
                        className="cursor-pointer text-wrap"
                      >
                        {statusLabel(lead.fe_lead_status) || "N/A"} <i className="fa-solid fa-pen-to-square"></i>
                      </Badge>
                      {lead.ai_stage_label && (
                        // The AI's own stage for this lead, read only (app/lib/ai/aiStage.js).
                        <div className="small text-muted mt-1" title="AI stage (read only)">
                          <i className="fa-solid fa-robot"></i> {lead.ai_stage_label}
                        </div>
                      )}
                    </Col>

                    <Col xl={1} lg={2} sm={2} xs={5}>
                      <div className="d-flex gap-1 w_card_list_btns justify-content-end">
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
                  )}
                </ListGroup.Item>
              ))
            ) : (
              <div className="text-center py-4">No leads found.</div>
            )}
          </ListGroup>

          {pagination.totalPages > 1 && (
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