"use client";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { formatTimestamp } from "../../../utils/dateUtils";
import useFetch from "../../../hooks/useFetch";
import { Col, Row, Button, Spinner, Nav, Badge } from "react-bootstrap";
import EmailReplyModal from "./EmailReplyModal";
import DateRangePickerComponent from "../../components/DateRangePicker";
import StatusModal from "./StatusModal"; // Import StatusModal
import LeadNotesModal from "./LeadNotesModal"; // Import LeadNotesModal
import AiLeadPanel from "../../ai/components/AiLeadPanel";
// import AutoReplyToggle from "./AutoReplyToggle"; // Import AutoReplyToggle
// import PendingAutoReplyIndicator from "./PendingAutoReplyIndicator"; // Import Pending indicator
import { useUser } from "../../context/UserContext";
import LeadList from "./LeadList";
import {
  AGENT_VIEW_LANGUAGE_OPTIONS,
  fetchAgentLanguageOptions,
  leadUserLanguageDisplay,
  messageUserLanguageDisplay,
} from "../../utils/conversationTranslation";
import { throwIfStatusFailed } from "../../../lib/bookingConflict"; // stream R: full-slot answer

// SMS is the default reply channel; email is only used when explicitly
// preferred, and either option is only offered when the lead actually has
// that contact method on file.
function getReplyChannel(lead) {
  const hasPhone = !!lead?.phone;
  const hasEmail = !!lead?.email;
  if (hasPhone && hasEmail) {
    return lead.followup_preference === 'email' ? 'email' : 'sms';
  }
  if (hasPhone) return 'sms';
  if (hasEmail) return 'email';
  return null;
}

function mergeConversationMessages(currentMessages, incomingMessages) {
  const byId = new Map(currentMessages.map((message) => [message._id, message]));
  incomingMessages.forEach((message) => byId.set(message._id, message));
  return Array.from(byId.values());
}

