"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useUser } from "../context/UserContext";
import useFetch from "../../hooks/useFetch";
import { Spinner, Alert } from "react-bootstrap";
import moment from "moment-timezone";
import {
  BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import DateRangePickerComponent from "../components/DateRangePicker";
import CountCard from "./components/CountCard";
import { aiFetch } from "../ai/components/aiShared";
import LeadStatusBar from "./components/LeadStatusBar";
import ActivityOverTimeDataBar from "./components/ActivityOverTimeDataBar";
import LeadSourceDataPie from "./components/LeadSourceDataPie";
import LeadSourceDistributionPie from "./components/LeadSourceDistributionPie";
//import ReportAnalytics from "./components/ReportAnalytics";


export default function Dashboard() {
  const { dealerParent, loadingParent } = useUser();
  const { fetchData } = useFetch();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [leadStats, setLeadStats] = useState(null);
  const [communicationData, setCommunicationData] = useState([]);
  const [messageStats, setMessageStats] = useState(null);
  const [reportAnalytics, setReportAnalytics] = useState(null);
  const [managerialReviewCount, setManagerialReviewCount] = useState(0);
  // Client, 8 Oct 2026: the dashboard's escalation card is "AI Alerts" - one name everywhere - and counts the open
  // AI alerts (the same number as the menu badge) plus the leads in Managerial Review.
  const [aiAlertCount, setAiAlertCount] = useState(0);
  useEffect(() => {
    aiFetch("/api/dealer-ai/alerts?count_only=1")
      .then((data) => setAiAlertCount(data.unhandled_count || 0))
      .catch(() => setAiAlertCount(0));
  }, []);
  const [newThisWeekCount, setNewThisWeekCount] = useState(0);
  const [todayLeadsCount, setTodayLeadsCount] = useState(0);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [readMessageCount, setReadMessageCount] = useState(0);
  const [mtdTotalLeads, setMtdTotalLeads] = useState(0); // Month-till-date total leads
  const [bookingStatusAppointmentCount, setBookingStatusAppointmentCount] = useState(0); // Old: all-time booking_status=true
  const [appointmentBookedCount, setAppointmentBookedCount] = useState(0); // New: status Appointment Booked by booking date (MTD / date range)
  const [todayAppointmentsCount, setTodayAppointmentsCount] = useState(0); // Today's scheduled appointments (status Appointment Booked)
  const [contactedCount, setContactedCount] = useState(0); // Contacted: today by default, follows date range after user changes it
  const [hasUserChangedDateRange, setHasUserChangedDateRange] = useState(false);
  
  // Get dealer timezone
  const dealerTimezone = dealerParent?.dealer_account_information?.time_zone || 'America/New_York';
  
  // Helper function to format UTC dates in dealer timezone for display
  const formatDateInDealerTimezone = (utcDate) => {
    if (!utcDate) return '';
    // Convert UTC date to dealer timezone and format
    const dealerMoment = moment.utc(utcDate).tz(dealerTimezone);
    return dealerMoment.format('MM/DD/YYYY');
  };
  
  // Initialize with today's date range in dealer timezone
  // IMPORTANT: "Today" always means "today in dealer's timezone"
  const getTodayDateRange = useCallback(() => {
    if (!dealerTimezone) {
      // Fallback to browser timezone if dealer timezone not available yet
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { startDate: startOfDay, endDate: endOfDay };
    }
    
    // Use dealer timezone for date calculations
    // "Now" is calculated in dealer timezone, then converted to Date object
    const now = moment.tz(dealerTimezone);
    const startOfDay = now.clone().startOf('day').toDate();
    const endOfDay = now.clone().endOf('day').toDate();
    return { startDate: startOfDay, endDate: endOfDay };
  }, [dealerTimezone]);

  // Month-to-Date: 1st of current month → end of today in dealer timezone
  const getMtdDateRange = useCallback(() => {
    const tz = dealerTimezone || 'America/New_York';
    const now = moment.tz(tz);
    return {
      startDate: now.clone().startOf('month').startOf('day').toDate(),
      endDate: now.clone().endOf('day').toDate()
    };
  }, [dealerTimezone]);

  const [dateRange, setDateRange] = useState(() => {
    // Default view: Month-to-Date in dealer timezone
    const now = moment.tz(dealerTimezone || 'America/New_York');
    return {
      startDate: now.clone().startOf('month').startOf('day').toDate(),
      endDate: now.clone().endOf('day').toDate()
    };
  });
  const [chartVisibility, setChartVisibility] = useState({ emailCount: true, smsCount: true });


  function getCurrentWeekDateParams() {
    // Get current week in dealer timezone
    const nowInDealerTz = moment.tz(dealerTimezone);
    // Get start of week (Monday) in dealer timezone
    const startOfWeek = nowInDealerTz.clone().startOf('isoWeek'); // isoWeek starts on Monday
    // Get end of week (Sunday) in dealer timezone
    const endOfWeek = nowInDealerTz.clone().endOf('isoWeek');
    
    // Convert to UTC dates for URL
    const startDateUTC = startOfWeek.utc().toDate();
    const endDateUTC = endOfWeek.utc().toDate();
    
    const formatDate = (date) => encodeURIComponent(date.toISOString());
    
    return `startDate=${formatDate(startDateUTC)}&endDate=${formatDate(endDateUTC)}`;
  }

  function getTodayDateParams() {
    // Get today's date in dealer timezone
    const nowInDealerTz = moment.tz(dealerTimezone);
    // Get start of day in dealer timezone
    const startOfDay = nowInDealerTz.clone().startOf('day');
    // Get end of day in dealer timezone
    const endOfDay = nowInDealerTz.clone().endOf('day');
    
    // Convert to UTC dates for URL
    const startDateUTC = startOfDay.utc().toDate();
    const endDateUTC = endOfDay.utc().toDate();
    
    const formatDate = (date) => encodeURIComponent(date.toISOString());
    
    return `startDate=${formatDate(startDateUTC)}&endDate=${formatDate(endDateUTC)}`;
  }


  const fetchDashboardData = useCallback(async (startDate, endDate) => {
    try {
      if (!dealerParent?.id) return;
      setLoading(true);
      setError(null);

      let queryParams = `dealer_id=${dealerParent.id}`;
      
      // Behaviour:
      // - Initial load (no args): default to Month-to-Date
      // - Explicit range (dates provided): use and pass them
      // - Clear (startDate === null && endDate === null): do NOT send date filters
      if (typeof startDate === 'undefined' && typeof endDate === 'undefined') {
        // Initial load: default to Month-to-Date in dealer timezone
        const mtdRange = getMtdDateRange();
        queryParams += `&start_date=${mtdRange.startDate.toISOString()}&end_date=${mtdRange.endDate.toISOString()}`;
      } else if (startDate && endDate) {
        // User-selected range
        queryParams += `&start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}`;
      } // else explicit clear: no date params added

      // Fetch all data in parallel (excluding managerial review, new_this_week, today's leads, and unread messages from main stats)
      // IMPORTANT: Get today's date range in DEALER TIMEZONE for today's leads count
      const todayRange = getTodayDateRange();
      const todayQueryParams = `dealer_id=${dealerParent.id}&start_date=${todayRange.startDate.toISOString()}&end_date=${todayRange.endDate.toISOString()}`;
      
      // Build MTD query params for the separate MTD total (always current month to date)
      const mtdRange = getMtdDateRange();
      const mtdQueryParams = `dealer_id=${dealerParent.id}&start_date=${mtdRange.startDate.toISOString()}&end_date=${mtdRange.endDate.toISOString()}`;
      
      // Contacted: today by default; follow selected date range after user changes it
      let contactedQueryParams = `dealer_id=${dealerParent.id}&fe_lead_status=Contacted`;
      if (hasUserChangedDateRange) {
        if (startDate && endDate) {
          contactedQueryParams += `&start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}`;
        }
        // else cleared → all-time contacted (no date params)
      } else {
        // Default view: always today's contacted
        contactedQueryParams += `&start_date=${todayRange.startDate.toISOString()}&end_date=${todayRange.endDate.toISOString()}`;
      }

      // Appointments: by booking.booking_date + status Appointment Booked (MTD default / selected range)
      let appointmentQueryParams = `dealer_id=${dealerParent.id}&fe_lead_status=${encodeURIComponent('Appointment Booked')}&use_booking_date=false`;
      if (typeof startDate === 'undefined' && typeof endDate === 'undefined') {
        appointmentQueryParams += `&start_date=${mtdRange.startDate.toISOString()}&end_date=${mtdRange.endDate.toISOString()}`;
      } else if (startDate && endDate) {
        appointmentQueryParams += `&start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}`;
      }
      // else cleared → all Appointment Booked (no date params)

      // Today's appointments: scheduled for today with status Appointment Booked
      const todayAppointmentsQueryParams = `dealer_id=${dealerParent.id}&fe_lead_status=${encodeURIComponent('Appointment Booked')}&use_booking_date=false&start_date=${todayRange.startDate.toISOString()}&end_date=${todayRange.endDate.toISOString()}`;
      
      const [statsRes, commRes, messageStatsRes, managerialReviewRes, newThisWeekRes, todayLeadsRes, messageReadStatsRes, mtdLeadsRes, bookingStatusAppointmentRes, appointmentBookedRes, contactedRes, todayAppointmentsRes] = await Promise.all([
        fetchData(`/api/leads/stats?${queryParams}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }}),
        fetchData(`/api/conversations/stats?${queryParams}&limit=50`,{ headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }}),
        fetchData(`/api/admin/message-stats?${queryParams}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }}),
        /*fetchData(`/api/dealers/report-analytics?${queryParams}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }}),*/
        // Fetch managerial review count separately without date filter
        fetchData(`/api/leads/stats?dealer_id=${dealerParent.id}&managerial_review_only=true`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }}),
        // Fetch new_this_week count separately without date filter (always current week)
        fetchData(`/api/leads/stats?dealer_id=${dealerParent.id}&new_this_week_only=true`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }}),
        // Fetch today's leads count separately (always today's date)
        fetchData(`/api/leads/stats?${todayQueryParams}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }}),
        // Fetch read/unread messages stats separately (not affected by date filter)
        fetchData(`/api/conversations/message-stats?dealer_id=${dealerParent.id}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }}),
        // Fetch month-till-date total leads
        fetchData(`/api/leads/stats?${mtdQueryParams}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }}),
        // Old: all-time appointments by booking_status=true
        fetchData(`/api/leads/stats?dealer_id=${dealerParent.id}&all_appointment_booked=true`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }}),
        // New: appointments by status Appointment Booked + booking date (MTD default / selected range)
        fetchData(`/api/leads/stats?${appointmentQueryParams}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }}),
        // Fetch contacted count (today by default, or selected date range)
        fetchData(`/api/leads/stats?${contactedQueryParams}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }}),
        // Fetch today's scheduled appointments (status Appointment Booked)
        fetchData(`/api/leads/stats?${todayAppointmentsQueryParams}`,{headers: {
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        }})
      ]);

      if (!statsRes.ok) throw new Error('Failed to fetch lead statistics');
      if (!commRes.ok) throw new Error('Failed to fetch communications');
      if (!messageStatsRes.ok) throw new Error('Failed to fetch message statistics');
      //if (!reportAnalyticsRes.ok) throw new Error('Failed to fetch report analytics');
      if (!managerialReviewRes.ok) throw new Error('Failed to fetch managerial review count');
      if (!newThisWeekRes.ok) throw new Error('Failed to fetch new this week count');
      if (!todayLeadsRes.ok) throw new Error('Failed to fetch today leads count');
      if (!messageReadStatsRes.ok) throw new Error('Failed to fetch message read/unread stats');
      if (!mtdLeadsRes.ok) throw new Error('Failed to fetch month-till-date total leads');
      if (!bookingStatusAppointmentRes.ok) throw new Error('Failed to fetch booking_status appointment count');
      if (!appointmentBookedRes.ok) throw new Error('Failed to fetch appointment booked count');
      if (!contactedRes.ok) throw new Error('Failed to fetch contacted count');
      if (!todayAppointmentsRes.ok) throw new Error('Failed to fetch today appointments count');

      const statsData = await statsRes.json();
      const managerialReviewData = await managerialReviewRes.json();
      const newThisWeekData = await newThisWeekRes.json();
      const todayLeadsData = await todayLeadsRes.json();
      const messageReadStatsData = await messageReadStatsRes.json();
      const mtdLeadsData = await mtdLeadsRes.json();
      const bookingStatusAppointmentData = await bookingStatusAppointmentRes.json();
      const appointmentBookedData = await appointmentBookedRes.json();
      const contactedData = await contactedRes.json();
      const todayAppointmentsData = await todayAppointmentsRes.json();
      
      setLeadStats(statsData);
      setCommunicationData(await commRes.json());
      setMessageStats(await messageStatsRes.json());
      //setReportAnalytics(await reportAnalyticsRes.json());
      // Set managerial review count from separate API call (without date filter)
      setManagerialReviewCount(managerialReviewData.managerial_review || 0);
      // Set new this week count from separate API call (always current week, no date filter)
      setNewThisWeekCount(newThisWeekData.new_this_week || 0);
      // Set today's leads count from separate API call (always today's date)
      setTodayLeadsCount(todayLeadsData.total_leads || 0);
      // Set read/unread messages count from separate API call (not affected by date filter)
      setUnreadMessageCount(messageReadStatsData.unread_count || 0);
      setReadMessageCount(messageReadStatsData.read_count || 0);
      // Set month-till-date total leads
      setMtdTotalLeads(mtdLeadsData.total_leads || 0);
      // Old: all-time booking_status=true
      setBookingStatusAppointmentCount(bookingStatusAppointmentData.total_leads || 0);
      // New: status Appointment Booked by booking date (MTD / selected range)
      setAppointmentBookedCount(appointmentBookedData.total_leads || 0);
      // Set contacted count (today by default, or selected date range after user changes it)
      setContactedCount(contactedData.total_leads || 0);
      // Set today's scheduled appointments
      setTodayAppointmentsCount(todayAppointmentsData.total_leads || 0);
    } catch (err) {
      console.error("Dashboard fetch error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [dealerParent?.id, fetchData, getTodayDateRange, getMtdDateRange, hasUserChangedDateRange]);

  useEffect(() => {
    // On initial mount we pass the current range (default Month-to-Date).
    // After user clears the range, dateRange will be {null, null} and we call
    // fetchDashboardData(null, null) so it sends NO date filters.
    fetchDashboardData(dateRange.startDate, dateRange.endDate);
  }, [dealerParent, dateRange.startDate, dateRange.endDate, fetchDashboardData]);

  // Align default date range to dealer timezone MTD once dealer data is ready
  const hasSyncedMtdRange = useRef(false);
  useEffect(() => {
    if (!dealerParent?.id || !dealerTimezone || hasSyncedMtdRange.current) return;
    hasSyncedMtdRange.current = true;
    setDateRange(getMtdDateRange());
  }, [dealerParent?.id, dealerTimezone, getMtdDateRange]);

  const handleDateRangeChange = ({ startDate, endDate }) => {
    setHasUserChangedDateRange(true);

    // If no date is selected, clear filters (Total Leads → all-time, Contacted → all-time)
    if (!startDate && !endDate) {
      setDateRange({ startDate: null, endDate: null });
      return;
    }
    
    // The DateRangePicker already converts dates to UTC with proper start/end of day
    // We just need to store them as-is for the API call
    // The dates are already in UTC format representing the correct start/end of day in dealer timezone
    setDateRange({ startDate, endDate });
  };

  if (loadingParent || !dealerParent) {
    return (
      <div className="page_content">
        <div className="d-flex justify-content-center align-items-center" style={{ height: '80vh' }}>
          <Spinner animation="border" variant="dark" />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page_content">
        <div className="d-flex justify-content-center align-items-center" style={{ height: '80vh' }}>
          <Spinner animation="border" variant="dark" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page_content">
        <Alert variant="danger">{error}</Alert>
      </div>
    );
  }

  // Calculate total SMS and Email from messageStats (already includes all messages in date range)
  // communicationData is just recent items for display, not for counting totals
  const totalSMS = messageStats?.smsCount || 0;
  const totalEmail = messageStats?.emailCount || 0;

  // Prepare data for charts
  // Group lead sources by case-insensitive matching
  const leadSourceData = (() => {
    if (!leadStats?.sources) return [];
    
    const sourceMap = new Map();
    
    leadStats.sources.forEach(source => {
      const originalName = source._id || 'Unknown';
      const normalizedName = originalName.toLowerCase().trim();
      const count = source.count || 0;
      
      if (count > 0) {
        if (sourceMap.has(normalizedName)) {
          // If we already have this source (case-insensitive), add the counts
          const existing = sourceMap.get(normalizedName);
          existing.value += count;
          // Keep the original name with proper capitalization if it exists
          if (originalName !== 'Unknown' && originalName !== originalName.toLowerCase()) {
            existing.name = originalName;
          }
        } else {
          // New source
          sourceMap.set(normalizedName, {
            name: originalName,
            value: count
          });
        }
      }
    });
    
    return Array.from(sourceMap.values()).sort((a, b) => b.value - a.value);
  })();

  // Group lead sources by case-insensitive matching
  const leadSourceFieldData = (() => {
    if (!leadStats?.lead_sources) return [];
    
    const sourceMap = new Map();
    
    leadStats.lead_sources.forEach(source => {
      const originalName = source._id || 'Unknown';
      const normalizedName = originalName.toLowerCase().trim();
      const count = source.count || 0;
      
      if (count > 0) {
        if (sourceMap.has(normalizedName)) {
          // If we already have this source (case-insensitive), add the counts
          const existing = sourceMap.get(normalizedName);
          existing.value += count;
          // Keep the original name with proper capitalization if it exists
          if (originalName !== 'Unknown' && originalName !== originalName.toLowerCase()) {
            existing.name = originalName;
          }
        } else {
          // New source
          sourceMap.set(normalizedName, {
            name: originalName,
            value: count
          });
        }
      }
    });
    
    return Array.from(sourceMap.values()).sort((a, b) => b.value - a.value);
  })();

  const leadStatusData = leadStats?.statuses?.map(status => ({
    name: status._id,
    value: status.count
  })) || [];

  const activityOverTimeData = leadStats?.activity_over_time?.map(item => ({
    date: item.date || item._id, // Expected format: 'YYYY-MM-DD'
    count: item.count
  })) || [];

  // Helper function to safely parse dates
  const safeParseDate = (dateValue) => {
    if (!dateValue) return null;
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    return isNaN(date.getTime()) ? null : date;
  };

  // Get min/max dates from API response or from data
  const leadMinDate = safeParseDate(leadStats?.date_range?.min_date);
  const leadMaxDate = safeParseDate(leadStats?.date_range?.max_date);

  // Prepare message trend data (daily by default)
  const messageTrendData = messageStats?.dailyStats || [];
  
  // Get min/max dates from message stats API response or from data
  let messageMinDate = safeParseDate(messageStats?.date_range?.min_date);
  let messageMaxDate = safeParseDate(messageStats?.date_range?.max_date);
  
  // Fallback to first/last date in dailyStats if API didn't provide date_range
  if (!messageMinDate && messageTrendData.length > 0 && messageTrendData[0].date) {
    messageMinDate = safeParseDate(messageTrendData[0].date + 'T00:00:00');
  }
  if (!messageMaxDate && messageTrendData.length > 0 && messageTrendData[messageTrendData.length - 1].date) {
    messageMaxDate = safeParseDate(messageTrendData[messageTrendData.length - 1].date + 'T00:00:00');
  }

  // Determine time grouping based on selected date range or actual data range:
  // - <= 1 month  -> daily
  // - > 1 month & <= 3 months -> weekly
  // - > 3 months  -> monthly
  const timeGrouping = (() => {
    let startDate = dateRange.startDate;
    let endDate = dateRange.endDate;
    
    // If no date filter, use actual data range
    if (!startDate || !endDate) {
      if (leadMinDate && leadMaxDate) {
        startDate = leadMinDate;
        endDate = leadMaxDate;
      } else {
        return 'daily';
      }
    }
    
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays > 90) return 'monthly';
    if (diffDays > 31) return 'weekly';
    return 'daily';
  })();

  const groupActivityData = (data, mode) => {
    if (!data || !Array.isArray(data) || data.length === 0) return [];
    if (mode === 'daily') return data;

    const buckets = new Map();

    data.forEach(item => {
      if (!item.date) return;
      const m = moment(item.date, 'YYYY-MM-DD');
      if (!m.isValid()) return;

      let key;
      if (mode === 'weekly') {
        // Group by ISO week
        const year = m.isoWeekYear();
        const week = String(m.isoWeek()).padStart(2, '0');
        key = `${year}-W${week}`;
      } else {
        // Monthly grouping
        key = m.format('YYYY-MM'); // e.g., 2026-01
      }

      const existing = buckets.get(key) || { date: key, count: 0 };
      existing.count += item.count || 0;
      buckets.set(key, existing);
    });

    return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
  };

  const groupMessageTrendData = (data, mode) => {
    if (!data || !Array.isArray(data) || data.length === 0) return [];
    if (mode === 'daily') return data;

    const buckets = new Map();

    data.forEach(item => {
      if (!item.date) return;
      const m = moment(item.date, 'YYYY-MM-DD');
      if (!m.isValid()) return;

      let key;
      if (mode === 'weekly') {
        const year = m.isoWeekYear();
        const week = String(m.isoWeek()).padStart(2, '0');
        key = `${year}-W${week}`;
      } else {
        key = m.format('YYYY-MM');
      }

      const existing = buckets.get(key) || { date: key, emailCount: 0, smsCount: 0 };
      existing.emailCount += item.emailCount || 0;
      existing.smsCount += item.smsCount || 0;
      buckets.set(key, existing);
    });

    return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
  };

  const activityChartData = groupActivityData(activityOverTimeData, timeGrouping);
  const messageTrendChartData = groupMessageTrendData(messageTrendData, timeGrouping);

  // Helper function to build URL with date range parameters
  const buildUrlWithDateRange = (baseUrl) => {
    if (!dateRange.startDate || !dateRange.endDate) {
      return baseUrl;
    }
    
    try {
      // Handle both absolute and relative URLs
      const url = baseUrl.startsWith('http') 
        ? new URL(baseUrl) 
        : new URL(baseUrl, window.location.origin);
      
      url.searchParams.set('startDate', dateRange.startDate.toISOString());
      url.searchParams.set('endDate', dateRange.endDate.toISOString());
      
      // Return relative URL
      return url.pathname + url.search;
    } catch (e) {
      // Fallback: manually append if URL parsing fails
      const separator = baseUrl.includes('?') ? '&' : '?';
      return `${baseUrl}${separator}startDate=${encodeURIComponent(dateRange.startDate.toISOString())}&endDate=${encodeURIComponent(dateRange.endDate.toISOString())}`;
    }
  };

  // Helper function to build URL with month-till-date range for Total Leads
  // IMPORTANT: MTD calculation is done in DEALER TIMEZONE
  // MTD ONLY applies when it's a SINGLE DAY selection, not a date range
  const buildUrlWithMtdRange = (baseUrl) => {
    if (!dateRange.startDate || !dateRange.endDate) {
      return baseUrl;
    }
    
    // Calculate MTD range for URL purposes (simple frontend calculation for navigation)
    // Parse dates in dealer timezone for comparison
    const start = moment(dateRange.startDate).tz(dealerTimezone);
    const end = moment(dateRange.endDate).tz(dealerTimezone);
    
    let mtdStartDate = dateRange.startDate;
    let mtdEndDate = dateRange.endDate;
    
    // ONLY calculate MTD if it's THE SAME DAY (single day selection)
    // If different dates (date range), use the exact range provided
    if (start.isSame(end, 'day')) {
      // Same day: Calculate from 1st of month to selected date
      const monthStart = end.clone().startOf('month');
      mtdStartDate = monthStart.toDate();
      mtdEndDate = end.clone().endOf('day').toDate();
    }
    // If different days (date range), use the range as-is (no MTD calculation)
    
    try {
      const url = baseUrl.startsWith('http') 
        ? new URL(baseUrl) 
        : new URL(baseUrl, window.location.origin);
      
      url.searchParams.set('startDate', mtdStartDate.toISOString());
      url.searchParams.set('endDate', mtdEndDate.toISOString());
      
      return url.pathname + url.search;
    } catch (e) {
      const separator = baseUrl.includes('?') ? '&' : '?';
      return `${baseUrl}${separator}startDate=${encodeURIComponent(mtdStartDate.toISOString())}&endDate=${encodeURIComponent(mtdEndDate.toISOString())}`;
    }
  };

  // Handle pie chart segment clicks
  const handleSourceClick = (data) => {
    if (data && data.name) {
      let url = `/dealer/leads?source=${encodeURIComponent(data.name)}`;
      url = buildUrlWithDateRange(url);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleLeadSourceFieldClick = (data) => {
    if (data && data.name) {
      let url = `/dealer/leads?lead_source=${encodeURIComponent(data.name)}`;
      url = buildUrlWithDateRange(url);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // Handle bar chart clicks
  const handleStatusBarClick = (data) => {
    if (data && data.name) {
      let url = `/dealer/leads?status=${encodeURIComponent(data.name)}`;
      url = buildUrlWithDateRange(url);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleActivityBarClick = (data) => {
    if (data && data.date) {
      // Parse the date string to handle different formats (daily, weekly, monthly)
      // IMPORTANT: Use dealer timezone to parse dates correctly
      const dateStr = data.date;
      let startDate, endDate;

      if (dateStr.includes('W')) {
        // Weekly format: YYYY-WXX
        const [year, week] = dateStr.split('-W');
        const firstDayOfYear = moment.tz(`${year}-01-01`, 'YYYY-MM-DD', dealerTimezone);
        const weekStart = firstDayOfYear.add((parseInt(week) - 1) * 7, 'days');
        const weekEnd = weekStart.clone().add(6, 'days');
        startDate = weekStart.startOf('day').utc().toDate();
        endDate = weekEnd.endOf('day').utc().toDate();
      } else if (dateStr.split('-').length === 2) {
        // Monthly format: YYYY-MM
        const [year, month] = dateStr.split('-');
        const monthStart = moment.tz(`${year}-${month}-01`, 'YYYY-MM-DD', dealerTimezone).startOf('month');
        const monthEnd = monthStart.clone().endOf('month');
        startDate = monthStart.startOf('day').utc().toDate();
        endDate = monthEnd.endOf('day').utc().toDate();
      } else {
        // Daily format: YYYY-MM-DD
        // Parse the date in dealer timezone (start and end of that day in dealer timezone)
        const dayStart = moment.tz(dateStr, 'YYYY-MM-DD', dealerTimezone).startOf('day');
        const dayEnd = moment.tz(dateStr, 'YYYY-MM-DD', dealerTimezone).endOf('day');
        startDate = dayStart.utc().toDate();
        endDate = dayEnd.utc().toDate();
      }

      const url = `/dealer/leads?startDate=${encodeURIComponent(startDate.toISOString())}&endDate=${encodeURIComponent(endDate.toISOString())}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleMessageBarClick = (data, messageType) => {
    if (data && data.date) {
      // Parse the date string to handle different formats (daily, weekly, monthly)
      // IMPORTANT: Use dealer timezone to parse dates correctly
      const dateStr = data.date;
      let startDate, endDate;

      if (dateStr.includes('W')) {
        // Weekly format: YYYY-WXX
        const [year, week] = dateStr.split('-W');
        const firstDayOfYear = moment.tz(`${year}-01-01`, 'YYYY-MM-DD', dealerTimezone);
        const weekStart = firstDayOfYear.add((parseInt(week) - 1) * 7, 'days');
        const weekEnd = weekStart.clone().add(6, 'days');
        startDate = weekStart.startOf('day').utc().toDate();
        endDate = weekEnd.endOf('day').utc().toDate();
      } else if (dateStr.split('-').length === 2) {
        // Monthly format: YYYY-MM
        const [year, month] = dateStr.split('-');
        const monthStart = moment.tz(`${year}-${month}-01`, 'YYYY-MM-DD', dealerTimezone).startOf('month');
        const monthEnd = monthStart.clone().endOf('month');
        startDate = monthStart.startOf('day').utc().toDate();
        endDate = monthEnd.endOf('day').utc().toDate();
      } else {
        // Daily format: YYYY-MM-DD
        // Parse the date in dealer timezone (start and end of that day in dealer timezone)
        const dayStart = moment.tz(dateStr, 'YYYY-MM-DD', dealerTimezone).startOf('day');
        const dayEnd = moment.tz(dateStr, 'YYYY-MM-DD', dealerTimezone).endOf('day');
        startDate = dayStart.utc().toDate();
        endDate = dayEnd.utc().toDate();
      }

      let url = `/dealer/leads?startDate=${encodeURIComponent(startDate.toISOString())}&endDate=${encodeURIComponent(endDate.toISOString())}`;
      if (messageType) {
        url += `&response_mode=${messageType}`;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // Calculate Total Leads description text based on selected date range
  const getTotalLeadsDescription = () => {
    if (!dateRange.startDate || !dateRange.endDate) {
      return 'All-time leads';
    }

    const start = moment.utc(dateRange.startDate).tz(dealerTimezone);
    const end = moment.utc(dateRange.endDate).tz(dealerTimezone);
    const mtdStart = moment.tz(dealerTimezone).startOf('month');
    const today = moment.tz(dealerTimezone).startOf('day');

    // Default MTD range (1st of month → today)
    if (
      start.isSame(mtdStart, 'day') &&
      end.isSame(today, 'day')
    ) {
      return `Month-to-Date: ${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`;
    }

    if (start.isSame(end, 'day')) {
      return start.format('MMM D, YYYY');
    }

    return `Date Range: ${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`;
  };

  // Calculate date range description for cards that follow the selected date filter
  const getDateRangeDescription = () => {
    if (!dateRange.startDate || !dateRange.endDate) {
      return 'All-time';
    }

    const start = moment(dateRange.startDate).tz(dealerTimezone);
    const end = moment(dateRange.endDate).tz(dealerTimezone);

    // Check if same day (single day selection)
    if (start.isSame(end, 'day')) {
      return start.format('MMM D, YYYY');
    } else {
      // Date Range
      const startFormatted = start.format('MMM D');
      const endFormatted = end.format('MMM D, YYYY');
      return `${startFormatted} - ${endFormatted}`;
    }
  };

  // Contacted: today by default; follows date range after user changes it
  const getContactedDescription = () => {
    if (!hasUserChangedDateRange) {
      return moment.tz(dealerTimezone).format('MMM D, YYYY');
    }
    if (!dateRange.startDate || !dateRange.endDate) {
      return 'All-time count';
    }
    return getDateRangeDescription();
  };

  const getContactedLink = () => {
    if (!hasUserChangedDateRange) {
      return `/dealer/leads?status=Contacted&${getTodayDateParams()}`;
    }
    if (!dateRange.startDate || !dateRange.endDate) {
      return '/dealer/leads?status=Contacted';
    }
    return buildUrlWithDateRange('/dealer/leads?status=Contacted');
  };

  // Appointments: same date-range logic as Total Leads (MTD default)
  const getAppointmentsDescription = () => {
    if (!dateRange.startDate || !dateRange.endDate) {
      return 'All-time appointments';
    }

    const start = moment.utc(dateRange.startDate).tz(dealerTimezone);
    const end = moment.utc(dateRange.endDate).tz(dealerTimezone);
    const mtdStart = moment.tz(dealerTimezone).startOf('month');
    const today = moment.tz(dealerTimezone).startOf('day');

    if (
      start.isSame(mtdStart, 'day') &&
      end.isSame(today, 'day')
    ) {
      return `Month-to-Date: ${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`;
    }

    if (start.isSame(end, 'day')) {
      return start.format('MMM D, YYYY');
    }

    return `Date Range: ${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`;
  };

  const buildUrlWithBookingDateRange = (baseUrl) => {
    if (!dateRange.startDate || !dateRange.endDate) {
      return baseUrl;
    }

    try {
      const url = baseUrl.startsWith('http')
        ? new URL(baseUrl)
        : new URL(baseUrl, window.location.origin);

      url.searchParams.set('startDate', dateRange.startDate.toISOString());
      url.searchParams.set('endDate', dateRange.endDate.toISOString());

      return url.pathname + url.search;
    } catch (e) {
      const separator = baseUrl.includes('?') ? '&' : '?';
      return `${baseUrl}${separator}startDate=${encodeURIComponent(dateRange.startDate.toISOString())}&endDate=${encodeURIComponent(dateRange.endDate.toISOString())}`;
    }
  };

  const getAppointmentsLink = () => {
    const base = '/dealer/leads?status=Appointment Booked';
    if (!dateRange.startDate || !dateRange.endDate) {
      return base;
    }
    return buildUrlWithBookingDateRange(base);
  };

  const getTodayAppointmentsLink = () => {
    const todayRange = getTodayDateRange();
    const formatDate = (date) => encodeURIComponent(date.toISOString());
    return `/dealer/leads?status=Appointment Booked&startDate=${formatDate(todayRange.startDate)}&endDate=${formatDate(todayRange.endDate)}`;
  };

  return (
    <div className="page_content">
      <div className="page_head">
        <div className="row align-items-center">
          <div className="col col-12">
            <div className="d-flex align-items-center">
              <h3 className="page_title mb-0 me-auto">
                Leads Dashboard
                {dateRange.startDate && dateRange.endDate && (
                  <small className="text-muted ms-2">
                    ({formatDateInDealerTimezone(dateRange.startDate)} - {formatDateInDealerTimezone(dateRange.endDate)})
                  </small>
                )}
              </h3>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <DateRangePickerComponent
                  onDateRangeChange={handleDateRangeChange}
                  dateRange={dateRange}
                  initialStartDate={getMtdDateRange().startDate}
                  initialEndDate={getMtdDateRange().endDate}
                  timezone={dealerTimezone}
                />
                <small className="text-muted" style={{fontSize: '0.75rem'}} title={`All dates are interpreted in your business timezone: ${dealerTimezone}`}>
                  <i className="fa-solid fa-clock me-1"></i>
                  {dealerTimezone.split('/').pop()}
                </small>
              </div>
              <small className="text-muted d-block mt-1" style={{fontSize: '0.7rem'}}>
              
              </small>
            </div>
          </div>
        </div>
      </div>

      <div className="page_body">
        {/* Dashboard Counts */}
        <div className="dashboard_counts">
          <div className="row gx-2 gx-lg-4">
            <CountCard
              iconClass="fa-regular fa-magnifying-glass"
              count={leadStats?.total_leads || 0}
              label="Total Leads"
              link={buildUrlWithDateRange("/dealer/leads")}
              description={getTotalLeadsDescription()}
            />
           {/* <CountCard
              iconClass="fa-regular fa-magnet"
              count={mtdTotalLeads}
              label="Total Leads"
              link={buildUrlWithMtdRange("/dealer/leads")}
              description={getTotalLeadsDescription()}
            />
            */}
            {/*
            <CountCard
              iconClass="fa-regular fa-comment-plus"
              count={newThisWeekCount}
              label="New Lead This Week"
              link={`/dealer/leads?${getCurrentWeekDateParams()}`}
            />
            */}
            <CountCard
              iconClass="fa-regular fa-calendar-day"
              count={todayLeadsCount}
              label="Today's Leads"
              link={`/dealer/leads?${getTodayDateParams()}`}
              description={moment.tz(dealerTimezone).format('MMM D, YYYY')}
            />

            <CountCard
              iconClass="fa-light fa-hand"
              count={contactedCount}
              label="Contacted"
              link={getContactedLink()}
              description={getContactedDescription()}
            />

            <CountCard
              iconClass="fa-light fa-bell"
              count={aiAlertCount}
              label="AI Alerts"
              link="/dealer/ai/alerts"
              description={`Need attention now${managerialReviewCount ? ` · ${managerialReviewCount} in Managerial Review` : ""}`}
            />
            
            <CountCard
              iconClass="fa-regular fa-envelope-open"
              count={unreadMessageCount}
              label="Unread Messages"
              link="/dealer/leads?message_filter=unread"
              description="Current unread count"
            />
           
            {/*
            <CountCard
              iconClass="fa-regular fa-envelope"
              count={readMessageCount}
              label="Read Messages"
              description="Current read count"
            /> */}
            
            <CountCard
              iconClass="fa-solid fa-calendar-check"
              count={bookingStatusAppointmentCount}
              label="Appointment Booked"
              link="/dealer/booking"
              description="All-time count"
            />

            <CountCard
              iconClass="fa-solid fa-calendar-days"
              count={appointmentBookedCount}
              label="All-Time Appointments"
              link={getAppointmentsLink()}
              description={getAppointmentsDescription()}
            />

            <CountCard
              iconClass="fa-regular fa-calendar-check"
              count={todayAppointmentsCount}
              label="Today's Appointments"
              link={getTodayAppointmentsLink()}
              description={moment.tz(dealerTimezone).format('MMM D, YYYY')}
            />
          </div>
        </div>

        {/* Full Calendar - inserted after second row 
        <div className="row gx-2 gx-xl-3">
          <div className="col col-lg-12 col-12">
            <div className="w_card">
              <h3 className="w_card_title">Calendar</h3>
              <LeadCalendar />
            </div>
          </div>
        </div>*/}

        {/* Charts */}
        <div className="dashboard_charts">
          <div className="row gx-2 gx-xl-3">
            <div className="col col-lg-5 col-12">
              <div className="w_card">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h3 className="w_card_title mb-0">Lead Sources</h3>
                  <small className="text-muted">
                    {leadSourceData.length} sources • {leadSourceData.reduce((sum, source) => sum + source.value, 0)} total leads
                  </small>
                </div>
                {leadSourceData.length > 0 ? (
                  <LeadSourceDataPie data={leadSourceData} onSegmentClick={handleSourceClick} />
                ) : (
                  <div className="text-center py-5">
                    <i className="fa-solid fa-chart-pie fa-3x text-muted mb-3"></i>
                    <p className="text-muted">No lead sources data for selected period</p>
                  </div>
                )}
              </div>
            </div>
            <div className="col col-lg-7 col-12">
              <div className="w_card">
                <h3 className="w_card_title">Lead Status</h3>
                <LeadStatusBar data={leadStatusData} onBarClick={handleStatusBarClick} />
              </div>
            </div>
          </div>
          
          {/* Second Row - Additional Lead Source Charts */}
          <div className="row gx-2 gx-xl-3">
            <div className="col col-lg-12 col-12">
              <div className="w_card">
                <h3 className="w_card_title">
                  {dateRange.startDate && dateRange.endDate 
                    ? `Lead Received from ${formatDateInDealerTimezone(dateRange.startDate)} to ${formatDateInDealerTimezone(dateRange.endDate)}`
                    : leadMinDate && leadMaxDate && !isNaN(leadMinDate.getTime()) && !isNaN(leadMaxDate.getTime())
                    ? `Lead Received from ${formatDateInDealerTimezone(leadMinDate)} to ${formatDateInDealerTimezone(leadMaxDate)}`
                    : 'Lead Received (All Time)'}
                  {dateRange.startDate && dateRange.endDate && (
                    <small className="text-muted ms-2">
                      ({timeGrouping === 'daily' ? 'Daily' : timeGrouping === 'weekly' ? 'Weekly' : 'Monthly'} view)
                    </small>
                  )}
                </h3>
                <ActivityOverTimeDataBar data={activityChartData} onBarClick={handleActivityBarClick} />
              </div>
            </div>
            {/* Message Trend Chart */}
            <div className="col col-lg-12 col-12">
              <div className="w_card">
                <h3 className="w_card_title">
                  {dateRange.startDate && dateRange.endDate 
                    ? `Message Sent from ${formatDateInDealerTimezone(dateRange.startDate)} to ${formatDateInDealerTimezone(dateRange.endDate)}`
                    : messageMinDate && messageMaxDate && !isNaN(messageMinDate.getTime()) && !isNaN(messageMaxDate.getTime())
                    ? `Message Sent from ${formatDateInDealerTimezone(messageMinDate)} to ${formatDateInDealerTimezone(messageMaxDate)}`
                    : 'Message Sent (All Time)'}
                  {dateRange.startDate && dateRange.endDate && (
                    <small className="text-muted ms-2">
                      ({timeGrouping === 'daily' ? 'Daily' : timeGrouping === 'weekly' ? 'Weekly' : 'Monthly'} view)
                    </small>
                  )}
                </h3>
                
                {/* Custom Legend with Toggle Buttons */}
                <div className="d-flex justify-content-center mb-3 gap-2">
                  <button
                    className={`btn btn-sm ${chartVisibility.emailCount ? 'btn-custom' : 'btn-outline-custom'}`}
                    onClick={() => setChartVisibility(prev => ({ ...prev, emailCount: !prev.emailCount }))}
                  >
                    <i className={`fa-regular ${chartVisibility.emailCount ? 'fa-eye' : 'fa-eye-slash'} me-1`}></i>
                    Emails {chartVisibility.emailCount ? '(Visible)' : '(Hidden)'}
                  </button>
                  <button
                    className={`btn btn-sm ${chartVisibility.smsCount ? 'btn-secondary2' : 'btn-outline-secondary2'}`}
                    onClick={() => setChartVisibility(prev => ({ ...prev, smsCount: !prev.smsCount }))}
                  >
                    <i className={`fa-regular ${chartVisibility.smsCount ? 'fa-eye' : 'fa-eye-slash'} me-2`}></i>
                    SMS {chartVisibility.smsCount ? '(Visible)' : '(Hidden)'}
                  </button>
                </div>

                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={messageTrendChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(str) => {
                        if (!str) return '';
                        try {
                          // Daily: YYYY-MM-DD -> DD-MM
                          const parts = str.split('-');
                          if (parts.length === 3) {
                            const [year, month, day] = parts;
                            if (year && month && day) {
                              return `${day}-${month}`;
                            }
                          }
                          // Monthly: YYYY-MM -> Mon-YY
                          if (parts.length === 2 && /^\d{4}$/.test(parts[0])) {
                            const [year, month] = parts;
                            if (year && month) {
                              const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
                              if (!isNaN(date.getTime())) {
                                return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
                              }
                            }
                          }
                          // Weekly or any other label: show as-is
                          return str;
                        } catch (e) {
                          return str;
                        }
                      }}
                    />
                    <YAxis />
                    <Tooltip cursor={{ fill: 'rgba(0, 0, 0, 0.1)' }} />
                    {chartVisibility.emailCount && (
                      <Bar 
                        dataKey="emailCount" 
                        fill="var(--primary)" 
                        name="Emails" 
                        onClick={(data) => handleMessageBarClick(data, 'email')}
                        style={{ cursor: 'pointer' }}
                      />
                    )}
                    {chartVisibility.smsCount && (
                      <Bar 
                        dataKey="smsCount" 
                        fill="var(--secondary)" 
                        name="SMS" 
                        onClick={(data) => handleMessageBarClick(data, 'sms')}
                        style={{ cursor: 'pointer' }}
                      />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

        

        {/* Report Analytics Section  
          {reportAnalytics && (
            <ReportAnalytics 
              data={reportAnalytics} 
              totalSMS={totalSMS} 
              totalEmail={totalEmail}
              dateRange={dateRange}
              buildUrlWithDateRange={buildUrlWithDateRange}
            />
          )}
          */}
       
          <div className="row gx-2 gx-xl-3">
            <div className="col col-xxl-7 col-lg-8 col-12">
              <div className="w_card">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h3 className="w_card_title mb-0">Lead Source Field</h3>
                  <small className="text-muted">
                    Breakdown by lead_source field
                  </small>
                </div>
                {leadSourceFieldData.length > 0 ? (
                  <LeadSourceDistributionPie data={leadSourceFieldData} onSegmentClick={handleLeadSourceFieldClick} />
                ) : (
                  <div className="text-center py-5">
                    <i className="fa-solid fa-chart-pie fa-3x text-muted mb-3"></i>
                    <p className="text-muted">No lead_source data for selected period</p>
                  </div>
                )}
              </div>
            </div>
            <div className="col col-xxl-5 col-lg-4 col-12">
              <div className="w_card">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h3 className="w_card_title mb-0">Lead Source Performance</h3>
                  <small className="text-muted">
                    Top 5 performing sources
                  </small>
                </div>
                {leadSourceFieldData.length > 0 ? (
                  <div className="lead-source-performance">
                    {leadSourceFieldData
                      .sort((a, b) => b.value - a.value)
                      .slice(0, 5)
                      .map((source, index) => (
                        <div 
                          key={source.name} 
                          className="d-flex justify-content-between align-items-center py-2 border-bottom"
                          onClick={() => handleLeadSourceFieldClick(source)}
                          style={{ 
                            cursor: 'pointer',
                            transition: 'background-color 0.2s'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.05)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                          title={`Click to view leads from ${source.name}`}
                        >
                          <div className="d-flex align-items-center">
                            <div 
                              className="me-3 rounded-circle" 
                              style={{
                                width: '12px',
                                height: '12px',
                                backgroundColor: ['var(--primary)', 'var(--secondary)', 'var(--primary2)', 'var(--secondary2)', 'var(--primary3)', 'var(--secondary3)'][index]
                              }}
                            ></div>
                            <span className="fw-medium">{source.name}</span>
                          </div>
                          <div className="text-end">
                            <div className="fw-bold">{source.value}</div>
                            <small className="text-muted">
                              {((source.value / leadSourceFieldData.reduce((sum, s) => sum + s.value, 0)) * 100).toFixed(1)}%
                            </small>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                ) : (
                  <div className="text-center py-5">
                    <i className="fa-solid fa-trophy fa-3x text-muted mb-3"></i>
                    <p className="text-muted">No lead_source performance data for selected period</p>
                  </div>
                )}
              </div>
            </div>

          </div>

        </div>

        
      </div>
    </div>
  );
}