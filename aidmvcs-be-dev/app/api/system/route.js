import dbConnect from "@lib/mongodb";
import Email from '@models/Email';
import EmailAccount from '@models/EmailAccount';
import WebhookLog from '@models/WebhookLog'; // Import WebhookLog model
import { Queue } from 'bullmq'; // Import BullMQ Queue
import Redis from 'ioredis'; // Import Redis for BullMQ
import { sendSubscriptionExpiryNotification } from '@lib/emailservice';
import { isPackageExpiryValid } from '@lib/isPackageExpiryValid';
import User from '@models/User'; 
import { uploadToS3 } from '@lib/aws-s3'; // Import S3 upload function 

// Configure route for App Router
export const maxDuration = 60; // 60 seconds timeout
export const runtime = 'nodejs'; // Use Node.js runtime

// Handle POST requests
export async function POST(req) {
  // Log incoming request at the very start
  console.log('=== Incoming Email Webhook ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Content-Type:', req.headers.get('content-type') || 'not specified');
  console.log('User-Agent:', req.headers.get('user-agent') || 'not specified');
  
  try {
    // Check if the request is multipart/form-data or JSON
    const contentType = req.headers.get('content-type') || '';
    let data = {};
    let attachments = [];
    
    const splitEmlHeadersAndBody = (content = '') => {
      const separatorMatch = content.match(/\r?\n\r?\n/);
      if (!separatorMatch || separatorMatch.index == null) {
        return { headers: '', body: content };
      }
      
      const separatorStart = separatorMatch.index;
      const separatorLength = separatorMatch[0].length;
      
      return {
        headers: content.substring(0, separatorStart),
        body: content.substring(separatorStart + separatorLength),
      };
    };
    
    const decodeTransferEncodedBody = (content = '', encoding = '') => {
      if (!content) return content;
      
      if (encoding === 'quoted-printable') {
        return content
          .replace(/=\r?\n/g, '')
          .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
      }
      
      if (encoding === 'base64') {
        try {
          const cleanBase64 = content.replace(/[\r\n\t ]/g, '');
          const decoded = Buffer.from(cleanBase64, 'base64').toString('utf-8');
          
          if (decoded && decoded.trim().length > 0) {
            return decoded;
          }
        } catch (error) {
          console.warn('⚠ Failed to decode base64 body, keeping raw content:', error.message);
        }
      }
      
      return content;
    };
    
    const extractStructuredPayload = (content = '') => {
      const trimmed = content.trim();
      if (!trimmed) return trimmed;
      
      const startCandidates = [
        trimmed.search(/<\?xml\b/i),
        trimmed.search(/<\?adf\b/i),
        trimmed.search(/<adf\b/i),
      ].filter(index => index >= 0);
      
      if (startCandidates.length === 0) {
        const looksLikeBase64Block =
          trimmed.length >= 200 &&
          /^[A-Za-z0-9+/=\r\n\t ]+$/.test(trimmed);
        
        if (looksLikeBase64Block) {
          const decodedStructuredPayload = decodeTransferEncodedBody(trimmed, 'base64').trim();
          
          if (
            decodedStructuredPayload &&
            decodedStructuredPayload !== trimmed &&
            (
              decodedStructuredPayload.startsWith('<?xml') ||
              decodedStructuredPayload.startsWith('<?ADF') ||
              decodedStructuredPayload.startsWith('<adf') ||
              decodedStructuredPayload.includes('<adf>') ||
              decodedStructuredPayload.includes('</adf>')
            )
          ) {
            return extractStructuredPayload(decodedStructuredPayload);
          }
        }
        
        return trimmed;
      }
      
      const payloadStart = Math.min(...startCandidates);
      const adfEndMatch = /<\/adf>/i.exec(trimmed);
      
      if (adfEndMatch && adfEndMatch.index >= payloadStart) {
        return trimmed.substring(payloadStart, adfEndMatch.index + adfEndMatch[0].length).trim();
      }
      
      return trimmed.substring(payloadStart).trim();
    };
    
    console.log('Processing request with content type:', contentType);

    if (contentType.includes('multipart/form-data')) {
      // Parse multipart form data
      console.log('Parsing multipart form data...');
      const formData = await req.formData();
      
      // Helper function to extract text from FormData (handles both string and File)
      const getTextValue = async (formData, key) => {
        const value = formData.get(key);
        if (!value) return '';
        if (typeof value === 'string') return value;
        // If it's a File object, read its text content
        if (value instanceof File || value instanceof Blob) {
          return await value.text();
        }
        return String(value);
      };
      
      // Extract form fields
      data = {
        sender: await getTextValue(formData, 'sender'),
        recipient: await getTextValue(formData, 'recipient'),
        subject: await getTextValue(formData, 'subject'),
        message_id: await getTextValue(formData, 'message_id'),
        in_reply_to: await getTextValue(formData, 'in_reply_to'),
        references: await getTextValue(formData, 'references'),
        first_message_id: await getTextValue(formData, 'first_message_id'),
        last_message_id: await getTextValue(formData, 'last_message_id'),
        parent_conversation: await getTextValue(formData, 'parent_conversation'),
        base_parent_id: await getTextValue(formData, 'base_parent_id'),
        date: await getTextValue(formData, 'date'),
        body: await getTextValue(formData, 'body'),
        headers: await getTextValue(formData, 'headers'),
      };
      
      // Extract and upload attachments to S3
      const attachmentFiles = formData.getAll('attachments[]');
      for (const file of attachmentFiles) {
        if (file && file.size > 0) {
          try {
            console.log(`Processing attachment: ${file.name} (${file.size} bytes)`);
            
            // Convert file to buffer
            const arrayBuffer = await file.arrayBuffer();
            const fileBuffer = Buffer.from(arrayBuffer);
            
            // Generate S3 filename with timestamp
            const timestamp = Date.now();
            const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
            const s3FileName = `email-attachments/${data.message_id || timestamp}/${sanitizedFileName}`;
            
            // Upload to S3
            const publicUrl = await uploadToS3(fileBuffer, s3FileName, file.type);
            
            attachments.push({
              filename: file.name,
              size: file.size,
              contentType: file.type,
              url: publicUrl,
              s3Key: s3FileName,
              status: 'processed',
              uploadedAt: new Date().toISOString()
            });
            
            console.log(`✓ Attachment uploaded to S3: ${file.name} -> ${publicUrl}`);
          } catch (uploadError) {
            console.error(`✗ Error uploading attachment ${file.name}:`, uploadError);
            // Store attachment info even if upload fails
            attachments.push({
              filename: file.name,
              size: file.size,
              contentType: file.type,
              status: 'failed',
              error: uploadError.message,
              uploadedAt: new Date().toISOString()
            });
          }
        }
      }
      
      console.log(`Processed ${attachments.length} attachment(s)`);
    } else {
      // Parse JSON (backward compatibility and new S3-based approach)
      console.log('Parsing JSON data...');
      try {
        data = await req.json();
      } catch (jsonError) {
        console.error('✗ Error parsing JSON request body:', jsonError);
        // If JSON parsing fails, try to get raw body for debugging
        try {
          const rawBody = await req.text();
          console.error(`Raw body length: ${rawBody.length} bytes`);
          console.error(`Raw body preview (first 500 chars): ${rawBody.substring(0, 500)}`);
        } catch (textError) {
          console.error('✗ Could not read request body as text:', textError);
        }
        throw new Error(`Failed to parse JSON request body: ${jsonError.message}`);
      }
      
      // Check if attachments are already processed (S3 URLs included)
      if (data.attachments && Array.isArray(data.attachments)) {
        attachments = data.attachments;
        console.log(`Received ${attachments.length} pre-processed attachment(s) with S3 URLs`);
      }
      
      // Check if entire email is available as .eml file - parse it to extract body/headers
      if (data.eml_url) {
        console.log(`Email .eml file available at: ${data.eml_url}, parsing...`);
        try {
          // Create timeout manually (AbortSignal.timeout may not be available in all Node versions)
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
          
          // Download and parse .eml file with size limit and error handling
          let emlResponse;
          try {
            emlResponse = await fetch(data.eml_url, {
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeoutId);
          }
          
          if (!emlResponse.ok) {
            throw new Error(`Failed to download .eml file: ${emlResponse.status} ${emlResponse.statusText}`);
          }
          
          // Check content length before downloading
          const contentLength = emlResponse.headers.get('content-length');
          let fileSizeMB = 0;
          if (contentLength) {
            fileSizeMB = parseInt(contentLength) / (1024 * 1024);
            console.log(`.eml file size: ${fileSizeMB.toFixed(2)} MB`);
            
            // For very large files (>20MB), stream intelligently to extract latest message
            if (parseInt(contentLength) > 20 * 1024 * 1024) {
              console.warn(`⚠ Large .eml file detected (${fileSizeMB.toFixed(2)} MB) - streaming to extract latest message`);
              
              // Stream to extract headers and latest message body
              const reader = emlResponse.body.getReader();
              const decoder = new TextDecoder('utf-8', { fatal: false });
              let headers = '';
              let bodyBuffer = '';
              let buffer = '';
              let totalRead = 0;
              let headerEndFound = false;
              const MAX_HEADER_SIZE = 100 * 1024; // Read max 100KB for headers
              const MAX_BODY_SIZE = 2 * 1024 * 1024; // Read max 2MB for body (latest message only)
              
              // Patterns that indicate start of quoted/replied content
              const quotedMarkers = [
                /^[\s>]*On\s+.{0,100}wrote:/i,
                /^[\s>]*From:/i,
                /^[\s>]*-----Original Message-----/i,
                /^[\s>]*________________________________/i,
                /<div[^>]*class\s*=\s*["'][^"']*gmail_quote/i,
                /<blockquote/i,
              ];
              
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  
                  totalRead += value.length;
                  buffer += decoder.decode(value, { stream: true });
                  
                  // Extract headers first
                  if (!headerEndFound) {
                    const headerEnd = buffer.indexOf('\n\n');
                    if (headerEnd > 0) {
                      headers = buffer.substring(0, headerEnd);
                      bodyBuffer = buffer.substring(headerEnd + 2);
                      headerEndFound = true;
                      buffer = bodyBuffer; // Continue with body
                      console.log(`✓ Extracted headers (${headers.length} chars), now extracting body...`);
                    } else if (totalRead > MAX_HEADER_SIZE) {
                      // Headers too long, try to find separator
                      const lastNewline = buffer.lastIndexOf('\n');
                      if (lastNewline > 0) {
                        headers = buffer.substring(0, lastNewline);
                        bodyBuffer = buffer.substring(lastNewline + 1);
                        headerEndFound = true;
                        buffer = bodyBuffer;
                      } else {
                        headers = buffer;
                        headerEndFound = true;
                        buffer = '';
                      }
                    }
                    continue;
                  }
                  
                  // Now extracting body - look for quoted content markers
                  if (headerEndFound && bodyBuffer.length < MAX_BODY_SIZE) {
                    // Check if we hit a quoted content marker
                    const lines = buffer.split('\n');
                    let foundQuotedMarker = false;
                    
                    // Check last few lines for quoted markers
                    for (let i = Math.max(0, lines.length - 10); i < lines.length; i++) {
                      for (const marker of quotedMarkers) {
                        if (marker.test(lines[i])) {
                          // Found quoted content, stop here
                          const markerIndex = buffer.lastIndexOf(lines[i]);
                          if (markerIndex > 0) {
                            bodyBuffer = buffer.substring(0, markerIndex).trim();
                            foundQuotedMarker = true;
                            console.log(`✓ Found quoted content marker, stopping body extraction at ${bodyBuffer.length} chars`);
                            break;
                          }
                        }
                      }
                      if (foundQuotedMarker) break;
                    }
                    
                    if (foundQuotedMarker) {
                      // Cancel reader - we have the latest message
                      reader.cancel();
                      break;
                    }
                    
                    // Continue reading body
                    bodyBuffer = buffer;
                    
                    // Safety limit - stop if body is getting too large
                    if (bodyBuffer.length >= MAX_BODY_SIZE) {
                      console.log(`✓ Body size limit reached (${MAX_BODY_SIZE} bytes), stopping extraction`);
                      reader.cancel();
                      break;
                    }
                  } else if (bodyBuffer.length >= MAX_BODY_SIZE) {
                    // Already reached limit
                    reader.cancel();
                    break;
                  }
                }
                
                console.log(`✓ Extracted headers (${headers.length} chars) and body (${bodyBuffer.length} chars) from large .eml file`);
                
                // Process the extracted body
                let extractedBody = bodyBuffer.trim();
                
                // Extract body from multipart if needed (same logic as smaller files)
                let partEncoding = '';
                if (headers.includes('Content-Type: multipart/')) {
                  const boundaryMatch = headers.match(/boundary\s*=\s*"?([^";\s]+)"?/i);
                  if (boundaryMatch) {
                    const boundary = boundaryMatch[1];
                    const boundaryPattern = new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?`, 'g');
                    const parts = extractedBody.split(boundaryPattern);
                    
                    let htmlBody = '';
                    let plainBody = '';
                    
                    for (let i = 0; i < parts.length; i++) {
                      const part = parts[i].trim();
                      if (!part || part.length === 0) continue;
                      
                      const isAttachment = part.match(/Content-Disposition:\s*attachment/i) ||
                                          part.match(/Content-Type:\s*(video|audio|image|application)\//i);
                      if (isAttachment) continue;
                      
                      const partEncodingMatch = part.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
                      const currentPartEncoding = partEncodingMatch ? partEncodingMatch[1].trim().toLowerCase() : '';
                      
                      if (part.includes('Content-Type:') && part.match(/Content-Type:\s*text\/html/i)) {
                        const headerEnd = part.indexOf('\n\n');
                        if (headerEnd > 0) {
                          const content = part.substring(headerEnd + 2).trim();
                          const cleanContent = content.replace(/^--.*$/gm, '').trim();
                          if (cleanContent && cleanContent.length > 0) {
                            htmlBody = cleanContent;
                            partEncoding = currentPartEncoding;
                            break;
                          }
                        }
                      } else if (!htmlBody && part.includes('Content-Type:') && part.match(/Content-Type:\s*text\/plain/i)) {
                        const headerEnd = part.indexOf('\n\n');
                        if (headerEnd > 0) {
                          const content = part.substring(headerEnd + 2).trim();
                          const cleanContent = content.replace(/^--.*$/gm, '').trim();
                          if (cleanContent && cleanContent.length > 0) {
                            plainBody = content;
                            partEncoding = currentPartEncoding;
                          }
                        }
                      }
                    }
                    
                    if (htmlBody) {
                      extractedBody = htmlBody;
                    } else if (plainBody) {
                      extractedBody = plainBody;
                    }
                  }
                }
                
                // Decode and clean body (same as smaller files)
                const encodingMatch = headers.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
                const encoding = partEncoding || (encodingMatch ? encodingMatch[1].trim().toLowerCase() : '');
                
                extractedBody = decodeTransferEncodedBody(extractedBody, encoding);
                extractedBody = extractStructuredPayload(extractedBody);
                
                // Clean encodings and HTML entities
                extractedBody = extractedBody
                  .replace(/=3D/g, '=')
                  .replace(/=\r/g, '')
                  .replace(/=\n/g, '')
                  .replace(/\\n/g, '\n')
                  .replace(/&#8217;/g, "'")
                  .replace(/&quot;/g, '"')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&amp;/g, '&');
                
                // Remove embedded attachments (basic cleaning)
                extractedBody = extractedBody.replace(/data:[^;]+;base64,[A-Za-z0-9+/=\s]{100,}/g, '[Embedded Attachment Removed]');
                extractedBody = extractedBody.replace(/^[A-Za-z0-9+/=]{200,}$/gm, '[Base64 Data Removed]');
                extractedBody = extractedBody.replace(/<img[^>]*src\s*=\s*["']data:[^"']+["'][^>]*>/gi, '<img src="[Embedded Image Removed]">');
                extractedBody = extractedBody.replace(/style\s*=\s*["'][^"']*data:[^"']+["']/gi, 'style="[Embedded Image Removed]"');
                extractedBody = extractedBody.replace(/<video[^>]*>[\s\S]*?<\/video>/gi, '[Video Attachment Removed]');
                extractedBody = extractedBody.replace(/<audio[^>]*>[\s\S]*?<\/audio>/gi, '[Audio Attachment Removed]');
                extractedBody = extractedBody.replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '[Object Attachment Removed]');
                extractedBody = extractedBody.replace(/<embed[^>]*>/gi, '[Embed Attachment Removed]');
                extractedBody = extractedBody.split('\n').map(line => {
                  if (line.length > 500 && /^[A-Za-z0-9+/=\s]+$/.test(line.trim())) {
                    return '[Long Base64 Line Removed]';
                  }
                  return line;
                }).join('\n');
                
                // Check if body looks like structured data (XML, JSON, etc.) - don't remove quoted content for these
                const isStructuredData = extractedBody.trim().startsWith('<?xml') || 
                                        extractedBody.trim().startsWith('<xml') ||
                                        extractedBody.trim().startsWith('{') ||
                                        extractedBody.trim().startsWith('[') ||
                                        (extractedBody.includes('<?xml') && extractedBody.includes('?>')) ||
                                        (extractedBody.includes('<adf>') || extractedBody.includes('<ADF>'));
                
                if (!isStructuredData) {
                  // Remove quoted/replied email content (same logic as smaller files)
                  const quotedEmailPatterns = [
                    /<div[^>]*class\s*=\s*["'][^"']*gmail_quote[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
                    /<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi,
                    /<div[^>]*style\s*=\s*["'][^"']*border-left[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
                  ];
                  
                  const quotedMarkersForRemoval = [
                    /^[\s>]*On\s+.{0,100}wrote:/gmi,
                    /^[\s>]*-----Original Message-----/gmi,
                    /^[\s>]*________________________________/gmi,
                    /<div[^>]*class\s*=\s*["'][^"']*gmail_quote/gi,
                    /<blockquote/gi,
                  ];
                  
                  if (extractedBody.includes('<html') || extractedBody.includes('<div') || extractedBody.includes('<blockquote')) {
                    extractedBody = extractedBody.replace(/<div[^>]*class\s*=\s*["'][^"']*gmail_quote[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
                    extractedBody = extractedBody.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');
                    extractedBody = extractedBody.replace(/<div[^>]*style\s*=\s*["'][^"']*border-left[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
                  }
                  
                  let lines = extractedBody.split('\n');
                  let newLines = [];
                  let inQuotedSection = false;
                  let foundQuotedMarker = false;
                  
                  for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    let isQuotedMarker = false;
                    
                    for (const marker of quotedMarkersForRemoval) {
                      if (marker.test(line)) {
                        isQuotedMarker = true;
                        inQuotedSection = true;
                        foundQuotedMarker = true;
                        break;
                      }
                    }
                    
                    if (!isQuotedMarker && foundQuotedMarker && /^[\s>|]+/.test(line) && line.trim().length > 0) {
                      if ((/^[\s>|]*From:\s+[^\s]+@/.test(line) || 
                           /^[\s>|]*To:\s+[^\s]+@/.test(line) || 
                           /^[\s>|]*Subject:\s+/.test(line) || 
                           /^[\s>|]*Date:\s+/.test(line) ||
                           /^[\s>|]*Sent:\s+/.test(line)) && inQuotedSection) {
                        continue;
                      } else if (inQuotedSection && line.trim().length > 20 && !/^[\s>|]+/.test(line)) {
                        inQuotedSection = false;
                        foundQuotedMarker = false;
                      }
                    }
                    
                    if (!inQuotedSection) {
                      newLines.push(line);
                    } else if (isQuotedMarker) {
                      break;
                    }
                  }
                  
                  extractedBody = newLines.join('\n').trim();
                  
                  for (const pattern of quotedEmailPatterns) {
                    extractedBody = extractedBody.replace(pattern, '');
                  }
                  
                  extractedBody = extractedBody.replace(/\n{3,}/g, '\n\n');
                  
                  console.log(`After removing quoted content: ${extractedBody.length} chars`);
                } else {
                  console.log(`Body appears to be structured data (XML/JSON), skipping quoted content removal`);
                }
                
                data.body = extractedBody;
                data.headers = headers;
                data.eml_file_url = data.eml_url;
                
                // Extract recipients from headers
                const extractEmailAddresses = (headerValue) => {
                  if (!headerValue) return [];
                  const decoded = headerValue
                    .replace(/\r?\n\s+/g, ' ')
                    .replace(/=\r?\n/g, '')
                    .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
                  const emailRegex = /[\w\.-]+@[\w\.-]+\.\w+/g;
                  const matches = decoded.match(emailRegex) || [];
                  return [...new Set(matches)];
                };
                
                const extractHeader = (headerName) => {
                  const regex = new RegExp(`^${headerName}:\\s*([^\\r\\n]+(?:\\r?\\n\\s+[^\\r\\n]+)*)`, 'ims');
                  const match = headers.match(regex);
                  return match ? match[1].replace(/\r?\n\s+/g, ' ').trim() : '';
                };
                
                const toHeader = extractHeader('To');
                const ccHeader = extractHeader('Cc');
                const bccHeader = extractHeader('Bcc');
                
                const toRecipients = extractEmailAddresses(toHeader);
                const ccRecipients = extractEmailAddresses(ccHeader);
                const bccRecipients = extractEmailAddresses(bccHeader);
                
                const allRecipients = [...new Set([...toRecipients, ...ccRecipients, ...bccRecipients])];
                const autopulseRecipients = allRecipients.filter(email => 
                  email.toLowerCase().endsWith('.autopulsemail.com') || email.toLowerCase().endsWith('@autopulsemail.com')
                );
                
                const originalRecipient = data.recipient || '';
                let finalRecipient = originalRecipient;
                
                if (autopulseRecipients.length > 0) {
                  finalRecipient = autopulseRecipients[0];
                  console.log(`✓ Using .autopulsemail.com recipient: ${finalRecipient}`);
                } else if (toRecipients.length > 0) {
                  finalRecipient = toRecipients[0];
                  console.log(`✓ Using first To recipient: ${finalRecipient}`);
                } else if (allRecipients.length > 0) {
                  finalRecipient = allRecipients[0];
                  console.log(`✓ Using first recipient: ${finalRecipient}`);
                }
                
                data.recipient = finalRecipient;
                
                // Body has been extracted and cleaned, continue with normal processing
                // The body will go through additional cleaning (quoted content removal) later in the code
                console.log(`✓ Large .eml file processed - extracted latest message (${extractedBody.length} chars)`);
                // Continue to save email with extracted body
              } catch (streamError) {
                console.error('Error streaming .eml file:', streamError);
                throw streamError;
              }
            } else {
              // For smaller files, parse normally
              // Use arrayBuffer instead of text() for better memory handling
              let emlArrayBuffer;
              try {
                emlArrayBuffer = await emlResponse.arrayBuffer();
                console.log(`Downloaded .eml file (${emlArrayBuffer.byteLength} bytes)`);
              } catch (bufferError) {
                console.error('Error reading .eml file as arrayBuffer:', bufferError);
                throw new Error(`Failed to read .eml file: ${bufferError.message}`);
              }
              
              // Use TextDecoder for safer conversion with bounds checking
              let emlContent;
              try {
                const decoder = new TextDecoder('utf-8', { fatal: false });
                emlContent = decoder.decode(emlArrayBuffer, { stream: false });
                console.log(`Decoded .eml content (${emlContent.length} characters)`);
              } catch (decodeError) {
                console.error('Error decoding .eml file:', decodeError);
                throw new Error(`Failed to decode .eml file: ${decodeError.message}`);
              }
              
              // Parse .eml file - split headers and body (handle LF and CRLF)
              const { headers, body } = splitEmlHeadersAndBody(emlContent);
              
              console.log(`Parsed .eml - headers: ${headers.length} chars, body: ${body.length} chars`);
              
              // Extract body from multipart if needed
              let extractedBody = body;
              let partEncoding = '';
              
              // Check if multipart
              if (headers.includes('Content-Type: multipart/')) {
                // Try to extract text/html or text/plain part
                // Handle boundary with or without quotes
                const boundaryMatch = headers.match(/boundary\s*=\s*"?([^";\s]+)"?/i);
                if (boundaryMatch) {
                  const boundary = boundaryMatch[1];
                  console.log(`Multipart detected with boundary: ${boundary}`);
                  
                  // Split by boundary (handle both --boundary and --boundary--)
                  const boundaryPattern = new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?`, 'g');
                  const parts = body.split(boundaryPattern);
                  
                  console.log(`Found ${parts.length} parts in multipart email`);
                  
                  let htmlBody = '';
                  let plainBody = '';
                  let foundHtmlEncoding = '';
                  let foundPlainEncoding = '';
                  
                  // Look for text/html or text/plain parts (skip video/audio/image/application attachments)
                  for (let i = 0; i < parts.length; i++) {
                    const part = parts[i].trim();
                    if (!part || part.length === 0) continue;
                    
                    // Skip if this is an attachment (video, audio, image, or has Content-Disposition: attachment)
                    const isAttachment = part.match(/Content-Disposition:\s*attachment/i) ||
                                        part.match(/Content-Type:\s*(video|audio|image|application)\//i);
                    
                    if (isAttachment) {
                      console.log(`Skipping attachment part ${i}`);
                      continue;
                    }
                    
                    // Check encoding in this part
                    const partEncodingMatch = part.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
                    const currentPartEncoding = partEncodingMatch ? partEncodingMatch[1].trim().toLowerCase() : '';
                    
                    // Try to extract HTML part
                    if (part.includes('Content-Type:') && part.match(/Content-Type:\s*text\/html/i)) {
                      // Find the content after headers (after double newline)
                      const headerEnd = part.indexOf('\n\n');
                      if (headerEnd > 0) {
                        const content = part.substring(headerEnd + 2).trim();
                        // Remove trailing boundary markers
                        const cleanContent = content.replace(/^--.*$/gm, '').trim();
                        if (cleanContent && cleanContent.length > 0) {
                          htmlBody = cleanContent;
                          foundHtmlEncoding = currentPartEncoding;
                          console.log(`Found HTML part (${htmlBody.length} chars, encoding: ${currentPartEncoding})`);
                        }
                      }
                    }
                    // Try to extract plain text part (only if HTML not found yet)
                    else if (!htmlBody && part.includes('Content-Type:') && part.match(/Content-Type:\s*text\/plain/i)) {
                      const headerEnd = part.indexOf('\n\n');
                      if (headerEnd > 0) {
                        const content = part.substring(headerEnd + 2).trim();
                        const cleanContent = content.replace(/^--.*$/gm, '').trim();
                        if (cleanContent && cleanContent.length > 0) {
                          plainBody = cleanContent;
                          foundPlainEncoding = currentPartEncoding;
                          console.log(`Found plain text part (${plainBody.length} chars, encoding: ${currentPartEncoding})`);
                        }
                      }
                    }
                  }
                  
                  // Use HTML if available, otherwise use plain text, otherwise keep original body
                  if (htmlBody) {
                    extractedBody = htmlBody;
                    partEncoding = foundHtmlEncoding;
                    console.log(`Using HTML body (${extractedBody.length} chars)`);
                  } else if (plainBody) {
                    extractedBody = plainBody;
                    partEncoding = foundPlainEncoding;
                    console.log(`Using plain text body (${extractedBody.length} chars)`);
                  } else {
                    console.warn('⚠ No text/html or text/plain part found in multipart email, using original body');
                    // Fallback: try to extract any readable text from the first non-attachment part
                    for (let i = 0; i < parts.length; i++) {
                      const part = parts[i].trim();
                      if (!part || part.length === 0) continue;
                      const isAttachment = part.match(/Content-Disposition:\s*attachment/i) ||
                                          part.match(/Content-Type:\s*(video|audio|image|application)\//i);
                      if (!isAttachment) {
                        const headerEnd = part.indexOf('\n\n');
                        if (headerEnd > 0) {
                          const content = part.substring(headerEnd + 2).trim();
                          const cleanContent = content.replace(/^--.*$/gm, '').trim();
                          if (cleanContent && cleanContent.length > 50) { // At least 50 chars
                            extractedBody = cleanContent;
                            console.log(`Using fallback body from part ${i} (${extractedBody.length} chars)`);
                            break;
                          }
                        }
                      }
                    }
                  }
                } else {
                  console.warn('⚠ Multipart detected but no boundary found');
                }
              }
              
              // Ensure we have a body (fallback to original if empty)
              if (!extractedBody || extractedBody.trim().length === 0) {
                console.warn('⚠ Extracted body is empty, using original body');
                extractedBody = body;
              }
              
              // Detect encoding from headers (same logic as bash script)
              // Check Content-Transfer-Encoding header (from main headers or part headers)
              const encodingMatch = headers.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
              const encoding = partEncoding || (encodingMatch ? encodingMatch[1].trim().toLowerCase() : '');
              
              console.log(`Body extraction complete: ${extractedBody.length} chars, encoding: ${encoding || 'none'}`);
              
              extractedBody = decodeTransferEncodedBody(extractedBody, encoding);
              extractedBody = extractStructuredPayload(extractedBody);
              
              // Clean encodings and HTML entities (exact same as bash script sed replacements)
              extractedBody = extractedBody
                .replace(/=3D/g, '=')           // =3D → = (equals sign encoding)
                .replace(/=\r/g, '')             // =\r → remove (carriage return)
                .replace(/=\n/g, '')             // =\n → remove (newline)
                .replace(/\\n/g, '\n')            // \\n → \n (escaped newline)
                .replace(/&#8217;/g, "'")         // &#8217; → ' (right single quotation mark)
                .replace(/&quot;/g, '"')          // &quot; → " (double quote)
                .replace(/&lt;/g, '<')            // &lt; → < (less than)
                .replace(/&gt;/g, '>')            // &gt; → > (greater than)
                .replace(/&amp;/g, '&');          // &amp; → & (ampersand - do last to avoid double replacement)
              
              // Remove embedded attachments/images from body (base64 data URIs, large base64 blocks)
              // Remove data URIs (data:image/..., data:application/..., data:video/...)
              extractedBody = extractedBody.replace(/data:[^;]+;base64,[A-Za-z0-9+/=\s]{100,}/g, '[Embedded Attachment Removed]');
              
              // Remove large base64 encoded blocks (standalone base64 lines > 100 chars)
              extractedBody = extractedBody.replace(/^[A-Za-z0-9+/=]{200,}$/gm, '[Base64 Data Removed]');
              
              // Remove base64 content in HTML img src attributes
              extractedBody = extractedBody.replace(/<img[^>]*src\s*=\s*["']data:[^"']+["'][^>]*>/gi, '<img src="[Embedded Image Removed]">');
              
              // Remove base64 content in style attributes (background images)
              extractedBody = extractedBody.replace(/style\s*=\s*["'][^"']*data:[^"']+["']/gi, 'style="[Embedded Image Removed]"');
              
              // Remove video/audio/attachment tags and content
              extractedBody = extractedBody.replace(/<video[^>]*>[\s\S]*?<\/video>/gi, '[Video Attachment Removed]');
              extractedBody = extractedBody.replace(/<audio[^>]*>[\s\S]*?<\/audio>/gi, '[Audio Attachment Removed]');
              extractedBody = extractedBody.replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '[Object Attachment Removed]');
              extractedBody = extractedBody.replace(/<embed[^>]*>/gi, '[Embed Attachment Removed]');
              
              // Remove very long lines that are likely base64 encoded content (lines > 500 chars)
              extractedBody = extractedBody.split('\n').map(line => {
                if (line.length > 500 && /^[A-Za-z0-9+/=\s]+$/.test(line.trim())) {
                  return '[Long Base64 Line Removed]';
                }
                return line;
              }).join('\n');
              
              // Check if body looks like structured data (XML, JSON, etc.) - don't remove quoted content for these
              const isStructuredData = extractedBody.trim().startsWith('<?xml') || 
                                      extractedBody.trim().startsWith('<xml') ||
                                      extractedBody.trim().startsWith('{') ||
                                      extractedBody.trim().startsWith('[') ||
                                      (extractedBody.includes('<?xml') && extractedBody.includes('?>')) ||
                                      (extractedBody.includes('<adf>') || extractedBody.includes('<ADF>'));
              
              if (!isStructuredData) {
                // Remove quoted/replied email content (email thread history) - only for regular text emails
                // Common patterns for quoted emails
                const quotedEmailPatterns = [
                  // HTML quoted content
                  /<div[^>]*class\s*=\s*["'][^"']*gmail_quote[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
                  /<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi,
                  /<div[^>]*style\s*=\s*["'][^"']*border-left[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
                ];
                
                // Try to find where the quoted content starts and remove it
                // Look for common markers that indicate start of quoted content
                const quotedMarkers = [
                  /^[\s>]*On\s+.{0,100}wrote:/gmi,
                  /^[\s>]*-----Original Message-----/gmi,
                  /^[\s>]*________________________________/gmi,
                  /<div[^>]*class\s*=\s*["'][^"']*gmail_quote/gi,
                  /<blockquote/gi,
                ];
                
                // For HTML content, remove quoted blocks
                if (extractedBody.includes('<html') || extractedBody.includes('<div') || extractedBody.includes('<blockquote')) {
                  // Remove HTML quoted blocks
                  extractedBody = extractedBody.replace(/<div[^>]*class\s*=\s*["'][^"']*gmail_quote[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
                  extractedBody = extractedBody.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');
                  extractedBody = extractedBody.replace(/<div[^>]*style\s*=\s*["'][^"']*border-left[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
                }
                
                // For plain text, find and remove quoted content - be more conservative
                let lines = extractedBody.split('\n');
                let newLines = [];
                let inQuotedSection = false;
                let foundQuotedMarker = false;
                
                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i];
                  let isQuotedMarker = false;
                  
                  // Check if this line is a clear quoted content marker (more specific patterns)
                  for (const marker of quotedMarkers) {
                    if (marker.test(line)) {
                      isQuotedMarker = true;
                      inQuotedSection = true;
                      foundQuotedMarker = true;
                      break;
                    }
                  }
                  
                  // Only mark as quoted if we have a clear marker AND the line looks like an email header
                  if (!isQuotedMarker && foundQuotedMarker && /^[\s>|]+/.test(line) && line.trim().length > 0) {
                    // Check if it's likely an email header (must have colon and look like email metadata)
                    if ((/^[\s>|]*From:\s+[^\s]+@/.test(line) || 
                         /^[\s>|]*To:\s+[^\s]+@/.test(line) || 
                         /^[\s>|]*Subject:\s+/.test(line) || 
                         /^[\s>|]*Date:\s+/.test(line) ||
                         /^[\s>|]*Sent:\s+/.test(line)) && inQuotedSection) {
                      // This is part of quoted email headers
                      continue; // Skip this line
                    } else if (inQuotedSection && line.trim().length > 20 && !/^[\s>|]+/.test(line)) {
                      // Non-quoted line after quoted section - might be new content
                      inQuotedSection = false;
                      foundQuotedMarker = false;
                    }
                  }
                  
                  // Keep lines that are not in quoted section
                  if (!inQuotedSection) {
                    newLines.push(line);
                  } else if (isQuotedMarker) {
                    // Stop at first quoted marker - everything after is quoted
                    break;
                  }
                }
                
                extractedBody = newLines.join('\n').trim();
                
                // Also apply regex patterns to catch any remaining quoted content (only HTML blocks)
                for (const pattern of quotedEmailPatterns) {
                  extractedBody = extractedBody.replace(pattern, '');
                }
                
                // Clean up multiple empty lines
                extractedBody = extractedBody.replace(/\n{3,}/g, '\n\n');
                
                console.log(`After removing quoted content: ${extractedBody.length} chars`);
              } else {
                console.log(`Body appears to be structured data (XML/JSON), skipping quoted content removal`);
              }
              
              // Extract recipients from headers (To, Cc, Bcc)
              const extractEmailAddresses = (headerValue) => {
                if (!headerValue) return [];
                // Handle folded headers (multiline) and decode quoted-printable
                const decoded = headerValue
                  .replace(/\r?\n\s+/g, ' ') // Unfold headers
                  .replace(/=\r?\n/g, '') // Remove soft line breaks
                  .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
                
                // Extract email addresses using regex
                const emailRegex = /[\w\.-]+@[\w\.-]+\.\w+/g;
                const matches = decoded.match(emailRegex) || [];
                return [...new Set(matches)]; // Remove duplicates
              };
              
              // Extract headers (handle multiline/folded headers)
              const extractHeader = (headerName) => {
                const regex = new RegExp(`^${headerName}:\\s*([^\\r\\n]+(?:\\r?\\n\\s+[^\\r\\n]+)*)`, 'ims');
                const match = headers.match(regex);
                return match ? match[1].replace(/\r?\n\s+/g, ' ').trim() : '';
              };
              
              const toHeader = extractHeader('To');
              const ccHeader = extractHeader('Cc');
              const bccHeader = extractHeader('Bcc');
              
              const toRecipients = extractEmailAddresses(toHeader);
              const ccRecipients = extractEmailAddresses(ccHeader);
              const bccRecipients = extractEmailAddresses(bccHeader);
              
              // Combine all recipients
              const allRecipients = [...new Set([...toRecipients, ...ccRecipients, ...bccRecipients])];
              
              // Find recipients ending with .autopulsemail.com (ALWAYS prioritize these)
              const autopulseRecipients = allRecipients.filter(email => 
                email.toLowerCase().endsWith('.autopulsemail.com') || email.toLowerCase().endsWith('@autopulsemail.com')
              );
              
              // Get original recipient from JSON payload
              const originalRecipient = data.recipient || '';
              
              // Determine final recipient (ALWAYS prioritize .autopulsemail.com):
              // 1. Use first .autopulsemail.com recipient if available (ALWAYS)
              // 2. Otherwise, check if original recipient exists in .eml file, keep it
              // 3. Otherwise, use first To recipient
              // 4. Otherwise, use first recipient from any field
              // 5. Otherwise, keep original recipient
              let finalRecipient = originalRecipient;
              
              if (autopulseRecipients.length > 0) {
                // ALWAYS use first .autopulsemail.com recipient if available
                finalRecipient = autopulseRecipients[0];
                console.log(`✓ Using .autopulsemail.com recipient: ${finalRecipient}${originalRecipient && originalRecipient.toLowerCase() !== finalRecipient.toLowerCase() ? ` (replaced original: ${originalRecipient})` : ''}`);
              } else {
                // No .autopulsemail.com recipient - check if original exists in .eml file
                const originalRecipientExists = originalRecipient && allRecipients.some(email => 
                  email.toLowerCase() === originalRecipient.toLowerCase()
                );
                
                if (originalRecipientExists) {
                  // Original recipient found in .eml file - keep it
                  finalRecipient = originalRecipient;
                  console.log(`✓ Original recipient "${originalRecipient}" found in .eml file - keeping it`);
                } else if (toRecipients.length > 0) {
                  // Use first To recipient
                  finalRecipient = toRecipients[0];
                  console.log(`✓ Using first To recipient: ${finalRecipient}`);
                } else if (allRecipients.length > 0) {
                  // Use first recipient from any field
                  finalRecipient = allRecipients[0];
                  console.log(`✓ Using first recipient from .eml file: ${finalRecipient}`);
                } else {
                  // Keep original recipient
                  console.log(`✓ No recipients found in .eml file - keeping original: ${originalRecipient}`);
                }
              }
              
              // Set parsed body and headers
              data.body = extractedBody;
              data.headers = headers;
              data.eml_file_url = data.eml_url;
              
              // Update recipient with final recipient
              data.recipient = finalRecipient;
            }
          }
          
          // Log all recipients and eml_file_url
         
          
        } catch (emlError) {
          console.error(`✗ Error parsing .eml file:`, emlError);
          console.error(`Error details:`, {
            message: emlError.message,
            stack: emlError.stack,
            eml_url: data.eml_url,
            name: emlError.name
          });
          
          // Continue without body/headers if parsing fails - API will need to handle this
          data.eml_file_url = data.eml_url;
          // Set empty body/headers as fallback
          if (!data.body) data.body = '';
          if (!data.headers) data.headers = '';
          
          // Log warning but don't throw - allow email to be saved with just metadata
          console.warn('⚠ Continuing without parsed .eml content - email will be saved with metadata only');
        }
      } else {
        // No .eml URL - this shouldn't happen but handle gracefully
        console.warn('⚠ No .eml_url provided - email may be incomplete');
        if (!data.body) data.body = '';
        if (!data.headers) data.headers = '';
      }
    }
    
    // Log successfully parsed data
    console.log('✓ Data parsed successfully:', {
      sender: data.sender || 'missing',
      recipient: data.recipient || 'missing',
      eml_file_url: data.eml_file_url || 'not provided',
      subject: data.subject || 'missing',
      message_id: data.message_id || 'missing',
      has_body: !!data.body,
      body_length: data.body?.length || 0,
      has_headers: !!data.headers,
      headers_length: data.headers?.length || 0,
      attachments_count: attachments.length,
    });

    // Connect to the database
    console.log('Connecting to MongoDB...');
    await dbConnect();
    
    // Clean body to remove embedded attachments and limit size for WebhookLog
    let cleanedBody = data.body || '';
    let cleanedHeaders = data.headers || '';
  
    // Remove embedded attachments/images from body if not already done
    if (cleanedBody) {
      // Remove data URIs
      cleanedBody = cleanedBody.replace(/data:[^;]+;base64,[A-Za-z0-9+/=\s]{100,}/g, '[Embedded Image/Attachment Removed]');
      // Remove large base64 blocks
      cleanedBody = extractStructuredPayload(cleanedBody);
      cleanedBody = cleanedBody.replace(/^[A-Za-z0-9+/=]{200,}$/gm, '[Base64 Data Removed]');
      // Remove base64 in HTML img tags
      cleanedBody = cleanedBody.replace(/<img[^>]*src\s*=\s*["']data:[^"']+["'][^>]*>/gi, '<img src="[Embedded Image Removed]">');
      // Remove base64 in style attributes
      cleanedBody = cleanedBody.replace(/style\s*=\s*["'][^"']*data:[^"']+["']/gi, 'style="[Embedded Image Removed]"');
      // Remove very long base64 lines
      cleanedBody = cleanedBody.split('\n').map(line => {
        if (line.length > 500 && /^[A-Za-z0-9+/=\s]+$/.test(line.trim())) {
          return '[Long Base64 Line Removed]';
        }
        return line;
      }).join('\n');
      
      // Truncate body if too large (limit to 100KB for WebhookLog to avoid MongoDB 16MB limit)
      const MAX_BODY_SIZE = 2*1024 * 1024; // 100KB
      if (cleanedBody.length > MAX_BODY_SIZE) {
        cleanedBody = cleanedBody.substring(0, MAX_BODY_SIZE) + '\n...[Body truncated for logging]';
      }
    }
    
    // Truncate headers if too large
    const MAX_HEADERS_SIZE = 50 * 1024; // 50KB
    if (cleanedHeaders.length > MAX_HEADERS_SIZE) {
      cleanedHeaders = cleanedHeaders.substring(0, MAX_HEADERS_SIZE) + '\n...[Headers truncated for logging]';
    }
    
    // Save webhook log with limited data size to avoid MongoDB 16MB BSON limit
    const webhookLogData = {
      sender: data.sender,
      recipient: data.recipient,
      subject: data.subject,
      message_id: data.message_id,
      in_reply_to: data.in_reply_to,
      references: data.references,
      first_message_id: data.first_message_id,
      last_message_id: data.last_message_id,
      parent_conversation: data.parent_conversation,
      base_parent_id: data.base_parent_id,
      date: data.date,
      body: cleanedBody, // Use cleaned/truncated body
      headers: cleanedHeaders, // Use truncated headers
      body_length: data.body?.length || 0, // Store original length
      headers_length: data.headers?.length || 0, // Store original length
      eml_url: data.eml_url || data.eml_file_url, // Store .eml URL
      attachments_count: attachments.length,
      attachments_info: attachments.map(a => ({ 
        filename: a.filename, 
        size: a.size, 
        contentType: a.contentType || a.type,
        url: a.url,
        status: a.status
      }))
    };
    
    const webhookLog = new WebhookLog({
      data: webhookLogData
    });
    
    try {
      await webhookLog.save();
    } catch (logError) {
      // If still too large, save minimal data
      if (logError.message && logError.message.includes('BSONObj size')) {
        console.warn('⚠ WebhookLog too large, saving minimal data only');
        const minimalLog = new WebhookLog({
          data: {
            sender: data.sender,
            recipient: data.recipient,
            subject: data.subject,
            message_id: data.message_id,
            date: data.date,
            body_length: data.body?.length || 0,
            headers_length: data.headers?.length || 0,
            eml_url: data.eml_url || data.eml_file_url,
            attachments_count: attachments.length,
            error: 'Body/headers too large to log - see .eml file'
          }
        });
        await minimalLog.save();
      } else {
        throw logError;
      }
    }
   
    // Find the dealer_id based on the recipient email
   
    const emailAccount = await EmailAccount.findOne({ 
      email_address: data.recipient 
    }).collation({ locale: 'en', strength: 2 });
    if (!emailAccount) {
      throw new Error(`No email account found for recipient: ${data.recipient}`);
    }

    const dealer_id = emailAccount.dealer_id;
    const dealer = await User.findById(dealer_id);
    if (!dealer) {
      throw new Error(`Dealer not found with ID: ${dealer_id}`);
    }

    let lead_id= null;
    let subscriptionValid = false;
    let notificationSent = false;
    let subscriptionOwner = dealer;

    if (dealer.vendor_id) {
    
      // Check agency subscription for dealer under an agency
      const agency = await User.findById(dealer.vendor_id);
     
      if (agency && isPackageExpiryValid(agency.package_expiry)) {
        subscriptionValid = true;
        subscriptionOwner = agency;
      } else {
        // Agency subscription is invalid or expired
        subscriptionValid = false;
        if (agency) {
          subscriptionOwner = agency;
        }
      }
    } else {
      // Check independent dealer's subscription
      if (isPackageExpiryValid(dealer.package_expiry)) {
        subscriptionValid = true;
      } else {
        subscriptionValid = false;
      }
    }
    if (!subscriptionValid) {
      await sendSubscriptionExpiryNotification({
        account: subscriptionOwner,
        dealer: dealer.vendor_id ? dealer : null
      });
      // Return error response
      return new Response(JSON.stringify({ 
        message: notificationSent 
          ? 'Subscription expired. Notification sent.' 
          : 'Subscription expired. ',
        error: 'Subscription expired or invalid'
      }), {
        status: 402, // Payment Required status code
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let parent_message_id = data.parent_conversation; // Default to incoming parent_conversation

    // If this is a reply, check the parent email's parent_message_id
    if (data.parent_conversation) {
      const parentEmail = await Email.findOne({ 
        $or: [
          { message_id: data.parent_conversation },
          { parent_conversation: data.parent_conversation }
        ]
      }).sort({ date: -1 }); // Get the most recent email in the thread

      // If the parent email has its own parent_message_id, use THAT instead
      if (parentEmail?.parent_message_id) {
        parent_message_id = parentEmail.parent_message_id;
        console.log(`Overriding parent_message_id with thread root: ${parent_message_id}`);
      }
      
      // Get lead_id from the parent email (should be ObjectId, not message_id)
      if (parentEmail?.lead_id) {
        lead_id = parentEmail.lead_id;
      }
    }

    // Clean body for Email model (remove embedded attachments and quoted content)
    let emailBody = data.body || '';
    if (emailBody) {
      // Remove embedded attachments/images (safe for all content types)
      emailBody = emailBody.replace(/data:[^;]+;base64,[A-Za-z0-9+/=\s]{100,}/g, '[Embedded Attachment Removed]');
      emailBody = extractStructuredPayload(emailBody);
      
      // Check if body looks like structured data (XML, JSON, etc.) after extraction/decoding
      const isStructuredData = emailBody.trim().startsWith('<?xml') || 
                                emailBody.trim().startsWith('<xml') ||
                                emailBody.trim().startsWith('{') ||
                                emailBody.trim().startsWith('[') ||
                                (emailBody.includes('<?xml') && emailBody.includes('?>')) ||
                                (emailBody.includes('<adf>') || emailBody.includes('<ADF>'));
      
      emailBody = emailBody.replace(/^[A-Za-z0-9+/=]{200,}$/gm, '[Base64 Data Removed]');
      emailBody = emailBody.replace(/<img[^>]*src\s*=\s*["']data:[^"']+["'][^>]*>/gi, '<img src="[Embedded Image Removed]">');
      emailBody = emailBody.replace(/style\s*=\s*["'][^"']*data:[^"']+["']/gi, 'style="[Embedded Image Removed]"');
      
      // Remove video/audio/attachment tags (safe for all content types)
      emailBody = emailBody.replace(/<video[^>]*>[\s\S]*?<\/video>/gi, '[Video Attachment Removed]');
      emailBody = emailBody.replace(/<audio[^>]*>[\s\S]*?<\/audio>/gi, '[Audio Attachment Removed]');
      emailBody = emailBody.replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '[Object Attachment Removed]');
      emailBody = emailBody.replace(/<embed[^>]*>/gi, '[Embed Attachment Removed]');
      
      emailBody = emailBody.split('\n').map(line => {
        if (line.length > 500 && /^[A-Za-z0-9+/=\s]+$/.test(line.trim())) {
          return '[Long Base64 Line Removed]';
        }
        return line;
      }).join('\n');
      
      // Only remove quoted content if it's NOT structured data
      if (!isStructuredData) {
        // Remove quoted/replied email content (email thread history)
        const quotedEmailPatterns = [
          /<div[^>]*class\s*=\s*["'][^"']*gmail_quote[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
          /<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi,
          /<div[^>]*style\s*=\s*["'][^"']*border-left[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
        ];
        
        const quotedMarkers = [
          /^[\s>]*On\s+.{0,100}wrote:/gmi,
          /^[\s>]*-----Original Message-----/gmi,
          /^[\s>]*________________________________/gmi,
          /<div[^>]*class\s*=\s*["'][^"']*gmail_quote/gi,
          /<blockquote/gi,
        ];
        
        // For HTML content, remove quoted blocks
        if (emailBody.includes('<html') || emailBody.includes('<div') || emailBody.includes('<blockquote')) {
          emailBody = emailBody.replace(/<div[^>]*class\s*=\s*["'][^"']*gmail_quote[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
          emailBody = emailBody.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');
          emailBody = emailBody.replace(/<div[^>]*style\s*=\s*["'][^"']*border-left[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');
        }
        
        // For plain text, find and remove quoted content - be more conservative
        let lines = emailBody.split('\n');
        let newLines = [];
        let inQuotedSection = false;
        let foundQuotedMarker = false;
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          let isQuotedMarker = false;
          
          for (const marker of quotedMarkers) {
            if (marker.test(line)) {
              isQuotedMarker = true;
              inQuotedSection = true;
              foundQuotedMarker = true;
              break;
            }
          }
          
          if (!isQuotedMarker && foundQuotedMarker && /^[\s>|]+/.test(line) && line.trim().length > 0) {
            if ((/^[\s>|]*From:\s+[^\s]+@/.test(line) || 
                 /^[\s>|]*To:\s+[^\s]+@/.test(line) || 
                 /^[\s>|]*Subject:\s+/.test(line) || 
                 /^[\s>|]*Date:\s+/.test(line) ||
                 /^[\s>|]*Sent:\s+/.test(line)) && inQuotedSection) {
              continue;
            } else if (inQuotedSection && line.trim().length > 20 && !/^[\s>|]+/.test(line)) {
              inQuotedSection = false;
              foundQuotedMarker = false;
            }
          }
          
          if (!inQuotedSection) {
            newLines.push(line);
          } else if (isQuotedMarker) {
            break;
          }
        }
        
        emailBody = newLines.join('\n').trim();
        
        // Apply regex patterns to catch any remaining quoted content (only HTML blocks)
        for (const pattern of quotedEmailPatterns) {
          emailBody = emailBody.replace(pattern, '');
        }
        
        // Clean up multiple empty lines
        emailBody = emailBody.replace(/\n{3,}/g, '\n\n');
        
        console.log(`Cleaned email body for storage: ${emailBody.length} chars (removed quoted content and attachments)`);
      } else {
        console.log(`Email body is structured data (XML/JSON), preserving full content: ${emailBody.length} chars`);
      }
    }
   
    // Create a new email document
    const newEmail = new Email({
     
      sender: data.sender,
      recipient: data.recipient,
      subject: data.subject,
      message_id: data.message_id,
      communication_type:'email',
      parent_conversation: data.parent_conversation,
      parent_message_id: parent_message_id,
      date: new Date(data.date),
      mail_content: emailBody, // Use cleaned body without embedded attachments
      lead_id:lead_id,
      status: 'incoming',
      dealer_id: dealer_id, // Save the dealer_id in the Email document
      has_attachments: attachments.length > 0,
      attachments: attachments.length > 0 ? attachments : undefined, // Save attachment metadata with S3 URLs
      eml_file_url: data.eml_file_url || data.eml_url || undefined, // Store .eml file URL for large emails
    });

    // Save the new email to the database
    console.log('Saving email...');
    await newEmail.save();
    console.log('Email saved.');

    // Initialize an array to hold the conversation thread
    let conversationThread = [];

    // Check if there is a parent conversation
    if (data.parent_conversation) {
      // Find all emails in the parent conversation thread
      console.log('Fetching parent emails...');
      const parentEmails = await Email.find({
        $or: [
           // The parent email
          { parent_message_id: parent_message_id }, // All replies to the parent
        ],
      }).sort({ date: 1 }); // Sort by date to maintain the conversation order

      // Add the parent emails to the conversation thread
      conversationThread = [...parentEmails, ...conversationThread];
    }

    // Create a Redis connection for BullMQ
    console.log('Connecting to Redis...');
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null, // Required by BullMQ
    });
    console.log('Connected to Redis.');

    // Create a BullMQ queue
    console.log('Creating BullMQ queue...');
    const emailQueue = new Queue('emailQueue', {
      connection: redis, // Use the Redis connection
    });

    // Prepare the job data
    const jobData = {
      conversationThread: conversationThread.map((email) => ({
        message_id: email.message_id,
        parent_conversation: email.parent_conversation,
        parent_message_id:newEmail.parent_message_id,
        sender: email.sender,
        recipient: email.recipient,
        subject: email.subject,
        date: email.date,
        mail_content: email.mail_content,
        status: email.status,
        dealer_id: email.dealer_id, // Include dealer_id in the job data
        has_attachments: email.has_attachments,
        attachments: email.attachments,
      })),
      currentEmail: {
        message_id: newEmail.message_id,
        parent_conversation: newEmail.parent_conversation,
        sender: newEmail.sender,
        parent_message_id:newEmail.parent_message_id,
        recipient: newEmail.recipient,
        subject: newEmail.subject,
        date: newEmail.date,
        mail_content: newEmail.mail_content,
        status: newEmail.status,
        dealer_id: newEmail.dealer_id, // Include dealer_id in the job data
        has_attachments: newEmail.has_attachments,
        attachments: newEmail.attachments, // Include S3 URLs for attachments
      },
    };

    // Add the job to the queue
    console.log('Adding job to queue...');
    await emailQueue.add('processEmail', jobData);
    console.log('Job added to queue.');

    // Respond with a success message
    return new Response(JSON.stringify({ 
      message: 'Email logged and sent to queue', 
      data: newEmail,
      attachments_received: attachments.length,
      attachments: attachments.map(a => ({ filename: a.filename, size: a.size }))
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    // Handle any errors with comprehensive logging
    console.error('=== ERROR in /api/system ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    // Log request details
    console.error('Request details:', {
      contentType: req.headers.get('content-type'),
      method: req.method,
      url: req.url,
    });
    
    // Log parsed data (if available)
    try {
      console.error('Parsed data:', {
        sender: data?.sender,
        recipient: data?.recipient,
        subject: data?.subject,
        message_id: data?.message_id,
        body_length: data?.body?.length || 0,
        headers_length: data?.headers?.length || 0,
        attachments_count: attachments?.length || 0,
      });
      
      // Log attachment details if available
      if (attachments && attachments.length > 0) {
        console.error('Attachment details:', attachments.map(a => ({
          filename: a.filename,
          size: a.size,
          contentType: a.contentType,
          status: a.status,
          error: a.error || null
        })));
      }
    } catch (loggingError) {
      console.error('Error while logging data:', loggingError.message);
    }
    
    return new Response(JSON.stringify({ 
      message: 'Internal Server Error', 
      error: error.message,
      timestamp: new Date().toISOString(),
      // Include partial data for debugging (be careful with sensitive info in production)
      debug: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        data: {
          sender: data?.sender,
          recipient: data?.recipient,
          subject: data?.subject,
          hasBody: !!data?.body,
          hasHeaders: !!data?.headers,
          attachmentsCount: attachments?.length || 0
        }
      } : undefined
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}