"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { formatTimestamp } from "../../../utils/dateUtils";

export default function LeadIframePage() {
  const params = useParams();
  const { leadId } = params;
  const [lead, setLead] = useState(null);
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch lead data
        const leadResponse = await fetch(`/api/leads/${leadId}`);
        if (!leadResponse.ok) {
          throw new Error('Failed to fetch lead data');
        }
        const leadData = await leadResponse.json();
        
        if (leadData.lead) {
          setLead(leadData.lead);
          
          // Fetch conversations for this lead
          const conversationsResponse = await fetch(`/api/conversations/lead?lead_id=${leadId}`);
          if (conversationsResponse.ok) {
            const conversationsData = await conversationsResponse.json();
            setEmails(conversationsData.emails || []);
          }
        } else {
          throw new Error('Lead not found');
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (leadId) {
      fetchData();
    }
  }, [leadId]);

  const getAttachmentIcon = (contentType) => {
    if (contentType?.startsWith('image/')) return 'fa-regular fa-image';
    if (contentType?.startsWith('video/')) return 'fa-regular fa-video';
    if (contentType?.startsWith('audio/')) return 'fa-regular fa-music';
    if (contentType?.includes('pdf')) return 'fa-regular fa-file-pdf';
    return 'fa-regular fa-file';
  };

  // Function to strip HTML tags and decode HTML entities
  const stripHTML = (html) => {
    if (!html || typeof html !== 'string') return '';
    // Create a temporary div element to decode HTML entities
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    // Get text content (automatically strips HTML tags and decodes entities)
    let text = tmp.textContent || tmp.innerText || '';
    // Clean up extra whitespace
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  };

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#f8f9fa'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', marginBottom: '10px' }}>Loading lead details...</div>
          <div style={{ fontSize: '14px', color: '#666' }}>Lead ID: {leadId}</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#f8f9fa'
      }}>
        <div style={{ textAlign: 'center', color: '#dc3545' }}>
          <div style={{ fontSize: '18px', marginBottom: '10px' }}>Error loading lead</div>
          <div style={{ fontSize: '14px' }}>{error}</div>
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#f8f9fa'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', marginBottom: '10px' }}>Lead not found</div>
          <div style={{ fontSize: '14px', color: '#666' }}>Lead ID: {leadId}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      margin: 0,
      padding: '20px',
      backgroundColor: '#f8f9fa',
      color: '#333',
      minHeight: '100vh'
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        background: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          padding: '20px',
          textAlign: 'center'
        }}>
          <h1 style={{ margin: 0, fontSize: '24px' }}>Lead Details</h1>
          <p style={{ margin: '10px 0 0 0' }}>Lead ID: {leadId}</p>
        </div>
        
        {/* Content */}
        <div style={{ padding: '20px' }}>
          {/* Lead Information */}
          <div style={{ marginBottom: '30px', borderBottom: '1px solid #eee', paddingBottom: '20px' }}>
            <h2 style={{ color: '#667eea', marginBottom: '15px', fontSize: '18px' }}>Lead Information</h2>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '15px'
            }}>
              <div style={{
                background: '#f8f9fa',
                padding: '12px',
                borderRadius: '6px',
                borderLeft: '4px solid #667eea'
              }}>
                <div style={{ fontWeight: 600, color: '#666', fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px' }}>Name</div>
                <div style={{ color: '#333', fontSize: '14px' }}>{lead.name || 'N/A'}</div>
              </div>
              <div style={{
                background: '#f8f9fa',
                padding: '12px',
                borderRadius: '6px',
                borderLeft: '4px solid #667eea'
              }}>
                <div style={{ fontWeight: 600, color: '#666', fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px' }}>Email</div>
                <div style={{ color: '#333', fontSize: '14px' }}>{lead.email || 'N/A'}</div>
              </div>
              <div style={{
                background: '#f8f9fa',
                padding: '12px',
                borderRadius: '6px',
                borderLeft: '4px solid #667eea'
              }}>
                <div style={{ fontWeight: 600, color: '#666', fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px' }}>Phone</div>
                <div style={{ color: '#333', fontSize: '14px' }}>{lead.phone || 'N/A'}</div>
              </div>
              <div style={{
                background: '#f8f9fa',
                padding: '12px',
                borderRadius: '6px',
                borderLeft: '4px solid #667eea'
              }}>
                <div style={{ fontWeight: 600, color: '#666', fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px' }}>Source</div>
                <div style={{ color: '#333', fontSize: '14px' }}>{lead.source || 'N/A'}</div>
              </div>
              <div style={{
                background: '#f8f9fa',
                padding: '12px',
                borderRadius: '6px',
                borderLeft: '4px solid #667eea'
              }}>
                <div style={{ fontWeight: 600, color: '#666', fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px' }}>Status</div>
                <div style={{ color: '#333', fontSize: '14px' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '4px 8px',
                    borderRadius: '12px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    background: lead.status === 'active' ? '#d4edda' : '#f8d7da',
                    color: lead.status === 'active' ? '#155724' : '#721c24'
                  }}>
                    {lead.status || 'Unknown'}
                  </span>
                </div>
              </div>
              <div style={{
                background: '#f8f9fa',
                padding: '12px',
                borderRadius: '6px',
                borderLeft: '4px solid #667eea'
              }}>
                <div style={{ fontWeight: 600, color: '#666', fontSize: '12px', textTransform: 'uppercase', marginBottom: '4px' }}>Created</div>
                <div style={{ color: '#333', fontSize: '14px' }}>{new Date(lead.createdAt).toLocaleDateString()}</div>
              </div>
            </div>
          </div>
          
          {/* Conversations */}
          <div style={{ marginBottom: '30px' }}>
            <h2 style={{ color: '#667eea', marginBottom: '15px', fontSize: '18px' }}>Conversations ({emails.length})</h2>
            {emails.length > 0 ? (
              <div style={{ 
                maxHeight: '500px', 
                overflowY: 'auto',
                background: '#f8f9fa',
                borderRadius: '8px',
                padding: '20px',
                border: '1px solid #e9ecef'
              }}>
                {emails
                  .sort((a, b) => {
                    // Sort by date in descending order (latest first)
                    const dateA = new Date(a.date || a.timestamp || 0);
                    const dateB = new Date(b.date || b.timestamp || 0);
                    return dateB - dateA;
                  })
                  .map((email, index) => {
                  // Determine if this is a user message or our response
                  const isUserMessage = email.sender === lead.email || email.sender === lead.phone;
                  const isOutgoing = email.recipient === lead.email || email.recipient === lead.phone;
                  
                  return (
                    <div key={email._id || index} style={{
                      marginBottom: '15px',
                      display: 'flex',
                      justifyContent: isUserMessage ? 'flex-start' : 'flex-end'
                    }}>
                      <div style={{
                        maxWidth: '70%',
                        background: isUserMessage ? '#e3f2fd' : '#667eea',
                        color: isUserMessage ? '#333' : 'white',
                        padding: '12px 16px',
                        borderRadius: isUserMessage ? '18px 18px 18px 4px' : '18px 18px 4px 18px',
                        position: 'relative',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      }}>
                        {/* Message header */}
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '8px',
                          fontSize: '12px',
                          opacity: 0.8
                        }}>
                          <span style={{ fontWeight: 600 }}>
                            {isUserMessage ? '👤 Customer' : '🤖 AutoPulse'}
                          </span>
                          <span>
                            {formatTimestamp(email.date || email.timestamp)}
                          </span>
                        </div>
                        
                        {/* Subject if available */}
                        {email.subject && (
                          <div style={{ 
                            fontWeight: 600, 
                            marginBottom: '8px',
                            fontSize: '14px'
                          }}>
                            {email.subject}
                          </div>
                        )}
                        
                         {/* Message content */}
                         <div style={{ 
                           fontSize: '14px', 
                           lineHeight: '1.4',
                           wordWrap: 'break-word'
                         }}>
                           {stripHTML(email.mail_content || '') || 'No content'}
                         </div>
                        
                        {/* Attachments */}
                        {email.attachments && email.attachments.length > 0 && (
                          <div style={{ 
                            marginTop: '8px', 
                            fontSize: '12px', 
                            opacity: 0.8,
                            display: 'flex',
                            alignItems: 'center'
                          }}>
                            <i className="fa-regular fa-paperclip" style={{ marginRight: '5px' }}></i>
                            {email.attachments.length} attachment(s)
                          </div>
                        )}
                        
                        {/* Communication type indicator */}
                        <div style={{
                          position: 'absolute',
                          top: '-8px',
                          right: isUserMessage ? 'auto' : '12px',
                          left: isUserMessage ? '12px' : 'auto',
                          background: isUserMessage ? '#e3f2fd' : '#667eea',
                          color: isUserMessage ? '#1976d2' : 'white',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          fontSize: '10px',
                          fontWeight: 600,
                          textTransform: 'uppercase'
                        }}>
                          {email.communication_type === 'sms' ? '📱 SMS' : '📧 Email'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ 
                textAlign: 'center', 
                color: '#666', 
                fontStyle: 'italic', 
                padding: '40px 20px',
                background: '#f8f9fa',
                borderRadius: '8px',
                border: '1px solid #e9ecef'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '10px' }}>💬</div>
                <div>No conversations found</div>
                <div style={{ fontSize: '12px', marginTop: '5px' }}>Start a conversation with this lead</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
