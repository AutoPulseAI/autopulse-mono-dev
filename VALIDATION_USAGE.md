# Report Settings Validation Usage

## Quick Validation Functions

### 1. Check for Duplicate Frequencies
```javascript
import { hasDuplicateFrequencies, checkDuplicateFrequencies } from '@utils/reportValidation';

// Quick check
const hasDuplicates = hasDuplicateFrequencies(schedules);

// Detailed check
const duplicateInfo = checkDuplicateFrequencies(schedules);
if (duplicateInfo.hasDuplicates) {
  console.log(duplicateInfo.message);
  // Output: "Duplicate frequencies detected: daily (2 schedules). Only one schedule allowed per frequency type."
}
```

### 2. Validate Complete Settings
```javascript
import { validateReportSettings } from '@utils/reportValidation';

const validation = validateReportSettings({
  dealerId: "123",
  reportEmail: "test@example.com",
  schedules: schedules
});

if (!validation.isValid) {
  console.log("Validation errors:", validation.errors);
  // Don't submit form
  return;
}
```

### 3. Real-time Schedule Validation
```javascript
import { getScheduleValidationStatus } from '@utils/reportValidation';

// Check individual schedule
const status = getScheduleValidationStatus(schedule, allSchedules);
if (!status.isValid) {
  console.log("Schedule errors:", status.errors);
}
```

## Frontend Integration Example

```javascript
import { 
  hasDuplicateFrequencies, 
  validateReportSettings,
  getAllValidationErrors 
} from '@utils/reportValidation';

const ReportSettingsForm = () => {
  const [schedules, setSchedules] = useState([]);
  const [errors, setErrors] = useState([]);
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Clear previous errors
    setErrors([]);
    
    // Validate before submission
    const validation = validateReportSettings({
      dealerId: dealerId,
      reportEmail: reportEmail,
      schedules: schedules
    });
    
    if (!validation.isValid) {
      setErrors(validation.errors);
      return; // Don't submit
    }
    
    // If validation passes, submit to API
    try {
      const response = await fetch('/api/dealers/report-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedules, reportEmail, dealerId })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        setErrors([errorData.message]);
        return;
      }
      
      // Success
      console.log('Settings saved successfully');
      
    } catch (error) {
      setErrors(['Network error occurred']);
    }
  };
  
  const handleScheduleChange = (index, field, value) => {
    const newSchedules = [...schedules];
    newSchedules[index] = { ...newSchedules[index], [field]: value };
    
    // Clear days array for daily schedules
    if (field === 'frequency' && value === 'daily') {
      newSchedules[index].days = [];
    }
    
    setSchedules(newSchedules);
    
    // Clear errors when user makes changes
    if (errors.length > 0) {
      setErrors([]);
    }
  };
  
  const handleDayChange = (index, day, checked) => {
    const newSchedules = [...schedules];
    const schedule = newSchedules[index];
    
    if (schedule.frequency === 'weekly') {
      // Weekly schedules: radio button behavior (only one day)
      if (checked) {
        schedule.days = [day];
      } else {
        schedule.days = [];
      }
    } else if (schedule.frequency === 'monthly' || schedule.frequency === 'yearly') {
      // Monthly/Yearly schedules: checkbox behavior (multiple days allowed)
      if (checked) {
        if (!schedule.days.includes(day)) {
          schedule.days.push(day);
        }
      } else {
        schedule.days = schedule.days.filter(d => d !== day);
      }
    }
    
    setSchedules(newSchedules);
    
    // Clear errors when user makes changes
    if (errors.length > 0) {
      setErrors([]);
    }
  };
  
  return (
    <form onSubmit={handleSubmit}>
      {/* Display validation errors */}
      {errors.length > 0 && (
        <div className="alert alert-danger">
          <ul>
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      
      {/* Schedules */}
      {schedules.map((schedule, index) => (
        <div key={index} className="schedule-item">
          <div className="schedule-header">
            <input
              type="checkbox"
              checked={schedule.active}
              onChange={(e) => handleScheduleChange(index, 'active', e.target.checked)}
            />
            <select
              value={schedule.frequency || ''}
              onChange={(e) => handleScheduleChange(index, 'frequency', e.target.value)}
              disabled={!schedule.active}
            >
              <option value="">Select frequency</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            
            <input
              type="time"
              value={schedule.time || ''}
              onChange={(e) => handleScheduleChange(index, 'time', e.target.value)}
              disabled={!schedule.active}
            />
          </div>
          
          {/* Day Selection */}
          {schedule.active && schedule.frequency && (
            <div className="day-selection">
              {schedule.frequency === 'daily' && (
                <div className="text-muted">
                  Daily schedules run every day automatically
                </div>
              )}
              
              {schedule.frequency === 'weekly' && (
                <div className="radio-group">
                  <label>Select one day:</label>
                  {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => (
                    <label key={day} className="radio-option">
                      <input
                        type="radio"
                        name={`day-${index}`}
                        value={day}
                        checked={schedule.days.includes(day)}
                        onChange={() => handleDayChange(index, day, true)}
                      />
                      {day.charAt(0).toUpperCase() + day.slice(1)}
                    </label>
                  ))}
                </div>
              )}
              
              {(schedule.frequency === 'monthly' || schedule.frequency === 'yearly') && (
                <div className="checkbox-group">
                  <label>Select days:</label>
                  {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => (
                    <label key={day} className="checkbox-option">
                      <input
                        type="checkbox"
                        value={day}
                        checked={schedule.days.includes(day)}
                        onChange={(e) => handleDayChange(index, day, e.target.checked)}
                      />
                      {day.charAt(0).toUpperCase() + day.slice(1)}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* Show error if duplicate frequency */}
          {hasDuplicateFrequencies(schedules) && schedule.active && (
            <small className="text-danger">
              Another {schedule.frequency} schedule is already active
            </small>
          )}
        </div>
      ))}
      
      <button type="submit" disabled={errors.length > 0}>
        Save Settings
      </button>
    </form>
  );
};
```

