"use client";

import { createImageField } from "../fields";
import {
  spacingFields,
  spacingDefaults,
  spacingStyle,
  radiusOptions,
  radiusValue,
} from "../styleFields";

export const Gallery = {
  label: "Gallery",
  fields: {
    images: {
      type: "array",
      label: "Images",
      arrayFields: {
        image: createImageField("Image"),
        alt: { type: "text", label: "Alt text" },
        href: { type: "text", label: "Link (optional)" },
      },
      defaultItemProps: { image: "", alt: "", href: "" },
      getItemSummary: (item, i) => item.alt || `Image ${i + 1}`,
    },
    columns: {
      type: "select",
      label: "Columns",
      options: [
        { label: "2", value: "2" },
        { label: "3", value: "3" },
        { label: "4", value: "4" },
        { label: "5", value: "5" },
      ],
    },
    gap: {
      type: "select",
      label: "Gap",
      options: [
        { label: "Small", value: "8" },
        { label: "Medium", value: "16" },
        { label: "Large", value: "24" },
      ],
    },
    radius: { type: "select", label: "Corner radius", options: radiusOptions },
    ...spacingFields,
  },
  defaultProps: {
    images: [
      { image: "", alt: "", href: "" },
      { image: "", alt: "", href: "" },
      { image: "", alt: "", href: "" },
    ],
    columns: "3",
    gap: "16",
    radius: "12",
    ...spacingDefaults,
  },
  render: ({ images, columns, gap, radius, ...rest }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns || 3}, 1fr)`,
        gap: `${gap || 16}px`,
        ...spacingStyle(rest),
      }}
    >
      {(images || []).map((item, i) => {
        const img = (
          <img
            src={item.image || "https://placehold.co/400x400?text=Image"}
            alt={item.alt || ""}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", borderRadius: radiusValue(radius), aspectRatio: "1 / 1" }}
          />
        );
        return item.href ? (
          <a key={i} href={item.href} target="_blank" rel="noopener noreferrer">
            {img}
          </a>
        ) : (
          <div key={i}>{img}</div>
        );
      })}
    </div>
  ),
};
