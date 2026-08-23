"use client";

import { spacingFields, spacingDefaults, spacingStyle, radiusOptions, radiusValue } from "../styleFields";

function toEmbedUrl(url = "") {
  if (!url) return "";
  // YouTube
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  // Vimeo
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return url;
}

const ratioMap = { "16:9": "56.25%", "4:3": "75%", "1:1": "100%", "21:9": "42.85%" };

export const VideoWidget = {
  label: "Video",
  fields: {
    url: { type: "text", label: "Video URL (YouTube / Vimeo / MP4)" },
    ratio: {
      type: "select",
      label: "Aspect ratio",
      options: [
        { label: "16:9", value: "16:9" },
        { label: "4:3", value: "4:3" },
        { label: "1:1", value: "1:1" },
        { label: "21:9", value: "21:9" },
      ],
    },
    radius: { type: "select", label: "Corner radius", options: radiusOptions },
    maxWidth: {
      type: "select",
      label: "Max width",
      options: [
        { label: "Full", value: "" },
        { label: "720px", value: "720" },
        { label: "960px", value: "960" },
      ],
    },
    ...spacingFields,
  },
  defaultProps: {
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ratio: "16:9",
    radius: "12",
    maxWidth: "",
    ...spacingDefaults,
  },
  render: ({ url, ratio, radius, maxWidth, ...rest }) => {
    const isFile = /\.(mp4|webm|ogg)(\?|$)/i.test(url || "");
    const pad = ratioMap[ratio] || "56.25%";
    return (
      <div style={{ maxWidth: maxWidth ? `${maxWidth}px` : "100%", margin: "0 auto", ...spacingStyle(rest) }}>
        <div
          style={{
            position: "relative",
            width: "100%",
            paddingTop: pad,
            borderRadius: radiusValue(radius),
            overflow: "hidden",
            background: "#000",
          }}
        >
          {isFile ? (
            <video
              src={url}
              controls
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <iframe
              src={toEmbedUrl(url)}
              title="Embedded video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
            />
          )}
        </div>
      </div>
    );
  },
};
