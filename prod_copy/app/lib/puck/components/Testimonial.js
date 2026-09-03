"use client";

import { createImageField, createColorField, createAlignField } from "../fields";
import {
  spacingFields,
  spacingDefaults,
  spacingStyle,
  radiusOptions,
  radiusValue,
} from "../styleFields";

export const Testimonial = {
  label: "Testimonial",
  fields: {
    quote: { type: "textarea", label: "Quote" },
    name: { type: "text", label: "Name" },
    role: { type: "text", label: "Role / company" },
    image: createImageField("Avatar"),
    rating: {
      type: "select",
      label: "Star rating",
      options: [
        { label: "No stars", value: "0" },
        { label: "3 stars", value: "3" },
        { label: "4 stars", value: "4" },
        { label: "5 stars", value: "5" },
      ],
    },
    align: createAlignField("Alignment"),
    background: createColorField("Card background"),
    radius: { type: "select", label: "Corner radius", options: radiusOptions },
    ...spacingFields,
  },
  defaultProps: {
    quote: "This product completely transformed how our team works. Highly recommended!",
    name: "Jane Doe",
    role: "CEO, Acme Inc.",
    image: "",
    rating: "5",
    align: "center",
    background: "#f7f8fb",
    radius: "12",
    ...spacingDefaults,
  },
  render: ({ quote, name, role, image, rating, align, background, radius, ...rest }) => {
    const alignItems = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
    const stars = Number(rating) || 0;
    return (
      <figure
        style={{
          textAlign: align || "center",
          display: "flex",
          flexDirection: "column",
          alignItems,
          background: background || undefined,
          borderRadius: radiusValue(radius),
          padding: background ? 28 : 0,
          margin: 0,
          ...spacingStyle(rest),
        }}
      >
        {stars > 0 && (
          <div style={{ color: "#f5b301", marginBottom: 12, letterSpacing: 2 }} aria-label={`${stars} out of 5 stars`}>
            {Array.from({ length: 5 }).map((_, i) => (
              <i key={i} className={i < stars ? "fa-solid fa-star" : "fa-regular fa-star"} aria-hidden="true" />
            ))}
          </div>
        )}
        <blockquote style={{ fontSize: 18, lineHeight: 1.6, margin: 0, marginBottom: 16 }}>
          “{quote}”
        </blockquote>
        <figcaption style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {image && (
            <img src={image} alt={name || ""} style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }} />
          )}
          <span>
            {name && <strong style={{ display: "block" }}>{name}</strong>}
            {role && <span style={{ opacity: 0.7, fontSize: 14 }}>{role}</span>}
          </span>
        </figcaption>
      </figure>
    );
  },
};
