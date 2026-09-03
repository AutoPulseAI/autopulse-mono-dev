"use client";

import { createImageField } from "../fields";
import {
  spacingFields,
  spacingDefaults,
  spacingStyle,
  radiusOptions,
  radiusValue,
  shadowOptions,
  targetOptions,
  maybeLink,
} from "../styleFields";

export const ImageWidget = {
  label: "Image",
  fields: {
    image: createImageField("Image"),
    alt: { type: "text", label: "Alt text" },
    href: { type: "text", label: "Link URL (optional)" },
    target: { type: "select", label: "Open in", options: targetOptions },
    width: {
      type: "select",
      label: "Width",
      options: [
        { label: "Full width", value: "100%" },
        { label: "Auto", value: "auto" },
        { label: "25%", value: "25%" },
        { label: "50%", value: "50%" },
        { label: "75%", value: "75%" },
        { label: "200px", value: "200px" },
        { label: "400px", value: "400px" },
        { label: "600px", value: "600px" },
      ],
    },
    align: {
      type: "select",
      label: "Alignment",
      options: [
        { label: "Left", value: "flex-start" },
        { label: "Center", value: "center" },
        { label: "Right", value: "flex-end" },
      ],
    },
    radius: { type: "select", label: "Corner radius", options: radiusOptions },
    shadow: { type: "select", label: "Shadow", options: shadowOptions },
    ...spacingFields,
  },
  defaultProps: {
    image: "",
    alt: "",
    href: "",
    target: "_self",
    width: "100%",
    align: "center",
    radius: "0",
    shadow: "none",
    ...spacingDefaults,
  },
  render: ({ image, alt, href, target, width, align, radius, shadow, ...rest }) => {
    const img = (
      <img
        src={image || "https://placehold.co/600x360?text=Image"}
        alt={alt || ""}
        style={{
          width: width || "100%",
          maxWidth: "100%",
          height: "auto",
          display: "block",
          borderRadius: radiusValue(radius),
          boxShadow: shadow && shadow !== "none" ? shadow : undefined,
        }}
      />
    );
    return (
      <div style={{ display: "flex", justifyContent: align || "center", ...spacingStyle(rest) }}>
        {maybeLink(href, target, img)}
      </div>
    );
  },
};
