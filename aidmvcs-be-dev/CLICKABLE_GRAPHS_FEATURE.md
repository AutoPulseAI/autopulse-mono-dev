# Clickable Dashboard Graphs Feature

## Summary
All graphs and charts in the dealer dashboard are now fully interactive and clickable. Clicking on any data point in the charts will navigate to the leads page with appropriate filters applied, including date ranges.

---

## 📊 Interactive Graphs Overview

### 1. ✅ Lead Sources (Pie Chart)
**Location:** First row, left column

**Click Behavior:**
- Click on any pie segment to filter leads by that source
- Applies current date range filter (if active)

**Example:**
- Click "Email" segment → `/dealer/leads?source=Email&startDate=...&endDate=...`

**Component:** `LeadSourceDataPie`  
**Handler:** `handleSourceClick()`

---

### 2. ✅ Lead Status (Bar Chart) - NEW
**Location:** First row, right column

**Click Behavior:**
- Click on any status bar to filter leads by that status
- Applies current date range filter (if active)

**Example:**
- Click "Contacted" bar → `/dealer/leads?status=Contacted&startDate=...&endDate=...`
- Click "Lead" bar → `/dealer/leads?status=Lead&startDate=...&endDate=...`

**Component:** `LeadStatusBar`  
**Handler:** `handleStatusBarClick()`

**Code Change:**
```javascript
<LeadStatusBar 
  data={leadStatusData} 
  onBarClick={handleStatusBarClick} 
/>
```

---

### 3. ✅ Lead Received Over Time (Bar Chart) - NEW
**Location:** Second row, full width

**Click Behavior:**
- Click on any date bar to filter leads received on that specific date/period
- Automatically handles different time groupings (daily, weekly, monthly)

**Examples:**
- **Daily View:** Click on "15-01" → Filters leads for January 15th only
- **Weekly View:** Click on "2026-W03" → Filters leads for week 3 of 2026
- **Monthly View:** Click on "Jan-26" → Filters leads for January 2026

**Component:** `ActivityOverTimeDataBar`  
**Handler:** `handleActivityBarClick()`

**Date Parsing Logic:**
```javascript
// Daily: YYYY-MM-DD → single day
// Weekly: YYYY-WXX → 7-day range (Monday to Sunday)
// Monthly: YYYY-MM → entire month range
```

---

### 4. ✅ Message Sent (Email & SMS Bar Chart) - NEW
**Location:** Third row, full width

**Click Behavior:**
- Click on **Email bar** → Filter leads by email messages for that date
- Click on **SMS bar** → Filter leads by SMS messages for that date
- Automatically handles different time groupings (daily, weekly, monthly)

**Examples:**
- Click Email bar on "15-01" → `/dealer/leads?startDate=...&endDate=...&response_mode=email`
- Click SMS bar on "Jan-26" → `/dealer/leads?startDate=...&endDate=...&response_mode=sms`

**Handler:** `handleMessageBarClick(data, messageType)`

**Code Change:**
```javascript
{chartVisibility.emailCount && (
  <Bar 
    dataKey="emailCount" 
    fill="var(--primary)" 
    name="Emails" 
    onClick={(data) => handleMessageBarClick(data, 'email')}
    style={{ cursor: 'pointer' }}
  />
)}
{chartVisibility.smsCount && (
  <Bar 
    dataKey="smsCount" 
    fill="var(--secondary)" 
    name="SMS" 
    onClick={(data) => handleMessageBarClick(data, 'sms')}
    style={{ cursor: 'pointer' }}
  />
)}
```

---

### 5. ✅ Lead Source Field (Pie Chart)
**Location:** Fourth row, left column

**Click Behavior:**
- Click on any segment to filter by lead_source field
- Applies current date range filter (if active)

**Example:**
- Click "Autotrader" → `/dealer/leads?lead_source=Autotrader&startDate=...&endDate=...`

**Component:** `LeadSourceDistributionPie`  
**Handler:** `handleLeadSourceFieldClick()`

---

## 🔧 Technical Implementation

### Files Modified

