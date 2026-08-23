"use client";
import { useState, useEffect, Suspense, useRef, useCallback } from "react";
// import { useSearchParams } from "next/navigation"; // Not needed for calendar view
import { Button, Card, Badge, Modal, Row, Col, Spinner } from "react-bootstrap";
import { formatTimestamp } from "../../../utils/dateUtils";
import useFetch from "../../../hooks/useFetch";
import { useUser } from "../../context/UserContext";
import moment from "moment-timezone";

// Component that uses useSearchParams - needs to be wrapped in Suspense
function LeadCalendarContent({ onLeadSelected }) {
  const { user, dealerParent } = useUser();
  const { fetchData, loading } = useFetch();
  
  const [leads, setLeads] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState('month'); // month, week, day
  const [selectedDate, setSelectedDate] = useState(null);
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [filteredLeads, setFilteredLeads] = useState([]);
  const [isFetching, setIsFetching] = useState(false);
  const isFetchingRef = useRef(false);

  const activeEntity = dealerParent || user;
  // Match server/dealer account timezone (same as booking_date storage in lead/status API).
  const [resolvedDealerTz, setResolvedDealerTz] = useState(null);
  useEffect(() => {
    if (!activeEntity?.id) return;
    let cancelled = false;
    const contextTz = activeEntity?.dealer_account_information?.time_zone;
    const token = localStorage.getItem("dealertoken");
    fetch(`/api/dealers/profile?dealer_id=${activeEntity.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const tz =
          data?.dealer_account_information?.time_zone ||
          contextTz ||
          "America/New_York";
        setResolvedDealerTz(tz);
      })
      .catch(() => {
        if (!cancelled) setResolvedDealerTz(contextTz || "America/New_York");
      });
    return () => {
      cancelled = true;
    };
  }, [activeEntity?.id]);

  const dealerTimezone =
    resolvedDealerTz ??
    activeEntity?.dealer_account_information?.time_zone ??
    "America/New_York";

  /** Calendar key aligned with list view date behavior. */
  const getBookingYmd = useCallback(
    (bookingDateValue) => {
      if (bookingDateValue == null || bookingDateValue === "") return null;
      if (typeof bookingDateValue === "string") {
        const trimmed = bookingDateValue.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
          const [a, b, c] = trimmed.split("/");
          const month = a.padStart(2, "0");
          const day = b.padStart(2, "0");
          return `${c}-${month}-${day}`;
        }
        if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
          const [d, m, y] = trimmed.split("-");
          return `${y}-${m}-${d}`;
        }
      }
      // Match list view: parse with Date and use local date parts
      const d = new Date(bookingDateValue);
      if (isNaN(d.getTime())) return null;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    },
    []
  );

  /** Show booking_date exactly as returned by the API (no Date/moment formatting). */
  const bookingDateRaw = (bookingDateValue) => {
    if (bookingDateValue == null || bookingDateValue === "") return "";
    return typeof bookingDateValue === "string"
      ? bookingDateValue
      : String(bookingDateValue);
  };

  // Match list-view appointment time output.
  const bookingTimeDisplay = (bookingTimeValue) => {
    const timeStr = bookingTimeValue ?? "";
    if (!timeStr) return "";
    if (typeof timeStr !== "string") return String(timeStr);

    const parts = timeStr.trim().split(" ");
    const [time, period] = parts;
    if (!time || !time.includes(":")) return timeStr;

    const [h, m] = time.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return timeStr;

    let hours = h;
    if (period === "PM" && hours < 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;

    const dt = new Date(2000, 0, 1, hours, m);
    return dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  };

  // Note: We're not using filters anymore since we only show leads with booking dates

  const fetchLeads = useCallback(async () => {
    if (isFetchingRef.current) {
      console.log('📅 Calendar - Already fetching, skipping...');
      return;
    }
    
    try {
      isFetchingRef.current = true;
      setIsFetching(true);
      // Only fetch leads that have booking status = 1 and booking dates
      let url = `/api/leads?dealer_id=${activeEntity.id}&booking_status=1`;
      
      // Add booking date range for current month view
      // IMPORTANT: compute boundaries in dealer timezone, then send UTC ISO strings.
      // This prevents client-local timezone from shifting booking dates (e.g. US users seeing previous day).
      const anchor = moment(currentDate).tz(dealerTimezone);
      const startOfMonthUtcIso = anchor.clone().startOf("month").startOf("day").utc().toISOString();
      const endOfMonthUtcIso = anchor.clone().endOf("month").endOf("day").utc().toISOString();
      url += `&bookingStartDate=${encodeURIComponent(startOfMonthUtcIso)}&bookingEndDate=${encodeURIComponent(endOfMonthUtcIso)}`;

      console.log('📅 Calendar - Fetching URL:', url);
      const token = localStorage.getItem('dealertoken');
      const response = await fetchData(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        console.error('📅 Calendar - API error:', response.status, response.statusText);
        const errorData = await response.json().catch(() => ({}));
        console.error('📅 Calendar - Error details:', errorData);
        setLeads([]);
        return;
      }
      
      const data = await response.json();
      console.log('📅 Calendar - Fetched leads with bookings:', data.data?.length || 0);
      console.log('📅 Calendar - Sample lead with booking:', data.data?.[0]);
      setLeads(data.data || []);
    } catch (error) {
      console.error("Error fetching leads:", error);
    } finally {
      isFetchingRef.current = false;
      setIsFetching(false);
    }
  }, [activeEntity?.id, currentDate, dealerTimezone, fetchData]);

  useEffect(() => {
    if (activeEntity?.id) {
      fetchLeads();
    }
  }, [activeEntity?.id, currentDate, fetchLeads]);

  // Group leads by date
  const groupLeadsByDate = (leads) => {
    const grouped = {};
    console.log('📅 Grouping leads with bookings:', leads.length);
    leads.forEach(lead => {
      // Only show leads that have booking dates
      const leadDate = lead.booking?.booking_date;
      console.log('📅 Lead booking date:', leadDate, 'from lead:', lead.name);
      const ymd = getBookingYmd(leadDate);
      if (!ymd) return;
      if (!grouped[ymd]) grouped[ymd] = [];
      grouped[ymd].push(lead);
    });
    console.log('📅 Grouped leads with bookings:', Object.keys(grouped).length, 'dates');
    return grouped;
  };

  // Get leads for a specific date
  const getLeadsForDate = (ymd) => {
    if (!ymd) return [];
    return leads.filter((lead) => getBookingYmd(lead.booking?.booking_date) === ymd);
  };

  // Calendar navigation
  const navigateCalendar = (direction) => {
    const newDate = new Date(currentDate);
    if (view === "month") {
      newDate.setMonth(newDate.getMonth() + direction);
    } else if (view === "week") {
      newDate.setDate(newDate.getDate() + direction * 7);
    } else if (view === "day") {
      newDate.setDate(newDate.getDate() + direction);
    }
    setCurrentDate(newDate);
    // Data will be refetched automatically due to currentDate dependency
  };

  // Get calendar days for current view
  const getCalendarDays = () => {
    const days = [];
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    if (view === "month") {
      const firstDay = new Date(year, month, 1);
      const startDate = new Date(firstDay);
      startDate.setDate(startDate.getDate() - firstDay.getDay());
      for (let i = 0; i < 42; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        days.push(d);
      }
    } else if (view === "week") {
      const startOfWeek = new Date(currentDate);
      startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
      for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        days.push(d);
      }
    } else if (view === "day") {
      days.push(new Date(currentDate));
    }

    return days;
  };

  // Handle date click
  const handleDateClick = (ymd) => {
    setSelectedDate(ymd);
    setFilteredLeads(getLeadsForDate(ymd));
    setShowLeadModal(true);
  };

  // Handle view change
  const handleViewChange = (newView) => {
    setView(newView);
    // Data will be refetched automatically due to currentDate dependency
  };

  // Handle lead click
  const handleLeadClick = (lead) => {
    setSelectedLead(lead);
  };

  // Get status color
  const getStatusColor = (status) => {
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

  // Render calendar header
  const renderCalendarHeader = () => {
    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    return (
      <div className="calendar-header">
        <div className="calendar-header-top">
          <Row className="align-items-center mb-2 g-0">
            <Col>
              <h5 className="mb-0">
                {(() => {
                  if (view === "month") return `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
                  if (view === "week") return `Week of ${currentDate.toLocaleDateString()}`;
                  return currentDate.toLocaleDateString();
                })()}
              </h5>
            </Col>
            <Col xs="auto">
              <div className="d-flex gap-1">
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={() => navigateCalendar(-1)}
                >
                  <i className="fa-solid fa-chevron-left"></i>
                </Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={() => setCurrentDate(new Date())}
                >
                  Today
                </Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={() => navigateCalendar(1)}
                >
                  <i className="fa-solid fa-chevron-right"></i>
                </Button>
              </div>
            </Col>
          </Row>

          <Row className="g-0 mb-2">
            <Col>
              <div className="d-flex gap-1">
                <Button
                  variant={view === 'month' ? 'custom' : 'outline-custom'}
                  size="sm"
                  onClick={() => handleViewChange('month')}
                >
                  Month
                </Button>
                <Button
                  variant={view === 'week' ? 'custom' : 'outline-custom'}
                  size="sm"
                  onClick={() => handleViewChange('week')}
                >
                  Week
                </Button>
                <Button
                  variant={view === 'day' ? 'custom' : 'outline-custom'}
                  size="sm"
                  onClick={() => handleViewChange('day')}
                >
                  Day
                </Button>
              </div>
            </Col>
          </Row>
        </div>

        {view !== 'day' && (
          <Row className="calendar-days-header g-0">
            {dayNames.map(day => (
              <Col key={day} className="text-center p-2">
                <strong>{day}</strong>
              </Col>
            ))}
          </Row>
        )}
      </div>
    );
  };

  // Render calendar body
  const renderCalendarBody = () => {
    const days = getCalendarDays();
    const groupedLeads = groupLeadsByDate(leads);

    if (view === 'day') {
      const ymd = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
      const dayLeads = getLeadsForDate(ymd);
      return (
        <div className="calendar-day-view">
          <h5 className="mb-3">Leads for {ymd}</h5>
          {dayLeads.length > 0 ? (
            <Row className="g-2">
              {dayLeads.map(lead => (
                <Col key={lead._id} md={6} lg={4}>
                  <Card 
                    className="h-100 cursor-pointer"
                    onClick={() => handleLeadClick(lead)}
                  >
                    <Card.Body>
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <h6 className="mb-0">{lead.name || 'N/A'}</h6>
                        <Badge bg={getStatusColor(lead.fe_lead_status)}>
                          {lead.fe_lead_status || 'Lead'}
                        </Badge>
                      </div>
                      <p className="small mb-1"><strong>Email: </strong>{lead.email || 'N/A'}</p>
                      <p className="small mb-1"><strong>Phone: </strong>{lead.phone || 'N/A'}</p>
                      <p className="small mb-2"><strong>Lead Date: </strong>{formatTimestamp(lead.createdAt || lead.date)}</p>
                      {lead.booking?.booking_date && (
                        <div className='position-relative border-top pt-2'>
                        <h6 className="mb-0">Booking: {bookingDateRaw(lead.booking.booking_date)}
                          {lead.booking.booking_time != null &&
                            lead.booking.booking_time !== "" &&
                            ` at ${bookingTimeDisplay(lead.booking.booking_time)}`}
                        </h6>
                        </div>
                      )}
                    </Card.Body>
                  </Card>
                </Col>
              ))}
            </Row>
          ) : (
            <div className="text-center py-5">
              <p className="text-muted">No leads for this date</p>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="calendar-grid">
        {days.map((day, index) => {
          const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
          const isCurrentMonth = day.getMonth() === currentDate.getMonth();
          const isToday = day.toDateString() === new Date().toDateString();
          const dateLeads = groupedLeads[ymd] || [];
          
          return (
            <div
              key={index}
              className={`calendar-day ${!isCurrentMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}`}
              onClick={() => handleDateClick(ymd)}
            >
              <div className="day-number">{day.getDate()}</div>
              {dateLeads.length > 0 && (
                <div className="day-leads">
                  {dateLeads.slice(0, 3).map(lead => (
                    <div
                      key={lead._id}
                      className={`lead-indicator bg-${getStatusColor(lead.fe_lead_status)}`}
                      title={`${lead.name} - ${lead.fe_lead_status}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLeadClick(lead);
                      }}
                    >
                      <div className="lead-name">{lead.name}</div>
                      {lead.booking?.booking_time != null &&
                        lead.booking.booking_time !== "" && (
                        <div className="lead-time">
                          {bookingTimeDisplay(lead.booking.booking_time)}
                        </div>
                      )}
                    </div>
                  ))}
                  {dateLeads.length > 3 && (
                    <div className="more-leads">+{dateLeads.length - 3}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  if (loading || isFetching) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ height: '400px' }}>
        <Spinner animation="border" variant="dark" />
        <span className="ms-3">Loading calendar...</span>
      </div>
    );
  }

  return (
    <div className="w_card p-0 overflow-hidden">
      {renderCalendarHeader()}
      {renderCalendarBody()}

      {/* Lead Modal */}
      <Modal show={showLeadModal} onHide={() => setShowLeadModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            Leads for {selectedDate || ""}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {filteredLeads.length > 0 ? (
            <Row className="g-2">
              {filteredLeads.map(lead => (
                <Col key={lead._id} md={6}>
                  <Card 
                    className="h-100 cursor-pointer border"
                    onClick={() => handleLeadClick(lead)}
                  >
                    <Card.Body>
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <h6 className="mb-0">{lead.name || 'N/A'}</h6>
                        <Badge bg={getStatusColor(lead.fe_lead_status)}>
                          {lead.fe_lead_status || 'Lead'}
                        </Badge>
                      </div>
                      <p className="small mb-1"><strong>Email: </strong>{lead.email || 'N/A'}</p>
                      <p className="small mb-1"><strong>Phone: </strong>{lead.phone || 'N/A'}</p>
                      <p className="small mb-1"><strong>Source Type: </strong>{lead.source || 'N/A'}</p>
                      <p className="small mb-2"><strong>Lead Date: </strong>{formatTimestamp(lead.createdAt || lead.date)}</p>
                      {lead.booking?.booking_date && (
                        <div className='position-relative border-top pt-2'>
                        <h6 className="mb-0">Booking: {bookingDateRaw(lead.booking.booking_date)}
                          {lead.booking.booking_time != null &&
                            lead.booking.booking_time !== "" &&
                            ` at ${bookingTimeDisplay(lead.booking.booking_time)}`}</h6>
                        </div>
                      )}
                    </Card.Body>
                  </Card>
                </Col>
              ))}
            </Row>
          ) : (
            <div className="text-center py-4">
              <p className="text-muted">No leads for this date</p>
            </div>
          )}
        </Modal.Body>
      </Modal>

      {/* Lead Details Modal */}
      <Modal show={!!selectedLead} onHide={() => setSelectedLead(null)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Lead Details</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedLead && (
            <div>
              <Row>
                <Col md={6}>
                  <h6 className="mb-3">Contact Information</h6>
                  <p><strong>Name:</strong> {selectedLead.name || 'N/A'}</p>
                  <p><strong>Email:</strong> {selectedLead.email || 'N/A'}</p>
                  <p><strong>Phone:</strong> {selectedLead.phone || 'N/A'}</p>
                  <p><strong>Source:</strong> {selectedLead.source || 'N/A'}</p>
                </Col>
                <Col md={6}>
                  <h6 className="mb-3">Lead Information</h6>
                  <p><strong>Status:</strong> 
                    <Badge bg={getStatusColor(selectedLead.fe_lead_status)} className="ms-2">
                      {selectedLead.fe_lead_status || 'Lead'}
                    </Badge>
                  </p>
                  <p><strong>Created:</strong> {formatTimestamp(selectedLead.createdAt || selectedLead.date)}</p>
                  {selectedLead.booking?.booking_date && (
                    <p><strong>Booking Date:</strong> {bookingDateRaw(selectedLead.booking.booking_date)}</p>
                  )}
                  {selectedLead.booking?.booking_time != null &&
                    selectedLead.booking.booking_time !== "" && (
                    <p><strong>Booking Time:</strong> {bookingTimeDisplay(selectedLead.booking.booking_time)}</p>
                  )}
                  {selectedLead.vehicle_make && (
                    <p><strong>Vehicle:</strong> {selectedLead.vehicle_make} {selectedLead.vehicle_model} {selectedLead.vehicle_year}</p>
                  )}
                </Col>
              </Row>
              <hr />
              <div className="text-center">
                <Button
                  variant="custom"
                  onClick={() => {
                    // Use the same onLeadSelected function as LeadList
                    if (onLeadSelected) {
                      onLeadSelected(selectedLead);
                    }
                    setSelectedLead(null); // Close the modal
                  }}
                >
                  <i className="fa-solid fa-comments me-2"></i>
                  View Conversation
                </Button>
              </div>
            </div>
          )}
        </Modal.Body>
      </Modal>
    </div>
  );
}

// Main component with Suspense boundary
export default function LeadCalendar({ onLeadSelected }) {
  return (
    <Suspense fallback={
      <div className="d-flex justify-content-center align-items-center" style={{ height: '400px' }}>
        <Spinner animation="border" variant="dark" />
        <span className="ms-3">Loading calendar...</span>
      </div>
    }>
      <LeadCalendarContent onLeadSelected={onLeadSelected} />
    </Suspense>
  );
}
