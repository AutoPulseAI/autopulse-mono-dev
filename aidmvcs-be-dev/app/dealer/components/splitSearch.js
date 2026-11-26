// One Search box on the list pages: an @ means an email, mostly digits a phone, anything else a name.
export function splitSearch(text) {
  const isEmail = text.includes("@");
  const isPhone = !isEmail && /^[\d\s()+.-]+$/.test(text.trim()) && text.replace(/\D/g, "").length >= 3;
  return { name: isEmail || isPhone ? "" : text, email: isEmail ? text : "", phone: isPhone ? text : "" };
}
