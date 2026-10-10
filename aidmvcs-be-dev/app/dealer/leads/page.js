"use client";
import { useState, Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LeadList from "./components/LeadList";
import LeadForm from "./components/LeadForm";
import ViewConversations from "./components/viewConversations";
import { Button } from "react-bootstrap";

// Content component that uses useSearchParams
function LeadManagementContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [editLead, setEditLead] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

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

  // Handle selectedLead removal from URL - ensure no lead is selected when URL doesn't have selectedLead=true
  useEffect(() => {
    const selectedLeadInUrl = searchParams.get('selectedLead') === 'true';
    
    if (!selectedLeadInUrl) {
      // If selectedLead is removed from URL, clear the selected lead
      // This ensures that when visiting /dealer/leads without selectedLead=true, no lead is selected
      setSelectedLead(null);
    }
  }, [searchParams]);

  // Client, 8 Oct 2026: "Open lead" (AI Alerts, AI Messages, manager alert links) opens that lead, not the list.
  // The address carries ?selectedLead=true&leadId=<id> or ?lead=<id>; the lead is loaded and shown.
  useEffect(() => {
    const leadId = searchParams.get('leadId') || searchParams.get('lead');
    if (!leadId || selectedLead?._id === leadId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/leads/${leadId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('dealertoken')}` },
        });
        const data = await res.json();
        if (!cancelled && data?.lead) {
          if (searchParams.get('selectedLead') !== 'true') {
            const params = new URLSearchParams(window.location.search);
            params.set('selectedLead', 'true');
            params.set('leadId', leadId);
            params.delete('lead');
            window.history.replaceState(window.history.state, '', `/dealer/leads?${params.toString()}`);
          }
          setSelectedLead(data.lead);
        }
      } catch (error) {
        console.error('Could not open the lead from the link:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLeadSelect = async (lead) => {
    setSelectedLead(lead);
    setIsOpen(false);
    
    // Mark all messages in this lead's conversation as read
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
        // Silently mark as read - no need to handle response or show errors to user
      } catch (error) {
        console.error('Error marking messages as read:', error);
        // Don't block the UI if marking as read fails
      }
    }
  };

  const toggleSidebar = () => setIsOpen(prev => !prev);

  // Handle close - clear selectedLead from URL and state
  const handleClose = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete('selectedLead');
    params.delete('leadId');
    params.delete('direction');
    try {
      window.history.replaceState(window.history.state, '', `/dealer/leads?${params.toString()}`);
    } catch (e) {
      // fallback
    }
    setSelectedLead(null);
  };

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center">
              {selectedLead && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleClose}
                  className="me-2"
                >
                  <i className="fa-solid fa-arrow-left"></i>
                </Button>
              )}
              <h3 className="page_title mb-0">Leads</h3>
              {isMobile && (
              <Button
              variant="custom"
              size="sm"
              onClick={toggleSidebar}
              className="ms-auto"
            ><i className="fa-regular fa-list me-1"></i>Lead List</Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        {selectedLead ? (
          <ViewConversations
            lead={selectedLead}
            onBack={handleClose}
            isOpen={isOpen}
            isMobile={isMobile}
            toggleSidebar={toggleSidebar}
            onLeadSelected={(lead) => {
              console.log("Lead selected:", lead);
              setSelectedLead(lead); // or whatever you want to do
            }}
          />
        ) : editLead ? (
          <LeadForm setEditLead={setEditLead} editLead={editLead} />
        ) : (
          <LeadList
            setEditLead={setEditLead}
            onLeadSelected={handleLeadSelect}
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
          <span className="ms-3">Loading leads...</span>
        </div>
      </div>
    }>
      <LeadManagementContent />
    </Suspense>
  );
}