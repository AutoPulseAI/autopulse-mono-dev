"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { Button, Form, Alert, Table, Badge, Modal, Spinner, Pagination, Row, Col } from "react-bootstrap";
import { useUser } from "../../context/UserContext";

function MultiSelectFilter({
  label,
  placeholder,
  options,
  selected,
  onToggle,
  onClear,
  menuKey,
  openMenu,
  setOpenMenu,
  menuRef,
  searchable = false,
  searchPlaceholder = "Search..."
}) {
  const isOpen = openMenu === menuKey;
  const [search, setSearch] = useState("");
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      // Focus search after open
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const filteredOptions = searchable && search.trim()
    ? options.filter((option) =>
        String(option).toLowerCase().includes(search.trim().toLowerCase())
      )
    : options;

  return (
    <>
      <Form.Label className="small text-muted mb-1">{label}</Form.Label>
      <div className="position-relative" ref={menuRef}>
        <Button
          variant="outline-secondary"
          size="sm"
          className="w-100 text-start d-flex justify-content-between align-items-center"
          onClick={() => setOpenMenu(isOpen ? null : menuKey)}
          type="button"
        >
          <span className="text-truncate">
            {selected.length === 0 ? placeholder : `${selected.length} selected`}
          </span>
          <i className={`fa-solid fa-chevron-${isOpen ? "up" : "down"} ms-2`}></i>
        </Button>
        {isOpen && (
          <div
            className="position-absolute top-100 start-0 w-100 bg-white border rounded shadow-sm mt-1"
            style={{ zIndex: 1055 }}
          >
            {searchable && (
              <div className="p-2 border-bottom sticky-top bg-white">
                <Form.Control
                  ref={searchInputRef}
                  type="text"
                  size="sm"
                  placeholder={searchPlaceholder}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  autoComplete="off"
                />
              </div>
            )}
            <div className="p-2" style={{ maxHeight: 180, overflowY: "auto" }}>
              {filteredOptions.length === 0 ? (
                <div className="small text-muted px-1 py-2">
                  {options.length === 0 ? "No options found" : "No matches"}
                </div>
              ) : (
                filteredOptions.map((option) => (
                  <Form.Check
                    key={option}
                    type="checkbox"
                    id={`${menuKey}-option-${option}`}
                    className="mb-1"
                    label={option}
                    checked={selected.includes(option)}
                    onChange={() => onToggle(option)}
                  />
                ))
              )}
            </div>
            {selected.length > 0 && (
              <div className="px-2 pb-2">
                <Button
                  variant="link"
                  size="sm"
                  className="p-0 text-decoration-none"
                  type="button"
                  onClick={onClear}
                >
                  Clear
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <div className="d-flex flex-wrap gap-1 mt-2">
          {selected.map((item) => (
            <Badge
              key={item}
              bg="secondary"
              className="fw-normal"
              style={{ cursor: "pointer" }}
              onClick={() => onToggle(item)}
              title="Click to remove"
            >
              {item} ×
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}

export default function CampaignLeadList({ leads, setLeads, dealerId }) {
  const [showSelectModal, setShowSelectModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [availableLeads, setAvailableLeads] = useState([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState(new Set());
  const [selectedLeadsData, setSelectedLeadsData] = useState(new Map()); // Store full lead data by ID
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [leadPagination, setLeadPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 100 // Changed to 100 as requested
  });
  const [leadFilters, setLeadFilters] = useState({
    name: "",
    email: "",
    phone: "",
    lead_sources: [],
    fe_lead_status: "",
    source: "",
    response_mode: [],
    followup_preference: [],
    startDate: "",
    endDate: "",
    stocks: [],
    makes: [],
    models: [],
    years: [],
    condition: ""
  });
  const emptyLeadFilters = {
    name: "",
    email: "",
    phone: "",
    lead_sources: [],
    fe_lead_status: "",
    source: "",
    response_mode: [],
    followup_preference: [],
    startDate: "",
    endDate: "",
    stocks: [],
    makes: [],
    models: [],
    years: [],
    condition: ""
  };
  const [leadSourceOptions, setLeadSourceOptions] = useState([]);
  const [statusOptions, setStatusOptions] = useState([]);
  const [sourceOptions, setSourceOptions] = useState([]);
  const [makeOptions, setMakeOptions] = useState([]);
  const [modelOptions, setModelOptions] = useState([]);
  const [yearOptions, setYearOptions] = useState([]);
  const [stockOptions, setStockOptions] = useState([]);
  const [conditionOptions, setConditionOptions] = useState(["New", "Used", "Certified"]);
  const [openMultiMenu, setOpenMultiMenu] = useState(null);
  const leadSourceMenuRef = useRef(null);
  const stockMenuRef = useRef(null);
  const makeMenuRef = useRef(null);
  const modelMenuRef = useRef(null);
  const yearMenuRef = useRef(null);
  const [selectAllMode, setSelectAllMode] = useState(false); // Track if "Select All" is active
  const [leadsPagination, setLeadsPagination] = useState({
    currentPage: 1,
    itemsPerPage: 500
  });
  const [selectedLeadsPreviewPagination, setSelectedLeadsPreviewPagination] = useState({
    currentPage: 1,
    itemsPerPage: 50
  });
  const [showSelectedLeadsPreview, setShowSelectedLeadsPreview] = useState(false);
  const fileInputRef = useRef(null);
  const [importError, setImportError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const { user, dealerParent } = useUser();
  const activeEntity = dealerParent || user;

  const buildLeadQueryParams = (page, limit) => {
    let queryParams = `dealer_id=${activeEntity.id}&page=${page}&limit=${limit}`;
    if (leadFilters.name) queryParams += `&name=${encodeURIComponent(leadFilters.name)}`;
    if (leadFilters.email) queryParams += `&email=${encodeURIComponent(leadFilters.email)}`;
    if (leadFilters.phone) queryParams += `&phone=${encodeURIComponent(leadFilters.phone)}`;
    if (leadFilters.lead_sources && leadFilters.lead_sources.length > 0) {
      leadFilters.lead_sources.forEach((source) => {
        queryParams += `&lead_source=${encodeURIComponent(source)}`;
      });
    }
    if (leadFilters.fe_lead_status) queryParams += `&fe_lead_status=${encodeURIComponent(leadFilters.fe_lead_status)}`;
    if (leadFilters.source) queryParams += `&source=${encodeURIComponent(leadFilters.source)}`;
    if (leadFilters.response_mode && leadFilters.response_mode.length > 0) {
      leadFilters.response_mode.forEach(mode => {
        queryParams += `&response_mode=${encodeURIComponent(mode)}`;
      });
    }
    if (leadFilters.followup_preference && leadFilters.followup_preference.length > 0) {
      leadFilters.followup_preference.forEach(pref => {
        queryParams += `&followup_preference=${encodeURIComponent(pref)}`;
      });
    }
    if (leadFilters.startDate) queryParams += `&startDate=${encodeURIComponent(leadFilters.startDate)}`;
    if (leadFilters.endDate) queryParams += `&endDate=${encodeURIComponent(leadFilters.endDate)}`;
    if (leadFilters.stocks && leadFilters.stocks.length > 0) {
      leadFilters.stocks.forEach((stock) => {
        queryParams += `&stock=${encodeURIComponent(stock)}`;
      });
    }
    if (leadFilters.makes && leadFilters.makes.length > 0) {
      leadFilters.makes.forEach((make) => {
        queryParams += `&make=${encodeURIComponent(make)}`;
      });
    }
    if (leadFilters.models && leadFilters.models.length > 0) {
      leadFilters.models.forEach((model) => {
        queryParams += `&model=${encodeURIComponent(model)}`;
      });
    }
    if (leadFilters.years && leadFilters.years.length > 0) {
      leadFilters.years.forEach((year) => {
        queryParams += `&year=${encodeURIComponent(year)}`;
      });
    }
    if (leadFilters.condition) queryParams += `&condition=${encodeURIComponent(leadFilters.condition)}`;
    return queryParams;
  };

  const toggleMultiFilter = (field, value) => {
    setLeadFilters((prev) => {
      const selected = prev[field] || [];
      const exists = selected.includes(value);
      return {
        ...prev,
        [field]: exists
          ? selected.filter((item) => item !== value)
          : [...selected, value]
      };
    });
  };

    const getStatusVariant = (status) => {
    switch (status?.toLowerCase()) {
      case 'contacted': return 'info';
      case 'appointment booked': return 'warning';
      case 'visited': return 'success';
      case 'managerial review': return 'info';
      case 'sold': return 'danger';
      case 'lead': return 'custom';
      case 'dnd': return 'secondary';
      default: return 'secondary';
    }
  };

  // Fetch filter options (lead sources, statuses, source types, models, stock numbers)
  const fetchFilterOptions = useCallback(async () => {
    if (!activeEntity?.id) return;
    
    try {
      const [statsRes, vehicleOptionsRes] = await Promise.all([
        fetch(`/api/leads/stats?dealer_id=${activeEntity.id}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
          }
        }),
        fetch(`/api/vehicles/options?dealer_id=${activeEntity.id}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
          }
        })
      ]);

      const data = await statsRes.json();
      
      if (statsRes.ok) {
        // Process lead sources
        if (data.lead_sources) {
          const sourceMap = new Map();
          data.lead_sources.forEach(source => {
            const originalName = source._id;
            if (originalName && originalName.trim() !== '') {
              const normalizedName = originalName.toLowerCase().trim();
              if (sourceMap.has(normalizedName)) {
                const existing = sourceMap.get(normalizedName);
                if (originalName !== originalName.toLowerCase() && existing === existing.toLowerCase()) {
                  sourceMap.set(normalizedName, originalName);
                }
              } else {
                sourceMap.set(normalizedName, originalName);
              }
            }
          });
          setLeadSourceOptions(Array.from(sourceMap.values()).sort());
        }
        
        // Process statuses
        if (data.statuses) {
          const statusList = data.statuses
            .map(s => s._id)
            .filter(s => s && s.trim() !== '')
            .sort();
          setStatusOptions(statusList);
        }
        
        // Process source types (email, sms, campaign, etc.)
        if (data.sources) {
          const sourceTypeMap = new Map();
          data.sources.forEach(source => {
            const originalName = source._id;
            if (originalName && originalName.trim() !== '') {
              const normalizedName = originalName.toLowerCase().trim();
              if (sourceTypeMap.has(normalizedName)) {
                const existing = sourceTypeMap.get(normalizedName);
                if (originalName !== originalName.toLowerCase() && existing === existing.toLowerCase()) {
                  sourceTypeMap.set(normalizedName, originalName);
                }
              } else {
                sourceTypeMap.set(normalizedName, originalName);
              }
            }
          });
          setSourceOptions(Array.from(sourceTypeMap.values()).sort());
        }
      }

      if (vehicleOptionsRes.ok) {
        const vehicleOptions = await vehicleOptionsRes.json();
        setMakeOptions(vehicleOptions.makes || []);
        setModelOptions(vehicleOptions.models || []);
        setYearOptions(vehicleOptions.years || []);
        setStockOptions(vehicleOptions.stocknumbers || []);
        setConditionOptions(
          vehicleOptions.conditions?.length
            ? vehicleOptions.conditions
            : ["New", "Used", "Certified"]
        );
      }
    } catch (err) {
      console.error("Error fetching filter options:", err);
    }
  }, [activeEntity?.id]);

  // Fetch leads from API
  const fetchAvailableLeads = useCallback(async (page = 1) => {
    if (!activeEntity?.id) return;
    
    setLoadingLeads(true);
    try {
      const queryParams = buildLeadQueryParams(page, leadPagination.itemsPerPage);

      const res = await fetch(`/api/leads?${queryParams}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to fetch leads");

      setAvailableLeads(data.data || []);
      setLeadPagination({
        currentPage: data.pagination?.currentPage || page,
        totalPages: data.pagination?.totalPages || 1,
        totalItems: data.pagination?.totalItems || 0,
        itemsPerPage: data.pagination?.itemsPerPage || 100
      });
    } catch (err) {
      console.error("Error fetching leads:", err);
    } finally {
      setLoadingLeads(false);
    }
  }, [activeEntity?.id, leadFilters, leadPagination.itemsPerPage]);

  // Fetch filter options when modal opens
  useEffect(() => {
    if (showSelectModal && activeEntity?.id) {
      fetchFilterOptions();
    }
  }, [showSelectModal, activeEntity?.id, fetchFilterOptions]);

  // Close multi-select menus when clicking outside
  useEffect(() => {
    if (!openMultiMenu) return;
    const handleClickOutside = (event) => {
      const refs = [leadSourceMenuRef, stockMenuRef, makeMenuRef, modelMenuRef, yearMenuRef];
      const clickedInside = refs.some((ref) => ref.current && ref.current.contains(event.target));
      if (!clickedInside) {
        setOpenMultiMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openMultiMenu]);

  // Fetch leads when modal opens
  useEffect(() => {
    if (showSelectModal && activeEntity?.id) {
      // Reset to page 1 when modal opens, but keep selected leads
      setLeadPagination(prev => ({ ...prev, currentPage: 1 }));
      fetchAvailableLeads(1);
      // Only reset selected leads when modal first opens, not on subsequent fetches
      if (selectedLeadIds.size === 0) {
        setSelectedLeadIds(new Set());
        setSelectedLeadsData(new Map());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSelectModal, activeEntity?.id]);

  const handleSelectLead = (leadId) => {
    const newSelected = new Set(selectedLeadIds);
    const newSelectedData = new Map(selectedLeadsData);
    
    if (newSelected.has(leadId)) {
      // Deselect
      newSelected.delete(leadId);
      newSelectedData.delete(leadId);
    } else {
      // Select - find the lead data from available leads
      const lead = availableLeads.find(l => l._id === leadId);
      if (lead) {
        newSelected.add(leadId);
        newSelectedData.set(leadId, {
          _id: lead._id,
          name: lead.name || "",
          email: lead.email || "",
          phone: lead.phone || ""
        });
      }
    }
    
    setSelectedLeadIds(newSelected);
    setSelectedLeadsData(newSelectedData);
  };

  const handleSelectAll = () => {
    // Get current page lead IDs
    const currentPageLeadIds = availableLeads.map(lead => lead._id);
    // Check if all current page leads are selected
    const allCurrentPageSelected = currentPageLeadIds.every(id => selectedLeadIds.has(id));
    
    const newSelected = new Set(selectedLeadIds);
    const newSelectedData = new Map(selectedLeadsData);
    
    if (allCurrentPageSelected) {
      // Deselect all leads on current page
      currentPageLeadIds.forEach(id => {
        newSelected.delete(id);
        newSelectedData.delete(id);
      });
      setSelectAllMode(false);
    } else {
      // Select all leads on current page (keep previous selections from other pages)
      availableLeads.forEach(lead => {
        newSelected.add(lead._id);
        newSelectedData.set(lead._id, {
          _id: lead._id,
          name: lead.name || "",
          email: lead.email || "",
          phone: lead.phone || ""
        });
      });
    }
    
    setSelectedLeadIds(newSelected);
    setSelectedLeadsData(newSelectedData);
  };

  // Handle "Select All" across all pages
  const handleSelectAllPages = async () => {
    if (selectAllMode) {
      // Deselect all
      setSelectedLeadIds(new Set());
      setSelectedLeadsData(new Map());
      setSelectAllMode(false);
      return;
    }

    // Fetch all leads matching current filters
    setLoadingLeads(true);
    try {
      const queryParams = buildLeadQueryParams(1, 10000); // Large limit to get all

        const res = await fetch(`/api/leads?${queryParams}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
          }
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Failed to fetch leads");

        // Select all fetched leads
      const allLeads = data.data || [];
      const newSelected = new Set();
      const newSelectedData = new Map();
      
      allLeads.forEach(lead => {
        newSelected.add(lead._id);
        newSelectedData.set(lead._id, {
          _id: lead._id,
          name: lead.name || "",
          email: lead.email || "",
          phone: lead.phone || ""
        });
      });
      
      setSelectedLeadIds(newSelected);
      setSelectedLeadsData(newSelectedData);
      setSelectAllMode(true);
    } catch (err) {
      console.error("Error selecting all leads:", err);
      alert("Failed to select all leads. Please try again.");
    } finally {
      setLoadingLeads(false);
    }
  };

  const handleAddSelectedLeads = async () => {
    if (selectedLeadIds.size === 0 && !selectAllMode) {
      return;
    }

    let leadsToAdd = [];

    if (selectAllMode) {
      // If "Select All" is active, fetch all matching leads
      setLoadingLeads(true);
      try {
        const queryParams = buildLeadQueryParams(1, 10000);

        const res = await fetch(`/api/leads?${queryParams}`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
          }
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Failed to fetch leads");

        const allLeads = data.data || [];
        leadsToAdd = allLeads
          .filter(lead => {
            const hasContact = (lead.email && lead.email.toString().trim().length > 0) || 
                              (lead.phone && lead.phone.toString().trim().length > 0);
            return hasContact;
          })
          .map(lead => ({
            name: (lead.name || "").toString().trim() || "N/A",
            email: (lead.email || "").toString().trim(),
            phone: (lead.phone || "").toString().trim(),
            lead_id: lead._id,
            id: `temp_${lead._id}_${Date.now()}`
          }));
      } catch (err) {
        console.error("Error fetching all leads:", err);
        alert("Failed to fetch all leads. Please try again.");
        setLoadingLeads(false);
        return;
      } finally {
        setLoadingLeads(false);
      }
    } else {
      // Use stored lead data from selected leads
      leadsToAdd = Array.from(selectedLeadsData.values())
        .filter(lead => {
          const hasContact = (lead.email && lead.email.toString().trim().length > 0) || 
                            (lead.phone && lead.phone.toString().trim().length > 0);
          return hasContact;
        })
        .map(lead => ({
          name: (lead.name || "").toString().trim() || "N/A",
          email: (lead.email || "").toString().trim(),
          phone: (lead.phone || "").toString().trim(),
          lead_id: lead._id,
          id: `temp_${lead._id}_${Date.now()}`
        }));
    }
    
    if (leadsToAdd.length === 0) {
      alert("No valid leads to add. All selected leads must have at least one contact method (email or phone).");
      return;
    }

    // Check for duplicates with existing campaign leads
    const newLeads = leadsToAdd.filter(newLead => {
      return !leads.some(existingLead => {
        // Check by lead_id if available
        if (existingLead.lead_id && newLead.lead_id && existingLead.lead_id === newLead.lead_id) {
          return true;
        }
        // Check by email
        if (existingLead.email && newLead.email && 
            existingLead.email.toLowerCase() === newLead.email.toLowerCase()) {
          return true;
        }
        // Check by phone
        if (existingLead.phone && newLead.phone && 
            existingLead.phone.replace(/\D/g, '') === newLead.phone.replace(/\D/g, '')) {
          return true;
        }
        return false;
      });
    });

    if (newLeads.length === 0) {
      alert("All selected leads are already in the campaign");
      return;
    }

    // Add new leads to campaign
    setLeads([...leads, ...newLeads]);
    setSelectedLeadIds(new Set());
    setSelectedLeadsData(new Map());
    setSelectAllMode(false);
    setLeadsPagination(prev => ({ ...prev, currentPage: 1 })); // Reset pagination when leads are added
    setShowSelectModal(false);
  };

  const handleRemoveLead = (index) => {
    const newLeads = leads.filter((_, i) => i !== index);
    setLeads(newLeads);
    // Reset pagination if current page would be empty
    const totalPages = Math.ceil(newLeads.length / leadsPagination.itemsPerPage);
    if (leadsPagination.currentPage > totalPages && totalPages > 0) {
      setLeadsPagination(prev => ({ ...prev, currentPage: totalPages }));
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (selectedFile.type === "text/csv" || selectedFile.name.endsWith(".csv")) {
        setImportError("");
      } else {
        setImportError("Please select a valid CSV file.");
      }
    }
  };

  const parseCSV = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      throw new Error("CSV file must have at least a header row and one data row");
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const nameIndex = headers.findIndex(h => h === 'name');
    const emailIndex = headers.findIndex(h => h === 'email');
    const phoneIndex = headers.findIndex(h => h === 'phone');

    if (nameIndex === -1) {
      throw new Error("CSV must have a 'name' column");
    }

    if (emailIndex === -1 && phoneIndex === -1) {
      throw new Error("CSV must have either an 'email' or 'phone' column");
    }

    const parsedLeads = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const lead = {
        name: values[nameIndex] || "",
        email: emailIndex !== -1 ? values[emailIndex] : "",
        phone: phoneIndex !== -1 ? values[phoneIndex] : ""
      };

      // Validate lead - ensure at least one contact method (name validation handled by API)
      const hasContact = (lead.email && lead.email.toString().trim().length > 0) || 
                        (lead.phone && lead.phone.toString().trim().length > 0);
      
      if (hasContact) {
        parsedLeads.push({
          name: (lead.name || "").toString().trim() || "N/A",
          email: (lead.email || "").toString().trim(),
          phone: (lead.phone || "").toString().trim(),
          // Note: CSV leads don't have lead_id (they're not existing leads in database)
          // The 'id' field below is just a temporary React key, not saved to database
          id: `temp_${Date.now()}_${i}_${Math.random()}`
        });
      }
    }

    return parsedLeads;
  };

  const handleImportCSV = async (e) => {
    e.preventDefault();
    const file = fileInputRef.current?.files[0];
    
    if (!file) {
      setImportError("Please select a CSV file");
      return;
    }

    setIsImporting(true);
    setImportError("");

    try {
      const text = await file.text();
      const parsedLeads = parseCSV(text);

      if (parsedLeads.length === 0) {
        setImportError("No valid leads found in CSV file");
        setIsImporting(false);
        return;
      }

      // Check for duplicates with existing leads
      const newLeads = parsedLeads.filter(parsedLead => {
        return !leads.some(existingLead => 
          (existingLead.email && parsedLead.email && 
           existingLead.email.toLowerCase() === parsedLead.email.toLowerCase()) ||
          (existingLead.phone && parsedLead.phone && 
           existingLead.phone.replace(/\D/g, '') === parsedLead.phone.replace(/\D/g, ''))
        );
      });

      if (newLeads.length === 0) {
        setImportError("All leads from CSV already exist in the campaign");
        setIsImporting(false);
        return;
      }

      // Add new leads
      setLeads([...leads, ...newLeads]);
      
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      
      setShowImportModal(false);
      setImportError("");
    } catch (err) {
      setImportError(err.message || "Failed to parse CSV file");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <>
      <div className="d-md-flex justify-content-between align-items-center mb-2">
        <h5 className="w_card_title mb-md-0 mb-2">Campaign Leads ({leads.length})</h5>
        <div className="d-flex gap-2">
          <Button
            variant="outline-custom"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowSelectModal(true);
            }}
            type="button"
          >
            <i className="fa-solid fa-list-check me-1"></i>Select from Leads
          </Button>
          <Button
            variant="outline-custom"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowImportModal(true);
            }}
            type="button"
          >
            <i className="fa fa-upload me-1"></i>Import CSV
          </Button>
        </div>
      </div>

      {leads.length === 0 ? (
        <Alert variant="info" className="text-start p-md-3 p-2">
          No leads added yet. You can select leads from your existing database or import from CSV file. You can also use both methods together.
        </Alert>
      ) : (
        <>
          <div className="table-responsive">
            <Table striped bordered hover size="sm">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Source</th>
                  <th width="100">Action</th>
                </tr>
              </thead>
              <tbody>
                {leads
                  .slice(
                    (leadsPagination.currentPage - 1) * leadsPagination.itemsPerPage,
                    leadsPagination.currentPage * leadsPagination.itemsPerPage
                  )
                  .map((lead, index) => {
                    const actualIndex = (leadsPagination.currentPage - 1) * leadsPagination.itemsPerPage + index;
                    return (
                <tr key={lead.id || index}>
                  <td>{lead.name || "N/A"}</td>
                  <td>{lead.email || "N/A"}</td>
                  <td>{lead.phone || "N/A"}</td>
                  <td>
                    <Badge bg={lead.lead_id ? "info" : "secondary"}>
                      {lead.lead_id ? (
                        <><i className="fa-solid fa-database me-1"></i>Database</>
                      ) : (
                        <><i className="fa-solid fa-file-csv me-1"></i>CSV</>
                      )}
                    </Badge>
                  </td>
                  <td>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRemoveLead(actualIndex);
                      }}
                      type="button"
                    >
                      <i className="fa-regular fa-trash"></i>
                    </Button>
                  </td>
                </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          {leads.length > leadsPagination.itemsPerPage && (
            <div className="d-flex justify-content-center mt-3">
              <Pagination className="mb-0">
                <Pagination.Prev
                  onClick={() => setLeadsPagination(prev => ({ ...prev, currentPage: Math.max(1, prev.currentPage - 1) }))}
                  disabled={leadsPagination.currentPage === 1}
                />
                <Pagination.Item active>
                  {leadsPagination.currentPage} / {Math.ceil(leads.length / leadsPagination.itemsPerPage)}
                </Pagination.Item>
                <Pagination.Next
                  onClick={() => setLeadsPagination(prev => ({ ...prev, currentPage: Math.min(Math.ceil(leads.length / prev.itemsPerPage), prev.currentPage + 1) }))}
                  disabled={leadsPagination.currentPage >= Math.ceil(leads.length / leadsPagination.itemsPerPage)}
                />
              </Pagination>
            </div>
          )}
        </>
      )}

      {/* Select Leads from Database Modal */}
      <Modal 
        show={showSelectModal} 
        onHide={() => {
          setShowSelectModal(false);
          setSelectedLeadIds(new Set());
          setSelectedLeadsData(new Map());
          setSelectAllMode(false);
          setShowSelectedLeadsPreview(false);
          setOpenMultiMenu(null);
          setSelectedLeadsPreviewPagination({ currentPage: 1, itemsPerPage: 50 });
          setLeadFilters({ ...emptyLeadFilters });
        }} 
        centered 
        size="xl"
      >
        <Modal.Header closeButton>
          <Modal.Title>Select Leads from Your Database</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {/* Search Filters */}
          <div className="campaign-lead-filters mb-3">
            <div className="border rounded-3 p-3 mb-3 bg-light">
              <div className="d-flex align-items-center justify-content-between mb-2">
                <h6 className="mb-0 fw-semibold">
                  <i className="fa-solid fa-user me-2 text-muted"></i>
                  Contact & Lead Filters
                </h6>
              </div>
              <Row className="g-2">
                <Col md={4}>
                  <Form.Label className="small text-muted mb-1">Name</Form.Label>
                  <Form.Control
                    type="text"
                    placeholder="Search by name"
                    value={leadFilters.name}
                    onChange={(e) => setLeadFilters(prev => ({ ...prev, name: e.target.value }))}
                    size="sm"
                  />
                </Col>
                <Col md={4}>
                  <Form.Label className="small text-muted mb-1">Email</Form.Label>
                  <Form.Control
                    type="text"
                    placeholder="Search by email"
                    value={leadFilters.email}
                    onChange={(e) => setLeadFilters(prev => ({ ...prev, email: e.target.value }))}
                    size="sm"
                  />
                </Col>
                <Col md={4}>
                  <Form.Label className="small text-muted mb-1">Phone</Form.Label>
                  <Form.Control
                    type="text"
                    placeholder="Search by phone"
                    value={leadFilters.phone}
                    onChange={(e) => setLeadFilters(prev => ({ ...prev, phone: e.target.value }))}
                    size="sm"
                  />
                </Col>
                <Col md={4}>
                  <MultiSelectFilter
                    label="Lead Sources"
                    placeholder="All Lead Sources"
                    options={leadSourceOptions}
                    selected={leadFilters.lead_sources}
                    onToggle={(value) => toggleMultiFilter("lead_sources", value)}
                    onClear={() => setLeadFilters((prev) => ({ ...prev, lead_sources: [] }))}
                    menuKey="lead_sources"
                    openMenu={openMultiMenu}
                    setOpenMenu={setOpenMultiMenu}
                    menuRef={leadSourceMenuRef}
                  />
                </Col>
                <Col md={4}>
                  <Form.Label className="small text-muted mb-1">Status</Form.Label>
                  <Form.Select
                    value={leadFilters.fe_lead_status}
                    onChange={(e) => setLeadFilters(prev => ({ ...prev, fe_lead_status: e.target.value }))}
                    size="sm"
                  >
                    <option value="">All Statuses</option>
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </Form.Select>
                </Col>
                <Col md={2}>
                  <Form.Label className="small text-muted mb-1">From</Form.Label>
                  <Form.Control
                    type="date"
                    value={leadFilters.startDate}
                    onChange={(e) => setLeadFilters(prev => ({ ...prev, startDate: e.target.value }))}
                    size="sm"
                  />
                </Col>
                <Col md={2}>
                  <Form.Label className="small text-muted mb-1">To</Form.Label>
                  <Form.Control
                    type="date"
                    value={leadFilters.endDate}
                    onChange={(e) => setLeadFilters(prev => ({ ...prev, endDate: e.target.value }))}
                    size="sm"
                  />
                </Col>
              </Row>
            </div>

            <div className="border rounded-3 p-3 mb-3">
              <div className="d-flex align-items-center justify-content-between mb-2">
                <div>
                  <h6 className="mb-0 fw-semibold">
                    <i className="fa-solid fa-car me-2 text-muted"></i>
                    Inventory Search
                  </h6>
                  <small className="text-muted">
                    Filter leads by matching inventory VIN (stock → vehicle → lead)
                  </small>
                </div>
              </div>
              <Row className="g-2">
                <Col md={6} lg={3}>
                  <MultiSelectFilter
                    label="Stock # (STK)"
                    placeholder="All Stock Numbers"
                    options={stockOptions}
                    selected={leadFilters.stocks}
                    onToggle={(value) => toggleMultiFilter("stocks", value)}
                    onClear={() => setLeadFilters((prev) => ({ ...prev, stocks: [] }))}
                    menuKey="stocks"
                    openMenu={openMultiMenu}
                    setOpenMenu={setOpenMultiMenu}
                    menuRef={stockMenuRef}
                    searchable
                    searchPlaceholder="Search stock #"
                  />
                </Col>
                <Col md={6} lg={3}>
                  <MultiSelectFilter
                    label="Make"
                    placeholder="All Makes"
                    options={makeOptions}
                    selected={leadFilters.makes}
                    onToggle={(value) => toggleMultiFilter("makes", value)}
                    onClear={() => setLeadFilters((prev) => ({ ...prev, makes: [] }))}
                    menuKey="makes"
                    openMenu={openMultiMenu}
                    setOpenMenu={setOpenMultiMenu}
                    menuRef={makeMenuRef}
                    searchable
                    searchPlaceholder="Search make"
                  />
                </Col>
                <Col md={6} lg={2}>
                  <MultiSelectFilter
                    label="Model"
                    placeholder="All Models"
                    options={modelOptions}
                    selected={leadFilters.models}
                    onToggle={(value) => toggleMultiFilter("models", value)}
                    onClear={() => setLeadFilters((prev) => ({ ...prev, models: [] }))}
                    menuKey="models"
                    openMenu={openMultiMenu}
                    setOpenMenu={setOpenMultiMenu}
                    menuRef={modelMenuRef}
                    searchable
                    searchPlaceholder="Search model"
                  />
                </Col>
                <Col md={6} lg={2}>
                  <MultiSelectFilter
                    label="Year"
                    placeholder="All Years"
                    options={yearOptions}
                    selected={leadFilters.years}
                    onToggle={(value) => toggleMultiFilter("years", value)}
                    onClear={() => setLeadFilters((prev) => ({ ...prev, years: [] }))}
                    menuKey="years"
                    openMenu={openMultiMenu}
                    setOpenMenu={setOpenMultiMenu}
                    menuRef={yearMenuRef}
                    searchable
                    searchPlaceholder="Search year"
                  />
                </Col>
                <Col md={6} lg={2}>
                  <Form.Label className="small text-muted mb-1">Condition</Form.Label>
                  <Form.Select
                    value={leadFilters.condition}
                    onChange={(e) => setLeadFilters(prev => ({ ...prev, condition: e.target.value }))}
                    size="sm"
                  >
                    <option value="">All Conditions</option>
                    {conditionOptions.map((condition) => (
                      <option key={condition} value={condition}>
                        {condition}
                      </option>
                    ))}
                  </Form.Select>
                </Col>
              </Row>
            </div>

            <div className="d-flex justify-content-end gap-2">
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => {
                  setLeadFilters({ ...emptyLeadFilters });
                  setOpenMultiMenu(null);
                  setLeadPagination(prev => ({ ...prev, currentPage: 1 }));
                  setTimeout(() => fetchAvailableLeads(1), 100);
                }}
                disabled={loadingLeads}
                type="button"
              >
                Clear
              </Button>
              <Button
                variant="outline-custom"
                size="sm"
                onClick={() => {
                  setOpenMultiMenu(null);
                  setLeadPagination(prev => ({ ...prev, currentPage: 1 }));
                  fetchAvailableLeads(1);
                }}
                disabled={loadingLeads}
                type="button"
              >
                <i className="fa-solid fa-magnifying-glass me-1"></i>
                Search
              </Button>
            </div>
          </div>

          <Row className="g-0">
            <Col md={12} >
              <div className="d-flex justify-content-between align-items-center mb-2">
                  <div className="d-flex gap-2">
                    <Button
                      variant="link"
                      size="sm"
                      onClick={handleSelectAll}
                      className="p-0 text-custom text-decoration-none"
                    >
                      {availableLeads.every(lead => selectedLeadIds.has(lead._id)) ? "Deselect Page" : "Select Page"}
                    </Button>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={handleSelectAllPages}
                      className="p-0 text-custom text-decoration-none"
                      disabled={loadingLeads}
                    >
                      {selectAllMode ? "Deselect All" : "Select All"}
                    </Button>
                  </div>
                  <p className="mb-0">
                    {selectAllMode ? (
                      <span className="ms-1 text-muted small">
                        All {leadPagination.totalItems} leads selected
                      </span>
                    ) : (
                      <>
                        {selectedLeadIds.size > 0 && (
                          <span className="ms-1 text-muted small">
                            {selectedLeadIds.size} selected /
                          </span>
                        )}
                        <span className="ms-1 text-muted small">
                          {leadPagination.totalItems} leads found
                        </span>
                      </>
                    )}
                  </p>
              </div>
            </Col>
          </Row>

          {loadingLeads ? (
            <div className="text-center py-4">
              <Spinner animation="border" />
            </div>
          ) : availableLeads.length === 0 ? (
            <Alert variant="info" className="text-center">
              No leads found. Try adjusting your search filters.
            </Alert>
          ) : (
            <>
              <div className="table-responsive" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                <Table striped bordered hover size="sm">
                  <thead style={{ position: 'sticky', top: 0, backgroundColor: 'white', zIndex: 1 }}>
                    <tr>
                      <th width="50">
                        <Form.Check
                          type="checkbox"
                          checked={availableLeads.length > 0 && availableLeads.every(lead => selectedLeadIds.has(lead._id))}
                          onChange={handleSelectAll}
                          indeterminate={availableLeads.some(lead => selectedLeadIds.has(lead._id)) && !availableLeads.every(lead => selectedLeadIds.has(lead._id))}
                        />
                      </th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableLeads.map((lead) => (
                      <tr key={lead._id}>
                        <td>
                          <Form.Check
                            type="checkbox"
                            checked={selectedLeadIds.has(lead._id)}
                            onChange={() => handleSelectLead(lead._id)}
                          />
                        </td>
                        <td>{lead.name || "N/A"}</td>
                        <td>{lead.email || "N/A"}</td>
                        <td>{lead.phone || "N/A"}</td>
                        <td>
                          <Badge bg={getStatusVariant(lead.fe_lead_status)}>{lead.fe_lead_status || "N/A"}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>

              {/* Pagination */}
              {leadPagination.totalPages > 1 && (
                <div className="d-flex justify-content-center mt-3">
                  <Pagination className="mb-0">
                    <Pagination.Prev
                      onClick={() => fetchAvailableLeads(leadPagination.currentPage - 1)}
                      disabled={leadPagination.currentPage === 1}
                    />
                    <Pagination.Item active>
                      {leadPagination.currentPage} / {leadPagination.totalPages}
                    </Pagination.Item>
                    <Pagination.Next
                      onClick={() => fetchAvailableLeads(leadPagination.currentPage + 1)}
                      disabled={leadPagination.currentPage === leadPagination.totalPages}
                    />
                  </Pagination>
                </div>
              )}
            </>
          )}

          {/* Selected Leads Preview (shown when more than 500 selected) */}
          {showSelectedLeadsPreview && (selectAllMode ? leadPagination.totalItems : selectedLeadIds.size) > 500 && (
            <div className="mt-3 border-top pt-3">
              <h6 className="mb-2">Selected Leads Preview</h6>
              <div className="table-responsive" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <Table striped bordered hover size="sm">
                  <thead style={{ position: 'sticky', top: 0, backgroundColor: 'white', zIndex: 1 }}>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>Status</th>
                      <th width="80">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let selectedLeadsArray = [];
                      
                      if (selectAllMode) {
                        // In select all mode, show available leads from current page that are selected
                        selectedLeadsArray = availableLeads.filter(lead => selectedLeadIds.has(lead._id));
                        // If we have more selected than what's on current page, show a message
                        if (leadPagination.totalItems > availableLeads.length) {
                          const startIndex = (selectedLeadsPreviewPagination.currentPage - 1) * selectedLeadsPreviewPagination.itemsPerPage;
                          const endIndex = selectedLeadsPreviewPagination.currentPage * selectedLeadsPreviewPagination.itemsPerPage;
                          
                          if (startIndex >= selectedLeadsArray.length) {
                            return (
                              <tr>
                                <td colSpan="5" className="text-center text-muted">
                                  <div>
                                    <i className="fa-solid fa-info-circle me-2"></i>
                                    Showing preview of selected leads from current page.
                                    <br />
                                    <small>All {leadPagination.totalItems} leads matching your filters will be added.</small>
                                  </div>
                                </td>
                              </tr>
                            );
                          }
                        }
                      } else {
                        // In normal selection mode, use stored lead data
                        selectedLeadsArray = Array.from(selectedLeadsData.values());
                      }
                      
                      const totalSelected = selectAllMode ? leadPagination.totalItems : selectedLeadsArray.length;
                      const paginatedLeads = selectedLeadsArray.slice(
                        (selectedLeadsPreviewPagination.currentPage - 1) * selectedLeadsPreviewPagination.itemsPerPage,
                        selectedLeadsPreviewPagination.currentPage * selectedLeadsPreviewPagination.itemsPerPage
                      );

                      if (paginatedLeads.length === 0) {
                        return (
                          <tr>
                            <td colSpan="5" className="text-center text-muted">
                              No leads to preview
                            </td>
                          </tr>
                        );
                      }

                      return paginatedLeads.map((lead) => (
                        <tr key={lead._id || lead.id}>
                          <td>{lead.name || "N/A"}</td>
                          <td>{lead.email || "N/A"}</td>
                          <td>{lead.phone || "N/A"}</td>
                          <td>
                            <Badge bg={getStatusVariant(lead.fe_lead_status)}>
                              {lead.fe_lead_status || "N/A"}
                            </Badge>
                          </td>
                          <td>
                            {!selectAllMode && (
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => handleSelectLead(lead._id)}
                                title="Remove from selection"
                              >
                                <i className="fa-regular fa-trash"></i>
                              </Button>
                            )}
                            {selectAllMode && (
                              <span className="text-muted small">All Selected</span>
                            )}
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </Table>
              </div>
              {(() => {
                const totalSelected = selectAllMode ? leadPagination.totalItems : selectedLeadsData.size;
                const totalPages = Math.ceil(totalSelected / selectedLeadsPreviewPagination.itemsPerPage);
                
                if (totalPages > 1) {
                  return (
                    <div className="d-flex justify-content-center mt-2">
                      <Pagination className="mb-0">
                        <Pagination.Prev
                          onClick={() => setSelectedLeadsPreviewPagination(prev => ({ 
                            ...prev, 
                            currentPage: Math.max(1, prev.currentPage - 1) 
                          }))}
                          disabled={selectedLeadsPreviewPagination.currentPage === 1}
                        />
                        <Pagination.Item active>
                          {selectedLeadsPreviewPagination.currentPage} / {totalPages}
                        </Pagination.Item>
                        <Pagination.Next
                          onClick={() => setSelectedLeadsPreviewPagination(prev => ({ 
                            ...prev, 
                            currentPage: Math.min(totalPages, prev.currentPage + 1) 
                          }))}
                          disabled={selectedLeadsPreviewPagination.currentPage >= totalPages}
                        />
                      </Pagination>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          )}
        </Modal.Body>
        <Modal.Footer className="py-2">
          <div className="me-auto d-flex align-items-center gap-2">
            <div>
              <strong>{selectAllMode ? leadPagination.totalItems : selectedLeadIds.size}</strong> lead(s) selected
            </div>
            {(selectAllMode ? leadPagination.totalItems : selectedLeadIds.size) > 500 && (
              <Button
                variant="link"
                size="sm"
                onClick={() => setShowSelectedLeadsPreview(!showSelectedLeadsPreview)}
                className="p-0 text-custom text-decoration-none"
              >
                <i className={`fa-solid fa-${showSelectedLeadsPreview ? 'chevron-up' : 'chevron-down'} me-1`}></i>
                {showSelectedLeadsPreview ? 'Hide' : 'Show'} Preview
              </Button>
            )}
          </div>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => {
              setSelectedLeadIds(new Set());
              setSelectedLeadsData(new Map());
              setSelectAllMode(false);
            }}
            disabled={selectedLeadIds.size === 0 && !selectAllMode}
          >
            Clear All
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setShowSelectModal(false);
              setSelectedLeadIds(new Set());
              setSelectedLeadsData(new Map());
              setSelectAllMode(false);
              setOpenMultiMenu(null);
              setLeadFilters({ ...emptyLeadFilters });
            }}
          >
            Cancel
          </Button>
          <Button
            variant="custom"
            onClick={handleAddSelectedLeads}
            disabled={selectedLeadIds.size === 0 && !selectAllMode}
          >
            Add Selected ({selectAllMode ? leadPagination.totalItems : selectedLeadIds.size})
            {(selectAllMode ? leadPagination.totalItems : selectedLeadIds.size) > 500 && (
              <span className="ms-1 badge bg-warning text-dark">
                Large Selection
              </span>
            )}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Import CSV Modal */}
      <Modal show={showImportModal} onHide={() => {
        setShowImportModal(false);
        setImportError("");
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }} centered size="md">
        <Modal.Header closeButton>
          <Modal.Title>Import Leads from CSV</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {importError && <Alert variant="danger">{importError}</Alert>}

          <div onClick={(e) => e.stopPropagation()}>
            <Form.Group className="mb-3">
              <Form.Label>CSV File</Form.Label>
              <Form.Control
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                ref={fileInputRef}
                disabled={isImporting}
                required
              />
              <Form.Text className="text-muted">
                CSV should include columns: name, email (optional), phone (optional)
                <br />
                At least one of email or phone is required per row
                <br />
                <a href="/csv/campaign-leads.csv" download target="_blank" rel="noopener noreferrer" className="text-decoration-none">
                  <i className="fa-solid fa-download me-1"></i>Download Sample CSV
                </a>
              </Form.Text>
            </Form.Group>

            <div className="mb-3">
              <h6>CSV Format Example:</h6>
              <div className="bg-white p-2 rounded border">
                <pre className="mb-0">
                  name,email,phone<br />
                  John Doe,john@example.com,5551234567<br />
                  Jane Smith,jane@example.com,<br />
                  Bob Johnson,,5559876543
                </pre>
              </div>
              <div className="mt-2">
                <a href="/csv/campaign-leads.csv" download target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-custom">
                  <i className="fa-solid fa-download me-1"></i>Download Sample CSV File
                </a>
              </div>
            </div>

            <div className="d-flex justify-content-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowImportModal(false);
                  setImportError("");
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
                disabled={isImporting}
              >
                Cancel
              </Button>
              <Button
                variant="custom"
                type="button"
                onClick={handleImportCSV}
                disabled={isImporting}
              >
                {isImporting ? "Importing..." : "Import Leads"}
              </Button>
            </div>
          </div>
        </Modal.Body>
      </Modal>
    </>
  );
}

