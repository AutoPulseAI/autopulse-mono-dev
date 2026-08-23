# DealerSocket Work Note Matching Flow

## Overview
This document explains how the data from the followup route matches with DealerSocket records and how work notes are inserted.

---

## 📊 Data Flow Diagram

```
Followup Route (PUT /api/conversations/followup)
    ↓
Creates workNoteCriteria (lines 232-241)
    ↓
Calls checkLeadByIdentifiers(workNoteCriteria) (line 243)
    ↓
Searches CSVImportedData collection (lines 328-368)
    ↓
Finds matching records (lines 380-417)
    ↓
Inserts work notes via DealerSocket API (lines 419-456)
    ↓
Returns work_notes array with results (lines 441-446)
```

---

## 🔍 Step-by-Step Matching Process

### Step 1: Followup Route Creates Search Criteria
**File:** `app/api/conversations/followup/route.js` (lines 232-241)

**Input Data from Followup:**
```javascript
const workNoteCriteria = {
  lead_id: updatedLead._id?.toString(),                    // '69555b2470f1e63603c46fd1'
  dealer_id: updatedDealer.dealer_account_information.dealersocket_dealerid,  // '10362'
  frenchise_id: updatedDealer.dealer_account_information.dealersocket_frenchiseid,  // '1'
  entity_email: updatedLead.email,                         // 'leads@victorymitsubishi-com.autopulsemail.com'
  entity_phone: updatedLead.phone,                         // 'truecar@leads.truecarmail.com' (NOTE: This looks like email, not phone!)
  vin: updatedLead.vin || null,                           // '5YJ3E1EA1MF076582'
  auto_insert_work_note: true,
  vendor_name: 'AutoPulse'
};
```

**Log Output (89412-89421):**
```
DealerSocket work note criteria (followup): {
  lead_id: '69555b2470f1e63603c46fd1',
  dealer_id: '10362',
  frenchise_id: '1',
  entity_email: 'leads@victorymitsubishi-com.autopulsemail.com',
  entity_phone: 'truecar@leads.truecarmail.com',  // ⚠️ This appears to be an email, not a phone!
  vin: '5YJ3E1EA1MF076582',
  auto_insert_work_note: true,
  vendor_name: 'AutoPulse'
}
```

---

### Step 2: checkLeadByIdentifiers Searches for Matches
**File:** `app/lib/dealersocket-worknote.js` (lines 312-368)

**Search Query Construction:**
```javascript
// Base query - always includes dealer_id and franchise_id
const searchQuery = {
  'source_data.SiteId': dealer_id,        // '10362'
  'source_data.Franchise': frenchise_id,  // '1'
};

// Add VIN if provided
if (vin) {
  searchQuery['source_data.VIN'] = vin;  // '5YJ3E1EA1MF076582'
}

// Add email or phone condition (OR logic)
const orConditions = [];

if (entity_email) {
  orConditions.push({ 
    'source_data.Email': entity_email  // 'leads@victorymitsubishi-com.autopulsemail.com'
  });
}

if (entity_phone) {
  // Normalize phone number
  const normalizedInputPhone = this.normalizePhoneNumber(entity_phone);
  
  // Search in WorkPhone, MobilePhone, or OtherPhone fields
  orConditions.push({
    $or: [
      { 'source_data.WorkPhone': { $regex: this.createPhoneRegex(normalizedInputPhone) } },
      { 'source_data.MobilePhone': { $regex: this.createPhoneRegex(normalizedInputPhone) } },
      { 'source_data.OtherPhone': { $regex: this.createPhoneRegex(normalizedInputPhone) } }
    ]
  });
}

// Final query combines all conditions
if (orConditions.length > 0) {
  searchQuery.$or = orConditions;
}
```

