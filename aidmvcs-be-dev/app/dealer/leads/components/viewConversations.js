"use client";
import { leadStatusLabel } from "@lib/statusLabels";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { formatTimestamp } from "../../../utils/dateUtils";
import useFetch from "../../../hooks/useFetch";
import { Col, Row, Button, Spinner, Nav, Badge, Dropdown } from "react-bootstrap";
import EmailReplyModal from "./EmailReplyModal";
import ChatComposer from "./ChatComposer";
import "./chat.css";
import { DEPARTMENT_NAMES, canReplyInDepartment, leadDepartment } from "@lib/departmentNames";
import { contactTypeLabel } from "@lib/leadContactType";
import DateRangePickerComponent from "../../components/DateRangePicker";
import StatusModal from "./StatusModal"; // Import StatusModal
import LeadNotesModal from "./LeadNotesModal"; // Import LeadNotesModal
import AiLeadPanel from "../../ai/components/AiLeadPanel";
import CallButton from "../../components/CallButton";
import LeadInfoCard from "./LeadInfoCard";
import { deskLogMenuVisible } from "../../desk-log/deskLogAccess";
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
import MessagePhotos from "../../components/MessagePhotos"; // stream R: AI photos
import { hasAiPhotos } from "../../../lib/ai/messagePhotos";
import AdfLead, { looksLikeAdf } from "../../ai/components/AdfLead";
import { messageAuthor, noteAuthor, AUTHOR_BADGE, isStatusNote, staffBookedTexts, messageStatusLabel, statusNoteParts } from "../../../lib/messageAuthor";
import { aiFetch } from "../../ai/components/aiShared";

