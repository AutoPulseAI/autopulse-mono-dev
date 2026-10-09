"use client";
import { statusLabel } from "@lib/statusLabels";
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
import { throwIfStatusFailed } from "../../../lib/bookingConflict"; // stream R: full-slot answer

// Component that uses useSearchParams - needs to be wrapped in Suspense
const LeadList = forwardRef(({ setEditLead, onLeadSelected, activeLeadId, selectedLeadId, compact = false, ...props }, ref) => {
  const canAssignLeads = useCan("Assign Leads");
  const [leads, setLeads] = useState([]);
  const [paginationDirection, setPaginationDirection] = useState(null);
  const paginationDirectionRef = useRef(null); // Use ref to hold direction reliably
  const hasSelectedRef = useRef(false); // Prevent multiple selections
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
  const [staffList, setStaffList] = useState([]);
  const [assignmentFilter, setAssignmentFilter] = useState(urlSearchParams.get('assignment') || 'all'); // 'all', 'my', 'unassigned'
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
      router.replace(`/dealer/leads${query ? `?${query}` : ''}`);
    } catch (e) {
      // no-op if window not available
    }
  };

  // Initialize filters and pagination from URL
  const [filters, setFilters] = useState({
    name: urlSearchParams.get('name') || '',
    email: urlSearchParams.get('email') || '',
    phone: urlSearchParams.get('phone') || '',
    status: urlSearchParams.get('status') || '',
    lead_source: urlSearchParams.get('lead_source') || '',
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

  const [inputValues, setInputValues] = useState({
    name: filters.name,
    email: filters.email,
    phone: filters.phone,
    status: filters.status,
    lead_source: filters.lead_source
  });

  // State for page input (separate from actual page)
  const [pageInputValue, setPageInputValue] = useState('1');
  
  // State for lead source options
  const [leadSourceOptions, setLeadSourceOptions] = useState([]);

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
      const res = await fetch(`/api/staff/list?dealer_id=${dealerParent.id}`);
      const data = await res.json();
      if (res.ok) {
        setStaffList(data.staff || []);
      }
    } catch (err) {
      console.error("Error fetching staff:", err);
    }
  }, [activeEntity?.id]);

  const fetchLeads = useCallback(async () => {
    try {
      console.log('=== fetchLeads called ===');
      console.log('filters.page:', filters.page);
      console.log('pagination.currentPage:', pagination.currentPage);
      setLoading(true);

      // Build query parameters including page
      let queryParams = `dealer_id=${activeEntity.id}&page=${filters.page}&limit=${pagination.itemsPerPage}`;
      console.log('Query params:', queryParams);

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
      if (filters.dateRange.startDate) queryParams += `&startDate=${filters.dateRange.startDate.toISOString()}`;
      if (filters.dateRange.endDate) queryParams += `&endDate=${filters.dateRange.endDate.toISOString()}`;

      const res = await fetch(`/api/leads?${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to fetch leads");

      setLeads(data.data || []);
      setPagination({
        currentPage: data.pagination?.currentPage || filters.page,
        totalPages: data.pagination?.totalPages || 1,
        totalItems: data.pagination?.totalItems || 0,
        itemsPerPage: data.pagination?.itemsPerPage || 10,
        hasNextPage: data.pagination?.hasNextPage || false,
        hasPreviousPage: data.pagination?.hasPreviousPage || false
      });
      
      // Sync pageInputValue with the current page after API call
      const newCurrentPage = data.pagination?.currentPage || filters.page;
      setPageInputValue(newCurrentPage.toString());
      console.log('Updated pageInputValue to:', newCurrentPage.toString());
    } catch (err) {
      console.error("Error fetching leads:", err);
      showAlert("Failed to load leads", "danger");
    } finally {
      setLoading(false);
    }
  }, [activeEntity?.id, filters, assignmentFilter, pagination.itemsPerPage, pagination.currentPage, showAlert]);

  const fetchLeadSourceOptions = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/stats?dealer_id=${activeEntity.id}`);
      const data = await res.json();
      
      if (res.ok && data.lead_sources) {
        // Group lead sources by case-insensitive matching
        const sourceMap = new Map();
        
        data.lead_sources.forEach(source => {
          const originalName = source._id;
          if (originalName && originalName.trim() !== '') {
            const normalizedName = originalName.toLowerCase().trim();
            
            if (sourceMap.has(normalizedName)) {
              // If we already have this source (case-insensitive), keep the better capitalization
              const existing = sourceMap.get(normalizedName);
              if (originalName !== originalName.toLowerCase() && existing === existing.toLowerCase()) {
                sourceMap.set(normalizedName, originalName);
              }
            } else {
              // New source
              sourceMap.set(normalizedName, originalName);
            }
          }
        });
        
        const options = Array.from(sourceMap.values()).sort();
        setLeadSourceOptions(options);
      }
    } catch (err) {
      console.error("Error fetching lead source options:", err);
    }
  }, [activeEntity?.id]);

  useEffect(() => {
    if (!activeEntity?.id) return;
    fetchStaffList();
  }, [activeEntity?.id, fetchStaffList]);

  useEffect(() => {
    if (!activeEntity?.id) return;
    fetchLeads();
    fetchLeadSourceOptions();
  }, [activeEntity?.id, filters, assignmentFilter, fetchLeads, fetchLeadSourceOptions]);

  // Handle lead selection when leads update
  useEffect(() => {
    if (!leads || leads.length === 0) {
      console.log('No leads available');
      return;
    }

    // Check if selectedLead=true is in URL
    const urlParams = new URLSearchParams(window.location.search);
    const selectedLeadInUrl = urlParams.get('selectedLead') === 'true';
    const leadIdInUrl = urlParams.get('leadId');
    
    // Use ref value which is more reliable than state
    const direction = paginationDirectionRef.current;

    console.log('=== Lead Selection Effect ===');
    console.log('URL:', window.location.search);
    console.log('selectedLeadInUrl:', selectedLeadInUrl);
    console.log('leadIdInUrl:', leadIdInUrl);
    console.log('paginationDirectionRef.current:', direction);
    console.log('hasSelectedRef.current:', hasSelectedRef.current);

    // Only auto-select if selectedLead=true is in URL
    if (!selectedLeadInUrl) {
      console.log('selectedLead not in URL, exiting');
      if (direction) {
        paginationDirectionRef.current = null;
        setPaginationDirection(null);
      }
      hasSelectedRef.current = false;
      return;
    }

    try {
      // PRIORITY 1: Handle pagination direction (next/prev clicked)
      // If direction is set, ALWAYS use it (ignore leadId in URL)
      if (direction && !hasSelectedRef.current) {
        console.log(`✅ PRIORITY 1: Direction = ${direction}, selecting lead (ignoring any leadId in URL)`);
        hasSelectedRef.current = true; // Mark as selected to prevent loop
        
        if (direction === "prev") {
          const lastLead = leads[leads.length - 1];
          console.log(`Selecting LAST lead for prev: ${lastLead._id} - ${lastLead.name}`);
          const params = new URLSearchParams(window.location.search);
          params.set('leadId', lastLead._id);
          router.push(`/dealer/leads?${params.toString()}`, undefined, { shallow: true });
          onLeadSelected(lastLead);
          // Clear direction
          paginationDirectionRef.current = null;
          setPaginationDirection(null);
          console.log('Direction cleared after prev');
        } else if (direction === "next") {
          const firstLead = leads[0];
          console.log(`Selecting FIRST lead for next: ${firstLead._id} - ${firstLead.name}`);
          const params = new URLSearchParams(window.location.search);
          params.set('leadId', firstLead._id);
          router.push(`/dealer/leads?${params.toString()}`, undefined, { shallow: true });
          onLeadSelected(firstLead);
          // Clear direction
          paginationDirectionRef.current = null;
          setPaginationDirection(null);
          console.log('Direction cleared after next');
        }
        return;
      }

      // PRIORITY 2: If there's a leadId in URL, check if it exists in current leads
      if (leadIdInUrl) {
        console.log('✅ PRIORITY 2: leadId in URL:', leadIdInUrl);
        
        // If we have a direction set, it means we're in the middle of pagination
        // Ignore the old leadId and let PRIORITY 1 handle it
        if (direction) {
          console.log('⚠️ Direction is set, ignoring old leadId - should use PRIORITY 1');
          // Don't return, let it fall through or be caught by PRIORITY 1 logic
        } else {
          // No direction, so this is a normal lead selection
          const leadExists = leads.some(lead => lead._id === leadIdInUrl);
          
          if (leadExists) {
            const lead = leads.find(l => l._id === leadIdInUrl);
            if (lead) {
              console.log(`Selecting lead from URL: ${lead._id} - ${lead.name}`);
              onLeadSelected(lead);
            }
            hasSelectedRef.current = false; // Reset for next pagination
            return;
          } else {
            console.log('Lead ID not found in current leads');
          }
        }
      }

      // PRIORITY 3: No leadId in URL and no direction - just opened selectedLead=true
      if (!leadIdInUrl && !direction && !hasSelectedRef.current) {
        console.log('✅ PRIORITY 3: No leadId, no direction - selecting first lead');
        hasSelectedRef.current = true; // Prevent loop
        const firstLead = leads[0];
        console.log(`Selecting first lead: ${firstLead._id} - ${firstLead.name}`);
        const params = new URLSearchParams(window.location.search);
        params.set('leadId', firstLead._id);
        router.push(`/dealer/leads?${params.toString()}`, undefined, { shallow: true });
        onLeadSelected(firstLead);
        console.log('PRIORITY 3: Lead selected and URL updated with leadId');
      }

    } catch (err) {
      console.error("Error auto-selecting lead:", err);
    }
  }, [leads, onLeadSelected, router]);

  const exportToCSV = async () => {
    try {
      let url = `/api/leads?format=csv&dealer_id=${activeEntity.id}`;
      
      // Add applied filters to export URL
      if (filters.name) url += `&name=${encodeURIComponent(filters.name)}`;
      if (filters.email) url += `&email=${encodeURIComponent(filters.email)}`;
      if (filters.phone) url += `&phone=${encodeURIComponent(filters.phone)}`;
      if (filters.status) url += `&fe_lead_status=${encodeURIComponent(filters.status)}`;
      if (filters.dateRange.startDate) url += `&startDate=${filters.dateRange.startDate.toISOString()}`;
      if (filters.dateRange.endDate) url += `&endDate=${filters.dateRange.endDate.toISOString()}`;

      // Trigger download
      window.location.href = url;
    } catch (error) {
      console.error("Error exporting to CSV:", error);
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

  const handleSearch = () => {
    const newFilters = {
      ...filters,
      name: inputValues.name,
      email: inputValues.email,
      phone: inputValues.phone,
      status: inputValues.status,
      lead_source: inputValues.lead_source,
      page: 1 // Reset to first page when searching
    };
    setFilters(newFilters);
    
    // Update URL
    const params = new URLSearchParams();
    if (inputValues.name) params.set('name', inputValues.name);
    if (inputValues.email) params.set('email', inputValues.email);
    if (inputValues.phone) params.set('phone', inputValues.phone);
    if (inputValues.status) params.set('status', inputValues.status);
    if (inputValues.lead_source) params.set('lead_source', inputValues.lead_source);
    if (filters.dateRange.startDate) params.set('startDate', filters.dateRange.startDate.toISOString());
    if (filters.dateRange.endDate) params.set('endDate', filters.dateRange.endDate.toISOString());
    params.set('page', 1);
    
    router.push(`?${params.toString()}`, undefined, { shallow: true });
  };

  const handleDateRangeChange = ({ startDate, endDate }) => {
    // Ensure we have valid dates
    const newStartDate = startDate ? new Date(startDate) : null;
    const newEndDate = endDate ? new Date(endDate) : null;
    
    // Reset time parts to ensure full day coverage
    if (newStartDate) newStartDate.setHours(0, 0, 0, 0);
    if (newEndDate) newEndDate.setHours(23, 59, 59, 999);

    const newFilters = {
      ...filters,
      dateRange: {
        startDate: newStartDate,
        endDate: newEndDate
      }
    };
    setFilters(newFilters);

    // Update URL immediately when date range changes
    const params = new URLSearchParams();
    if (filters.name) params.set('name', filters.name);
    if (filters.email) params.set('email', filters.email);
    if (filters.phone) params.set('phone', filters.phone);
    if (filters.status) params.set('status', filters.status);
    if (newStartDate) params.set('startDate', newStartDate.toISOString());
    if (newEndDate) params.set('endDate', newEndDate.toISOString());
    
    router.push(`?${params.toString()}`, undefined, { shallow: true });
  };

  const clearFilters = () => {
    setInputValues({
      name: "",
      email: "",
      phone: "",
      status: ""
    });
    const newFilters = {
      name: "",
      email: "",
      phone: "",
      status: "",
      dateRange: {
        startDate: null,
        endDate: null
      },
      page: 1
    };
    setFilters(newFilters);
    
    // Clear URL parameters
    router.push('/dealer/leads', undefined, { shallow: true });
  };

  // Helper function to handle lead click and update URL with selectedLead=true and leadId
  const handleLeadClick = useCallback((lead) => {
    const params = new URLSearchParams(window.location.search);
    params.set('selectedLead', 'true');
    params.set('leadId', lead._id); // Add the lead ID to URL
    router.push(`/dealer/leads?${params.toString()}`, undefined, { shallow: true });
    onLeadSelected(lead);
  }, [router, onLeadSelected]);

   const handlePageChange = useCallback((page) => {
    if (page < 1) return;
    
    console.log('=== handlePageChange ===');
    console.log('Changing to page:', page);
    console.log('🔥 paginationDirectionRef.current at START of handlePageChange:', paginationDirectionRef.current);
    
    // Update pagination state immediately
    setPagination(prev => ({ ...prev, currentPage: page }));
    
    // Update filters with new page
    const newFilters = {
      ...filters,
      page
    };
    setFilters(newFilters);
    
    // Update URL - preserve existing params including selectedLead
    const params = new URLSearchParams(window.location.search);
    params.set('page', page);
    
    // If selectedLead=true, REMOVE old leadId
    // The new leadId will be set by useEffect based on pagination direction
    if (params.get('selectedLead') === 'true') {
      console.log('Removing leadId from URL');
      params.delete('leadId');
    }
    
    const newUrl = `/dealer/leads?${params.toString()}`;
    console.log('New URL:', newUrl);
    router.push(newUrl, undefined, { shallow: true });
    console.log('🔥 paginationDirectionRef.current at END of handlePageChange:', paginationDirectionRef.current);
  }, [filters, router]);

  const handleShowDetails = (lead) => {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_to: assignedToId || null })
      });

      if (res.ok) {
        showAlert('Lead assignment updated successfully', 'success');
        fetchLeads(); // Refresh leads
      } else {
        showAlert('Failed to update assignment', 'danger');
      }
    } catch (err) {
      console.error('Error updating assignment:', err);
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
        headers: { "Content-Type": "application/json" },
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
      console.error("Error deleting lead:", err);
      showAlert("Failed to delete lead", "danger");
    }
  };

  const handleStatusChange = async (newStatus, extra = {}) => {
    if (!selectedLead) return;

    try {
      const payload = { id: selectedLead._id, status: newStatus, ...extra };
      console.log('Sending lead status update:', payload);
      const response = await fetch("/api/conversations/lead/status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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
      console.error("Error updating status:", err);
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
  moveToNextLead(currentLead) {
    console.log('=== moveToNextLead called ===');
    const idx = leads.findIndex(l => l._id === currentLead._id);
    console.log('Current index:', idx, 'Total leads:', leads.length);
    
    if (idx < leads.length - 1) {
      // Move to next lead on same page
      console.log('Moving to next lead on SAME page');
      handleLeadClick(leads[idx + 1]);
    } else if (pagination.hasNextPage) {
      // Move to next page
      console.log('🔥 Moving to NEXT page');
      
      // IMMEDIATELY update URL to remove old leadId BEFORE anything else
      const params = new URLSearchParams(window.location.search);
      params.set('page', pagination.currentPage + 1);
      params.delete('leadId'); // Remove old leadId NOW
      const newUrl = `/dealer/leads?${params.toString()}`;
      console.log('🔥 Immediately updating URL to:', newUrl);
      router.replace(newUrl, undefined, { shallow: true });
      
      // Set direction AFTER URL is updated
      hasSelectedRef.current = false;
      paginationDirectionRef.current = "next";
      setPaginationDirection("next");
      
      // Trigger page change to fetch new leads
      setPagination(prev => ({ ...prev, currentPage: pagination.currentPage + 1 }));
      setFilters(prev => ({ ...prev, page: pagination.currentPage + 1 }));
    } else {
      console.log('Already at last lead, no next page');
    }
  },
  moveToPrevLead(currentLead) {
    console.log('=== moveToPrevLead called ===');
    const idx = leads.findIndex(l => l._id === currentLead._id);
    console.log('Current index:', idx, 'Total leads:', leads.length);
    
    if (idx > 0) {
      // Move to previous lead on same page
      console.log('Moving to prev lead on SAME page');
      handleLeadClick(leads[idx - 1]);
    } else if (pagination.hasPreviousPage) {
      // Move to previous page
      console.log('🔥 Moving to PREV page');
      
      // IMMEDIATELY update URL to remove old leadId BEFORE anything else
      const params = new URLSearchParams(window.location.search);
      params.set('page', pagination.currentPage - 1);
      params.delete('leadId'); // Remove old leadId NOW
      const newUrl = `/dealer/leads?${params.toString()}`;
      console.log('🔥 Immediately updating URL to:', newUrl);
      router.replace(newUrl, undefined, { shallow: true });
      
      // Set direction AFTER URL is updated
      hasSelectedRef.current = false;
      paginationDirectionRef.current = "prev";
      setPaginationDirection("prev");
      
      // Trigger page change to fetch new leads
      setPagination(prev => ({ ...prev, currentPage: pagination.currentPage - 1 }));
      setFilters(prev => ({ ...prev, page: pagination.currentPage - 1 }));
    } else {
      console.log('Already at first lead, no previous page');
    }
  }
}), [leads, pagination, handleLeadClick, router, setFilters]);


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
        <div className="d-flex gap-2 mb-3">
        {(useCan("Manage Leads")) && (
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
        {(useCan("Manage Leads") || useCan("View Assigned Leads")) && (
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
        {(useCan("Manage Leads") ) && (
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
            <div className="d-flex align-items-center mb-2">
              <h3 className="w_card_title mb-0">Lead List</h3>
              {dealerParent && (
                <span className="ms-2 text-muted"></span>
              )}
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
                <DateRangePickerComponent
                  onDateRangeChange={handleDateRangeChange}
                  dateRange={filters.dateRange}
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
                    disabled={!inputValues.name && !inputValues.email && !inputValues.phone && !inputValues.status && !filters.dateRange.startDate}
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
              <Col xxl={2} xl={4} lg={2} md={2}>
                <Form.Control
                  type="text"
                  placeholder="Name"
                  name="name"
                  value={inputValues.name}
                  onChange={handleInputChange}
                  size="sm"
                />
              </Col>
              <Col xxl={2} xl={4} lg={2} md={2}>
                <Form.Control
                  type="text"
                  placeholder="Email"
                  name="email"
                  value={inputValues.email}
                  onChange={handleInputChange}
                  size="sm"
                />
              </Col>
              <Col xxl={2} xl={4} lg={2} md={2} xs={6}>
                <Form.Control
                  type="text"
                  placeholder="Phone"
                  name="phone"
                  value={inputValues.phone}
                  onChange={handleInputChange}
                  size="sm"
                />
              </Col>
              <Col xxl={1} xl={3} lg={2} md={2} xs={6}>
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
              <Col xxl={2} xl={3} lg={2} md={2} xs={6}>
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
              <Col xxl={1} xl={3} lg={2} md={2} xs={6}>
                <DateRangePickerComponent
                  onDateRangeChange={handleDateRangeChange}
                  dateRange={filters.dateRange}
                  className="w-100"
                />
              </Col>
              <Col xxl={2} xl={3} lg={2} md={2} xs={12}>
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
                    disabled={!inputValues.name && !inputValues.email && !inputValues.phone && !inputValues.status && !filters.dateRange.startDate}
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
                <ListGroup.Item as="li" key={lead._id} className={`lead-item ${activeLeadId === lead._id ? 'active-lead' : ''} w_card_list_box d-flex align-items-center`} onClick={() => handleLeadClick(lead)}>
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
                          <Button variant="custom" size="sm" onClick={() => handleShowDetails(lead)}>
                            <i className="fa-regular fa-eye"></i>
                          </Button>
                          {!compact && (
                          <Button variant="custom" size="sm" onClick={() => handleLeadClick(lead)}>
                            <i className="fa-regular fa-envelope-open"></i>
                          </Button>
                          )}
                          <Button variant="danger" size="sm" onClick={() => handleShowDeleteModal(lead)}>
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
                            <p className="text-truncate">{formatTimestamp(lead.createdAt)}</p>
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
                        <Button variant="custom" size="sm" onClick={() => handleShowDetails(lead)}>
                          <i className="fa-regular fa-eye"></i>
                        </Button>
                        <Button variant="custom" size="sm" onClick={() => handleLeadClick(lead)}>
                          <i className="fa-regular fa-envelope-open"></i>
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => handleShowDeleteModal(lead)}>
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
              <Pagination className="mb-md-0 justify-content-center">
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
              
              {/* Page Input Box */}
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