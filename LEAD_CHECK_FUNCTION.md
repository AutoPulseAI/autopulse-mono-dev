# Lead Check Function Documentation

## Overview

The `checkLeadByIdentifiers` function has been added to the dealersocket library to help identify leads based on specific criteria. This function searches through imported CSV data to find matching leads using dealer ID, vendor ID, entity email/phone, and VIN.

## Function Location

- **File**: `app/lib/dealersocket-worknote.js`
- **Function**: `checkLeadByIdentifiers`
- **API Endpoint**: `app/api/leads/check/route.js`

## Usage

### Method 1: Direct Function Call

```javascript
import { checkLeadByIdentifiers } from './app/lib/dealersocket-worknote.js';

const searchCriteria = {
  dealer_id: '7250',
  vendor_id: 'your_vendor_id',
  entity_email: 'sarahfranich@icloud.com', // OR entity_phone: '1234567890'
  vin: 'your_vin_number'
};

const result = await checkLeadByIdentifiers(searchCriteria);
```

### Method 2: Using the DealerSocketWorkNote Class

```javascript
import { DealerSocketWorkNote } from './app/lib/dealersocket-worknote.js';

const client = new DealerSocketWorkNote({
  // your config
});

const result = await client.checkLeadByIdentifiers(searchCriteria);
```

### Method 3: API Endpoint

```javascript
// POST request to /api/leads/check
const response = await fetch('/api/leads/check', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    dealer_id: '7250',
    vendor_id: 'your_vendor_id',
    entity_email: 'sarahfranich@icloud.com',
    vin: 'your_vin_number'
  })
});

const result = await response.json();
```

## Parameters

### Required Parameters

- `dealer_id` (string): The dealer's site ID (e.g., '7250') - matches `source_data.SiteId`

### Optional Parameters (at least one required for contact matching)

- `entity_email` (string): Entity's email address - matches `source_data.Email`
- `entity_phone` (string): Entity's phone number (searches in WorkPhone, MobilePhone, OtherPhone)
  - Supports various formats: `+1-555-123-4567`, `15551234567`, `5551234567`, `(555) 123-4567`
  - Automatically matches with or without country code (+1)
- `vin` (string): Vehicle Identification Number - matches `source_data.VIN` (optional)
- `vendor_id` (string): The vendor ID (optional, not used in search)
- `auto_insert_work_note` (boolean): Automatically insert work note when lead is found (default: true)
- `vendor_name` (string): Vendor name for work note insertion (default: 'DealerSocket')

## Search Logic

The function searches for leads using the following criteria:

1. **Dealer ID**: Matches `source_data.SiteId` with the provided `dealer_id` (required)
2. **Email OR Phone**: 
   - If `entity_email` is provided: matches `source_data.Email`
   - If `entity_phone` is provided: matches any of `source_data.WorkPhone`, `source_data.MobilePhone`, or `source_data.OtherPhone`
   - **If both are provided**: Uses OR logic to find records matching EITHER email OR phone (or both)
     - **Smart Phone Matching**: Automatically handles various phone number formats:
       - With country code: `+1-555-123-4567`, `+1 555 123 4567`, `+1(555)123-4567`
       - Without country code: `555-123-4567`, `5551234567`, `(555) 123-4567`
       - 11-digit format: `15551234567`
       - 10-digit format: `5551234567`
3. **VIN**: Matches `source_data.VIN` with the provided `vin` (optional - if not provided, will match any VIN)
4. **Import Status**: Includes both 'imported' and 'skipped' records

### Flexible Matching
- **VIN is optional**: If not provided, the function will match leads regardless of VIN
- **Vendor ID is optional**: Not used in the search criteria
- **Contact matching**: Either email OR phone is required, but both can be provided
- **OR Logic**: If both email and phone are provided, finds records matching EITHER email OR phone (or both)
- **Automatic Work Notes**: When leads are found, automatically inserts work notes to DealerSocket (can be disabled)
- **Iframe Integration**: Work notes include iframe URLs for viewing lead details

## Response Format

### Success Response (Lead Found)

```javascript
{
  success: true,
  found: true,
  message: "Found 1 matching lead(s)",
  count: 1,
  data: [
    {
      _id: "68d0fb1ab8235cba40619ae4",
      csv_import_id: "68d0fb16b8235cba40619ac7",
      record_index: 12,
      import_status: "skipped",
      error_message: "Missing required fields",
      processed_at: "2025-09-22T07:30:34.839Z",
      entity_id: "1054802",
      event_id: "2559049",
      first_name: "",
      last_name: "",
      company_name: "",
      email: "sarahfranich@icloud.com",
      work_phone: "",
      mobile_phone: "",
      other_phone: "",
      vin: "your_vin",
      make: "",
      model: "",
      year: "",
      event_status: "220",
      event_status_desc: "0 - Unqualified",
      entity_status: "328",
      entity_status_desc: "Active",
      assigned_to: "DCPJoan",
      assigned_to_name: "Joan Joan",
      insert_date: "9/16/2025 4:18:26 PM",
      update_date: "9/16/2025 6:54:53 PM",
          dealer_info: {
            dealer_id: "7250",
            dealer_name: "Dealer Name",
            filename: "original_file.csv"
          }
        }
      ],
      work_notes: [
        {
          entity_id: "1054802",
          event_id: "2559049",
          work_note_success: true,
          work_note_message: "Work note inserted successfully"
        }
      ]
    }
```

### Success Response (No Lead Found)

```javascript
{
  success: true,
  found: false,
  message: "No matching lead found",
  data: null
}
```

### Error Response