// SMS is the default reply channel; email is only used when explicitly
// preferred, and either option is only offered when the lead actually has
// that contact method on file.
function getReplyChannel(lead, tab, stopped = {}) {
  // Client, 20 Oct 2026 (Betsy: "Customer opted out and I was allowed to still text ... Customer MUST opt back in to
  // receive subsequent AI OR MANUAL SMS same goes for email"): a channel the customer opted out of is never offered.
  const hasPhone = !!lead?.phone && !stopped.sms;
  const hasEmail = !!lead?.email && !stopped.email;
  // The reply follows the tab staff have open (client, 10 Oct 2026), when the lead has that contact detail.
  if (tab === 'sms' && hasPhone) return 'sms';
  if (tab === 'email' && hasEmail) return 'email';
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
  // Called after the lead card saves an edit (the customer profile reloads, so its name / phone / email follow).
  onLeadSaved,
  // A DOM element (the customer profile's opportunity row): the action buttons are shown there instead of here.
  actionsTarget = null,
}) {
  const AGENT_VIEW_LANGUAGE_STORAGE_KEY = "dealer_agent_view_language";
  const [emails, setEmails] = useState([]);
  const { fetchData } = useFetch();
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [replyChannel, setReplyChannel] = useState(null); // the profile's SMS Reply / Email Reply (null = follow the tab)
  // The newest real message (not a note) on a channel - what a reply on that channel answers.
  const latestOn = (ch) => [...emails].filter((e) => e.communication_type === ch && !isNoteRecord(e) && e.message_id)
    .sort((a, b) => new Date(b.timestamp || b.createdAt || 0) - new Date(a.timestamp || a.createdAt || 0))[0] || null;
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [editNote, setEditNote] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);
  const [leadData, setLeadData] = useState(lead); // Local lead state for auto-reply updates
  // The Desk Log check-in button: only where the Desk Log menu shows (deskLogAccess.js).
  const [showCheckIn, setShowCheckIn] = useState(false);
  useEffect(() => { setShowCheckIn(deskLogMenuVisible()); }, []);
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
  const threadRef = useRef(null); // the chat thread: kept scrolled to the newest message at the bottom
  // Leads page (the user, 27 Nov 2026): one inbox - the lead's header on top with tabs (Conversation / Lead details /
  // AI Assistant) instead of a middle column; the customer profile (embedded) keeps its own layout.
  // (2) The user, 27 Nov 2026: the lead's information must stay on screen - it is a panel on the right of the
  // conversation again (lead card, then the AI Assistant), which the Details button folds away.
  const [showInfo, setShowInfo] = useState(true);
  const leadTab = "conversation";
  const tabbed = !embedded;
  // Channels this customer opted out of (the AI's consent record), re-read whenever the lead or its status changes.
  const [stoppedChannels, setStoppedChannels] = useState({});
  useEffect(() => {
    const id = lead?._id;
    setStoppedChannels({});
    if (!id) return undefined;
    let live = true;
    aiFetch(`/api/dealer-ai/leads/${id}`).then((data) => {
      const channels = data?.consent?.channels || {};
      if (live) setStoppedChannels({ sms: !!channels.sms?.opted_out, email: !!channels.email?.opted_out });
    }).catch(() => {});
    return () => { live = false; };
  }, [lead?._id, lead?.status]);
  const tabDefaultSetForLeadRef = useRef(null);
  const conversationGenerationRef = useRef(0);
  const initialRequestControllerRef = useRef(null);
  const pollingRef = useRef(false);
  const olderRequestRef = useRef(false);
  const cursorRef = useRef({ older: null, newer: null, hasOlder: false });
  const [hasOlderConversations, setHasOlderConversations] = useState(false);
  const [loadingOlderConversations, setLoadingOlderConversations] = useState(false);

  const { dealerParent, user: me } = useUser();
  // 13 Nov 2026 meeting (6.2): Sales reads a Service conversation but Service staff answer it.
  const replyAllowed = canReplyInDepartment(me, lead);

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
  const staffBooked = useMemo(() => staffBookedTexts(emails), [emails]);
  // A note belongs to the lead, not to a channel (client, 10 Oct 2026: notes didn't show): it was filed under the
  // channel of the latest message, so it only appeared in one tab - usually not the open one. Both tabs show it.
  const isNoteRecord = (e) => Boolean(e?.is_note || e?.status === "note");
  // Client, 18 Oct 2026 (Betsy: "color code blue for AI status change or yellow if human does it"): notes the AI wrote
  // are blue, notes and status changes by a person are yellow.
  const isAiNote = (e) => /by the AI\b|^AutoPulse AI\b|^\s*AI[: ]/.test(String(e?.mail_content || ""))
    || /^(nicole|ai|autopulse)/i.test(String(e?.sender_name || e?.from_name || ""));
  // The user, 28 Oct 2026: the tab counts are messages only - notes and status changes show in both tabs but are not
  // texts or emails (Deyvi Lopez showed "SMS 2" with no text sent: both were notes).
  const smsConversations = useMemo(
    () => sortedEmails.filter((e) => e.communication_type === "sms" || isNoteRecord(e)),
    [sortedEmails]
  );
  // Client, 18 Oct 2026 (Betsy: "stop the lead email from going to the email conversation and put it with the raw
  // lead"): the email a portal sent us about the lead (ADF file or a portal notification) is not the customer writing.
  const leadEmailIds = useMemo(() => {
    const inbound = sortedEmails.filter((e) => e.communication_type !== "sms" && !isNoteRecord(e)
      && ["incoming", "received"].includes(e.status));
    const created = lead?.createdAt ? new Date(lead.createdAt).getTime() : null;
    const earliest = inbound.reduce((a, e) => (!a || new Date(e.createdAt || e.timestamp) < new Date(a.createdAt || a.timestamp) ? e : a), null);
    return new Set(inbound.filter((e) => e.is_lead_email || looksLikeAdf(e.mail_content || "")
      || (e === earliest && created && Math.abs(new Date(e.createdAt || e.timestamp).getTime() - created) < 10 * 60 * 1000))
      .map((e) => String(e._id)));
  }, [sortedEmails, lead?.createdAt]);
  const leadEmails = useMemo(() => sortedEmails.filter((e) => leadEmailIds.has(String(e._id))), [sortedEmails, leadEmailIds]);
  const emailConversations = useMemo(
    () => sortedEmails.filter((e) => (e.communication_type !== "sms" || isNoteRecord(e)) && !leadEmailIds.has(String(e._id))),
    [sortedEmails, leadEmailIds]
  );
  const activeChannelEmails = activeChannelTab === "sms" ? smsConversations : emailConversations;
  // Open at the newest message (bottom), and follow new ones; loading older messages at the top doesn't jump.
  const newestId = activeChannelEmails[0]?._id ? String(activeChannelEmails[0]._id) : "";
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lead?._id, activeChannelTab, newestId]);

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

  // Re-read the latest page each poll, like the AI Messages screen does, rather than
  // asking only for records "after" the newest one shown: a record saved out of
  // timestamp order (e.g. an AI send recorded a moment late) was skipped by the
  // cursor and only appeared after a reload.
  const pollForNewConversations = useCallback(async (leadId) => {
    if (!leadId || pollingRef.current) return;
    pollingRef.current = true;
    try {
      await reconcileLatestConversations(leadId);
    } finally {
      pollingRef.current = false;
    }
  }, [reconcileLatestConversations]);

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
          // Client, 12 Oct 2026: a portal lead with a phone is a text conversation; the lead email never makes it an
          // email conversation.
          setActiveChannelTab(lead?.phone || result.emails.some((message) => message.communication_type === "sms")
            ? "sms" : "email");
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
          {tabbed && (
            <div className="inbox_head w_card mb-2" data-testid="lead-header">
              {/* The lead's top band, like the customer profile (the user, 27 Nov 2026): who, the status, where the lead
                  came from, and every action the old lead page had - one place, nothing hidden. */}
              <div className="d-flex flex-wrap align-items-center gap-2">
                <div className="me-auto d-flex align-items-center gap-2 flex-wrap">
                  <span className="inbox_name">{lead?.name || "Lead"}</span>
                  <button type="button" className="inbox_status" onClick={() => setShowStatusModal(true)} title="Change the status">
                    {leadStatusLabel(lead) || lead?.fe_lead_status || "New Lead"} <i className="fa-solid fa-chevron-down ms-1"></i>
                  </button>
                </div>
                <Button variant="outline-custom" size="sm" onClick={handlePrevLead} disabled={isNavigating} title="Previous lead">
                  <i className="fa-solid fa-chevron-left me-1"></i>Prev
                </Button>
                <Button variant="outline-custom" size="sm" onClick={handleNextLead} disabled={isNavigating} title="Next lead">
                  Next<i className="fa-solid fa-chevron-right ms-1"></i>
                </Button>
              </div>
              <div className="inbox_band">
                <span><small>UP TYPE</small>{contactTypeLabel(lead)}</span>
                <span><small>DEPARTMENT</small>{DEPARTMENT_NAMES[leadDepartment(lead)]}</span>
                <span><small>SOURCE</small>{lead?.lead_source || lead?.source || "Not set"}</span>
                <span><small>SUB-SOURCE</small>{lead?.sub_source || "No sub-source"}</span>
                <span><small>OWNER</small>{lead?.assigned_to?.name || "Unassigned"}</span>
                <span><small>PHONE</small>{lead?.phone || "-"}</span>
                <span><small>EMAIL</small>{lead?.email || "-"}</span>
              </div>
              <div className="inbox_actions_bar">
                {[["sms", "fa-duotone fa-comment-sms", "Text", Boolean(lead?.phone) && !stoppedChannels.sms],
                  ["email", "fa-duotone fa-envelope-open-text", "Email", Boolean(lead?.email) && !stoppedChannels.email]].map(([ch, icon, label, ok]) => (
                  <button key={ch} type="button" className="inbox_act" disabled={!ok || !replyAllowed}
                    title={ok ? `Write a ${ch === "sms" ? "text" : "email"} in the box under the conversation` : ch === "sms" ? "No phone, or texts stopped" : "No email, or emails stopped"}
                    onClick={() => { setActiveChannelTab(ch); setTimeout(() => document.querySelector(".chat_textarea")?.focus(), 50); }}>
                    <i className={icon}></i><span>{label}</span>
                  </button>
                ))}
                {lead?.phone && (
                  <span className="inbox_act inbox_act_call">
                    <CallButton phone={lead.phone} leadId={lead._id} dealerId={lead.dealer_id} size="sm" variant="link" label="Call"
                      icon="fa-duotone fa-phone-office" />
                  </span>
                )}
                <button type="button" className="inbox_act" onClick={() => setShowNotesModal(true)}>
                  <i className="fa-duotone fa-note-sticky"></i><span>Add note</span></button>
                <button type="button" className="inbox_act" onClick={() => setShowStatusModal(true)}>
                  <i className="fa-duotone fa-right-left"></i><span>Update status</span></button>
                {showCheckIn && (
                  <a className="inbox_act" href={`/dealer/desk-log?check_in=${lead._id}`}>
                    <i className="fa-duotone fa-user-check"></i><span>Check in</span></a>
                )}
                {lead?.customer_id && (
                  <a className="inbox_act" href={`/dealer/customers/${lead.customer_id}`}>
                    <i className="fa-duotone fa-user"></i><span>Customer profile</span></a>
                )}
                <button type="button" className="inbox_act" onClick={handleClose}>
                  <i className="fa-duotone fa-list"></i><span>Back to list</span></button>
                <button type="button" className={`inbox_act ms-auto${showInfo ? " on" : ""}`} onClick={() => setShowInfo(!showInfo)}
                  aria-pressed={showInfo} title="Lead details and AI Assistant on the right">
                  <i className="fa-duotone fa-sidebar-flip"></i><span>{showInfo ? "Hide details" : "Show details"}</span></button>
              </div>
            </div>
          )}
          <Row className="gx-3">
            <Col xxl={4} lg={tabbed ? 4 : 5} md={tabbed ? 12 : 5}
              className={tabbed ? (showInfo ? "order-lg-last inbox_info" : "d-none") : ""}>
              {/* Stays in view while the conversation scrolls (BB, 17 Nov 2026: "as the conversation gets long this
                  column shifts to the bottom"); scrolls on its own when taller than the screen. */}
              <div className="dealer_info position-sticky mb-3 lead_center_col">
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
                  {/* The lead's details, editable in one click (LeadInfoCard: 13 Nov 2026 meeting / BB 17 Nov). */}
                  <div className="col-12">
                    <LeadInfoCard lead={lead} dealerTimezone={dealerTimezone} onStatusClick={() => setShowStatusModal(true)}
                      onSaved={(saved) => { if (!embedded && onLeadSelected) onLeadSelected({ ...lead, ...saved }); onLeadSaved?.(saved); }} />
                  </div>

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

                  {/* Every action on the lead in one place (BB, 17 Nov 2026: "all call to action should be in one place").
                      On the customer profile they sit in the opportunity's own action row instead (Bibi, 25 Nov 2026:
                      "this way all communication is in one place") - actionsTarget is that row. */}
                  {!tabbed && (() => { const actions = (
                  <div className={actionsTarget ? "lead_actions_row" : "lead_actions mt-2"}>
                    {selectedConversation && getReplyChannel(lead, activeChannelTab, stoppedChannels) && !replyAllowed && (
                      <span className="small text-muted align-self-center" title="Reply from the department's own staff">
                        <i className="fa-solid fa-lock me-1" />{DEPARTMENT_NAMES[leadDepartment(lead)]} lead - {DEPARTMENT_NAMES[leadDepartment(lead)]} staff reply
                      </span>
                    )}
                    {/* Customer profile (25 Nov 2026): a reply button per channel the lead has a conversation on - SMS Reply and
                        Email Reply side by side, instead of one button that follows the open conversation tab. */}
                    {actionsTarget && replyAllowed && ["sms", "email"].map((ch) => {
                      const can = ch === "sms" ? lead?.phone && !stoppedChannels.sms : lead?.email && !stoppedChannels.email;
                      if (!can || !latestOn(ch)) return null;
                      return (
                        <Button key={ch} variant="custom" size="sm" className={ch === "sms" ? "act_sms" : "act_email"}
                          onClick={() => { setReplyChannel(ch); setShowReplyModal(true); }}>
                          <i className={ch === "sms" ? "fa-duotone fa-comment-sms" : "fa-duotone fa-envelope-open-text"}></i>
                          {ch === "sms" ? "SMS Reply" : "Email Reply"}
                        </Button>
                      );
                    })}
                    {/* The reply is typed in the message box under the conversation (the user, 27 Nov 2026); the old Reply
                        button is gone from the Leads page. */}
                    {lead?.phone && <CallButton phone={lead.phone} leadId={lead._id} dealerId={lead.dealer_id} size="sm"
                      className={actionsTarget ? "act_call" : ""} icon={actionsTarget ? "fa-duotone fa-phone-office" : null} />}
                    <Button variant="outline-warning" size="sm" className="text-nowrap act_note" onClick={() => setShowNotesModal(true)}>
                      <i className={actionsTarget ? "fa-duotone fa-note-sticky" : "fa-solid fa-sticky-note me-1"}></i>Add Note
                    </Button>
                    <Button variant="outline-custom" size="sm" className="text-nowrap act_status" onClick={() => setShowStatusModal(true)}>
                      <i className={actionsTarget ? "fa-duotone fa-right-left" : "fa-solid fa-pen me-1"}></i>Update Status
                    </Button>
                    {/* The Desk Log check-in, with this lead picked. */}
                    {showCheckIn && (
                      <Button variant="outline-custom" size="sm" className="text-nowrap act_visit" href={`/dealer/desk-log?check_in=${lead._id}`}>
                        <i className={actionsTarget ? "fa-duotone fa-user-check" : "fa-solid fa-right-to-bracket me-1"}></i>Check in
                      </Button>
                    )}
                    {/* Client, 8 Oct 2026: from the lead, straight to the customer's 360 profile (not shown on the profile itself). */}
                    {lead?.customer_id && !embedded && (
                      <Button variant="outline-secondary" size="sm" className="text-nowrap" href={`/dealer/customers/${lead.customer_id}`}>
                        <i className="fa-regular fa-user me-1"></i>Customer profile
                      </Button>
                    )}
                    {!embedded && (
                      <Button variant="outline-secondary" size="sm" className="text-nowrap" onClick={handleClose}>
                        <i className="fa-solid fa-arrow-left me-1"></i>Back to List
                      </Button>
                    )}
                  </div>
                  ); return actionsTarget ? createPortal(actions, actionsTarget) : actions; })()}
                </div>
                {/* What the AI is doing with this lead (stage, next touch, call task, consent; on/off) */}
                {lead?._id && (
                  <AiLeadPanel key={`${lead._id}-${lead.fe_lead_status || lead.status || ""}`} leadId={lead._id} />)}
                {!embedded && !tabbed && (
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

            <Col xxl={tabbed && !showInfo ? 12 : 8} lg={tabbed ? (showInfo ? 8 : 12) : 7} md={tabbed ? 12 : 7}
              className={tabbed ? "inbox_chat" : ""}>
              <div className="position-relative mb-2">
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
                        <Badge bg="secondary" className="ms-2">{smsConversations.filter((e) => !isNoteRecord(e)).length}</Badge>
                      )}
                    </Nav.Link>
                  </Nav.Item>
                  <Nav.Item>
                    <Nav.Link eventKey="email">
                      <i className="fa-regular fa-envelope me-2"></i>Email Conversation
                      {emailConversations.length > 0 && (
                        <Badge bg="secondary" className="ms-2">{emailConversations.filter((e) => !isNoteRecord(e)).length}</Badge>
                      )}
                    </Nav.Link>
                  </Nav.Item>
                </Nav>
              </div>

              {activeChannelEmails.length > 0 ? (
                <div className="conversation-list chat_thread" ref={threadRef} data-testid="chat-thread">
                  {/* Chat order (the user, 27 Nov 2026): oldest at the top, newest at the bottom next to the message box;
                      older messages load at the top. */}
                  {hasOlderConversations && (
                    <div className="d-flex justify-content-center">
                      <Button variant="outline-secondary" size="sm" onClick={loadOlderConversations} disabled={loadingOlderConversations}>
                        {loadingOlderConversations ? <><Spinner animation="border" size="sm" className="me-2" />Loading older messages...</>
                          : "Load older messages"}
                      </Button>
                    </div>
                  )}
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
                  {activeChannelTab === "email" && leadEmails.length > 0 && (
                    <details className="w_card mb-2 py-2 small" style={{ background: "#f6f7f9" }}>
                      <summary className="fw-semibold" role="button">
                        <i className="fa-regular fa-file-lines me-2"></i>Lead received{lead?.source ? ` from ${lead.source}` : ""} (raw lead)
                      </summary>
                      {leadEmails.map((e) => (
                        <div key={e._id} className="mt-2">
                          {looksLikeAdf(e.mail_content || "") ? <AdfLead raw={e.mail_content} />
                            : <div style={{ whiteSpace: "pre-wrap" }}>{cleanEmailContent(e.mail_content || "").type === "html"
                              ? <div className="html-body" dangerouslySetInnerHTML={{ __html: cleanEmailContent(e.mail_content || "").content }} />
                              : cleanEmailContent(e.mail_content || "").content}</div>}
                        </div>
                      ))}
                    </details>
                  )}
                  {[...activeChannelEmails].reverse().map((email, idx, ordered) => {
                      const cleaned = cleanEmailContent(email.mail_content || "");
                      const originalText = getMessageTextForTranslation(email);
                      const translationKey = getTranslationKey(email, agentViewLanguage, originalText);
                      const translatedText = translationMap[translationKey] || translationCacheRef.current[translationKey] || "";
                      const msgUserLanguageLabel = messageUserLanguageDisplay(email, lead);
                      const author = messageAuthor(email, lead, dealerParent?.dealer_account_information?.ai_bot_name);
                  const bookedBy = staffBooked[String(email._id)];
                      const isNote = email.is_note || email.status === 'note';
                      // A day chip when the day changes, like WhatsApp (dealer's time zone).
                      const dayOf = (m) => (m?.timestamp ? new Date(m.timestamp).toLocaleDateString("en-US",
                        { timeZone: dealerTimezone || undefined, weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "");
                      const day = dayOf(email);
                      const dayChip = day && day !== dayOf(ordered[idx - 1])
                        ? <div className="chat_day" key={`day-${email._id}`}>{day}</div> : null;
                      const clock = email.timestamp ? new Date(email.timestamp).toLocaleTimeString("en-US",
                        { timeZone: dealerTimezone || undefined, hour: "numeric", minute: "2-digit" }) : "";
                      // A status change is one quiet line in the middle (the user, 27 Nov 2026: "how can we arrange it
                      // in a much better way") - the new status in bold, who and why in small grey.
                      const sn = isNote && isStatusNote(email) ? statusNoteParts(cleaned.content) : null;
                      if (sn) {
                        return [dayChip, (
                          <div key={email._id} className="chat_system" title={cleaned.content}>
                            <i className="fa-solid fa-arrow-right-arrow-left" aria-hidden="true"></i>
                            <span>
                              {sn.from ? <>{sn.from} <i className="fa-solid fa-arrow-right mx-1" aria-hidden="true"></i></> : "Status: "}
                              <strong>{sn.to}</strong>
                              <span className="chat_system_by"> · {sn.by === "AI" ? "by the AI" : `by ${sn.by}`}{sn.why ? ` · ${sn.why}` : ""} · {clock}</span>
                              {showTranslation && translatedText && <span className="d-block chat_system_by">{agentViewLanguage}: {translatedText}</span>}
                            </span>
                            {/* Status notes can be edited as before (nothing from the old screen is lost). */}
                            <button type="button" className="chat_note_edit" aria-label="Edit note" title="Edit note"
                              onClick={(e) => { e.stopPropagation(); handleEditNote(email); }}>
                              <i className="fa-regular fa-pen-to-square"></i>
                            </button>
                          </div>
                        )];
                      }
                      const st = String(email.status || "").toLowerCase();
                      const tick = ["received", "incoming"].includes(st) ? null
                        : ["failed", "undelivered", "bounced", "error"].includes(st)
                          ? <span className="chat_tick failed" title={messageStatusLabel(email)}><i className="fa-solid fa-circle-exclamation me-1"></i>{messageStatusLabel(email)}</span>
                          : st === "delivered" || /deliver|read|open/i.test(messageStatusLabel(email))
                            ? <span className="chat_tick read" title={messageStatusLabel(email)}><i className="fa-solid fa-check-double me-1"></i>{messageStatusLabel(email)}</span>
                            : <span className="chat_tick" title={messageStatusLabel(email)}><i className="fa-solid fa-check me-1"></i>{messageStatusLabel(email)}</span>;

                      return [dayChip, (
                        <div
                          key={email._id}
                          className={`w_card conversation-item ${
                            selectedConversation?._id === email._id ? 'selected-conversation' : ''
                          } ${isNote ? 'note-item' : ["received", "incoming"].includes(email.status) ? 'chat_in'
                            : `chat_out ${author.kind === 'ai' ? 'chat_ai' : 'chat_staff'}${["failed", "undelivered", "bounced", "error"].includes(email.status) ? ' chat_failed' : ''}`}`}
                          onClick={() => setSelectedConversation(email)}
                          style={undefined}
                        >
                          {/* Who wrote it on top; the time and the delivery ticks at the bottom, like WhatsApp
                              (From / To / language on hover). */}
                          <div className="chat_meta" title={isNote ? `User language: ${msgUserLanguageLabel}`
                            : `From: ${email.sender || "-"}\nTo: ${email.recipient || "-"}\nUser language: ${msgUserLanguageLabel}`}>
                            {isNote ? (
                              <span className="chat_note_head">
                                <i className="fa-solid fa-note-sticky me-1" aria-hidden="true"></i>
                                {email.internal_use === true ? "Internal note" : "Lead note"} · {noteAuthor(email, isAiNote(email))}
                              </span>
                            ) : (
                              <span className={`chat_who ${author.kind}`}>{author.label}</span>
                            )}
                            {bookedBy && <span className="badge bg-warning text-dark">Appointment set by staff: {bookedBy}</span>}
                            {isNote && (
                              <button type="button" className="chat_note_edit ms-auto" aria-label="Edit note" title="Edit note"
                                onClick={(e) => { e.stopPropagation(); handleEditNote(email); }}>
                                <i className="fa-regular fa-pen-to-square"></i>
                              </button>
                            )}
                          </div>
                          {/* Click a message for its details (From / To / language), as the old screen showed them. */}
                          {!isNote && selectedConversation?._id === email._id && (
                            <div className="chat_details">
                              <div><strong>From:</strong> {email.sender || "-"}</div>
                              <div><strong>To:</strong> {email.recipient || "-"}</div>
                              <div><strong>User language:</strong> {msgUserLanguageLabel}</div>
                            </div>
                          )}
                          {!isNote && email.communication_type === "email" && email.subject && (
                            <div className="chat_subject">{email.subject}</div>
                          )}
                          <div className={`conversation-content ${
                            cleaned.type === "html" ? 'html-content' : 'text-content'
                          }`}>
                            {email.is_lead_email && !looksLikeAdf(email.mail_content || "") ? (
                              // A portal's plain lead notification: the lead it brought in, not the customer writing.
                              <div className="text-body">
                                <div className="fw-semibold mb-1">New lead received{lead?.source ? ` from ${lead.source}` : ""}</div>
                                {cleaned.type === "html"
                                  ? <div className="html-body" dangerouslySetInnerHTML={{ __html: cleaned.content }} />
                                  : cleaned.content}
                              </div>
                            ) : looksLikeAdf(email.mail_content || "") ? (
                              // The lead file a portal sent (ADF XML) shown as the lead it describes, never raw XML
                              // (client, 10 Oct 2026).
                              <AdfLead raw={email.mail_content} />
                            ) : cleaned.type === "html" ? (
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
                          <MessagePhotos email={email} />{/* stream R: the AI's photos as thumbnails */}
                          {(hasAiPhotos(email) ? [] : email.attachments)?.map((attachment, index) => {
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
                          {/* Time and delivery, bottom right of the bubble (WhatsApp style). */}
                          <div className="chat_foot">
                            {!isNote && email.ai_generated && <span className="chat_foot_tag">AI</span>}
                            <span>{clock}</span>{!isNote && tick}
                          </div>
                        </div>
                      )];
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
              {/* The message box under the conversation, like a chat app; + holds everything else (the user, 27 Nov 2026). */}
              {lead && (
                <ChatComposer
                  key={lead._id}
                  lead={lead}
                  channel={activeChannelTab}
                  onChannel={setActiveChannelTab}
                  canText={Boolean(lead.phone) && !stoppedChannels.sms}
                  canEmail={Boolean(lead.email) && !stoppedChannels.email}
                  latestOf={latestOn}
                  onSent={handleReplySuccess}
                  thread={emails}
                  leadUserLanguage={latestConversationUserLanguageLabel}
                  // One place for each action: on the Leads page they are in the box's + menu; on the customer profile
                  // they stay in the opportunity's action row (so not in the + menu there).
                  showCall={false}
                  onAddNote={null}
                  onUpdateStatus={null}
                  onCheckIn={null}
                  disabledReason={!replyAllowed ? `${DEPARTMENT_NAMES[leadDepartment(lead)]} lead - ${DEPARTMENT_NAMES[leadDepartment(lead)]} staff reply`
                    : lead.fe_lead_status === "Opted Out" && lead.status_source === "staff" ? "Opted Out by staff - nothing is sent" : null}
                />
              )}
            </Col>
          </Row>
        </Col>
      </Row>

      {showReplyModal && selectedConversation && (
        <EmailReplyModal
          lead={lead}
          dealer_id={lead.dealer_id}
          onClose={() => setShowReplyModal(false)}
          selectedConversation={(replyChannel && latestOn(replyChannel)) || selectedConversation}
          communicationType={replyChannel || getReplyChannel(lead, activeChannelTab, stoppedChannels) || selectedConversation.communication_type || 'email'}
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
