/**
 * Client-side validation for report settings
 * This prevents invalid data from being sent to the server
 */

const VALID_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const VALID_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"];

/**
 * Validate a single schedule entry
 * @param {Object} schedule - Schedule object to validate
 * @returns {Object} - { isValid: boolean, errors: string[] }
 */
export function validateSchedule(schedule) {
  const errors = [];
  
  // Check if schedule is active (only validate active schedules)
  if (!schedule.active) {
    return { isValid: true, errors: [] };
  }
  
  // Handle both 'frequency' and 'reportType' fields
  const reportType = schedule.reportType || schedule.frequency;
  
  // Validate days array - handle both 'day' and 'days' fields
  let days = [];
  if (schedule.days && Array.isArray(schedule.days)) {
    days = schedule.days;
  } else if (schedule.day) {
    days = [schedule.day];
  }
  
  // For daily schedules, days array can be empty (runs every day)
  // For weekly/monthly/yearly schedules, days array must have at least one day
  if (reportType === 'daily') {
    // Daily schedules don't need specific days - they run every day
    if (days.length > 0) {
      errors.push(`Daily schedules don't need specific days selected. They run every day automatically.`);
    }
  } else if (['weekly', 'monthly', 'yearly'].includes(reportType)) {
    // Weekly/monthly/yearly schedules need specific days
    if (days.length === 0) {
      errors.push(`Please select at least one day for ${reportType} schedule.`);
    } else if (days.length > 1 && reportType === 'weekly') {
      errors.push(`Weekly schedules can only have one day selected.`);
    } else {
      // Validate each day in the array
      for (const day of days) {
        if (!day || typeof day !== 'string') {
          errors.push(`Invalid day value: ${day}. Day must be a valid string.`);
        } else if (!VALID_DAYS.includes(day.toLowerCase())) {
          errors.push(`Invalid day: ${day}. Must be one of: ${VALID_DAYS.join(", ")}`);
        }
      }
    }
  }
  
  // Validate time
  if (!schedule.time || typeof schedule.time !== 'string') {
    errors.push(`Time is required and must be a string`);
  } else {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(schedule.time)) {
      errors.push(`Invalid time format: ${schedule.time}. Must be in HH:MM format (e.g., 09:00, 14:30)`);
    }
  }
  
  // Validate reportType/frequency
  if (!reportType) {
    errors.push(`Report type/frequency is required`);
  } else if (!VALID_FREQUENCIES.includes(reportType)) {
    errors.push(`Invalid report type: ${reportType}. Must be one of: ${VALID_FREQUENCIES.join(", ")}`);
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Check for duplicate frequencies in schedules
 * @param {Array} schedules - Array of schedule objects
 * @returns {Object} - { hasDuplicates: boolean, duplicates: Object, message: string }
 */
export function checkDuplicateFrequencies(schedules) {
  if (!Array.isArray(schedules)) {
    return { hasDuplicates: false, duplicates: {}, message: "" };
  }

  const frequencyCounts = {};
  const activeSchedules = schedules.filter(s => s.active);
  
  activeSchedules.forEach(schedule => {
    const frequency = schedule.frequency || schedule.reportType;
    if (frequency) {
      frequencyCounts[frequency] = (frequencyCounts[frequency] || 0) + 1;
    }
  });

  const duplicates = {};
  let hasDuplicates = false;
  
  for (const [frequency, count] of Object.entries(frequencyCounts)) {
    if (count > 1) {
      duplicates[frequency] = count;
      hasDuplicates = true;
    }
  }

  let message = "";
  if (hasDuplicates) {
    const duplicateList = Object.entries(duplicates)
      .map(([freq, count]) => `${freq} (${count} schedules)`)
      .join(", ");
    message = `Duplicate frequencies detected: ${duplicateList}. Only one schedule allowed per frequency type.`;
  }

  return { hasDuplicates, duplicates, message };
}

/**
 * Validate all schedules for frequency conflicts and day restrictions
 * @param {Array} schedules - Array of schedule objects
 * @returns {Object} - { isValid: boolean, errors: string[] }
 */
export function validateSchedules(schedules) {
  const errors = [];
  
  if (!Array.isArray(schedules)) {
    errors.push("Schedules must be an array");
    return { isValid: false, errors };
  }
  
  // Check for duplicate frequencies first
  const duplicateCheck = checkDuplicateFrequencies(schedules);
  if (duplicateCheck.hasDuplicates) {
    errors.push(duplicateCheck.message);
  }
  
  // Validate individual schedules
  schedules.forEach((schedule, index) => {
    const scheduleValidation = validateSchedule(schedule);
    if (!scheduleValidation.isValid) {
      const dayInfo = schedule.days?.[0] || schedule.day || 'unknown';
      scheduleValidation.errors.forEach(error => {
        errors.push(`Schedule ${index + 1} (${dayInfo}): ${error}`);
      });
    }
  });
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validate complete report settings object
 * @param {Object} settings - Complete report settings object
 * @returns {Object} - { isValid: boolean, errors: string[], warnings: string[] }
 */
export function validateReportSettings(settings) {
  const errors = [];
  const warnings = [];

  // Validate dealerId
  if (!settings.dealerId) {
    errors.push("Dealer ID is required");
  }

  // Validate reportEmail
  if (!settings.reportEmail) {
    errors.push("Report email is required");
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(settings.reportEmail)) {
      errors.push("Please enter a valid email address");
    }
  }

  // Validate schedules
  if (settings.schedules) {
    const scheduleValidation = validateSchedules(settings.schedules);
    if (!scheduleValidation.isValid) {
      errors.push(...scheduleValidation.errors);
    }
  }

  // Validate timezone
  if (settings.timezone && typeof settings.timezone !== 'string') {
    errors.push("Timezone must be a string");
  }

  // Validate isActive
  if (settings.isActive !== undefined && typeof settings.isActive !== 'boolean') {
    errors.push("isActive must be a boolean value");
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Quick validation check for duplicate frequencies (for real-time validation)
 * @param {Array} schedules - Array of schedule objects
 * @returns {boolean} - True if duplicates found
 */
export function hasDuplicateFrequencies(schedules) {
  if (!Array.isArray(schedules)) return false;
  
  const frequencyCounts = {};
  const activeSchedules = schedules.filter(s => s.active);
  
  for (const schedule of activeSchedules) {
    const frequency = schedule.frequency || schedule.reportType;
    if (frequency) {
      if (frequencyCounts[frequency]) {
        return true; // Found duplicate
      }
      frequencyCounts[frequency] = 1;
    }
  }
  
  return false;
}

/**
 * Get validation error message for a specific field
 * @param {string} fieldName - Name of the field
 * @param {any} value - Current value
 * @param {string} frequency - Schedule frequency for context
 * @returns {string|null} - Error message or null if valid
 */
export function getFieldError(fieldName, value, frequency = null) {
  switch (fieldName) {
    case 'days':
      if (frequency === 'daily') {
        // Daily schedules don't need days
        if (value && Array.isArray(value) && value.length > 0) {
          return 'Daily schedules don\'t need specific days selected';
        }
        return null;
      } else if (['weekly', 'monthly', 'yearly'].includes(frequency)) {
        if (!value || !Array.isArray(value) || value.length === 0) {
          return `Please select at least one day for ${frequency} schedule`;
        }
        if (frequency === 'weekly' && value.length > 1) {
          return 'Weekly schedules can only have one day selected';
        }
        for (const day of value) {
          if (!day || typeof day !== 'string') {
            return 'Invalid day value';
          }
          if (!VALID_DAYS.includes(day.toLowerCase())) {
            return `Invalid day: ${day}. Must be one of: ${VALID_DAYS.join(", ")}`;
          }
        }
      }
      break;
      
    case 'day':
      if (!value) return 'Day is required';
      if (!VALID_DAYS.includes(value.toLowerCase())) {
        return `Invalid day. Must be one of: ${VALID_DAYS.join(", ")}`;
      }
      break;
      
    case 'time':
      if (!value) return 'Time is required';
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(value)) {
        return 'Invalid time format. Use HH:MM (e.g., 09:00, 14:30)';
      }
      break;
      
    case 'reportType':
    case 'frequency':
      if (!value) return 'Report type/frequency is required';
      if (!VALID_FREQUENCIES.includes(value)) {
        return `Invalid report type. Must be one of: ${VALID_FREQUENCIES.join(", ")}`;
      }
      break;
      
    case 'reportEmail':
      if (!value) return 'Report email is required';
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return 'Please enter a valid email address';
      }
      break;
  }
  
  return null;
}

/**
 * Validate complete schedule configuration
 * @param {Array} schedules - Array of schedule objects
 * @returns {Object} - { isValid: boolean, errors: string[], warnings: string[] }
 */
export function validateScheduleConfiguration(schedules) {
  const errors = [];
  const warnings = [];
  
  if (!Array.isArray(schedules)) {
    errors.push("Schedules must be an array");
    return { isValid: false, errors, warnings };
  }
  
  const activeSchedules = schedules.filter(s => s.active);
  
  // Check for duplicate frequency types
  const frequencyCounts = {};
  activeSchedules.forEach(schedule => {
    if (schedule.reportType) {
      frequencyCounts[schedule.reportType] = (frequencyCounts[schedule.reportType] || 0) + 1;
    }
  });
  
  // Validate only one schedule per frequency type
  for (const [frequency, count] of Object.entries(frequencyCounts)) {
    if (count > 1) {
      errors.push(`Only one schedule allowed per frequency type. You have ${count} schedules for ${frequency}.`);
    }
  }
  
  // Check for specific frequency requirements
  if (frequencyCounts.weekly > 1) {
    errors.push("Weekly reports can only be scheduled for one day of the week.");
  }
  
  if (frequencyCounts.monthly > 1) {
    errors.push("Monthly reports can only be scheduled for one day of the month.");
  }
  
  if (frequencyCounts.yearly > 1) {
    errors.push("Yearly reports can only be scheduled for one day of the year.");
  }
  
  // Validate individual schedules
  activeSchedules.forEach((schedule, index) => {
    if (!schedule.day) {
      errors.push(`Schedule ${index + 1}: Day is required`);
    }
    if (!schedule.time) {
      errors.push(`Schedule ${index + 1}: Time is required`);
    }
    if (!schedule.reportType) {
      errors.push(`Schedule ${index + 1}: Report type is required`);
    }
  });
  
  // Check for optimal scheduling
  if (activeSchedules.length === 0) {
    warnings.push("No active schedules configured. Reports will not be sent automatically.");
  }
  
  if (activeSchedules.length > 4) {
    warnings.push("Having too many schedules may impact performance. Consider consolidating similar frequencies.");
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Check if a schedule can be activated (no frequency conflicts)
 * @param {Array} schedules - All schedules
 * @param {number} scheduleIndex - Index of schedule to check
 * @returns {boolean} - True if can be activated
 */
export function canActivateSchedule(schedules, scheduleIndex) {
  const targetSchedule = schedules[scheduleIndex];
  if (!targetSchedule || !targetSchedule.reportType) return true;
  
  // Check if another schedule with same frequency is already active
  return !schedules.some((schedule, index) => 
    index !== scheduleIndex && 
    schedule.active && 
    schedule.reportType === targetSchedule.reportType
  );
}

/**
 * Get available frequency options for a schedule
 * @param {Array} schedules - All schedules
 * @param {number} scheduleIndex - Index of current schedule
 * @returns {Array} - Available frequency options
 */
export function getAvailableFrequencies(schedules, scheduleIndex) {
  const usedFrequencies = schedules
    .filter((schedule, index) => 
      index !== scheduleIndex && 
      schedule.active && 
      schedule.reportType
    )
    .map(schedule => schedule.reportType);
  
  return VALID_FREQUENCIES.filter(freq => !usedFrequencies.includes(freq));
}

/**
 * Get validation status for a specific schedule
 * @param {Object} schedule - Schedule object to validate
 * @param {Array} allSchedules - All schedules array for context
 * @returns {Object} - { isValid: boolean, errors: string[], warnings: string[] }
 */
export function getScheduleValidationStatus(schedule, allSchedules) {
  const errors = [];
  const warnings = [];

  // Check if schedule is active
  if (!schedule.active) {
    return { isValid: true, errors: [], warnings: [] };
  }

  // Check for duplicate frequency with other schedules
  const currentFrequency = schedule.frequency || schedule.reportType;
  if (currentFrequency) {
    const duplicateCount = allSchedules.filter(s => 
      s.active && 
      s !== schedule && 
      (s.frequency === currentFrequency || s.reportType === currentFrequency)
    ).length;
    
    if (duplicateCount > 0) {
      errors.push(`Another ${currentFrequency} schedule is already active`);
    }
  }

  // Validate individual schedule fields
  const scheduleValidation = validateSchedule(schedule);
  if (!scheduleValidation.isValid) {
    errors.push(...scheduleValidation.errors);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Get all validation errors for display
 * @param {Array} schedules - Array of schedule objects
 * @returns {Array} - Array of error messages
 */
export function getAllValidationErrors(schedules) {
  const errors = [];
  
  // Check for duplicate frequencies
  const duplicateCheck = checkDuplicateFrequencies(schedules);
  if (duplicateCheck.hasDuplicates) {
    errors.push(duplicateCheck.message);
  }
  
  // Check individual schedules
  schedules.forEach((schedule, index) => {
    const scheduleValidation = validateSchedule(schedule);
    if (!scheduleValidation.isValid) {
      const dayInfo = schedule.days?.[0] || schedule.day || 'unknown';
      scheduleValidation.errors.forEach(error => {
        errors.push(`Schedule ${index + 1} (${dayInfo}): ${error}`);
      });
    }
  });
  
  return errors;
}