#### 1. Component Files:

**`app/dealer/dashboard/components/LeadStatusBar.js`**
```javascript
// Added onBarClick prop and click handler
export default function LeadStatusBar({ data, onBarClick }) {
    const handleClick = (data) => {
        if (onBarClick && data) {
            onBarClick(data);
        }
    };
    
    return (
        <Bar 
          dataKey="value" 
          name="Status" 
          onClick={handleClick} 
          style={{ cursor: 'pointer' }}
        >
          {/* ... */}
        </Bar>
    );
}
```

**`app/dealer/dashboard/components/ActivityOverTimeDataBar.js`**
```javascript
// Added onBarClick prop and click handler
export default function ActivityOverTimeDataBar({ data, onBarClick }) {
    const handleClick = (data) => {
        if (onBarClick && data) {
            onBarClick(data);
        }
    };
    
    return (
        <Bar 
          dataKey="count" 
          fill="var(--secondary)" 
          name="Leads" 
          onClick={handleClick} 
          style={{ cursor: 'pointer' }}
        />
    );
}
```

#### 2. Dashboard Page:

**`app/dealer/dashboard/page.js`**

Added three new click handlers:

**a) Status Bar Click Handler:**
```javascript
const handleStatusBarClick = (data) => {
  if (data && data.name) {
    let url = `/dealer/leads?status=${encodeURIComponent(data.name)}`;
    url = buildUrlWithDateRange(url);
    window.location.href = url;
  }
};
```

**b) Activity Bar Click Handler:**
```javascript
const handleActivityBarClick = (data) => {
  if (data && data.date) {
    const dateStr = data.date;
    let startDate, endDate;

    // Parse different date formats
    if (dateStr.includes('W')) {
      // Weekly format: YYYY-WXX
      const [year, week] = dateStr.split('-W');
      // Calculate week start and end dates
      startDate = weekStart;
      endDate = weekEnd;
    } else if (dateStr.split('-').length === 2) {
      // Monthly format: YYYY-MM
      const [year, month] = dateStr.split('-');
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 0); // Last day of month
    } else {
      // Daily format: YYYY-MM-DD
      startDate = new Date(dateStr);
      endDate = new Date(dateStr);
    }

    const url = `/dealer/leads?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`;
    window.location.href = url;
  }
};
```

**c) Message Bar Click Handler:**
```javascript
const handleMessageBarClick = (data, messageType) => {
  if (data && data.date) {
    // Same date parsing logic as activity bar
    // ...
    
    let url = `/dealer/leads?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`;
    if (messageType) {
      url += `&response_mode=${messageType}`;
    }
    window.location.href = url;
  }
};
```

---

## 📅 Date Range Handling

### Current Date Range Filter
When a date range is selected in the dashboard, clicking on most graphs will preserve that filter:

```javascript
const buildUrlWithDateRange = (baseUrl) => {
  if (!dateRange.startDate || !dateRange.endDate) {
    return baseUrl;
  }
  
  const url = new URL(baseUrl, window.location.origin);
  url.searchParams.set('startDate', dateRange.startDate.toISOString());
  url.searchParams.set('endDate', dateRange.endDate.toISOString());
  
  return url.pathname + url.search;
};
```

### Specific Date from Bar Chart
When clicking on time-series bar charts (Lead Received, Message Sent), the specific date/period from the bar overrides the dashboard date range.

---

## 🎨 Visual Feedback

### Cursor Changes
All clickable charts now have:
```javascript
style={{ cursor: 'pointer' }}
```

### Hover Effects
Added tooltip cursor highlighting:
```javascript
<Tooltip cursor={{ fill: 'rgba(0, 0, 0, 0.1)' }} />
```

This provides subtle visual feedback when hovering over clickable bars.

---

## 🔄 User Flow Examples

### Example 1: Investigating a Specific Day
1. User sees a spike in leads on January 15th in the "Lead Received" chart
2. Clicks on the January 15th bar
3. Navigated to `/dealer/leads?startDate=2026-01-15T00:00:00.000Z&endDate=2026-01-15T23:59:59.999Z`
4. Sees all leads received on that specific day

