"use client";
import { forwardRef, useImperativeHandle, useState, useEffect, Suspense, useCallback, useRef } from "react";
import { formatTimestamp } from "../../../utils/dateUtils";
import { Button, ListGroup, Row, Col, Offcanvas, Form, Alert, Badge, Pagination, Spinner } from "react-bootstrap";
import { useUser } from "../../context/UserContext";
import { useCan } from "../../../hooks/PermissionsContext";
import DateRangePickerComponent from "../../components/DateRangePicker";
import { useRouter, useSearchParams } from "next/navigation";
import StatusModal from "./StatusModal";
import LeadDetailsSidebar from "../../leads/components/LeadDetailsSidebar";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";
import moment from "moment-timezone";
import { throwIfStatusFailed } from "../../../lib/bookingConflict"; // stream R: full-slot answer

// Component that uses useSearchParams - needs to be wrapped in Suspense
const LeadListContent = forwardRef(({ setEditLead, onLeadSelected, activeLeadId, compact = false, ...props }, ref) => {
  const [leads, setLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ show: false, message: "", variant: "success" });
  const [openLeadId, setOpenLeadId] = useState(null);
  const { user, dealerParent } = useUser();
  const activeEntity = dealerParent || user;
  const orignalDealer = user;
  const router = useRouter();
  const urlSearchParams = useSearchParams();
  // Get dealer timezone
  const dealerTimezone = activeEntity?.dealer_account_information?.time_zone || "America/New_York";
  const [staffList, setStaffList] = useState([]);
  const [assignmentFilter, setAssignmentFilter] = useState(urlSearchParams.get('assignment') || 'all'); // 'all', 'my', 'unassigned'
  const canAssignLeads = useCan("Assign Leads");
  const [paginationDirection, setPaginationDirection] = useState(null);
  
  // Refs for router and onLeadSelected to avoid unnecessary fetchLeads recreations
  const routerRef = useRef(router);
  const onLeadSelectedRef = useRef(onLeadSelected);
  const lastSelectedLeadIdRef = useRef(null); // Track last selected lead to prevent re-selection
  const paginationDirectionRef = useRef(null); // Use ref to hold direction reliably across renders
  const isPageChangeFetchingRef = useRef(false); // Flag to prevent useEffect from calling fetchLeads when handlePageChange is fetching
  
  // Keep refs updated
  useEffect(() => {
    routerRef.current = router;
    onLeadSelectedRef.current = onLeadSelected;
  }, [router, onLeadSelected]);
  
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
      router.replace(`/dealer/booking${query ? `?${query}` : ''}`);
    } catch (e) {
      // no-op if window not available
    }
  };

  // Initialize filters and pagination from URL
  const [filters, setFilters] = useState({
    name: urlSearchParams.get('name') || '',
    email: urlSearchParams.get('email') || '',
    phone: urlSearchParams.get('phone') || '',
    dateRange: {
      startDate: urlSearchParams.get('startDate') ? new Date(urlSearchParams.get('startDate')) : null,
      endDate: urlSearchParams.get('endDate') ? new Date(urlSearchParams.get('endDate')) : null
    },
    page: parseInt(urlSearchParams.get('page')) || 1
  });

  const [pagination, setPagination] = useState({
    currentPage: filters.page,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 10,
    hasNextPage: false,
    hasPreviousPage: false
  });

  const [dateRange, setDateRange] = useState(filters.dateRange);
  const [pageInputValue, setPageInputValue] = useState(filters.page.toString());

  // Form input states (temporary until search is clicked)
  const [inputValues, setInputValues] = useState({
    name: filters.name,
    email: filters.email,
    phone: filters.phone
  });

  const getStatusVariant = (status) => {
    switch (status?.toLowerCase()) {
      case 'contacted':
        return 'info';
      case 'appointment booked':
        return 'warning';
      case 'visited':
        return 'success';
      case 'managerial review':
        return 'info';
      case 'sold':
        return 'danger';
      case 'new':
        return 'custom';
      case 'no show':
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  const fetchStaffList = useCallback(async () => {
    if (!activeEntity?.id) return;
    try {
      const token = localStorage.getItem('dealertoken');
      const res = await fetch(`/api/staff/list?dealer_id=${dealerParent.id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }});
   
      const data = await res.json();
      if (res.ok) {
        setStaffList(data.staff || []);
      }
    } catch (err) {
      console.error("Error fetching staff:", err);
    }
  }, [activeEntity?.id, dealerParent?.id]);

  useEffect(() => {
    if (!activeEntity?.id) return;
    fetchStaffList();
  }, [activeEntity?.id, fetchStaffList]);

  // Helper function to fetch leads for a specific page
  const fetchLeadsForPage = useCallback(async (page) => {
    try {
      setLoading(true);

      // Build query parameters including page
      let queryParams = `dealer_id=${activeEntity.id}&page=${page}&limit=${pagination.itemsPerPage}&booking_status=1`;

      // Add assignment filter (only when not 'all')
      if (assignmentFilter && assignmentFilter !== 'all') {
        queryParams += `&assignment=${assignmentFilter}`;
      }

      // Add filters to query
      if (filters.name) queryParams += `&name=${encodeURIComponent(filters.name)}`;
      if (filters.email) queryParams += `&email=${encodeURIComponent(filters.email)}`;
      if (filters.phone) queryParams += `&phone=${encodeURIComponent(filters.phone)}`;
      if (filters.dateRange.startDate) queryParams += `&startDate=${filters.dateRange.startDate.toISOString()}`;
      if (filters.dateRange.endDate) queryParams += `&endDate=${filters.dateRange.endDate.toISOString()}`;

      const token = localStorage.getItem('dealertoken');
      const res = await fetch(`/api/leads?${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${token}`
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
  }, [activeEntity?.id, assignmentFilter, pagination.itemsPerPage, filters]);

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

  useEffect(() => {
    if (!activeEntity?.id) return;
    
    // Skip fetchLeads if handlePageChange is currently fetching (prevents duplicate calls)
    if (isPageChangeFetchingRef.current) {
      isPageChangeFetchingRef.current = false; // Reset flag
      return;
    }
    
    fetchLeads();
  }, [activeEntity?.id, filters, assignmentFilter, fetchLeads]);

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
      // PRIORITY 2: If there's a leadId in URL, check if it exists in current leads
      if (leadIdInUrl) {
        // Skip if this is the same lead we just selected
        if (lastSelectedLeadIdRef.current === leadIdInUrl) {
          return;
        }
        
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
        router.replace(`/dealer/booking?${params.toString()}`, undefined, { shallow: true });
        lastSelectedLeadIdRef.current = null;
        // Fall through to PRIORITY 3
      }

      // PRIORITY 3: No leadId in URL and no direction - select first lead (initial load)
    } catch (err) {
      // Error auto-selecting lead
    }
  }, [leads, paginationDirection, onLeadSelected, router, pagination.currentPage]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setInputValues(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSearch = () => {
    const newFilters = {
      ...filters,
      name: inputValues.name,
      email: inputValues.email,
      phone: inputValues.phone,
      page: 1 // Reset to first page when searching
    };
    setFilters(newFilters);
    
    // Update URL
    const params = new URLSearchParams();
    if (inputValues.name) params.set('name', inputValues.name);
    if (inputValues.email) params.set('email', inputValues.email);
    if (inputValues.phone) params.set('phone', inputValues.phone);
    if (filters.dateRange.startDate) params.set('startDate', filters.dateRange.startDate.toISOString());
    if (filters.dateRange.endDate) params.set('endDate', filters.dateRange.endDate.toISOString());
    params.set('page', 1);
    
    router.push(`?${params.toString()}`, undefined, { shallow: true });
  };

  const handleDateRangeChange = ({ startDate, endDate }) => {
    // Normalize dates to start/end of day in dealer timezone, then convert to UTC
    let normalizedStartDate = null;
    let normalizedEndDate = null;

    if (startDate) {
      const dateStr = moment.utc(startDate).format("YYYY-MM-DD");
      normalizedStartDate = moment
        .tz(dateStr, "YYYY-MM-DD", dealerTimezone)
        .startOf("day")
        .utc()
        .toDate();
    }

    if (endDate) {
      const dateStr = moment.utc(endDate).format("YYYY-MM-DD");
      normalizedEndDate = moment
        .tz(dateStr, "YYYY-MM-DD", dealerTimezone)
        .endOf("day")
        .utc()
        .toDate();
    }

    const newFilters = {
      ...filters,
      dateRange: { startDate: normalizedStartDate, endDate: normalizedEndDate },
      page: 1 // Reset to first page when date range changes
    };
    setFilters(newFilters);
    setDateRange({ startDate: normalizedStartDate, endDate: normalizedEndDate });

    // Update URL
    const params = new URLSearchParams();
    if (filters.name) params.set("name", filters.name);
    if (filters.email) params.set("email", filters.email);
    if (filters.phone) params.set("phone", filters.phone);
    if (normalizedStartDate) params.set("startDate", normalizedStartDate.toISOString());
    if (normalizedEndDate) params.set("endDate", normalizedEndDate.toISOString());
    params.set("page", 1);

    router.push(`?${params.toString()}`, undefined, { shallow: true });
  };

  const clearFilters = () => {
    setInputValues({
      name: "",
      email: "",
      phone: ""
    });
    setDateRange({ startDate: null, endDate: null });
    const clearedFilters = {
      name: "",
      email: "",
      phone: "",
      dateRange: {
        startDate: null,
        endDate: null
      },
      page: 1
    };
    setFilters(clearedFilters);
    
    // Clear URL parameters
    router.push('?', undefined, { shallow: true });
  };

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
    const newUrl = `/dealer/booking?${params.toString()}`;
    router.replace(newUrl, undefined, { shallow: true });
    
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
      let queryParams = `dealer_id=${activeEntity.id}&page=${page}&limit=${pagination.itemsPerPage}&booking_status=1`;
      
      // Add assignment filter (only when not 'all')
      if (assignmentFilter && assignmentFilter !== 'all') {
        queryParams += `&assignment=${assignmentFilter}`;
      }
      
      // Add filters to query
      if (filters.name) queryParams += `&name=${encodeURIComponent(filters.name)}`;
      if (filters.email) queryParams += `&email=${encodeURIComponent(filters.email)}`;
      if (filters.phone) queryParams += `&phone=${encodeURIComponent(filters.phone)}`;
      if (filters.dateRange.startDate) queryParams += `&startDate=${filters.dateRange.startDate.toISOString()}`;
      if (filters.dateRange.endDate) queryParams += `&endDate=${filters.dateRange.endDate.toISOString()}`;
      
      const token = localStorage.getItem('dealertoken');
      const res = await fetch(`/api/leads?${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${token}`
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
          routerRef.current.replace(`/dealer/booking?${finalParams.toString()}`, undefined, { shallow: true });
          
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

  const showAlert = useCallback((message, variant = "success") => {
    setAlert({ show: true, message, variant });
    setTimeout(() => setAlert(prev => ({ ...prev, show: false })), 5000);
  }, []);

  // Helper function to handle lead click and update URL with selectedLead=true and leadId
  const handleLeadClick = useCallback((lead) => {
    // Clear direction from ref and state (manual click overrides direction)
    paginationDirectionRef.current = null;
    setPaginationDirection(null);
    
    const params = new URLSearchParams(window.location.search);
    params.set('selectedLead', 'true');
    params.set('leadId', lead._id);
    // Remove direction from URL since this is a manual click
    params.delete('direction');
    router.replace(`/dealer/booking?${params.toString()}`, undefined, { shallow: true });
    lastSelectedLeadIdRef.current = lead._id; // Track this selection
    onLeadSelected(lead);
  }, [router, onLeadSelected]);

  // Function to clear selectedLead from URL (close sidebar)
  const clearSelectedLead = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete('selectedLead');
    params.delete('leadId');
    params.delete('direction');
    router.replace(`/dealer/booking?${params.toString()}`, undefined, { shallow: true });
    lastSelectedLeadIdRef.current = null;
    paginationDirectionRef.current = null;
    setPaginationDirection(null);
  }, [router]);

  const handleShowDetails = (lead) => {
    // Only open details sidebar, close viewConversations if open
    // Clear viewConversations URL params to close it
    const params = new URLSearchParams(window.location.search);
    if (params.get('leadId')) {
      params.delete('leadId');
      router.replace(`/dealer/booking?${params.toString()}`, undefined, { shallow: true });
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

  const handleShowStatusModal = (lead) => {
    setSelectedLead(lead);
    setShowStatusModal(true);
  };

  const handleCloseStatusModal = () => {
    setShowStatusModal(false);
    setSelectedLead(null);
  };

  const handleShowDeleteModal = (lead) => {
    setSelectedLead(lead);
    setShowDeleteModal(true);
  };

  const handleCloseDeleteModal = () => {
    setShowDeleteModal(false);
    setSelectedLead(null);
  };

  const handleDelete = async () => {
    if (!selectedLead) return;
    const token = localStorage.getItem('dealertoken');
    try {
      const response = await fetch(`/api/leads`, {
        method: "DELETE",
        headers: { 
          "Content-Type": "application/json", 
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ id: selectedLead._id })
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
      console.error("Error deleting lead:", err);
      showAlert("Failed to delete lead", "danger");
    }
  };

  const handleStatusChange = async (newStatus, extra = {}) => {
    if (!selectedLead) return;

    try {
      const payload = { id: selectedLead._id, status: newStatus, ...extra };
      console.log('Sending lead status update (booking list):', payload);
      const token = localStorage.getItem('dealertoken');
        const response = await fetch(`/api/conversations/lead/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload),
      });

      // A full slot keeps the modal open with "Book {next available}" (stream R, app/lib/bookingConflict.js).
      await throwIfStatusFailed(response, extra);

      setLeads(prev => prev.map(l =>
        l._id === selectedLead._id ? { ...l, status: newStatus } : l
      ));
      showAlert("Status updated successfully");
      handleCloseStatusModal();
    } catch (err) {
      if (err?.slotConflict) throw err; // shown in the StatusModal (stream R)
      console.error("Error updating status:", err);
      showAlert("Failed to update status", "danger");
    }
  };

  const handleAssignmentChange = async (leadId, assignedToId) => {
    const token = localStorage.getItem('dealertoken');
    try {
      const response = await fetch(`/api/leads/${leadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ assigned_to: assignedToId || null })
      });

      if (response.ok) {
        showAlert('Lead assignment updated successfully', 'success');
        fetchLeads(); // Refresh leads
      } else {
        showAlert('Failed to update assignment', 'danger');
      }
    } catch (err) {
      console.error('Error updating assignment:', err);
      showAlert('Failed to update assignment', 'danger');
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

    addPageItem(1);
    if (totalPages >= 2) addPageItem(2);

    if (currentPage > 3) {
      addEllipsis("start-ellipsis");
    }

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 2, currentPage + 1);

    for (let i = start; i <= end; i++) {
      if (i > 2 && i < totalPages - 1) {
        addPageItem(i);
      }
    }

    if (currentPage < totalPages - 3) {
      addEllipsis("end-ellipsis");
    }

    if (totalPages > 3) addPageItem(totalPages - 1);
    if (totalPages > 2) addPageItem(totalPages);

    return items;
  };

  // Add useImperativeHandle inside the component (before return)
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
        router.replace(`/dealer/booking?${params.toString()}`, undefined, { shallow: true });
          
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
        // Same page - use handleLeadClick
        handleLeadClick(leads[idx - 1]);
      } else if (pagination.hasPreviousPage) {
        // Cross page - fetch prev page leads first, then select last lead
        const prevPage = pagination.currentPage - 1;
        
        try {
          isPageChangeFetchingRef.current = true;
          setLoading(true);
          
          // Fetch leads for prev page FIRST
          const result = await fetchLeadsForPage(prevPage);
          const newLeads = result.leads;
          
          if (newLeads.length === 0) {
            isPageChangeFetchingRef.current = false;
            setLoading(false);
            return;
          }
          
          // Select last lead of new page
          const lastLead = newLeads[newLeads.length - 1];
          
          // Update URL with page only (handleLeadClick will set leadId and selectedLead)
          const params = new URLSearchParams(window.location.search);
          params.set('page', prevPage.toString());
          // Preserve selectedLead if it exists (handleLeadClick will set leadId)
          if (params.get('selectedLead') === 'true') {
            // Keep selectedLead, but remove old leadId (handleLeadClick will set new one)
            params.delete('leadId');
          }
          params.delete('direction');
          router.replace(`/dealer/booking?${params.toString()}`, undefined, { shallow: true });
          
          // Update state
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
          
          // handleLeadClick will set leadId in URL
          handleLeadClick(lastLead);
          
          isPageChangeFetchingRef.current = false;
        } catch (err) {
          isPageChangeFetchingRef.current = false;
          setLoading(false);
        }
      }
    },
    clearSelectedLead() {
      clearSelectedLead();
    }
  }), [leads, pagination, handleLeadClick, fetchLeadsForPage, router, clearSelectedLead]);

  if (loading) {
    return (
      <div className="w_card">
        <div className="text-center py-4">
          <Spinner animation="border" size="sm" className="me-2" />
          Loading appointments...
        </div>
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
          {useCan("Manage Leads") && (
            <Button
              size="sm"
              variant={assignmentFilter === 'all' ? 'custom' : 'outline-custom'}
              onClick={() => setAssignmentAndSync('all')}
            >
              <i className="fa-regular fa-users me-1"></i>
              <span className="text-nowrap">All Appts</span>
            </Button>
          )}
          {(useCan("Manage Leads") || useCan("View Assigned Leads")) && (
            <Button
              size="sm"
              variant={assignmentFilter === 'my' ? 'custom' : 'outline-custom'}
              onClick={() => setAssignmentAndSync('my')}
            >
              <i className="fa-regular fa-user me-1"></i>
              <span className="text-nowrap">My Appts</span>
            </Button>
          )}
          {useCan("Manage Leads") && (
            <Button
              size="sm"
              variant={assignmentFilter === 'unassigned' ? 'custom' : 'outline-custom'}
              onClick={() => setAssignmentAndSync('unassigned')}
            >
              <i className="fa-regular fa-user-slash me-1"></i>
              <span className="text-nowrap">Unassigned</span>
            </Button>
          )}
        </div>
        
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
                  <DateRangePickerComponent
                    onDateRangeChange={handleDateRangeChange}
                    dateRange={filters.dateRange}
                    timezone={dealerTimezone}
                    size="sm"
                    className="w-100"
                  />
                </Col>
                <Col xxl={12} xl={12} lg={12} md={12} xs={12}>
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
                      disabled={!inputValues.name && !inputValues.email && !inputValues.phone && !filters.dateRange.startDate}
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
            <Col md={2}>
              <div className="d-flex flex-md-column mb-2">
                <h3 className="w_card_title mb-0 me-2">
                  Appointment List
                </h3>
                <p className="mb-0">
                  {pagination.totalItems !== undefined && (
                      <small className="text-muted fw-normal">
                        ({pagination.totalItems.toLocaleString()} {pagination.totalItems === 1 ? 'appointment' : 'appointments'})
                      </small>
                    )}
                </p>
              </div>
            </Col>
            <Col md={10}>
              <Row className="search_filters gx-1 gy-md-0 gy-1">
                <Col xl={3} lg={3} md={3} xs={6}>
                  <Form.Control
                    type="text"
                    placeholder="Name"
                    name="name"
                    value={inputValues.name}
                    onChange={handleInputChange}
                    size="sm"
                  />
                </Col>
                <Col xl={3} lg={3} md={3} xs={6}>
                  <Form.Control
                    type="text"
                    placeholder="Email"
                    name="email"
                    value={inputValues.email}
                    onChange={handleInputChange}
                    size="sm"
                  />
                </Col>
                <Col xxl={3} xl={2} lg={2} md={2} xs={4}>
                  <Form.Control
                    type="text"
                    placeholder="Phone"
                    name="phone"
                    value={inputValues.phone}
                    onChange={handleInputChange}
                    size="sm"
                  />
                </Col>
                <Col xl={2} lg={2} md={2} xs={4}>
                  <DateRangePickerComponent
                    onDateRangeChange={handleDateRangeChange}
                    dateRange={dateRange}
                    timezone={dealerTimezone}
                    size="sm"
                  />
                </Col>
                <Col xxl={1} xl={2} lg={2} md={2} xs={4}>
                  <div className="d-flex">
                    <Button
                      variant="custom"
                      size="sm"
                      onClick={handleSearch}
                    >
                      Search
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={clearFilters}
                      disabled={!inputValues.name && !inputValues.email && !inputValues.phone && !filters.dateRange.startDate}
                      className="text-nowrap ms-1"
                    >
                      Clear
                    </Button>
                  </div>
                </Col>
              </Row>
            </Col>
          </Row>
        )}

        <div className="w_card_list mt-3">
          <ListGroup as="ul" variant="flush">
            {!compact && (
            <ListGroup.Item as="li" className="w_card_list_head border-bottom-0">
              <Row className="align-items-center w-100 g-0 gx-1">
                <Col xl={9} lg={9} sm={9} xs={12}>
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
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="label"><small>Appt. Date</small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="label"><small>Appt. Time</small></p>
                    </Col>
                    <Col xl={2} lg={2} sm={2} xs={12}>
                      <p className="label"><small>Assigned To</small></p>
                    </Col>
                  </Row>
                </Col>
                <Col xl={2} lg={1} sm={1} xs={12}>
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
                  <Row className="align-items-center w-100 g-0 gx-1">
                    <Col xl={9} lg={9} sm={9} xs={12} className="mb-1 mb-md-0">
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
                            <p className="text-truncate">{lead.phone || "N/A"}</p>
                          </div>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12} onClick={() => handleLeadClick(lead)} className="a_link">
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Appointment Date:</small></p>
                            <p className="text-truncate">
                              {(() => {
                                try {
                                  const date = new Date(lead.booking?.booking_date);
                                  return isNaN(date.getTime()) ? 'Date Flexible' : date.toLocaleDateString();
                                } catch {
                                  return 'Date Flexible';
                                }
                              })()}
                            </p>
                          </div>
                        </Col>
                        <Col xl={2} lg={2} sm={2} xs={12} onClick={() => handleLeadClick(lead)} className="a_link">
                          <div className="w_card_list_box_label">
                            <p className="label"><small>Appointment Time:</small></p>
                            <p className="text-truncate">
                              {(() => {
                                const timeStr = lead?.booking?.booking_time ?? '';
                                if (!timeStr) return 'Time Flexible';

                                // Parse 12-hour format with AM/PM
                                const [time, period] = timeStr.split(' ');
                                let [hours, minutes] = time.split(':').map(Number);

                                if (period === 'PM' && hours < 12) hours += 12;
                                if (period === 'AM' && hours === 12) hours = 0;

                                const date = new Date(2000, 0, 1, hours, minutes);
                                return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                              })()}
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
                      </Row>
                    </Col>
                    <Col xl={2} lg={1} sm={1} xs={7}>
                      <Badge
                        bg={getStatusVariant(lead.fe_lead_status)}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleShowStatusModal(lead);
                        }}
                        className="cursor-pointer text-wrap"
                      >
                        {lead.fe_lead_status || "N/A"} <i className="fa-solid fa-pen-to-square"></i>
                      </Badge>
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
              <div className="text-center py-4">No appointments found.</div>
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

      <LeadDetailsSidebar
        show={showDetails}
        onHide={handleCloseDetails}
        lead={selectedLead}
        onLeadUpdated={handleLeadUpdated}
      />

      {showStatusModal && selectedLead && (
        <StatusModal
          show={showStatusModal}
          onHide={handleCloseStatusModal}
          currentStatus={selectedLead.fe_lead_status}
          onStatusChange={handleStatusChange}
        />
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        show={showDeleteModal}
        onHide={handleCloseDeleteModal}
        onConfirm={handleDelete}
        title="Delete Appointment?"
        body="Are you sure you want to delete this appointment? This action cannot be undone."
      />
    </>
  );
});

// Main component with Suspense boundary
const LeadList = forwardRef(({ setEditLead, onLeadSelected, activeLeadId, compact, ...props }, ref) => {
  return (
    <Suspense fallback={
      <div className="w_card">
        <div className="text-center py-4">
          <Spinner animation="border" size="sm" className="me-2" />
          Loading appointments...
        </div>
      </div>
    }>
      <LeadListContent ref={ref} setEditLead={setEditLead} onLeadSelected={onLeadSelected} activeLeadId={activeLeadId} compact={compact} {...props} />
    </Suspense>
  );
});

LeadList.displayName = 'LeadList';

export default LeadList;