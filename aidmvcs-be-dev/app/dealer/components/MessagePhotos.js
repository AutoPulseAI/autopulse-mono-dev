"use client";
// Thumbnails of the vehicle photos the AI sent with a message (agentic-upsell MASTER_PLAN_4 stream R).
// Shown in every conversation view; a click opens the full image. See app/lib/ai/messagePhotos.js.
import { hasAiPhotos, messagePhotoUrls } from "@lib/ai/messagePhotos";

export default function MessagePhotos({ email }) {
  if (!hasAiPhotos(email)) return null;
  const urls = messagePhotoUrls(email);
  return (
    <div className="d-flex flex-wrap gap-2 mt-2" aria-label="Photos sent by the AI">
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
          title="Open the photo">
          {/* eslint-disable-next-line @next/next/no-img-element -- external dealer/CDN photos, any host */}
          <img src={url} alt="Vehicle photo sent by the AI" loading="lazy" className="rounded border"
            style={{ width: 160, height: 120, objectFit: "cover" }} />
        </a>
      ))}
    </div>
  );
}
