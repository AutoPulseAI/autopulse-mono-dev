// Vehicle photos staff send with a reply (Betsy, 25 Nov 2026: "I want to send a picture of the car ... anything a
// customer asked me about the car, I should be able to send it from here"). A text sends them as picture messages
// (MMS); an email lists them as links under the message. Only web (https) addresses, at most MAX_STAFF_PHOTOS.
export const MAX_STAFF_PHOTOS = 5;

/** The photo addresses to send: https only, no duplicates, at most MAX_STAFF_PHOTOS. Anything else is dropped. */
export function cleanStaffMedia(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const v of value) {
    const url = String(v || '').trim();
    if (!/^https:\/\/[^\s<>"']+$/i.test(url) || url.length > 2000 || out.includes(url)) continue;
    out.push(url);
    if (out.length === MAX_STAFF_PHOTOS) break;
  }
  return out;
}

/** An email's text with its photo links under it. */
export function emailWithPhotoLinks(text, urls) {
  if (!urls?.length) return text;
  return `${text}\n\nPhotos:\n${urls.join('\n')}`;
}
