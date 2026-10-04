// The vehicle photos the AI sent with a message (agentic-upsell MASTER_PLAN_4 stream R, A2 open item).
//
// An AI message with photos is stored with `ai_media_urls` (and `attachments` built from them,
// app/lib/ai/aiMessageRecord.js). The conversation views show them as small thumbnails that open the full
// image (app/dealer/components/MessagePhotos.js). Only http(s) URLs; duplicates once.
// No framework imports: the CRM's node tests import it.

export function messagePhotoUrls(message) {
  if (!message) return [];
  const fromAttachments = (message.attachments || [])
    .filter((a) => String(a?.contentType || a?.mimeType || '').startsWith('image/'))
    .map((a) => a.publicUrl || a.url);
  const urls = [...(message.ai_media_urls || []), ...(message.ai_media_urls?.length ? [] : fromAttachments)];
  return [...new Set(urls.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)))];
}

// True when the view should show the AI's photos as thumbnails instead of its generic attachment list.
export function hasAiPhotos(message) {
  return Boolean(message?.ai_generated && message.ai_media_urls?.length && messagePhotoUrls(message).length);
}