```javascript
{
  success: false,
  found: false,
  message: "Error checking lead: [error message]",
  data: null,
  error: "[detailed error message]"
}
```

## Example Usage with Sample Data

Based on your sample data, here's how to use the function:

### Example 1: Using Email with VIN
```javascript
const searchCriteria = {
  dealer_id: '7250', // From source_data.SiteId
  entity_email: 'sarahfranich@icloud.com', // From source_data.Email
  vin: 'your_vin_number' // Optional - can be omitted
};

const result = await checkLeadByIdentifiers(searchCriteria);

if (result.success && result.found) {
  console.log(`Found lead with Entity ID: ${result.data[0].entity_id}`);
  console.log(`Event ID: ${result.data[0].event_id}`);
  // Use these IDs for further operations
}
```

### Example 1b: Using Email without VIN (Flexible Matching)
```javascript
const searchCriteria = {
  dealer_id: '7250', // From source_data.SiteId
  entity_email: 'sarahfranich@icloud.com' // Will match any lead with this email for this dealer
  // No VIN required - will find all leads with this email
};

const result = await checkLeadByIdentifiers(searchCriteria);
```

### Example 2: Using Phone Number (Smart Matching)
```javascript
// Any of these phone formats will work and match various stored formats:
const phoneExamples = [
  '+1-555-123-4567',    // International format
  '15551234567',        // 11-digit format
  '5551234567',         // 10-digit format
  '(555) 123-4567',     // Formatted with parentheses
  '555-123-4567',       // Formatted with dashes
  '+1 555 123 4567'     // International with spaces
];

const searchCriteria = {
  dealer_id: '7250',
  entity_phone: phoneExamples[0], // Any of the above formats
  vin: 'your_vin_number' // Optional
};

const result = await checkLeadByIdentifiers(searchCriteria);
```

### Example 3: API Call with Phone
```javascript
const response = await fetch('/api/leads/check', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dealer_id: '7250',
    entity_phone: '+1-555-123-4567', // Will match stored as "5551234567"
    vin: 'your_vin_number' // Optional
  })
});
```

### Example 4: Minimal Search (Email only, no VIN)
```javascript
const response = await fetch('/api/leads/check', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dealer_id: '7250',
    entity_email: 'sarahfranich@icloud.com'
    // No VIN, no vendor_id - will find all leads with this email for this dealer
  })
});
```

### Example 5: Both Email and Phone (OR Logic)
```javascript
const response = await fetch('/api/leads/check', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dealer_id: '7250',
    entity_email: 'sarahfranich@icloud.com',
    entity_phone: '+1-555-123-4567'
    // Will find leads matching EITHER email OR phone (or both) for this dealer
    // This is more flexible - finds leads even if only one contact method matches
  })
});
```

### Example 6: With Work Note Insertion
```javascript
const response = await fetch('/api/leads/check', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dealer_id: '7250',
    entity_email: 'sarahfranich@icloud.com',
    auto_insert_work_note: true, // Automatically insert work note when lead found
    vendor_name: 'YourCompanyName' // Custom vendor name for work note
  })
});

const result = await response.json();
if (result.success && result.found) {
  console.log('Leads found:', result.count);
  console.log('Work notes inserted:', result.work_notes);
}
```

### Example 7: Disable Work Note Insertion
```javascript
const response = await fetch('/api/leads/check', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dealer_id: '7250',
    entity_email: 'sarahfranich@icloud.com',
    auto_insert_work_note: false // Don't insert work notes automatically
  })
});
```

### Example 8: Iframe Integration
```javascript
const response = await fetch('/api/leads/check', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    lead_id: '507f1f77bcf86cd799439011', // Lead ID for iframe URL
    dealer_id: '7250',
    entity_email: 'sarahfranich@icloud.com',
    auto_insert_work_note: true,
    vendor_name: 'AutoPulse'
  })
});

const result = await response.json();
if (result.success && result.found) {
  console.log('Work notes with iframe URLs:', result.work_notes);
  // Each work note will contain an iframe URL like:
  // "View lead details: http://localhost:3000/iframe/lead/507f1f77bcf86cd799439011"
}
```

## Iframe Integration

The function automatically includes iframe URLs in work notes for viewing lead details:

### Iframe URL Structure
- **Format**: `/iframe/lead/[lead_id]`
- **Example**: `http://localhost:3000/iframe/lead/507f1f77bcf86cd799439011`

### Iframe Features
- Displays lead information (name, email, phone, source, status)
- Shows recent conversations
- Responsive design suitable for embedding
- Uses existing API endpoints (`/api/leads` and `/api/conversations/lead`)
- Similar styling to `viewConversations` component

### Work Note Content
```
Lead found and processed via API - Email: sarahfranich@icloud.com, Phone: N/A, VIN: N/A. View lead details: http://localhost:3000/iframe/lead/507f1f77bcf86cd799439011
```

## Testing

Test scripts are available:
- `test-lead-check.js` - Basic lead checking
- `test-flexible-matching.js` - Flexible matching scenarios  
- `test-work-note-integration.js` - Work note functionality
- `test-iframe-integration.js` - Iframe integration

To run them:
```bash
node test-lead-check.js
node test-flexible-matching.js
node test-work-note-integration.js
node test-iframe-integration.js
```

## Notes

- The function searches through the `CSVImportedData` collection
- Results are limited to 10 most recent matches
- The function includes both imported and skipped records in the search
- Phone number search is flexible and checks all phone fields
- Results are sorted by creation date (most recent first)

## Error Handling

The function includes comprehensive error handling for:
- Missing required parameters
- Database connection issues
- Invalid search criteria
- No matching records found

All errors are returned in a consistent format with appropriate error messages.
