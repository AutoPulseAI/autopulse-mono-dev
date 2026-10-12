// Client, 12 Oct 2026: customers see 12-hour times ("3:00 PM"), never "15:00".
export const twelveHour = (value) => {
  const found = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!found) return value;
  const hour = Number(found[1]);
  if (hour > 23) return value;
  return `${hour % 12 || 12}:${found[2]} ${hour < 12 ? 'AM' : 'PM'}`;
};

export const appointmentBookingSMSTemplate = (customerName, appointmentDate, appointmentTime, dealerName, dealerPhone) => {
  return `Hi ${customerName}! Your appointment with ${dealerName} is confirmed for ${appointmentDate} at ${twelveHour(appointmentTime)}. Call ${dealerPhone} if you need to reschedule. We look forward to seeing you!`;
};

export const appointmentUpdateSMSTemplate = (customerName, oldDate, oldTime, newDate, newTime, dealerName, dealerPhone) => {
  return `Hi ${customerName}! Your appointment with ${dealerName} has been updated from ${oldDate} at ${twelveHour(oldTime)} to ${newDate} at ${twelveHour(newTime)}. Call ${dealerPhone} if you have questions. Thank you!`;
};