## Day Selection Rules

1. **Daily Schedules**: No day selection needed (runs every day)
2. **Weekly Schedules**: Radio buttons - only one day allowed
3. **Monthly Schedules**: Checkboxes - multiple days allowed
4. **Yearly Schedules**: Checkboxes - multiple days allowed

## Data Structure Examples

### Daily Schedule (Correct)
```json
{
  "active": true,
  "frequency": "daily",
  "time": "09:00",
  "days": []
}
```

### Weekly Schedule (Correct)
```json
{
  "active": true,
  "frequency": "weekly",
  "time": "09:00",
  "days": ["tuesday"]
}
```

### Monthly Schedule (Correct)
```json
{
  "active": true,
  "frequency": "monthly",
  "time": "09:00",
  "days": ["monday", "wednesday", "friday"]
}
```

## Key Validation Rules

1. **No Duplicate Frequencies**: Only one schedule per frequency type (daily, weekly, monthly, yearly)
2. **Required Fields**: Day, time, and frequency for active schedules
3. **Valid Days**: Monday through Sunday only
4. **Valid Times**: HH:MM format (e.g., 09:00, 14:30)
5. **Valid Frequencies**: daily, weekly, monthly, yearly

## Error Messages

- `"Only one schedule allowed per frequency type. You have 2 schedules for daily."`
- `"Days are required. Please select at least one day."`
- `"Invalid day: undefined. Must be one of: monday, tuesday, wednesday, thursday, friday, saturday, sunday"`
- `"Invalid time format: 9:0. Must be in HH:MM format (e.g., 09:00, 14:30)"`
- `"Report type/frequency is required"`

## CSS Styles

```css
.schedule-item {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  background: #f9f9f9;
}

.schedule-header {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.day-selection {
  margin-top: 12px;
  padding: 12px;
  background: white;
  border-radius: 6px;
}

.radio-group, .checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.radio-option, .checkbox-option {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  background: #f0f0f0;
}

.radio-option:hover, .checkbox-option:hover {
  background: #e0e0e0;
}

.text-muted {
  color: #6c757d;
  font-style: italic;
}

.alert {
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 16px;
}

.alert-danger {
  background-color: #f8d7da;
  border: 1px solid #f5c6cb;
  color: #721c24;
}

.alert ul {
  margin: 0;
  padding-left: 20px;
}

button[type="submit"] {
  background: #007bff;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
}

button[type="submit"]:disabled {
  background: #6c757d;
  cursor: not-allowed;
}
```