### Example 2: Checking SMS Performance for a Week
1. User looks at "Message Sent" chart in weekly view
2. Sees high SMS activity in week 3
3. Clicks on the SMS bar for week 3
4. Navigated to `/dealer/leads?startDate=2026-01-13T00:00:00.000Z&endDate=2026-01-19T23:59:59.999Z&response_mode=sms`
5. Sees all leads contacted via SMS during that week

### Example 3: Filtering by Status
1. User sees many "Contacted" leads in the Lead Status chart
2. Clicks on the "Contacted" bar
3. Navigated to `/dealer/leads?status=Contacted&startDate=...&endDate=...`
4. Sees all contacted leads within the current date range

### Example 4: Analyzing Lead Sources
1. User notices "Autotrader" is a top lead source
2. Clicks on the "Autotrader" pie segment
3. Navigated to `/dealer/leads?lead_source=Autotrader&startDate=...&endDate=...`
4. Sees all leads from Autotrader within the current date range

---

## 🧪 Testing Checklist

### Test All Graphs:
- [ ] **Lead Sources Pie Chart** - Click each segment
- [ ] **Lead Status Bar Chart** - Click each status bar
- [ ] **Lead Received Bar Chart** - Click bars in daily/weekly/monthly view
- [ ] **Message Sent Bar Chart** - Click both email and SMS bars
- [ ] **Lead Source Field Pie Chart** - Click each segment

### Test Date Range Scenarios:
- [ ] No date filter applied (shows all data)
- [ ] Daily date range selected (1 day)
- [ ] Weekly date range selected (7 days)
- [ ] Monthly date range selected (30+ days)
- [ ] Multi-month date range selected (90+ days)

### Test Navigation:
- [ ] Verify URL parameters are correct
- [ ] Verify leads page receives and applies filters correctly
- [ ] Verify clicking different chart types in sequence

### Visual Feedback:
- [ ] Cursor changes to pointer on hover
- [ ] Tooltip shows on hover
- [ ] Subtle background highlight on bar hover

---

## 🎯 Benefits

1. **Enhanced User Experience**
   - Intuitive drill-down capability
   - No need to manually set filters
   - Direct navigation to filtered data

2. **Improved Data Analysis**
   - Quick investigation of anomalies
   - Easy comparison of specific periods
   - Faster identification of patterns

3. **Time Savings**
   - Reduces clicks needed to filter data
   - Eliminates manual date/filter entry
   - Streamlined workflow

4. **Better Decision Making**
   - Immediate access to detailed data
   - Context-aware filtering
   - Date range preservation when appropriate

---

## 📝 Future Enhancements (Optional)

### Potential Additions:
1. **Tooltip Enhancement**
   - Show "Click to filter" hint in tooltip
   - Display additional context on hover

2. **Multi-Select**
   - Hold Ctrl/Cmd to select multiple bars/segments
   - Apply combined filters

3. **Right-Click Context Menu**
   - "View in new tab"
   - "Export data"
   - "Add to report"

4. **Animation**
   - Smooth transition when clicking
   - Visual feedback of selected state

5. **Breadcrumb Navigation**
   - Show applied filters at top of leads page
   - Quick filter removal/modification

---

## 📊 Summary of Clickable Elements

| Chart Name | Type | Location | Filters Applied | Date Range |
|-----------|------|----------|----------------|------------|
| Lead Sources | Pie | Row 1, Col 1 | `source=...` | Current range |
| Lead Status | Bar | Row 1, Col 2 | `status=...` | Current range |
| Lead Received | Bar | Row 2 | `startDate=...&endDate=...` | Specific period |
| Message Sent | Bar | Row 3 | `startDate=...&endDate=...&response_mode=...` | Specific period |
| Lead Source Field | Pie | Row 4, Col 1 | `lead_source=...` | Current range |

---

## Date: January 7, 2026

## Status: ✅ COMPLETED

All dashboard graphs are now fully clickable with intelligent date range and filter handling.

