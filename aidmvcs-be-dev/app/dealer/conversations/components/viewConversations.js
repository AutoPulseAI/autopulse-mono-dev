// viewConversations.js
"use client";
import { useState, useEffect } from "react";
import { formatTimestamp } from "../../../utils/dateUtils";
import useFetch from "../../../hooks/useFetch";
import { Button, Col, Row } from "react-bootstrap";
import EmailReplyModal from "../components/EmailReplyModal";
import DateRangePickerComponent from "../../components/DateRangePicker";
import { decode } from "quoted-printable";
import StatusModal from "./StatusModal"; // Import StatusModal

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

export default function ViewConversations({ selectedEmail, dealer_id, refresh }) {
    const [childEmails, setChildEmails] = useState([]);
    const { fetchData } = useFetch();
    const [lead, setLeadDetails] = useState(null);
    const [selectedConversation, setSelectedConversation] = useState(null);
    const [isEmailReplyModalOpen, setEmailReplyModalOpen] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [dateRange, setDateRange] = useState({ startDate: null, endDate: null });
    const [showStatusModal, setShowStatusModal] = useState(false); // State for status modal
    const handleReplySuccess = () => setRefreshKey(prev => prev + 1);

    useEffect(() => {
        if (selectedEmail) {
            fetchLeadDetails(selectedEmail.lead_id);
            fetchChildEmails(selectedEmail.message_id);
            setSelectedConversation(selectedEmail);
        }
    }, [selectedEmail, refresh, refreshKey, dateRange]);
    const handleStatusChange = async (newStatus) => {
        try {
          const response = await fetch("/api/conversations/lead/status", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              id: lead._id, 
              status: newStatus 
            }),
          });
    
          if (!response.ok) throw new Error("Failed to update status");
          
          // Update local state
          lead.fe_lead_status = newStatus;
          setRefreshKey(prev => prev + 1);
        } catch (err) {
          console.error("Error updating status:", err);
        }
      };
    

    const fetchChildEmails = async (emailId) => {
        let url = `/api/conversations?dealer_id=${dealer_id}&parent_conversation=${emailId}`;
        if (dateRange.startDate) url += `&startDate=${dateRange.startDate.toISOString()}`;
        if (dateRange.endDate) url += `&endDate=${dateRange.endDate.toISOString()}`;
        const response = await fetchData(url);
        const data = await response.json();
        setChildEmails(data.emails || []);
    };

    const fetchLeadDetails = async (leadId) => {
        const response = await fetchData(`/api/leads/${leadId}`);
        const data = await response.json();
        setLeadDetails(data.lead);
    };

    const handleDateRangeChange = (startDate, endDate) => {
        setDateRange({ startDate, endDate });
    };

    function decodeHtmlEntities(str) {
        const txt = typeof document !== 'undefined' ? document.createElement('textarea') : null;
        if (!txt) return str;
        txt.innerHTML = str;
        return txt.value;
    }

    const cleanEmailContent = (raw) => {
        if (!raw || typeof raw !== 'string') return { type: 'text', content: '' };

        // Decode quoted-printable characters
        let decoded = decode(raw).toString('utf-8');

        // Remove =\n (soft line breaks), weird unicode, and trailing headers
        decoded = decoded
            .replace(/=\r?\n/g, '')
            .replace(/\\n/g, '\n')
            .replace(/=3D/g, '=')
            .replace(/\\\"/g, '"')
            .replace(/\\\\/g, '\\')
            .replace(/<div class="gmail_signature"[\\s\\S]*$/i, '')
            .trim();

        // Decode HTML entities
        decoded = decodeHtmlEntities(decoded);

        // Try to match and parse <adf> XML
        const xmlMatch = decoded.match(/<adf[\s\S]*<\/adf>/i);
        if (xmlMatch) {
            return {
                type: 'xml',
                content: xmlMatch[0],
                parsed: parseXmlToJson(xmlMatch[0])
            };
        }

        // Try to decode escaped <adf> block
        const htmlXmlMatch = decoded.match(/&lt;adf&gt;[\s\S]*&lt;\/adf&gt;/i);
        if (htmlXmlMatch) {
            const decodedXml = htmlXmlMatch[0]
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&');
            return {
                type: 'xml',
                content: decodedXml,
                parsed: parseXmlToJson(decodedXml)
            };
        }

        // Render as HTML if it contains tags
        if (/<[a-z][\s\S]*>/i.test(decoded)) {
            return { type: 'html', content: decoded };
        }

        // Default fallback: text
        return { type: 'text', content: decoded };
    };
    const parseXmlToJson = (xmlString) => {
        try {
            const parser = new DOMParser();
            const xml = parser.parseFromString(xmlString, "text/xml");
            const parseNode = (node) => {
                const obj = {};
                if (node.hasChildNodes()) {
                    [...node.childNodes].forEach(child => {
                        if (child.nodeType === 1) {
                            const childObj = parseNode(child);
                            if (obj[child.nodeName]) {
                                if (!Array.isArray(obj[child.nodeName])) {
                                    obj[child.nodeName] = [obj[child.nodeName]];
                                }
                                obj[child.nodeName].push(childObj);
                            } else {
                                obj[child.nodeName] = childObj;
                            }
                        } else if (child.nodeType === 3 && child.nodeValue.trim()) {
                            obj["value"] = child.nodeValue.trim();
                        }
                    });
                }
                return obj;
            };
            return parseNode(xml.documentElement);
        } catch (e) {
            console.error("XML parsing failed:", e);
            return null;
        }
    };

    const renderParsedXml = (obj, indent = 0) => {
        if (!obj || typeof obj !== "object") return null;

        return Object.entries(obj).map(([key, val], idx) => {
            if (key === "value") return null;
            const isSimpleValue = typeof val === "object" && val !== null && Object.keys(val).length === 1 && "value" in val;
            if (isSimpleValue) {
                return <div key={idx} style={{ marginLeft: `${indent}px`, whiteSpace: 'pre-wrap' }}><strong>{key}:</strong> {val.value}</div>;
            }
            if (typeof val === "object" && !Array.isArray(val)) {
                return <div key={idx} style={{ marginLeft: `${indent}px`, whiteSpace: 'pre-wrap' }}><strong>{key}:</strong><div>{renderParsedXml(val, indent + 20)}</div></div>;
            }
            if (Array.isArray(val)) {
                return (
                    <div key={idx} style={{ marginLeft: `${indent}px`, whiteSpace: 'pre-wrap' }}>
                        <strong>{key}:</strong>
                        {val.map((item, i) => (
                            <div key={i} style={{ marginLeft: `${indent + 20}px` }}>{renderParsedXml(item, indent + 20)}</div>
                        ))}
                    </div>
                );
            }
            return <div key={idx} style={{ marginLeft: `${indent}px`, whiteSpace: 'pre-wrap' }}><strong>{key}:</strong> {val}</div>;
        });
    };

    if (!selectedEmail) return null;
    const allEmails = [selectedEmail, ...childEmails].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return (
        <>
            <Row className="justify-content-center gx-3">
                <Col xl={3} md={4}>
                    <div className="w_card mb-3 dealer_info position-sticky row gx-1">
                        <p className="col col-md-12 col-12"><strong>Name:</strong> {lead?.name}</p>
                        <p className="col col-md-12 col-12 text-break"><strong>Email:</strong> {lead?.email}</p>
                        <p className="col col-md-12 col-12"><strong>Phone:</strong> {lead?.phone}</p>
                        <p className="col col-md-12 col-6"><strong>Source:</strong> {lead?.source}</p>
                        <p className="col col-md-12 col-6"><strong>Lead Status:</strong> {lead?.fe_lead_status}</p>
                        <p className="col col-md-12 col-12"><strong>Lead Source:</strong> {lead?.lead_source}</p>
                        <p className="col col-md-12 col-6"><strong>Vin:</strong> {lead?.vin}</p>
                        <p className="col col-md-12 col-6"><strong>Year:</strong> {lead?.vehicle_year}</p>
                        <p className="col col-md-12 col-6"><strong>Make:</strong> {lead?.vehicle_make}</p>
                        <p className="col col-md-12 col-6"><strong>Model:</strong> {lead?.vehicle_model}</p>
                        <p className="col col-md-12 col-12"><strong>Created At:</strong> {formatTimestamp(lead?.createdAt)}</p>
                        <div className="d-flex flex-md-colomn flex-row gap-1">
                            <Button
                            variant="outline-custom"
                            className="w-100"
                            onClick={() => setShowStatusModal(true)}
                            >
                            <i className="fa-solid fa-pen me-2"></i>
                            Update Status
                            </Button>
                            {selectedConversation && getReplyChannel(lead) && (
                                <Button className="w-100" variant="custom" onClick={() => setEmailReplyModalOpen(true)}>
                                    <i className="fa-regular fa-reply me-2"></i>
                                    {getReplyChannel(lead) === 'sms' ? 'SMS Reply' : 'Email Reply'}
                                </Button>
                            )}
                        </div>
                    </div>
                </Col>
                <Col xl={9} md={8}>
                    <div className="position-relative mb-xl-3 mb-2">
                        <Row className="align-items-center">
                            <Col xl={10} lg={9} xs={7}><h3 className="w_card_title mb-0">{selectedEmail.subject}</h3></Col>
                            <Col xl={2} lg={3} xs={5}><DateRangePickerComponent onDateRangeChange={handleDateRangeChange} size="sm" /></Col>
                        </Row>
                    </div>
                    {allEmails.map((email, i) => {
                        const cleaned = cleanEmailContent(email.mail_content || '');
                        const messageBy = (email.message_by && String(email.message_by).trim()) || 'chatbot';
                        return (
                            <div key={i} className={`w_card mb-2 ${selectedConversation?._id === email._id ? 'selected-conversation' : ''}`}>
                                <div className="d-md-flex align-items-top">
                                    <div className="me-auto mb-2">
                                        <p className="mb-1"><strong>{email.sender?.split('<')[0]?.trim() || 'Unknown Sender'}</strong></p>
                                        <p className="mb-0 text-muted small"><strong>To:</strong> {email.recipient?.split('<')[0]?.trim() || 'Unknown Recipient'}</p>
                                    </div>
                                    <p className="text-muted small text-end">
                                        <span className={`badge ${email.status === "sent" ? "bg-custom" : email.status === "incoming" ? "bg-warning" : email.status === "cancel" ? "bg-danger" : ""}`}>{email.status || 'unknown'}</span>
                                        <span className="ms-2"><i className="fa-light fa-calendar-days me-1"></i>{formatTimestamp(email.timestamp)}</span>
                                        <span className="d-block"><i className="fa-light fa-user me-1"></i>{messageBy}</span>
                                    </p>
                                </div>
                                <div className="email-content mt-2">
                                    {cleaned.type === 'xml' && cleaned.parsed ? (
                                        <>
                                            <h6>📄 Parsed XML Data</h6>
                                            {renderParsedXml(cleaned.parsed)}
                                        </>
                                    ) : cleaned.type === 'html' ? (
                                        <div dangerouslySetInnerHTML={{ __html: cleaned.content }} />
                                    ) : (
                                        <div dangerouslySetInnerHTML={{ __html: cleaned.content }} />

                                    )}
                                </div>
                            </div>
                        );
                    })}
                </Col>
            </Row>
            {isEmailReplyModalOpen && selectedEmail && (
                <EmailReplyModal
                    dealer_id={lead.dealer_id}
                    onClose={() => setEmailReplyModalOpen(false)}
                    selectedConversation={selectedEmail}
                    communicationType={getReplyChannel(lead) || selectedEmail.communication_type || 'email'}
                    onReplySuccess={handleReplySuccess}
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
        </>
    );
}