**MongoDB Query Executed:**
```javascript
CSVImportedData.find({
  'source_data.SiteId': '10362',
  'source_data.Franchise': '1',
  'source_data.VIN': '5YJ3E1EA1MF076582',  // If VIN provided
  $or: [
    { 'source_data.Email': 'leads@victorymitsubishi-com.autopulsemail.com' },
    // OR phone matching (if entity_phone is a valid phone number)
  ]
})
.sort({ createdAt: -1 })
.limit(10)
```

---

### Step 3: Matching Records Found
**File:** `app/lib/dealersocket-worknote.js` (lines 380-417)

**Processed Results:**
For each matching record, the function extracts:
```javascript
{
  entity_id: sourceData.EntityId,    // '1884648' ← From CSVImportedData
  event_id: sourceData.EventId,      // '2614974' ← From CSVImportedData
  // ... other fields
}
```

---

### Step 4: Work Note Insertion
**File:** `app/lib/dealersocket-worknote.js` (lines 419-456)

**For Each Matching Record:**
```javascript
// Create iframe URL
const iframeUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/iframe/lead/${lead_id}`;
const formattedIframeUrl = `<a href=${iframeUrl}>Autopulse</a>`;

// Build work note request
const workNoteRequest = {
  Vendor: vendor_name,                    // 'AutoPulse'
  DealerId: dealer_id + '_' + record.franchise,  // '10362_1'
  EntityId: record.entity_id,            // '1884648' ← From matched record
  EventId: record.event_id,              // '2614974' ← From matched record
  BatchId: 0,
  Note: `${formattedIframeUrl}`          // '<a href=...>Autopulse</a>'
};

// Insert work note via DealerSocket API
const workNoteResult = await this.insertWorkNote(workNoteRequest);

