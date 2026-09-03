/**
 * Helper function to download and parse .eml file from S3
 * @param {string} emlUrl - S3 URL of the .eml file
 * @returns {Promise<Object>} Parsed email data
 */
export async function parseEmlFromS3(emlUrl) {
  try {
    if (!emlUrl) {
      throw new Error('EML URL is required');
    }

    console.log(`Downloading .eml file from: ${emlUrl}`);
    
    // Download the .eml file
    const response = await fetch(emlUrl);
    if (!response.ok) {
      throw new Error(`Failed to download .eml file: ${response.statusText}`);
    }

    const emlContent = await response.text();
    console.log(`Downloaded .eml file (${emlContent.length} bytes)`);

    // Parse the .eml file
    // Split headers and body
    const headerBodySplit = emlContent.indexOf('\n\n');
    const headers = headerBodySplit > 0 ? emlContent.substring(0, headerBodySplit) : '';
    const body = headerBodySplit > 0 ? emlContent.substring(headerBodySplit + 2) : emlContent;

    // Extract key headers
    const getHeader = (name) => {
      const regex = new RegExp(`^${name}:\\s*(.+)$`, 'im');
      const match = headers.match(regex);
      return match ? match[1].trim() : '';
    };

    return {
      headers: headers,
      body: body,
      sender: getHeader('From'),
      recipient: getHeader('To'),
      subject: getHeader('Subject'),
      message_id: getHeader('Message-ID'),
      date: getHeader('Date'),
      raw: emlContent,
    };
  } catch (error) {
    console.error('Error parsing .eml file:', error);
    throw error;
  }
}

/**
 * Extract attachments from .eml file
 * @param {string} emlContent - Raw .eml file content
 * @returns {Array} Array of attachment objects
 */
export function extractAttachmentsFromEml(emlContent) {
  const attachments = [];
  
  // This is a simplified parser - for production, use a proper MIME parser like mailparser
  // For now, this is a placeholder that can be enhanced
  
  try {
    // Check if multipart
    if (emlContent.includes('Content-Type: multipart/')) {
      // Extract boundary
      const boundaryMatch = emlContent.match(/boundary="?([^";\s]+)"?/i);
      if (boundaryMatch) {
        const boundary = boundaryMatch[1];
        const parts = emlContent.split(`--${boundary}`);
        
        for (const part of parts) {
          if (part.includes('Content-Disposition: attachment') || 
              part.includes('Content-Disposition: inline')) {
            // Extract filename
            const filenameMatch = part.match(/filename="?([^"]+)"?/i);
            const contentTypeMatch = part.match(/Content-Type:\s*([^\n]+)/i);
            
            if (filenameMatch) {
              attachments.push({
                filename: filenameMatch[1],
                contentType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
                // Note: Actual file content would need to be extracted from the part
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error extracting attachments from .eml:', error);
  }
  
  return attachments;
}

