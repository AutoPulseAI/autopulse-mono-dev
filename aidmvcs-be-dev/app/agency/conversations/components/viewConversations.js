"use client";
import { useState, useEffect } from "react";
import { formatTimestamp } from "../../../utils/dateUtils";
import useFetch from "../../../hooks/useFetch";
import { Col, Row } from "react-bootstrap";

export default function ViewConversations({ selectedEmail, dealer_id }) {
    const [childEmails, setChildEmails] = useState([]);
    const { fetchData, error: fetchError, loading } = useFetch();

    useEffect(() => {
        if (selectedEmail) {
            fetchChildEmails(selectedEmail.message_id);
        }
    }, [selectedEmail]);

    const fetchChildEmails = async (emailId) => {
        try {
            const response = await fetchData(`/api/conversations?dealer_id=${dealer_id}&parent_conversation=${emailId}`);
            const data = await response.json();
            setChildEmails(data.emails);
        } catch (error) {
            console.error("Error fetching child emails:", error);
        }
    };

    // Function to extract ADF/XML data from email content
    const extractAdfData = (content) => {
        try {
            // First try to find the ADF/XML in plain text format
            const plainTextMatch = content.match(/<adf>[\s\S]*<\/adf>/);
            if (plainTextMatch) {
                return {
                    type: 'xml',
                    content: plainTextMatch[0],
                    parsed: parseAdfXml(plainTextMatch[0])
                };
            }

            // If not found in plain text, try HTML version
            const htmlMatch = content.match(/&lt;adf&gt;[\s\S]*&lt;\/adf&gt;/);
            if (htmlMatch) {
                // Convert HTML entities back to XML
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
        try {
            // This is a simplified parser - consider using a proper XML parser library
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
        if (attributeValue) {
            const regex = new RegExp(`<${tagName}[^>]*part="${attributeValue}"[^>]*>([^<]*)<\/${tagName}>`);
            const match = content.match(regex);
            return match ? match[1].trim() : null;
        } else {
            const regex = new RegExp(`<${tagName}[^>]*>([^<]*)<\/${tagName}>`);
            const match = content.match(regex);
            return match ? match[1].trim() : null;
        }
    };

    // Function to clean up email content
    const cleanEmailContent = (content) => {
        // First check if this is an ADF/XML email
        const adfData = extractAdfData(content);
        if (adfData) {
            return adfData;
        }

        // Otherwise, proceed with normal email cleaning
        if (content.startsWith('--') && content.includes('Content-Type: text/plain')) {
            const plainTextPart = content.split('Content-Type: text/plain')[1];
            if (plainTextPart) {
                const message = plainTextPart.split('\n\nOn ')[0] || 
                               plainTextPart.split('\n\n>')[0] || 
                               plainTextPart;
                return {
                    type: 'text',
                    content: message.trim()
                };
            }
        }
        else if (content.includes('<div dir=')) {
            const start = content.indexOf('<div dir=');
            const end = content.indexOf('</div>', start);
            if (start !== -1 && end !== -1) {
                const htmlContent = content.substring(start, end + 6);
                return {
                    type: 'html',
                    content: htmlContent.replace(/<[^>]*>/g, '').trim()
                };
            }
        }
        
        return {
            type: 'text',
            content: content
        };
    };

    if (!selectedEmail) return null;

    // Combine all emails in the thread
    const allEmails = [selectedEmail, ...childEmails].sort((a, b) => 
        new Date(a.timestamp) - new Date(b.timestamp)
    );

    return (
        <Row className="justify-content-center">
            <Col lg={10}>
                <h6 className="mt-4 mb-3">{selectedEmail.subject}</h6>
                
                {allEmails.map((email, index) => {
                    const cleanedContent = cleanEmailContent(email.mail_content);
                    
                    return (
                        <div key={email._id || index} className="w_card mb-3">
                            <div className="d-md-flex align-items-top">
                                <div className="position-relative me-auto mb-2">
                                    <p className="mb-1">
                                        <strong>
                                            {email.sender.split('<')[0].trim() || email.sender}
                                        </strong>
                                    </p>
                                    <p className="mb-0 text-muted small">
                                        <strong>To:</strong> {email.recipient.split('<')[0].trim() || email.recipient}
                                    </p>
                                </div>
                                <p className="text-muted small">
                                    <span className={`email_status ${email.status === "sent" ? "text-success" : email.status === "incoming" ? "text-warning" : email.status === "cancel" ? "text-danger" : ""}`}
                                    >{email.status}</span>
                                    <span className="ms-2">
                                        <i className="fa-light fa-calendar-days me-1"></i>
                                        {formatTimestamp(email.timestamp)}
                                    </span>
                                </p>
                            </div>
                            
                            <div className="email-content mt-2">
                                {cleanedContent.type === 'xml' || cleanedContent.type === 'html' ? (
                                    <div className="adf-data">
                                        <h6>ADF/XML Lead Information</h6>
                                        {cleanedContent.parsed ? (
                                            <div className="adf-details">
                                                <p><strong>Request Date:</strong> {cleanedContent.parsed.requestdate}</p>
                                                <p><strong>Vehicle:</strong> {cleanedContent.parsed.vehicle.year} {cleanedContent.parsed.vehicle.make} {cleanedContent.parsed.vehicle.model}</p>
                                                <p><strong>Customer:</strong> {cleanedContent.parsed.customer.firstName} {cleanedContent.parsed.customer.lastName}</p>
                                                <p><strong>Email:</strong> {cleanedContent.parsed.customer.email}</p>
                                                <p><strong>Phone:</strong> {cleanedContent.parsed.customer.phone}</p>
                                                <p><strong>Vendor:</strong> {cleanedContent.parsed.vendor.name}</p>
                                            </div>
                                        ) : (
                                            <p className="text-break">{cleanedContent.content}</p>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-break">{cleanedContent.content}</p>
                                )}
                            </div>
                        </div>
                    );
                })}
            </Col>
        </Row>
    );
}