// Store result
workNoteResults.push({
  entity_id: record.entity_id,          // '1884648'
  event_id: record.event_id,            // '2614974'
  work_note_success: workNoteResult.Success,  // true
  work_note_message: workNoteResult.Success 
    ? 'Work note inserted successfully' 
    : workNoteResult.ErrorMessage
});
```

---

### Step 5: Return Results
**File:** `app/lib/dealersocket-worknote.js` (lines 458-465)

**Return Value:**
```javascript
return {
  success: true,
  found: true,
  message: `Found ${matchingRecords.length} matching lead(s)`,
  data: processedResults,
  count: matchingRecords.length,
  work_notes: workNoteResults  // Array of work note insertion results
};
```

**Log Output (89443-89448):**
```
{
  entity_id: '1884648',              // ← Extracted from matched CSVImportedData record
  event_id: '2614974',               // ← Extracted from matched CSVImportedData record
  work_note_success: true,            // ← DealerSocket API returned Success: true
  work_note_message: 'Work note inserted successfully'
}
```

---

## 🔗 How the Data Matches

### Matching Criteria:
1. **Dealer ID Match:** `dealer_id: '10362'` → `source_data.SiteId: '10362'`
2. **Franchise ID Match:** `frenchise_id: '1'` → `source_data.Franchise: '1'`
3. **VIN Match (if provided):** `vin: '5YJ3E1EA1MF076582'` → `source_data.VIN: '5YJ3E1EA1MF076582'`
4. **Email OR Phone Match:**
   - `entity_email: 'leads@victorymitsubishi-com.autopulsemail.com'` → `source_data.Email`
   - OR `entity_phone` (normalized) → `source_data.WorkPhone/MobilePhone/OtherPhone`

### Result Extraction:
Once a match is found in `CSVImportedData`, the function extracts:
- **EntityId** → `entity_id: '1884648'`
- **EventId** → `event_id: '2614974'`

These are then used to insert the work note into DealerSocket.

---

## ⚠️ Important Notes

### 1. Phone Number Issue
**Observation:** In the log, `entity_phone` is set to `'truecar@leads.truecarmail.com'`, which appears to be an email address, not a phone number.

**Impact:**
- The phone matching logic will normalize this string (remove non-digits)
- If it results in an empty string, phone matching won't work
- Matching will rely on email and VIN only

**Recommendation:**
Check why `lead.phone` contains an email address. This might be a data quality issue.

### 2. Matching Logic
The matching uses **AND** logic for:
- `SiteId` (dealer_id)
- `Franchise` (frenchise_id)
- `VIN` (if provided)

And **OR** logic for:
- `Email` OR `Phone` (WorkPhone/MobilePhone/OtherPhone)

### 3. Multiple Matches
The function can find up to 10 matching records (`.limit(10)`). If multiple matches are found, work notes are inserted for **all** of them.

---

## 📋 Complete Data Flow Example

### Input (from followup route):
```javascript
{
  lead_id: '69555b2470f1e63603c46fd1',
  dealer_id: '10362',
  frenchise_id: '1',
  entity_email: 'leads@victorymitsubishi-com.autopulsemail.com',
  entity_phone: 'truecar@leads.truecarmail.com',  // ⚠️ Email, not phone
  vin: '5YJ3E1EA1MF076582',
  auto_insert_work_note: true,
  vendor_name: 'AutoPulse'
}
```

### MongoDB Query:
```javascript
CSVImportedData.find({
  'source_data.SiteId': '10362',
  'source_data.Franchise': '1',
  'source_data.VIN': '5YJ3E1EA1MF076582',
  $or: [
    { 'source_data.Email': 'leads@victorymitsubishi-com.autopulsemail.com' }
    // Phone matching skipped (entity_phone is email)
  ]
})
```

### Matched Record (from CSVImportedData):
```javascript
{
  source_data: {
    SiteId: '10362',
    Franchise: '1',
    VIN: '5YJ3E1EA1MF076582',
    Email: 'leads@victorymitsubishi-com.autopulsemail.com',
    EntityId: '1884648',    // ← Extracted
    EventId: '2614974'      // ← Extracted
  }
}
```

### Work Note Request (to DealerSocket API):
```javascript
{
  Vendor: 'AutoPulse',
  DealerId: '10362_1',
  EntityId: '1884648',      // ← From matched record
  EventId: '2614974',       // ← From matched record
  BatchId: 0,
  Note: '<a href=http://localhost:3000/iframe/lead/69555b2470f1e63603c46fd1>Autopulse</a>'
}
```

### Output (returned to followup route):
```javascript
{
  success: true,
  found: true,
  message: 'Found 1 matching lead(s)',
  data: [/* processedResults */],
  count: 1,
  work_notes: [
    {
      entity_id: '1884648',              // ← From matched record
      event_id: '2614974',                // ← From matched record
      work_note_success: true,             // ← DealerSocket API success
      work_note_message: 'Work note inserted successfully'
    }
  ]
}
```

---

## 🔧 Code Locations

### Followup Route:
- **File:** `app/api/conversations/followup/route.js`
- **Lines:** 224-252 (DealerSocket work note section)

### Matching Function:
- **File:** `app/lib/dealersocket-worknote.js`
- **Function:** `checkLeadByIdentifiers()` (lines 312-477)
- **Search Query:** Lines 328-363
- **Work Note Insertion:** Lines 419-456

### DealerSocket API Call:
- **File:** `app/lib/dealersocket-worknote.js`
- **Function:** `insertWorkNote()` (lines 227-285)
- **XML Building:** `buildWorkNoteXML()` (lines 113-147)

---

## 🐛 Potential Issues

### 1. Phone Number Contains Email
**Issue:** `entity_phone: 'truecar@leads.truecarmail.com'` is not a valid phone number.

**Fix:** Validate phone numbers before passing to `checkLeadByIdentifiers()`.

### 2. Multiple Matches
**Issue:** If multiple records match, work notes are inserted for all of them.

**Consideration:** This might be intentional, but could result in duplicate work notes.

### 3. VIN Matching
**Issue:** VIN matching is strict (exact match). If VIN format differs, matching fails.

**Consideration:** Consider normalizing VINs (uppercase, remove spaces) before matching.

---

## 📅 Date: January 7, 2026

## Status: ✅ DOCUMENTED

Complete flow from followup route to DealerSocket work note insertion is now documented.

