"use client";

import { spacingFields, spacingDefaults, spacingStyle, radiusOptions, radiusValue } from "../styleFields";

export const GoogleMap = {
  label: "Google Map",
  fields: {
    query: { type: "text", label: "Address or place to show" },
    embedUrl: { type: "textarea", label: "…or paste a full Maps embed URL (optional)" },
    height: {
      type: "select",
      label: "Height",
      options: [
        { label: "Small (240px)", value: "240" },
        { label: "Medium (360px)", value: "360" },
        { label: "Large (480px)", value: "480" },
      ],
    },
    radius: { type: "select", label: "Corner radius", options: radiusOptions },
    ...spacingFields,
  },
  defaultProps: {
    query: "New York, NY",
    embedUrl: "",
    height: "360",
    radius: "12",
    ...spacingDefaults,
  },
  render: ({ query, embedUrl, height, radius, ...rest }) => {
    const src = embedUrl?.trim()
      ? embedUrl.trim()
      : `https://www.google.com/maps?q=${encodeURIComponent(query || "")}&output=embed`;
    return (
      <div style={{ borderRadius: radiusValue(radius), overflow: "hidden", ...spacingStyle(rest) }}>
        <iframe
          src={src}
          title="Google Map"
          width="100%"
          height={`${height || 360}px`}
          style={{ border: 0, display: "block" }}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      </div>
    );
  },
};
