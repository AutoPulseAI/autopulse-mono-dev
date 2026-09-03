# New Lead This Week - Always Show Current Week Count

## Summary
Updated the "New Lead This Week" metric to always display the count for the **current week** (Monday to Sunday), regardless of any date range filters applied to the dashboard. This ensures users always see the most recent week's new leads, similar to how Managerial Review always shows the total count.

---

## ✅ Changes Completed

### 1. **Dashboard Component** (`app/dealer/dashboard/page.js`)

**Added State:**
```javascript
const [newThisWeekCount, setNewThisWeekCount] = useState(0);
```

**Separate API Call:**
- Added a separate API call to fetch `new_this_week` count without date filters
- Always fetches current week's count regardless of dashboard date range
- Similar pattern to Managerial Review implementation

**Updated Fetch Logic:**
```javascript
// Fetch new_this_week count separately without date filter (always current week)
fetchData(`/api/leads/stats?dealer_id=${dealerParent.id}&new_this_week_only=true`, {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('dealertoken')}`
  }
})
```

**Updated Display:**
```javascript
<CountCard
  iconClass="fa-regular fa-comment-plus"
  count={newThisWeekCount}  // Uses separate state instead of leadStats?.new_this_week
  label="New Lead This Week"
  link={`/dealer/leads?${getCurrentWeekDateParams()}`}
/>
```

---

### 2. **API Endpoint** (`app/api/leads/stats/route.js`)

**Added New Parameter:**
- `new_this_week_only=true` - Returns only the current week's new lead count

**Implementation:**
```javascript
// If only new_this_week is requested, return just that count for current week (no date filter)
if (new_this_week_only) {
  // Calculate start of current week in dealer timezone
  const nowInDealerTz = moment.tz(dealerTimezone);
  const startOfWeek = nowInDealerTz.clone().startOf('isoWeek'); // isoWeek starts on Monday
  const startOfWeekUTC = startOfWeek.utc().toDate();
  
  const new_this_week_count = await Lead.countDocuments({ 
    dealer_id,
    createdAt: { 
      $gte: startOfWeekUTC
    }
  });
  
  return new Response(JSON.stringify({
    new_this_week: new_this_week_count
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

**Key Features:**
- ✅ Always calculates from start of current week (Monday) in dealer timezone
- ✅ No date filter applied - always shows current week
- ✅ Uses dealer timezone for accurate week calculation
- ✅ Returns count for all leads created since start of current week

---

## 📊 Behavior Comparison

### Before:
- "New Lead This Week" was filtered by dashboard date range
- If user selected a date range that didn't include current week, count would be 0 or incorrect
- Count changed based on selected date range

### After:
- "New Lead This Week" always shows current week's count
- Count remains constant regardless of date range selection
- Always reflects the most recent week's new leads
- Similar behavior to Managerial Review (always shows total)

---

## 🎯 User Experience

### Example Scenarios:

**Scenario 1: User selects last month's date range**
- **Before:** "New Lead This Week" might show 0 or incorrect count
- **After:** "New Lead This Week" shows current week's count (e.g., 15 new leads this week)

**Scenario 2: User clears date range (shows all time)**
- **Before:** "New Lead This Week" might show all-time count or be confusing
- **After:** "New Lead This Week" shows current week's count (e.g., 15 new leads this week)

**Scenario 3: User selects current week**
- **Before:** "New Lead This Week" shows count for selected week
- **After:** "New Lead This Week" shows current week's count (consistent)

---

## 🔧 Technical Details

### Week Calculation:
- Uses ISO week standard (Monday to Sunday)
- Calculates in dealer's timezone
- Converts to UTC for database query
- Always uses current week (not filtered by dashboard date range)

### API Endpoint:
```
GET /api/leads/stats?dealer_id={id}&new_this_week_only=true
```

**Response:**
```json
{
  "new_this_week": 15
}
```

### Database Query:
```javascript
Lead.countDocuments({ 
  dealer_id,
  createdAt: { 
    $gte: startOfWeekUTC  // Start of current week (Monday) in UTC
  }
})
```

---

## 📝 Files Modified

1. **`app/dealer/dashboard/page.js`**
   - Added `newThisWeekCount` state
   - Added separate API call for `new_this_week_only`
   - Updated CountCard to use separate state
   - Added error handling for new API call

2. **`app/api/leads/stats/route.js`**
   - Added `new_this_week_only` parameter handling
   - Added current week calculation logic
   - Returns count for current week without date filters

---

## ✅ Testing Checklist

- [ ] **No Date Filter Applied**
  - Verify "New Lead This Week" shows current week's count
  - Count should match leads created since Monday of current week

- [ ] **Date Range Selected (Past Month)**
  - Verify "New Lead This Week" still shows current week's count
  - Should NOT be affected by date range selection

- [ ] **Date Range Selected (Current Week)**
  - Verify "New Lead This Week" shows current week's count
  - Should match the week range selected

- [ ] **Date Range Selected (Future Dates)**
  - Verify "New Lead This Week" still shows current week's count
  - Should NOT show 0 or future dates

- [ ] **Week Boundary Testing**
  - Test on Monday (start of week)
  - Test on Sunday (end of week)
  - Verify count updates correctly as week progresses

- [ ] **Timezone Testing**
  - Verify week calculation uses dealer timezone
  - Test with different dealer timezones
  - Verify UTC conversion is correct

- [ ] **Click Functionality**
  - Click on "New Lead This Week" card
  - Should navigate to leads page with current week date range
  - Should show all leads from current week

---

## 🔄 Similar Patterns

This implementation follows the same pattern as **Managerial Review**:
- Both metrics are fetched separately
- Both ignore dashboard date range filters
- Both provide constant, meaningful metrics
- Both use dedicated API parameters (`managerial_review_only`, `new_this_week_only`)

---

## 📅 Date: January 7, 2026

## Status: ✅ COMPLETED

"New Lead This Week" now always shows the current week's count, regardless of dashboard date range filters.

