export const appointmentBookingSMSTemplate = (customerName, appointmentDate, appointmentTime, dealerName, dealerPhone) => {
  return `Hi ${customerName}! Your appointment with ${dealerName} is confirmed for ${appointmentDate} at ${appointmentTime}. Call ${dealerPhone} if you need to reschedule. We look forward to seeing you!`;
};

export const appointmentUpdateSMSTemplate = (customerName, oldDate, oldTime, newDate, newTime, dealerName, dealerPhone) => {
  return `Hi ${customerName}! Your appointment with ${dealerName} has been updated from ${oldDate} at ${oldTime} to ${newDate} at ${newTime}. Call ${dealerPhone} if you have questions. Thank you!`;
};
