const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,4}[-\s.]?[0-9]{1,9}$/;

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function fieldError(message) {
  return { ok: false, error: message };
}

export function validateContactPayload(raw) {
  const firstName = trim(raw?.firstName);
  const lastName = trim(raw?.lastName);
  const email = trim(raw?.email);
  const phone = trim(raw?.phone);
  const message = trim(raw?.message);

  if (!firstName) return fieldError("First name is required");
  if (firstName.length > 50) return fieldError("First name cannot exceed 50 characters");
  if (!lastName) return fieldError("Last name is required");
  if (lastName.length > 50) return fieldError("Last name cannot exceed 50 characters");
  if (!email) return fieldError("Email is required");
  if (!EMAIL_RE.test(email)) return fieldError("Please enter a valid email address");
  if (phone && !PHONE_RE.test(phone)) return fieldError("Please enter a valid phone number");
  if (phone && phone.length > 20) return fieldError("Phone number cannot exceed 20 characters");
  if (!message) return fieldError("Message is required");
  if (message.length < 10) return fieldError("Message must be at least 10 characters");
  if (message.length > 2000) return fieldError("Message cannot exceed 2000 characters");

  const data = { firstName, lastName, email, message };
  if (phone) data.phone = phone;
  return { ok: true, data };
}

export function validateDemoPayload(raw) {
  const name = trim(raw?.name);
  const dealershipAgencyName = trim(raw?.dealershipAgencyName);
  const email = trim(raw?.email);
  const phone = trim(raw?.phone);
  const comment = trim(raw?.comment);

  if (!name) return fieldError("Name is required");
  if (!dealershipAgencyName) return fieldError("Please select Dealership or Agency");
  if (!["dealership", "agency"].includes(dealershipAgencyName)) {
    return fieldError("Please select Dealership or Agency");
  }
  if (!email) return fieldError("Email is required");
  if (!EMAIL_RE.test(email)) return fieldError("Please enter a valid email address");
  if (!phone) return fieldError("Phone is required");
  if (!PHONE_RE.test(phone)) return fieldError("Please enter a valid phone number");
  if (!comment) return fieldError("Comment is required");
  if (comment.length < 10) return fieldError("Comment must be at least 10 characters");

  return {
    ok: true,
    data: { name, dealershipAgencyName, email, phone, comment },
  };
}
