// page.js
"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import LeadList from "./components/LeadList";
import LeadForm from "./components/LeadForm";
import LeadCalendar from "./components/LeadCalendar";
import ViewConversations from "./components/viewConversations";
import { Button, ButtonGroup } from "react-bootstrap";
import "./components/LeadCalendar.css";

// Content component that uses useSearchParams
function LeadManagementContent() {
  const [editLead, setEditLead] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [view, setView] = useState('list'); // 'list' or 'calendar'
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  // ✅ Detect screen size for responsive behavior (<992px = mobile)
  useEffect(() => {
    function handleResize() {
      const mobileView = window.innerWidth < 992;
      setIsMobile(mobileView);
  
      // Auto-close sidebar when switching to desktop
      if (!mobileView) setIsOpen(false);
    }
  
    handleResize(); // Run on mount
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Handle URL parameters for view
  useEffect(() => {
    const viewParam = searchParams.get('view');
    
    if (viewParam === 'calendar') {
      setView('calendar');
    } else {
      setView('list');
    }
  }, [searchParams]);

  // Handle selectedLead removal from URL - ensure no lead is selected when URL doesn't have selectedLead=true
  useEffect(() => {
    const selectedLeadInUrl = searchParams.get('selectedLead') === 'true';
    
    if (!selectedLeadInUrl) {
      // If selectedLead is removed from URL, clear the selected lead
      // This ensures that when visiting /dealer/booking without selectedLead=true, no lead is selected
      setSelectedLead(null);
    }
  }, [searchParams]);

  // Update URL when view changes
  const handleViewChange = (newView) => {
    setView(newView);
    const params = new URLSearchParams(searchParams);
    if (newView === 'calendar') {
      params.set('view', 'calendar');
    } else {
      params.delete('view');
    }
    // Remove selectedLead and leadId when changing views
    params.delete('selectedLead');
    params.delete('leadId');
    params.delete('direction');
    router.push(`?${params.toString()}`, { scroll: false });
  };

  // Handle lead selection with URL state
  const handleLeadSelect = (lead) => {
    setSelectedLead(lead);
    // On mobile, close sidebar when lead is selected. On desktop, keep it open.
    if (isMobile) {
      setIsOpen(false);
    }
  };

  const toggleSidebar = () => setIsOpen(prev => !prev);

  // Auto-open sidebar on desktop when lead is selected
  useEffect(() => {
    if (selectedLead && !isMobile) {
      setIsOpen(true);
    }
  }, [selectedLead, isMobile]);

  // Handle back navigation with URL state
  const handleBack = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('selectedLead');
    params.delete('leadId');
    params.delete('direction');
    router.replace(`/dealer/booking?${params.toString()}`, undefined, { shallow: true });
    setSelectedLead(null);
  };

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center w-100">
                {/* {editLead && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditLead(null)}
                    className="me-2"
                  >
                    <i className="fa-solid fa-arrow-left"></i>
                  </Button>
                )} */}
                {selectedLead && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleBack}
                    className="me-2"
                  >
                    <i className="fa-solid fa-arrow-left"></i>
                  </Button>
                )}
                <h3 className="page_title mb-0">Appointments</h3>
                {selectedLead && isMobile && (
                  <Button
                    variant="custom"
                    size="sm"
                    onClick={toggleSidebar}
                    className="ms-auto"
                  >
                    <i className="fa-regular fa-list me-1"></i>Appt List
                  </Button>
                )}
              </div>
              
              {/* View Toggle Buttons */}
              {!selectedLead && !editLead && (
                <ButtonGroup size="sm">
                  <Button
                    className="btn-sm text-nowrap"
                    variant={view === 'list' ? 'custom' : 'outline-custom'}
                    onClick={() => handleViewChange('list')}
                  >
                    <i className="fa-regular fa-list me-1"></i>
                    List View
                  </Button>
                  <Button
                    className="btn-sm text-nowrap"
                    variant={view === 'calendar' ? 'custom' : 'outline-custom'}
                    onClick={() => handleViewChange('calendar')}
                  >
                    <i className="fa-regular fa-calendar me-1"></i>
                    Calendar View
                  </Button>
                </ButtonGroup>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        {selectedLead ? (
          <ViewConversations
            lead={selectedLead}
            onBack={handleBack}
            isOpen={isOpen}
            isMobile={isMobile}
            toggleSidebar={toggleSidebar}
            onLeadSelected={(lead) => {
              setSelectedLead(lead);
            }}
            activeLeadId={selectedLead?._id}
          />
        ) : editLead ? (
          <LeadForm setEditLead={setEditLead} editLead={editLead} />
        ) : view === 'calendar' ? (
          <LeadCalendar onLeadSelected={handleLeadSelect} />
        ) : (
          <LeadList
            setEditLead={setEditLead}
            onLeadSelected={handleLeadSelect}
            activeLeadId={selectedLead?._id}
            compact={false}
          />
        )}
      </div>
    </div>
  );
}

// Main component with Suspense boundary
export default function LeadManagement() {
  return (
    <Suspense fallback={
      <div className="page_content">
        <div className="d-flex justify-content-center align-items-center" style={{ height: '300px' }}>
          <div className="spinner-border text-dark" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <span className="ms-3">Loading appointments...</span>
        </div>
      </div>
    }>
      <LeadManagementContent />
    </Suspense>
  );
}