export default function ViewConversations({
  lead,
  onBack,
  onLeadSelected = () => {},
  activeLeadId,
  isOpen = false,
  toggleSidebar = () => {},
  isMobile,
  // When true, renders just the lead info + conversation thread without the
  // all-dealer lead-list sidebar (used to back Prev/Next navigation on the leads
  // page) or the Prev/Next/Back-to-List controls that only make sense with that
  // sidebar. Used to drop this component into a customer-scoped context (e.g. a
  // lead accordion on the customer detail page) where there's no "whole dealer
  // lead list" to navigate.
  embedded = false,
}) {
  const AGENT_VIEW_LANGUAGE_STORAGE_KEY = "dealer_agent_view_language";
  const [emails, setEmails] = useState([]);
  const { fetchData } = useFetch();
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [editNote, setEditNote] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);
  const [leadData, setLeadData] = useState(lead); // Local lead state for auto-reply updates
  const [dateRange, setDateRange] = useState({
    startDate: null,
    endDate: null
  });
  const [showTranslation, setShowTranslation] = useState(false);
  const [agentViewLanguage, setAgentViewLanguage] = useState("English");
  const [agentLanguageOptions, setAgentLanguageOptions] = useState(AGENT_VIEW_LANGUAGE_OPTIONS);
  const [translationMap, setTranslationMap] = useState({});
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const translationCacheRef = useRef({});
  const sidebarRef = useRef(null);
  const previousLeadIdRef = useRef(null);
  const [activeChannelTab, setActiveChannelTab] = useState("sms");
  const tabDefaultSetForLeadRef = useRef(null);
  const conversationGenerationRef = useRef(0);
  const initialRequestControllerRef = useRef(null);
  const pollingRef = useRef(false);
  const olderRequestRef = useRef(false);
  const cursorRef = useRef({ older: null, newer: null, hasOlder: false });
  const [hasOlderConversations, setHasOlderConversations] = useState(false);
  const [loadingOlderConversations, setLoadingOlderConversations] = useState(false);

  const {  dealerParent } = useUser();

  // Get dealer timezone
  const dealerTimezone = dealerParent?.dealer_account_information?.time_zone || 'America/New_York';
  const leadUserLanguageLabel = useMemo(
    () => leadUserLanguageDisplay(lead),
    [lead?.user_language, lead?._id]
  );
  const latestNonNoteForLanguage = useMemo(
    () =>
      (emails || [])
        .slice()
        .filter((e) => !(e?.is_note || e?.status === "note"))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0] || null,
    [emails]
  );
  const latestConversationUserLanguageLabel = useMemo(
    () => messageUserLanguageDisplay(latestNonNoteForLanguage, lead),
    [latestNonNoteForLanguage, lead?.user_language, lead?._id]
  );
  const sortedEmails = useMemo(
    () => [...emails].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    [emails]
  );
  const smsConversations = useMemo(
    () => sortedEmails.filter((e) => e.communication_type === "sms"),
    [sortedEmails]
  );
  const emailConversations = useMemo(
    () => sortedEmails.filter((e) => e.communication_type !== "sms"),
    [sortedEmails]
  );
  const activeChannelEmails = activeChannelTab === "sms" ? smsConversations : emailConversations;

    // 🔹 hold a ref to the LeadList so we can trigger pagination from here
  const leadListRef = useRef(null);
  
  // Update local lead data when prop changes
  useEffect(() => {
    setLeadData(lead);
  }, [lead]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const langs = await fetchAgentLanguageOptions();
      if (!ignore && Array.isArray(langs) && langs.length > 0) {
        setAgentLanguageOptions(langs);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(AGENT_VIEW_LANGUAGE_STORAGE_KEY);
      if (saved && agentLanguageOptions.includes(saved)) {
        setAgentViewLanguage(saved);
      }
    } catch {
      // ignore
    }
  }, [agentLanguageOptions]);

  useEffect(() => {
    try {
      localStorage.setItem(AGENT_VIEW_LANGUAGE_STORAGE_KEY, agentViewLanguage);
    } catch {
      // ignore
    }
  }, [agentViewLanguage]);

  const getAttachmentIcon = (contentType) => {
    if (contentType?.startsWith('image/')) return 'fa-regular fa-image';
    if (contentType?.startsWith('video/')) return 'fa-regular fa-video';
    if (contentType?.startsWith('audio/')) return 'fa-regular fa-music';
    if (contentType?.includes('pdf')) return 'fa-regular fa-file-pdf';
    return 'fa-regular fa-file';
  };
  const [showStatusModal, setShowStatusModal] = useState(false); // State for status modal

  const buildConversationUrl = useCallback((leadId, cursorType, cursorValue, pageLimit = 50) => {
    const params = new URLSearchParams({ lead_id: leadId, limit: String(pageLimit) });
    if (dateRange.startDate) params.set("startDate", dateRange.startDate.toISOString());
    if (dateRange.endDate) params.set("endDate", dateRange.endDate.toISOString());
    if (cursorType && cursorValue) params.set(cursorType, cursorValue);
    return `/api/conversations/lead?${params.toString()}`;
  }, [dateRange.startDate, dateRange.endDate]);

  const readConversationResponse = useCallback(async (response) => {
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error || "Failed to fetch conversations");
    return {
      emails: Array.isArray(json.emails) ? json.emails : [],
      pageInfo: json.pageInfo || {},
    };
  }, []);

  const reconcileLatestConversations = useCallback(async (leadId) => {
    if (!leadId) return;
    const generation = conversationGenerationRef.current;
    try {
      const response = await fetch(buildConversationUrl(leadId, null, null, 50));
      const result = await readConversationResponse(response);
      if (generation !== conversationGenerationRef.current) return;

      setEmails((current) => mergeConversationMessages(current, result.emails));
      setSelectedConversation((current) => {
        if (!current) return result.emails[0] || null;
        return result.emails.find((message) => message._id === current._id) || current;
      });
      if (result.pageInfo.newerCursor) cursorRef.current.newer = result.pageInfo.newerCursor;
      if (!cursorRef.current.older && result.pageInfo.olderCursor) {
        cursorRef.current.older = result.pageInfo.olderCursor;
        cursorRef.current.hasOlder = Boolean(result.pageInfo.hasOlder);
        setHasOlderConversations(cursorRef.current.hasOlder);
      }
    } catch (err) {
      console.error("Error reconciling conversations:", err);
    }
  }, [buildConversationUrl, readConversationResponse]);

  const pollForNewConversations = useCallback(async (leadId) => {
    if (!leadId || pollingRef.current) return;
    if (!cursorRef.current.newer) {
      await reconcileLatestConversations(leadId);
      return;
    }

    pollingRef.current = true;
    const generation = conversationGenerationRef.current;
    let cursor = cursorRef.current.newer;
    try {
      let hasNewer = true;
      while (hasNewer && generation === conversationGenerationRef.current) {
        const response = await fetch(buildConversationUrl(leadId, "after", cursor, 100));
        const result = await readConversationResponse(response);
        if (generation !== conversationGenerationRef.current) return;

        if (result.emails.length > 0) {
          setEmails((current) => mergeConversationMessages(current, result.emails));
          cursor = result.pageInfo.newerCursor;
          cursorRef.current.newer = cursor;
        }
        hasNewer = Boolean(result.pageInfo.hasNewer && result.pageInfo.newerCursor);
      }
    } catch (err) {
      console.error("Error polling conversations:", err);
    } finally {
      pollingRef.current = false;
    }
  }, [buildConversationUrl, readConversationResponse, reconcileLatestConversations]);

  const loadOlderConversations = useCallback(async () => {
    const leadId = lead?._id;
    const olderCursor = cursorRef.current.older;
    if (!leadId || !olderCursor || olderRequestRef.current) return;

    olderRequestRef.current = true;
    setLoadingOlderConversations(true);
    const generation = conversationGenerationRef.current;
    try {
      const response = await fetchData(buildConversationUrl(leadId, "before", olderCursor, 50));
      const result = await readConversationResponse(response);
      if (generation !== conversationGenerationRef.current) return;

      setEmails((current) => mergeConversationMessages(current, result.emails));
      if (result.pageInfo.olderCursor) cursorRef.current.older = result.pageInfo.olderCursor;
      cursorRef.current.hasOlder = Boolean(result.pageInfo.hasOlder);
      setHasOlderConversations(cursorRef.current.hasOlder);
    } catch (err) {
      console.error("Error loading older conversations:", err);
    } finally {
      olderRequestRef.current = false;
      if (generation === conversationGenerationRef.current) {
        setLoadingOlderConversations(false);
      }
    }
  }, [lead?._id, fetchData, buildConversationUrl, readConversationResponse]);

  useEffect(() => {
    const leadId = lead?._id;
    conversationGenerationRef.current += 1;
    const generation = conversationGenerationRef.current;
    initialRequestControllerRef.current?.abort();
    const controller = new AbortController();
    initialRequestControllerRef.current = controller;
    cursorRef.current = { older: null, newer: null, hasOlder: false };
    setHasOlderConversations(false);
    setLoadingOlderConversations(false);
    setEmails([]);
    setSelectedConversation(null);

    if (!leadId) return () => controller.abort();
    if (previousLeadIdRef.current && previousLeadIdRef.current !== leadId) {
      setIsNavigating(true);
    }
    previousLeadIdRef.current = leadId;

    (async () => {
      try {
        const response = await fetchData(buildConversationUrl(leadId, null, null, 50), {
          signal: controller.signal,
        });
        const result = await readConversationResponse(response);
        if (generation !== conversationGenerationRef.current) return;

        setEmails(result.emails);
        setSelectedConversation(result.emails[0] || null);
        cursorRef.current = {
          older: result.pageInfo.olderCursor || null,
          newer: result.pageInfo.newerCursor || null,
          hasOlder: Boolean(result.pageInfo.hasOlder),
        };
        setHasOlderConversations(cursorRef.current.hasOlder);
        if (tabDefaultSetForLeadRef.current !== leadId) {
          tabDefaultSetForLeadRef.current = leadId;
          setActiveChannelTab(result.emails.some((message) => message.communication_type === "sms") ? "sms" : "email");
        }
      } catch (err) {
        if (err.name !== "AbortError") console.error("Error fetching conversations:", err);
      }
    })();

    return () => controller.abort();
  }, [lead?._id, dateRange.startDate, dateRange.endDate, buildConversationUrl, fetchData, readConversationResponse]);

  useEffect(() => {
    if (refreshKey > 0 && lead?._id) reconcileLatestConversations(lead._id);
  }, [refreshKey, lead?._id, reconcileLatestConversations]);

  // Poll only for records newer than the newest cursor. Catch up immediately
  // when a hidden tab becomes visible again.
  useEffect(() => {
    if (!lead?._id) return;
    const poll = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      pollForNewConversations(lead._id);
    };
    const pollInterval = setInterval(poll, 10000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(pollInterval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [lead?._id, dateRange.startDate, dateRange.endDate, pollForNewConversations]);

  useEffect(() => {
    if (emails.length > 0 || (emails.length === 0 && lead?._id)) setIsNavigating(false);
  }, [emails, lead?._id]);

  const handleDateRangeChange = (startDate, endDate) => {
    setDateRange({ startDate, endDate });
  };

  const handleReplySuccess = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleNoteSaved = () => {
    setRefreshKey(prev => prev + 1);
    setEditNote(null); // Clear edit note
  };

  const handleEditNote = (note) => {
    setEditNote(note);
    setShowNotesModal(true);
  };

  const handleCloseNotesModal = () => {
    setShowNotesModal(false);
    setEditNote(null);
  };
  
  // Handler for auto-reply toggle updates
  const handleAutoReplyUpdate = (updatedLeadData) => {
    setLeadData(prev => ({
      ...prev,
      auto_reply_enabled: updatedLeadData.auto_reply_enabled,
      auto_reply_paused_until: updatedLeadData.auto_reply_paused_until,
      pending_auto_reply_job_id: updatedLeadData.pending_auto_reply_job_id
    }));
  };
  
  // Handler for cancelling pending auto-reply
  const handleCancelPendingAutoReply = async () => {
    try {
      const response = await fetchData('/api/conversations/lead/auto-reply-control', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
        },
        body: JSON.stringify({
          lead_id: lead._id,
          action: 'pause',
          duration_minutes: 0 // Pause for 0 minutes (just cancel the current job)
        })
      });
      
      const data = await response.json();
      if (data.success) {
        handleAutoReplyUpdate(data.lead);
        console.log('Pending auto-reply cancelled');
      }
    } catch (error) {
      console.error('Error cancelling pending auto-reply:', error);
    }
  };

  // ---- NAVIGATION HANDLERS --------------------------------------------------
  const handleNextLead = () => {
    if (!leadListRef.current || isNavigating) return;
    setIsNavigating(true);
    leadListRef.current.moveToNextLead(lead);
  };

  const handlePrevLead = () => {
    if (!leadListRef.current || isNavigating) return;
    setIsNavigating(true);
    leadListRef.current.moveToPrevLead(lead);
  };

  // Handle close/back - clear selectedLead from URL and call onBack
  const handleClose = () => {
    // Call onBack first to update parent state (this will clear URL)
    if (onBack) {
      onBack();
    }
    // Also clear selectedLead from URL via LeadList ref (backup)
    if (leadListRef.current && leadListRef.current.clearSelectedLead) {
      leadListRef.current.clearSelectedLead();
    }
  };

  // Status update handler (supports booking fields)
  const handleStatusChange = async (newStatus, extra = {}) => {
    try {
      // Get dealertoken from localStorage
      const token = localStorage.getItem("dealertoken");
      const headers = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const payload = { id: lead._id, status: newStatus, ...extra };
      console.log('Sending lead status update (conversations):', payload);
      const response = await fetch("/api/conversations/lead/status", {
        method: "PUT",
        headers: headers,
        body: JSON.stringify(payload),
      });

      // A full slot keeps the modal open with "Book {next available}" (stream R, app/lib/bookingConflict.js).
      await throwIfStatusFailed(response, extra);
      
      // Update local state
      lead.fe_lead_status = newStatus;
      setRefreshKey(prev => prev + 1);
    } catch (err) {
      if (err?.slotConflict) throw err; // shown in the StatusModal (stream R)
      console.error("Error updating status:", err);
    }
  };

  const extractAdfData = (content) => {
    if (!content || typeof content !== 'string') return null;

    try {
      const plainTextMatch = content.match(/<adf>[\s\S]*<\/adf>/);
      if (plainTextMatch) {
        return {
          type: 'xml',
          content: plainTextMatch[0],
          parsed: parseAdfXml(plainTextMatch[0])
        };
      }

      const htmlMatch = content.match(/&lt;adf&gt;[\s\S]*&lt;\/adf&gt;/);
      if (htmlMatch) {
        const xmlContent = htmlMatch[0]
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&');
        return {
          type: 'html',
          content: xmlContent,
          parsed: parseAdfXml(xmlContent)
        };
      }

      return null;
    } catch (error) {
      console.error("Error extracting ADF data:", error);
      return null;
    }
  };

  // Function to parse ADF/XML into a readable object
  const parseAdfXml = (xmlString) => {
    if (!xmlString) return null;

    try {
      const prospectMatch = xmlString.match(/<prospect>([\s\S]*)<\/prospect>/);
      if (!prospectMatch) return null;

      const prospectContent = prospectMatch[1];

      return {
        id: extractTagValue(prospectContent, 'id'),
        requestdate: extractTagValue(prospectContent, 'requestdate'),
        vehicle: {
          year: extractTagValue(prospectContent, 'year'),
          make: extractTagValue(prospectContent, 'make'),
          model: extractTagValue(prospectContent, 'model')
        },
        customer: {
          firstName: extractTagValue(prospectContent, 'name', 'first'),
          lastName: extractTagValue(prospectContent, 'name', 'last'),
          email: extractTagValue(prospectContent, 'email'),
          phone: extractTagValue(prospectContent, 'phone')
        },
        vendor: {
          id: extractTagValue(prospectContent, 'id'),
          name: extractTagValue(prospectContent, 'vendorname')
        }
      };
    } catch (error) {
      console.error("Error parsing ADF XML:", error);
      return null;
    }
  };

  // Helper function to extract values from XML tags
  const extractTagValue = (content, tagName, attributeValue = null) => {
    if (!content) return null;

    try {
      if (attributeValue) {
        const regex = new RegExp(`<${tagName}[^>]*part="${attributeValue}"[^>]*>([^<]*)<\/${tagName}>`);
        const match = content.match(regex);
        return match ? match[1].trim() : null;
      } else {
        const regex = new RegExp(`<${tagName}[^>]*>([^<]*)<\/${tagName}>`);
        const match = content.match(regex);
        return match ? match[1].trim() : null;
      }
    } catch (error) {
      console.error("Error extracting tag value:", error);
      return null;
    }
  };

  // Function to clean up email content
  const cleanEmailContent = (raw) => {
    if (!raw || typeof raw !== 'string') {
      return { type: 'text', content: '' }
    }

    let body = raw
      .replace(/^(Content-Type|Content-Transfer-Encoding):.*$/gim, '')
      .replace(/^--[_A-Za-z0-9-]+/gm, '')
      .trim()

    const adf = extractAdfData(body)
    if (adf) {
      return adf
    }

    body = body
      .replace(/<div class="gmail_signature"[\s\S]*$/i, '')
      .replace(/<!--\s*signature[\s\S]*$/i, '')

    const sigMarkers = [
      '\n-- ',
      '\n__',
      '\nThanks,',
      '\nRegards,',
      '\nSent from my',
    ]
    for (const marker of sigMarkers) {
      const idx = body.indexOf(marker)
      if (idx !== -1) {
        body = body.slice(0, idx)
        break
      }
    }

    body = body.split(/\nOn .*? wrote:/)[0]

    if (/<[a-z][\s\S]*>/i.test(body)) {
      return { type: 'html', content: body.trim() }
    }

    return {
      type: 'text',
      content: body.replace(/<[^>]+>/g, '').trim()
    }
  };

  const normalizeTranslationText = (text) => {
    if (!text || typeof text !== "string") return "";
    return text.replace(/\s+/g, " ").trim();
  };

  const getMessageTextForTranslation = (email) => {
    const cleaned = cleanEmailContent(email?.mail_content || "");
    if (cleaned.type === "html" || cleaned.type === "xml") {
      const stripped = String(cleaned.content || "").replace(/<[^>]+>/g, " ");
      return normalizeTranslationText(stripped);
    }
    return normalizeTranslationText(cleaned.content);
  };

  const hashText = (value) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
  };

  const getTranslationKey = (email, targetLanguage, text) => {
    const leadId = lead?._id || "no-lead";
    const emailId = email?._id || "no-email";
    return `${leadId}:${emailId}:${targetLanguage}:${hashText(text)}`;
  };

  /** Stable while message bodies/order are unchanged — avoids re-calling translate on every poll. */
  const translationFingerprint = [...emails]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((e) => {
      const text = getMessageTextForTranslation(e);
      return `${e._id}:${hashText(text)}`;
    })
    .join("|");

  useEffect(() => {
    let ignore = false;

    const fetchTranslations = async () => {
      if (!showTranslation || !sortedEmails.length) {
        setTranslationError("");
        setTranslationLoading(false);
        return;
      }

      const translationCandidates = sortedEmails
        .map((email) => {
          const text = getMessageTextForTranslation(email);
          const key = getTranslationKey(email, agentViewLanguage, text);
          return { email, key, text };
        })
        .filter((item) => item.text);

      const missing = translationCandidates.filter(
        (item) => !translationCacheRef.current[item.key]
      );

      if (!missing.length) {
        setTranslationError("");
        setTranslationLoading(false);
        return;
      }

      setTranslationLoading(true);
      setTranslationError("");
      try {
        const token = localStorage.getItem("dealertoken");
        const response = await fetch("/api/conversations/translate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            targetLanguage: agentViewLanguage,
            sourceHint: "",
            messages: missing.map((item) => ({ id: item.key, text: item.text })),
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || "Failed to translate conversation.");
        }

        const nextMap = data?.translations || {};
        Object.keys(nextMap).forEach((key) => {
          translationCacheRef.current[key] = nextMap[key];
        });
        if (!ignore) {
          setTranslationMap((prev) => ({ ...prev, ...nextMap }));
        }
      } catch (err) {
        if (!ignore) {
          setTranslationError(err.message || "Translation failed. Showing original text.");
        }
      } finally {
        if (!ignore) setTranslationLoading(false);
      }
    };

    fetchTranslations();
    return () => {
      ignore = true;
    };
  }, [showTranslation, translationFingerprint, agentViewLanguage, leadUserLanguageLabel]);

  // ✅ Close sidebar when clicking outside (mobile)
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        sidebarRef.current &&
        !sidebarRef.current.contains(event.target) &&
        isOpen // use prop instead of local state
      ) {
        toggleSidebar(); // call prop toggle function
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, toggleSidebar]);

  if (!lead) return null;

  // ✅ Close sidebar when a lead is selected
  const handleLeadSelect = (selectedLead) => {
    onLeadSelected(selectedLead);
    if (isOpen) toggleSidebar(); // use prop toggle
  };

  return (
    <>
      <Row className="justify-content-center gx-3">
        {/* <Col xxl={3} lg={4} md={12} sm={12}>
          <div className="dealer_info position-sticky mb-2">
            <LeadList
              ref={leadListRef}
              onLeadSelected={onLeadSelected}
              activeLeadId={lead?._id}
              compact={true}
            />
          </div>
        </Col> */}

      {/* Fixed Sidebar - not applicable when embedded (no all-dealer lead list to browse) */}
      {!embedded && (
        <Col xxl={3} lg={4} md={5} sm={12} className={`dealer-sidebar ${isOpen ? "sidebar-open" : "sidebar-closed"}`} ref={sidebarRef}>
          <div className="dealer_info position-sticky">
              {isMobile && (
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="offcanvas-title mb-0">Leads</h5>
                <Button variant="outline-secondary" size="sm" onClick={toggleSidebar}><i className="fa-regular fa-xmark"></i></Button>
            </div>
              )}

            <LeadList
              ref={leadListRef}
              onLeadSelected={handleLeadSelect}
              activeLeadId={lead?._id}
              compact={true}
            />
          </div>
        </Col>
      )}

        <Col xxl={embedded ? 12 : 9} lg={embedded ? 12 : 8} md={12} sm={12}>
          <Row className="gx-3">
            <Col xxl={4} lg={12} md={5}>
              <div className="dealer_info position-sticky mb-3">
                {/* Auto-Reply Toggle Component */}
                {/* <AutoReplyToggle 
                  lead={leadData} 
                  onUpdate={handleAutoReplyUpdate} 
                /> */}
                
                {/* Pending Auto-Reply Countdown Indicator */}
                {/* {leadData?.pending_auto_reply_job_id && (
                  <PendingAutoReplyIndicator 
                    lead={leadData} 
                    onCancel={handleCancelPendingAutoReply}
                  />
                )} */}
                
                <div className="w_card leadinfo_card mb-2 row gx-1">
                  <p className="col col-xxl-12 col-lg-6 col-12"><strong>Name:</strong> {lead?.name  || "N/A"}</p>
                  <p className="col col-xxl-12 col-lg-6 col-12 text-break"><strong>Email:</strong> {lead?.email  || "N/A"}</p>
                  <p className="col col-xxl-12 col-lg-6 col-12"><strong>Phone:</strong> {lead?.phone  || "N/A"}</p>
                  <p className="col col-xxl-12 col-lg-6 col-6"><strong>Source Type:</strong> {lead?.source  || "N/A"}</p>

                  <p className="col col-xxl-12 col-lg-6 col-6">
                    <strong>Lead Status:</strong> {lead?.fe_lead_status  || "N/A"}
                  </p>
                  <p className="col col-xxl-12 col-lg-6 col-12"><strong>Lead Source:</strong> {lead?.lead_source  || "N/A"}</p>
                  <p className="col col-xxl-12 col-lg-6 col-6"><strong>Vin:</strong> {lead?.vin  || "N/A"}</p>
                  <p className="col col-xxl-12 col-lg-6 col-6"><strong>Year:</strong> {lead?.vehicle_year  || "N/A"}</p>
                  <p className="col col-xxl-12 col-lg-6 col-6"><strong>Make:</strong> {lead?.vehicle_make  || "N/A"}</p>
                  <p className="col col-xxl-12 col-lg-6 col-6"><strong>Model:</strong> {lead?.vehicle_model  || "N/A"}</p>
                  <p className="col col-xxl-12 col-lg-6 col-12 mb-0"><strong>Lead Date:</strong> {formatTimestamp(lead.createdAt, dealerTimezone)}
                   </p>
                   <p className="col col-xxl-12 col-lg-6 col-12 mb-0"><strong>Lead Date:</strong> {formatTimestamp(lead.createdAt.toLocaleString())}</p>

                  {lead.booking_status && lead.booking && (
                    <div className="mt-3 px-3 py-2 bg-light rounded border">
                      <h5 className="w_card_title mb-2">Booking Details</h5>
                      <p className="mb-2"><strong>Date:</strong> {
                        (() => {
                          if (!lead.booking.booking_date) return 'N/A';
                          // Extract date without timezone conversion
                          const dateStr = lead.booking.booking_date.split('T')[0];
                          const [year, month, day] = dateStr.split('-');
                          return `${month}/${day}/${year}`; // Consistent MM/DD/YYYY format
                        })()
                      }</p>
                      <p>
                        <strong>Time:</strong>{' '}
                        {(() => {
                          const timeStr = lead?.booking?.booking_time;
                          if (!timeStr) return 'Time Flexible';
                          
                          // If already in AM/PM format, return as-is
                          if (timeStr.toLowerCase().includes('am') || timeStr.toLowerCase().includes('pm')) {
                            return timeStr;
                          }
                          
                          // Convert 24-hour format to 12-hour AM/PM
                          const [hours, minutes] = timeStr.split(':').map(Number);
                          const period = hours >= 12 ? 'PM' : 'AM';
                          const hour12 = hours % 12 || 12;
                          return `${String(hour12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${period}`;
                        })()}
                      </p>
                    </div>
                  )}

                  <div className="position-relative mt-3">
                    <Row className="align-items-center g-1">
                    <Col xxl={12} lg={3} md={12} xs={6}>
                      {selectedConversation && getReplyChannel(lead) && (
                        <Button
                          variant="custom"
                          className="w-100"
                          onClick={() => setShowReplyModal(true)}
                        >
                          <i className="fa-regular fa-reply me-2"></i>
                          {getReplyChannel(lead) === 'sms' ? 'SMS Reply' : 'Email Reply'}
                        </Button>
                      )}
                    </Col>

                    <Col xxl={12} lg={3} md={12} xs={6}>
                    <Button
                      variant="outline-warning"
                      className="w-100 text-nowrap"
                      onClick={() => setShowNotesModal(true)}
                    >
                      <i className="fa-solid fa-sticky-note me-2"></i>
                      Add Note
                    </Button>
                    </Col>

                    <Col xxl={12} lg={3} md={12} xs={6}>
                    <Button
                      variant="outline-custom"
                      className="w-100 text-nowrap"
                      onClick={() => setShowStatusModal(true)}
                    >
                      <i className="fa-solid fa-pen me-2"></i>
                      Update Status
                    </Button>
                    </Col>

                    {!embedded && (
                    <Col xxl={12} lg={3} md={12} xs={6}>
                    <Button
                      variant="outline-secondary"
                      className="w-100"
                      onClick={handleClose}
                    >
                      <i className="fa-solid fa-arrow-left me-2"></i>
                      Back to List
                    </Button>
                    </Col>
                    )}
                    </Row>
                  </div>
                </div>
                {/* What the AI is doing with this lead (stage, next touch, call task, consent; on/off) */}
                {lead?._id && <AiLeadPanel key={lead._id} leadId={lead._id} />}
                {!embedded && (
                <div className="d-flex align-items-center justify-content-between gap-2">
                  <Button
                    variant="outline-custom"
                    onClick={handlePrevLead}
                    disabled={isNavigating}
                  >
                    {isNavigating ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-1" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <i className="fa-solid fa-chevron-left me-1" /> Prev
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline-custom"
                    onClick={handleNextLead}
                    disabled={isNavigating}
                  >
                    {isNavigating ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-1" />
                        Loading...
                      </>
                    ) : (
                      <>
                        Next <i className="fa-solid fa-chevron-right ms-1" />
                      </>
                    )}
                  </Button>
                </div>
                )}
              </div>
            </Col>

            <Col xxl={8} lg={12} md={7}>
              <div className="position-relative mb-xl-3 mb-2">
                {isNavigating && (
                  <div 
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(255, 255, 255, 0.8)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 10,
                      borderRadius: '0.375rem'
                    }}
                  >
                    <Spinner animation="border" variant="primary" />
                  </div>
                )}
                <Row className="align-items-center gx-1">
                  <Col xxl={7} xl={7} md={5} xs={12}>
                    <div className="d-flex align-items-center">
                      <h3 className="w_card_title mb-0">Conversations</h3>
                    </div>
                  </Col>
                  <Col xxl={5} xl={5} md={7} xs={12}>
                    <div className="d-flex align-items-center justify-content-md-end justify-content-between gap-2 mt-2 mt-md-0">
                      <DateRangePickerComponent
                        onDateRangeChange={handleDateRangeChange}
                        size="sm"
                      />

                      <div className="d-flex align-items-center gap-2">
                        <span className="small fw-semibold">Show translation</span>
                        <div className="form-check form-switch mb-0">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={showTranslation}
                            onChange={(e) => setShowTranslation(e.target.checked)}
                          />
                        </div>
                      </div>
                    </div>
                  </Col>
                </Row>

                <Nav
                  variant="pills"
                  activeKey={activeChannelTab}
                  onSelect={(key) => setActiveChannelTab(key)}
                  className="mt-2"
                >
                  <Nav.Item>
                    <Nav.Link eventKey="sms">
                      <i className="fa-regular fa-comment-sms me-2"></i>SMS Conversation
                      {smsConversations.length > 0 && (
                        <Badge bg="secondary" className="ms-2">{smsConversations.length}</Badge>
                      )}
                    </Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="email">
                      <i className="fa-regular fa-envelope me-2"></i>Email Conversation
                      {emailConversations.length > 0 && (
                        <Badge bg="secondary" className="ms-2">{emailConversations.length}</Badge>
                      )}
                    </Nav.Link>
                  </Nav.Item>
                </Nav>
              </div>

              {activeChannelEmails.length > 0 ? (
                <div className="conversation-list">
                  {showTranslation && (
                  <div className="w_card mb-2">
                    <Row className="align-items-center gx-2">
                      <Col xxl={6} xl={6} lg={6} xs={12} className="d-flex align-items-center gap-2">
                        <span className="small text-muted text-uppercase text-nowrap" style={{ letterSpacing: "0.04em", fontSize: "0.72rem" }}>View in</span>
                        <select
                          className="form-select form-select-sm border-0"
                          value={agentViewLanguage}
                          onChange={(e) => setAgentViewLanguage(e.target.value)}
                          style={{ width: "200px", backgroundColor: "#f7f9fc", boxShadow: "inset 0 0 0 1px #dce3ee" }}
                          title="Language you want to read this conversation in"
                        >
                        {agentLanguageOptions.map((lang) => (
                            <option key={lang} value={lang}>
                              {lang}
                            </option>
                          ))}
                        </select>
                      </Col>
                      <Col xxl={5} xl={4} lg={5} xs={12} className="d-flex align-items-center gap-2">
                        <span className="small text-muted text-uppercase text-nowrap" style={{ letterSpacing: "0.04em", fontSize: "0.72rem" }}>User language</span>
                        <input
                          type="text"
                          className="form-control form-control-sm border-0"
                          value={latestConversationUserLanguageLabel}
                          disabled
                          style={{ width: "200px", backgroundColor: "#eef2f7", boxShadow: "inset 0 0 0 1px #dce3ee", color: "#1f2a37", opacity: 1 }}
                        />
                      </Col>
                      <Col xs={12} className="small text-muted mt-1">
                        <span><i className="fa-regular fa-circle-info me-1"></i>Translations are shown for readability. Original messages remain unchanged.</span>
                      </Col>
                    </Row>
                    {/* <div className="d-flex align-items-center gap-2">
                      <span className="small fw-semibold">Show translation</span>
                      <div className="form-check form-switch mb-0">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={showTranslation}
                          onChange={(e) => setShowTranslation(e.target.checked)}
                        />
                      </div>
                    </div> */}                   
                    
                  </div>
                  )}
                  {translationLoading && (
                    <div className="w_card mb-2 py-2 small">
                      <i className="fa-regular fa-hourglass me-2"></i>Translating conversation<span className="load_dots"></span>
                    </div>
                  )}
                  {translationError && (
                    <div className="w_card mb-2 py-2 small text-danger">
                      {translationError}
                    </div>
                  )}
                  {activeChannelEmails.map((email) => {
                      const cleaned = cleanEmailContent(email.mail_content || "");
                      const originalText = getMessageTextForTranslation(email);
                      const translationKey = getTranslationKey(email, agentViewLanguage, originalText);
                      const translatedText = translationMap[translationKey] || translationCacheRef.current[translationKey] || "";
                      const msgUserLanguageLabel = messageUserLanguageDisplay(email, lead);
                      let messageBy = '';
                      if(email.status === 'incoming' || email.status === 'received'){
                        messageBy = lead.name || lead.email || lead.phone || 'Unknown';
                      }else{
                         messageBy = email.message_by?.name || dealerParent?.dealer_account_information?.ai_bot_name || 'chatbot';
                      }
                      const isNote = email.is_note || email.status === 'note';
                      
                      return (
                        <div
                          key={email._id}
                          className={`w_card mb-2 conversation-item ${
                            selectedConversation?._id === email._id ? 'selected-conversation' : ''
                          } ${isNote ? 'note-item' : ''}`}
                          onClick={() => setSelectedConversation(email)}
                          style={isNote ? (email.internal_use === true ? {
                            borderLeft: '4px solid #2196f3',
                            backgroundColor: '#e3f2fd',
                            border: '1px solid #2196f3'
                          } : {
                            borderLeft: '4px solid #ffc107',
                            backgroundColor: '#fff8e1',
                            border: '1px solid #ffc107'
                          }) : {}}
                        >
                          <div className="conversation-header d-flex justify-content-between align-items-start mb-2">
                            <div>
                              <h6 className="w_card_title mb-1 fw-bold">
                                {isNote ? (
                                  <>
                                    <i className={`fa-solid fa-sticky-note me-2 ${email.internal_use === true ? 'text-info' : 'text-warning'}`}></i>
                                    {email.internal_use === true ? 'Note for Internal Use Only' : 'Lead Note'}
                                  </>
                                ) : (
                                  email.subject || 'No Subject'
                                )}
                              </h6>
                              {!isNote ? (
                                <div className="text-muted small">
                                  <div><strong>From:</strong> {email.sender}</div>
                                  <div><strong>To:</strong> {email.recipient}</div>
                                  <div>
                                    <strong>User language:</strong> {msgUserLanguageLabel}
                                  </div>
                                </div>
                              ) : (
                                <div className="text-muted small">
                                  <div>
                                    <strong>User language:</strong> {msgUserLanguageLabel}
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="text-end">
                              <div className="d-flex align-items-center gap-1 justify-content-end">
                                {isNote && (
                                  <Button
                                    variant={email.internal_use === true ? "outline-info" : "outline-warning"}
                                    size="xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEditNote(email);
                                    }}
                                    className="text-nowrap"
                                  >
                                    <i className="fa-regular fa-pen-to-square me-1"></i>
                                    Edit
                                  </Button>
                                )}
                                <span className={`badge ${
                                  isNote ? (email.internal_use === true ? "bg-info" : "bg-warning") :
                                  email.status === "sent" ? "bg-success" :
                                  email.status === "incoming" ? "bg-warning" : "bg-danger"
                                }`}>
                                  {isNote ? "Note" : email.status}
                                </span>
                              </div>
                              <div className="d-lg-flex align-items-center gap-1 justify-content-end">
                                <div className="text-muted small mt-1">
                                  <i className="fa-light fa-calendar-days me-1"></i>
                                  {formatTimestamp(email.timestamp, dealerTimezone)}
                                </div>
                                <div className="text-muted small mt-1">
                                  <i className="fa-light fa-user me-1"></i>
                                  {messageBy}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className={`conversation-content ${
                            cleaned.type === "html" ? 'html-content' : 'text-content'
                          }`}>
                            {cleaned.type === "html" ? (
                              <div 
                                className="html-body"
                                dangerouslySetInnerHTML={{ __html: cleaned.content }}
                              />
                            ) : (
                              <div className="text-body">{cleaned.content}</div>
                            )}
                          </div>
                          {showTranslation && translatedText && (
                            <div className="conv_trans">
                              <div className="fw-semibold mb-2">
                                {agentViewLanguage} Translation
                              </div>
                              <div className="text-body">{translatedText}</div>
                            </div>
                          )}
                          {/* Attachments Section */}
                          {email.attachments?.map((attachment, index) => {
                            // Handle both formats: SMS (publicUrl, contentType, fileName) and Campaign (url, mimeType, filename)
                            const attachmentUrl = attachment.publicUrl || attachment.url;
                            const attachmentType = attachment.contentType || attachment.mimeType;
                            const attachmentName = attachment.fileName || attachment.filename;
                            let encodedUrl = '';
                            if (!attachmentUrl) return null;
                            if(email.communication_type === 'sms'){
                              encodedUrl = attachmentUrl;
                            }else{
                               encodedUrl = encodeURI(attachmentUrl);
                            }
                            
                            return (
                              
                              <div key={index} className="attachment-item">
                                {attachmentType?.startsWith('image/') ? (
                                  <div className="image-attachment">
                                    <img 
                                      src={encodedUrl} 
                                      alt={attachmentName || 'Image attachment'}
                                      className="img-fluid rounded cursor-pointer"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(encodedUrl, '_blank');
                                      }}
                                      style={{ cursor: 'pointer' }}
                                    />
                                  </div>
                                ) : attachmentType?.startsWith('video/') ? (
                                  <div className="video-attachment">
                                    <video 
                                      controls
                                      className="rounded w-100"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(encodedUrl, '_blank');
                                      }}
                                      style={{ cursor: 'pointer' }}
                                    >
                                      <source src={encodedUrl} type={attachmentType} />
                                      Your browser does not support the video tag.
                                    </video>
                                  </div>
                                ) : attachmentType?.startsWith('audio/') ? (
                                  <div className="audio-attachment">
                                    <audio 
                                      controls
                                      className="w-100"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(encodedUrl, '_blank');
                                      }}
                                      style={{ cursor: 'pointer' }}
                                    >
                                      <source src={encodedUrl} type={attachmentType} />
                                      Your browser does not support the audio tag.
                                    </audio>
                                  </div>
                                ) : (
                                  <a 
                                    href={encodedUrl}
                                    className="file-attachment d-flex align-items-center"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ cursor: 'pointer', textDecoration: 'none' }}
                                  >
                                    <i className={`${getAttachmentIcon(attachmentType)} me-2`}></i>
                                    <span className="attachment-name">
                                      {attachmentName ? attachmentName.split('/').pop() : 'Unnamed file'}
                                    </span>
                                    <span className="attachment-size ms-auto">
                                      {attachment.size ? `${Math.round(attachment.size / 1024)}KB` : 'Unknown size'}
                                    </span>
                                  </a>
                                )}
                              </div>
                            );
                          })} 
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="w_card p-4 text-center">
                  <i className="fa-light fa-inbox-empty fa-2x mb-2 text-muted"></i>
                  <p className="mb-0">
                    No {activeChannelTab === "sms" ? "SMS" : "email"} conversations found
                  </p>
                </div>
              )}
              {hasOlderConversations && (
                <div className="d-flex justify-content-center mt-3">
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={loadOlderConversations}
                    disabled={loadingOlderConversations}
                  >
                    {loadingOlderConversations ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-2" />
                        Loading older messages...
                      </>
                    ) : (
                      "Load older messages"
                    )}
                  </Button>
                </div>
              )}
            </Col>
          </Row>
        </Col>
      </Row>

      {showReplyModal && selectedConversation && (
        <EmailReplyModal
          dealer_id={lead.dealer_id}
          onClose={() => setShowReplyModal(false)}
          selectedConversation={selectedConversation}
          communicationType={getReplyChannel(lead) || selectedConversation.communication_type || 'email'}
          agentViewLanguage={agentViewLanguage}
          leadUserLanguage={latestConversationUserLanguageLabel}
          showTranslationEnabled={showTranslation}
          onReplySuccess={handleReplySuccess}
          conversationThread={emails}
        />
      )}
      
      {showStatusModal && (
        <StatusModal
          show={showStatusModal}
          onHide={() => setShowStatusModal(false)}
          currentStatus={lead?.fe_lead_status}
          onStatusChange={handleStatusChange}
        />
      )}

      {showNotesModal && (
        <LeadNotesModal
          show={showNotesModal}
          onHide={handleCloseNotesModal}
          lead={lead}
          dealer_id={lead.dealer_id}
          agentViewLanguage={agentViewLanguage}
          showTranslationEnabled={showTranslation}
          selectedConversation={selectedConversation}
          onNoteSaved={handleNoteSaved}
          editNote={editNote}
          conversationThread={emails}
        />
      )}
    </>
  );
}
