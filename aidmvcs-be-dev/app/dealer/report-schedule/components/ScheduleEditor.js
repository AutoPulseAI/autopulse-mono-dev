'use client';

import { useState, useEffect } from 'react';
import { Form, Button, Row, Col, Alert } from 'react-bootstrap';

const FREQUENCY_OPTIONS = ['daily', 'weekly', 'monthly', 'yearly'];
const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DATES_OF_MONTH = Array.from({ length: 31 }, (_, i) => (i + 1).toString());
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

export default function ScheduleEditor({ schedule, validationErrors, onUpdate, onDelete, onFrequencyChange }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Use the normalized schedule data directly - this will be reactive to schedule changes
  const scheduleData = schedule._doc || schedule;
  
  // Initialize defaults for new schedules - only run once when component mounts
  useEffect(() => {
    if (!scheduleData.id) return;
    
    // Only set defaults for completely new schedules (no time and no days)
    const isCompletelyNew = (!scheduleData.time || scheduleData.time === '') && 
                           (!scheduleData.days || scheduleData.days.length === 0);
    
    if (isCompletelyNew) {
      const updates = {};
      updates.time = '09:00';
      
      if (scheduleData.frequency === 'weekly') {
        updates.days = ['monday'];
      } else if (scheduleData.frequency === 'monthly') {
        updates.days = ['1'];
      } else if (scheduleData.frequency === 'yearly') {
        updates.days = ['january', '1'];
      } else {
        updates.days = [];
      }
      
      onUpdate(scheduleData.id, updates);
    }
  }, []); // Only run once when component mounts

  const handleChange = (field, value) => {
    onUpdate(scheduleData.id, { [field]: value });
  };

  const handleFrequencyChange = (newFrequency) => {
    onFrequencyChange(scheduleData.id, newFrequency);
  };

  const renderDateSelection = () => {
    if (scheduleData.frequency === 'weekly') {
      const selectedDay = scheduleData.days?.[0] || '';
      return (
        <Form.Group key="weekly-day" as={Col} md={3} xs={6}>
          <Form.Label className="mb-1"><small>Day of Week</small></Form.Label>
          <Form.Select
            value={selectedDay}
            onChange={e => handleChange('days', [e.target.value])}
            isInvalid={!!validationErrors.days}
            size='sm'
          >
            <option value="">Select a day</option>
            {DAYS_OF_WEEK.map(day => (
              <option key={day} value={day}>
                {day.charAt(0).toUpperCase() + day.slice(1)}
              </option>
            ))}
          </Form.Select>
          <Form.Control.Feedback type="invalid">
            {validationErrors.days}
          </Form.Control.Feedback>
        </Form.Group>
      );
    } else if (scheduleData.frequency === 'monthly') {
      const selectedDate = scheduleData.days?.[0] || '';
      return (
        <Form.Group key="monthly-date" as={Col} md={3} xs={6}>
          <Form.Label className="mb-1"><small>Date of Month</small></Form.Label>
          <Form.Select
            value={selectedDate}
            onChange={e => handleChange('days', [e.target.value])}
            isInvalid={!!validationErrors.days}
            size='sm'
          >
            <option value="">Select a date</option>
            {DATES_OF_MONTH.map(date => (
              <option key={date} value={date}>
                {date}
              </option>
            ))}
          </Form.Select>
          <Form.Control.Feedback type="invalid">
            {validationErrors.days}
          </Form.Control.Feedback>
        </Form.Group>
      );
    } else if (scheduleData.frequency === 'yearly') {
      const selectedMonth = scheduleData.days?.[0] || '';
      const selectedDate = scheduleData.days?.[1] || '';
      
      return (
        <>
          <Form.Group key="yearly-month" as={Col} md={3} xs={6}>
            <Form.Label className="mb-1"><small>Month</small></Form.Label>
            <Form.Select
              value={selectedMonth}
              onChange={e => {
                const currentDate = scheduleData.days?.[1] || '1';
                handleChange('days', [e.target.value, currentDate]);
              }}
              isInvalid={!!validationErrors.days}
              size='sm'
            >
              <option value="">Select a month</option>
              {MONTHS.map(month => (
                <option key={month} value={month}>
                  {month.charAt(0).toUpperCase() + month.slice(1)}
                </option>
              ))}
            </Form.Select>
            <Form.Control.Feedback type="invalid">
              {validationErrors.days}
            </Form.Control.Feedback>
          </Form.Group>
          <Form.Group key="yearly-date" as={Col} md={3} xs={6}>
            <Form.Label className="mb-1"><small>Date</small></Form.Label>
            <Form.Select
              value={selectedDate}
              onChange={e => {
                const currentMonth = scheduleData.days?.[0] || 'january';
                handleChange('days', [currentMonth, e.target.value]);
              }}
              isInvalid={!!validationErrors.days}
              size='sm'
            >
              <option value="">Select a date</option>
              {DATES_OF_MONTH.map(date => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </Form.Select>
            <Form.Control.Feedback type="invalid">
              {validationErrors.days}
            </Form.Control.Feedback>
          </Form.Group>
        </>
      );
    }
    return null;
  };

  return (
    <div className="followup_rule">
        <div className="position-relative d-flex align-items-center">
        <Form.Check
          type="switch"
          id={`schedule-active-${scheduleData.id}`}
          checked={scheduleData.active}
          onChange={e => handleChange('active', e.target.checked)}
          className="me-2"
        />
        <p className="mb-0 me-auto">
          <b>Schedule reports <span className='text-custom'>{scheduleData.frequency}</span> at <span className='text-custom'>{scheduleData.time || '--:--'}</span></b>
        </p>
        <Button variant="link" size="sm" onClick={() => setIsExpanded(v => !v)} className="ms-2 close_sm text-custom">
          {isExpanded ? <i className="fa-regular fa-chevron-up"></i> : <i className="fa-regular fa-chevron-down"></i>}
        </Button>
        <Button
          variant="danger"
          size="sm"
          className="ms-2 close_sm"
          onClick={() => onDelete(scheduleData.id)}
        ><i className="fa-solid fa-xmark"></i></Button>
      </div>

      {/* Validation errors for this schedule */}
      {Object.keys(validationErrors).length > 0 && (
        <Alert variant="danger" className="mt-2 mb-2">
          {Object.entries(validationErrors).map(([field, message]) => (
            <div key={field} className="small">
              <i className="bi bi-exclamation-triangle me-1"></i>
              {message}
            </div>
          ))}
        </Alert>
      )}

      {isExpanded && (
        <Form as={Row} className="mt-2 gx-lg-3 gx-2 gy-md-0 gy-1">
          <Form.Group as={Col} md={3} xs={6}>
            <Form.Label className="mb-1"><small>Frequency</small></Form.Label>
            <Form.Select
              value={scheduleData.frequency || ''}
              onChange={e => handleFrequencyChange(e.target.value)}
              size='sm'
            >
              {FREQUENCY_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group as={Col} md={3} xs={6}>
            <Form.Label className="mb-1"><small>Time</small></Form.Label>
            <Form.Control
              type="time"
              value={scheduleData.time || ''}
              onChange={e => handleChange('time', e.target.value)}
              isInvalid={!!validationErrors.time}
              size='sm'
            />
            <Form.Control.Feedback type="invalid">
              {validationErrors.time}
            </Form.Control.Feedback>
          </Form.Group>

          {renderDateSelection()}
        </Form>
      )}
    </div>
  );
}