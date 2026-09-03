// dealersocket-worknote.js
import CSVImportedData from '../models/CSVImportedData.js';
import CSVImportData from '../models/CSVImportData.js'; // Required for Mongoose population

class DealerSocketWorkNote {
    constructor(config) {
      // Only keep authentication and endpoint in config
      this.config = {
        endpoint: 'https://api.dealersocket.com/api/DealerSocket/WorkNote',
        publicKey: '723',
        privateKey: 'FC88ACFE-A851-4BA2-9AE7-FA0570AAEC54',
        ...config
      };
    }

    
  
    // HMAC-SHA256 signature creation
    async createSignature(body) {
      try {
        const { publicKey, privateKey } = this.config;
        
        if (typeof window !== 'undefined') {
          // Browser environment - using Web Crypto API
          const encoder = new TextEncoder();
          const keyData = encoder.encode(privateKey);
          const bodyData = encoder.encode(body);
          
          const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
          );
          
          const signature = await crypto.subtle.sign('HMAC', cryptoKey, bodyData);
          const hashString = btoa(String.fromCharCode(...new Uint8Array(signature)));
          
          return `${publicKey}:${hashString}`;
        } else {
          // Node.js environment
          const crypto = await import('crypto');
          const hmac = crypto.createHmac('sha256', privateKey);
          hmac.update(body);
          const hashString = hmac.digest('base64');
          return `${publicKey}:${hashString}`;
        }
      } catch (error) {
        throw new Error(`Signature creation failed: ${error.message}`);
      }
    }
  
    // Escape XML special characters
    escapeXML(str) {
      if (!str) return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    }

    // Normalize phone number by removing all non-digit characters
    normalizePhoneNumber(phone) {
      if (!phone) return '';
      return phone.replace(/\D/g, '');
    }

    // Create regex pattern for phone number matching
    createPhoneRegex(normalizedPhone) {
      if (!normalizedPhone) return '';
      
      // If the phone number is 10 digits, create patterns for both with and without country code
      if (normalizedPhone.length === 10) {
        // Match 10 digits, or 11 digits starting with 1, or with +1 prefix
        const patterns = [
          normalizedPhone, // Exact 10 digits
          `1${normalizedPhone}`, // 11 digits with 1 prefix
          `\\+1${normalizedPhone}`, // +1 prefix
          `1\\s*${normalizedPhone}`, // 1 with optional space
          `\\+1\\s*${normalizedPhone}`, // +1 with optional space
          `\\(1\\)\\s*${normalizedPhone}`, // (1) prefix
          `1-${normalizedPhone}`, // 1- prefix
          `\\+1-${normalizedPhone}`, // +1- prefix
        ];
        return new RegExp(`(${patterns.join('|')})`, 'i');
      }
      
      // If the phone number is 11 digits starting with 1, create patterns for both formats
      if (normalizedPhone.length === 11 && normalizedPhone.startsWith('1')) {
        const tenDigitPhone = normalizedPhone.substring(1);
        const patterns = [
          normalizedPhone, // Exact 11 digits
          tenDigitPhone, // 10 digits without 1
          `\\+${normalizedPhone}`, // + prefix
          `\\+1\\s*${tenDigitPhone}`, // +1 with optional space
          `1\\s*${tenDigitPhone}`, // 1 with optional space
          `\\(1\\)\\s*${tenDigitPhone}`, // (1) prefix
          `1-${tenDigitPhone}`, // 1- prefix
          `\\+1-${tenDigitPhone}`, // +1- prefix
        ];
        return new RegExp(`(${patterns.join('|')})`, 'i');
      }
      
      // For other lengths, create a more flexible pattern
      const escapedPhone = normalizedPhone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(escapedPhone, 'i');
    }
  
    // Build XML from request data - FIXED: Vendor and DealerId come from request
    buildWorkNoteXML(request) {
      const {
        Vendor,        // From request
        DealerId,      // From request
        EntityId,
        EventId,
        BatchId = 0,
        ExternalId,
        Note
      } = request;
  
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
  <WorkNoteInsert xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <Vendor>${this.escapeXML(Vendor)}</Vendor>
    <DealerId>${this.escapeXML(DealerId)}</DealerId>`;
  
      if (EntityId) {
        xml += `\n  <EntityId>${EntityId}</EntityId>`;
      }
  
      if (EventId) {
        xml += `\n  <EventId>${EventId}</EventId>`;
      }
  
      xml += `\n  <BatchId>${BatchId}</BatchId>`;
  
      if (ExternalId && ExternalId.type && ExternalId.value) {
        xml += `\n  <ExternalId type="${this.escapeXML(ExternalId.type)}">${this.escapeXML(ExternalId.value)}</ExternalId>`;
      }
  
      xml += `\n  <Note><![CDATA[${Note}]]></Note>
  </WorkNoteInsert>`;
  
      return xml;
    }
  
    // Parse XML response
    parseResponseXML(xmlText) {
      try {
        if (typeof window !== 'undefined') {
          // Browser environment
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
          
          const getTextContent = (tagName) => {
            const element = xmlDoc.getElementsByTagName(tagName)[0];
            return element ? element.textContent : null;
          };
  
          return {
            Success: getTextContent('Success') === 'true',
            ErrorCode: getTextContent('ErrorCode') || undefined,
            ErrorMessage: getTextContent('ErrorMessage') || undefined,
            StackTrace: getTextContent('StackTrace') || undefined,
          };
        } else {
          // Node.js environment - simple regex parsing for basic structure
          const successMatch = xmlText.match(/<Success>(true|false)<\/Success>/);
          const errorCodeMatch = xmlText.match(/<ErrorCode>([^<]*)<\/ErrorCode>/);
          const errorMessageMatch = xmlText.match(/<ErrorMessage>([^<]*)<\/ErrorMessage>/);
          
          return {
            Success: successMatch ? successMatch[1] === 'true' : false,
            ErrorCode: errorCodeMatch ? errorCodeMatch[1] : undefined,
            ErrorMessage: errorMessageMatch ? errorMessageMatch[1] : undefined,
            StackTrace: undefined,
          };
        }
      } catch (error) {
        return {
          Success: false,
          ErrorCode: 'XML_PARSE_ERROR',
          ErrorMessage: `Failed to parse response: ${error.message}`
        };
      }
    }
  
    // Validate configuration
    validateConfig() {
      const errors = [];
  
      if (!this.config.publicKey) errors.push('Public key is required');
      if (!this.config.privateKey) errors.push('Private key is required');
      if (!this.config.endpoint) errors.push('Endpoint is required');
  
      return {
        isValid: errors.length === 0,
        errors
      };
    }
  
    // Validate request parameters - UPDATED: Now requires Vendor and DealerId
    validateRequest(request) {
      const errors = [];
  
      if (!request.Vendor) errors.push('Vendor is required');
      if (!request.DealerId) errors.push('DealerId is required');
      if (!request.Note) errors.push('Note is required');
      
      // Validate that we have either EntityId/EventId OR ExternalId
      const hasEntityEvent = request.EntityId && request.EventId;
      const hasExternalId = request.ExternalId && request.ExternalId.type && request.ExternalId.value;
      
      if (!hasEntityEvent && !hasExternalId) {
        errors.push('Either EntityId/EventId combination or ExternalId with type is required');
      }
  
      return {
        isValid: errors.length === 0,
        errors
      };
    }
  
    // Main function to insert work note - UPDATED: Now accepts Vendor and DealerId in request
    async insertWorkNote(request) {
      try {
        // Validate configuration
        const configValidation = this.validateConfig();
        if (!configValidation.isValid) {
          throw new Error(`Configuration invalid: ${configValidation.errors.join(', ')}`);
        }
  
        // Validate request
        const requestValidation = this.validateRequest(request);
        if (!requestValidation.isValid) {
          throw new Error(`Request invalid: ${requestValidation.errors.join(', ')}`);
        }
  
        // Build XML
        const xmlBody = this.buildWorkNoteXML(request);
  
        // Create authentication signature
        const authSignature = await this.createSignature(xmlBody);
  
        // Make API request
        const response = await fetch(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/xml',
            'Authentication': authSignature,
          },
          body: xmlBody,
        });
  
        const responseText = await response.text();
        
        if (!response.ok) {
          // Parse the XML response to get the real error message
          const parsedResponse = this.parseResponseXML(responseText);
          if (parsedResponse.ErrorMessage) {
            throw new Error(`DealerSocket API Error: ${parsedResponse.ErrorMessage}`);
          }
          
          if (response.status === 401) {
            throw new Error('Authentication failed - 401 Unauthorized');
          }
          if (response.status === 403) {
            throw new Error('Authentication failed - 403 Forbidden');
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        return this.parseResponseXML(responseText);
  
      } catch (error) {
        console.error('Error inserting work note:', error);
        return {
          Success: false,
          ErrorCode: 'CLIENT_ERROR',
          ErrorMessage: error.message
        };
      }
    }
  
    // Utility method to test connection
    async testConnection(vendor, dealerId) {
      try {
        const testRequest = {
          Vendor: vendor,
          DealerId: dealerId,
          EntityId: 999999, // Non-existent ID for testing
          EventId: 999999,
          Note: 'Test connection work note'
        };
  
        const result = await this.insertWorkNote(testRequest);
        
        // Even if it fails with expected errors, the connection worked
        if (result.ErrorCode && result.ErrorCode.includes('INVALID')) {
          return { connected: true, message: 'Connection successful - received expected error response' };
        }
        
        return { connected: true, message: 'Connection successful' };
      } catch (error) {
        return { connected: false, message: `Connection failed: ${error.message}` };
      }
    }

    // Method to check lead by identifiers (dealer_id, entity email/phone, optional VIN)
    async checkLeadByIdentifiers(searchCriteria) {
      try {
        const { lead_id, dealer_id,frenchise_id, entity_email, entity_phone, vin, auto_insert_work_note = true, vendor_name = 'AutoPulse' } = searchCriteria;
        
        // Validate required parameters
        if (!dealer_id) {
          throw new Error('dealer_id is required');
        }
        
        if (!entity_email && !entity_phone) {
          throw new Error('Either entity_email or entity_phone is required');
        }

        // Models are already imported at the top of the file
        
        // Build search query for CSVImportedData
        // Base conditions: dealer_id and franchise_id are required
        const searchQuery = {
          'source_data.SiteId': dealer_id,
        };
        
        // Add franchise condition only if provided
        if (frenchise_id) {
          searchQuery['source_data.Franchise'] = frenchise_id;
        }
        
        // Build OR conditions for email or phone matching (required for matching)
        const orConditions = [];
        
        if (entity_email) {
          orConditions.push({ 'source_data.Email': entity_email });
        }
        
        if (entity_phone) {
          // Normalize the input phone number
          const normalizedInputPhone = this.normalizePhoneNumber(entity_phone);
          const phoneRegex = this.createPhoneRegex(normalizedInputPhone);
          
          // Add each phone field as a separate OR condition
          orConditions.push({ 'source_data.WorkPhone': { $regex: phoneRegex } });
          orConditions.push({ 'source_data.MobilePhone': { $regex: phoneRegex } });
          orConditions.push({ 'source_data.OtherPhone': { $regex: phoneRegex } });
        }
        
        // Email or phone matching is required - add to query
        if (orConditions.length > 0) {
          searchQuery.$or = orConditions;
        }
        
        // Add VIN condition only if provided (optional additional filter)
        if (vin) {
          searchQuery['source_data.VIN'] = vin;
        }
        
        // Find matching records
        const matchingRecords = await CSVImportedData.find(searchQuery)
          .sort({ createdAt: -1 })
          .limit(1); // Limit to 10 most recent matches
        
        if (matchingRecords.length === 0) {
          return {
            success: true,
            found: false,
            message: 'No matching lead found',
            data: null
          };
        }
        
        // Process the results to extract relevant information
        const processedResults = matchingRecords.map(record => {
          const sourceData = record.source_data;
          return {
            _id: record._id,
            csv_import_id: record.csv_import_id,
            record_index: record.record_index,
            import_status: record.import_status,
            error_message: record.error_message,
            processed_at: record.processed_at,
            entity_id: sourceData.EntityId,
            event_id: sourceData.EventId,
            first_name: sourceData.FirstName,
            last_name: sourceData.LastName,
            company_name: sourceData.CompanyName,
            email: sourceData.Email,
            work_phone: sourceData.WorkPhone,
            mobile_phone: sourceData.MobilePhone,
            other_phone: sourceData.OtherPhone,
            vin: sourceData.VIN,
            make: sourceData.Make,
            model: sourceData.Model,
            year: sourceData.Year,
            franchise: sourceData.Franchise,
            event_status: sourceData.EventStatus,
            event_status_desc: sourceData.EventStatusDesc,
            entity_status: sourceData.EntityStatus,
            entity_status_desc: sourceData.EntityStatusDesc,
            assigned_to: sourceData.AssignedTo,
            assigned_to_name: sourceData.AssignedToName,
            insert_date: sourceData.InsertDate,
            update_date: sourceData.UpdateDate,
            dealer_info: {
              dealer_id: record.csv_import_id?.dealer_id,
              dealer_name: record.csv_import_id?.dealer_name,
              filename: record.csv_import_id?.original_filename
            }
          };
        });
        
        // If records found, automatically insert work note for each record (if enabled)
        const workNoteResults = [];
        if (matchingRecords.length > 0 && auto_insert_work_note) {
          for (const record of processedResults) {
            try {
              // Create iframe URL for lead details
              const iframeUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/iframe/lead/${lead_id}`;
              
              // Check if iframeUrl is already in CDATA structure, if not wrap it
              //const isCDATAStructure = iframeUrl.includes('<![CDATA[') && iframeUrl.includes(']]>');
              const formattedIframeUrl =  `<a href=${iframeUrl}>Autopulse</a>`;
              
              const workNoteRequest = {
                Vendor: vendor_name,
                DealerId: dealer_id+'_'+record.franchise, // Just the dealership ID, not with franchise
                EntityId: record.entity_id,
                EventId: record.event_id,
                BatchId: 0, // Required field, usually set to 0
                Note: `${formattedIframeUrl}`
              };
              
              const workNoteResult = await this.insertWorkNote(workNoteRequest);
              workNoteResults.push({
                entity_id: record.entity_id,
                event_id: record.event_id,
                work_note_success: workNoteResult.Success,
                work_note_message: workNoteResult.Success ? 'Work note inserted successfully' : workNoteResult.ErrorMessage
              });
            } catch (workNoteError) {
              workNoteResults.push({
                entity_id: record.entity_id,
                event_id: record.event_id,
                work_note_success: false,
                work_note_message: `Work note failed: ${workNoteError.message}`
              });
            }
          }
        }

        return {
          success: true,
          found: true,
          message: `Found ${matchingRecords.length} matching lead(s)`,
          data: processedResults,
          count: matchingRecords.length,
          work_notes: workNoteResults
        };
        
      } catch (error) {
        console.error('Error checking lead:', error);
        return {
          success: false,
          found: false,
          message: `Error checking lead: ${error.message}`,
          data: null,
          error: error.message
        };
      }
    }
  }
  
  // React Hook for use in Next.js components
  const useWorkNote = (config) => {
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(null);
    const [lastResponse, setLastResponse] = React.useState(null);
  
    const client = new DealerSocketWorkNote(config);
  
    const insertWorkNote = async (request) => {
      setLoading(true);
      setError(null);
  
      try {
        const response = await client.insertWorkNote(request);
        setLastResponse(response);
        
        if (!response.Success) {
          throw new Error(response.ErrorMessage || 'Unknown error occurred');
        }
  
        return response;
      } catch (err) {
        const errorMessage = err.message || 'Unknown error occurred';
        setError(errorMessage);
        throw err;
      } finally {
        setLoading(false);
      }
    };
  
    return {
      insertWorkNote,
      loading,
      error,
      lastResponse,
    };
  };
  
  // Pre-configured instances (now only contain auth credentials, not vendor/dealer info)
  const productionClient = new DealerSocketWorkNote({
    endpoint: 'https://api.dealersocket.com/api/DealerSocket/WorkNote',
    publicKey: '723',
    privateKey: 'FC88ACFE-A851-4BA2-9AE7-FA0570AAEC54',
  });
  
  const testClient = new DealerSocketWorkNote({
    endpoint: 'https://test-api.dealersocket.com/api/DealerSocket/WorkNote',
    publicKey: '723',
    privateKey: 'FC88ACFE-A851-4BA2-9AE7-FA0570AAEC54',
  });
  

  // Wrapper function to use the class method for easier importing
  const checkLeadByIdentifiers = async (searchCriteria) => {
    const client = new DealerSocketWorkNote();
    return await client.checkLeadByIdentifiers(searchCriteria);
  };
    
    // Common error codes for reference
  const ERROR_CODES = {
      MISSING_VENDOR_NAME: 'MISSING_VENDOR_NAME',
      MISSING_DEALER_NUMBER: 'MISSING_DEALER_NUMBER',
      INVALID_DEALER_NUMBER: 'INVALID_DEALER_NUMBER',
      ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
      NO_DATA: 'NO_DATA',
      EVENTID_INVALID: 'EVENTID_INVALID',
      EVENTID_ENTITYID: 'EVENTID_ENTITYID',
      ENTITYID_INVALID: 'ENTITYID_INVALID',
      EXTERNALID_INVALID: 'EXTERNALID_INVALID'
  };

  // Export everything
  export {
    DealerSocketWorkNote,
    useWorkNote,
    productionClient,
    testClient,
    checkLeadByIdentifiers,
    ERROR_CODES
  };