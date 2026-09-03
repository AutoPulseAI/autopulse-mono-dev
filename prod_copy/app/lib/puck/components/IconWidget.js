"use client";

import { createColorField } from "../fields";
import {
  spacingFields,
  spacingDefaults,
  spacingStyle,
  targetOptions,
  maybeLink,
} from "../styleFields";

export const IconWidget = {
  label: "Icon",
  fields: {
    icon: { type: "text", label: "Icon class (Font Awesome)" },
    size: {
      type: "select",
      label: "Size",
      options: [
        { label: "Small (24px)", value: "24" },
        { label: "Medium (40px)", value: "40" },
        { label: "Large (64px)", value: "64" },
        { label: "XL (96px)", value: "96" },
      ],
    },
    color: createColorField("Icon color"),
    align: {
      type: "select",
      label: "Alignment",
      options: [
        { label: "Left", value: "flex-start" },
        { label: "Center", value: "center" },
        { label: "Right", value: "flex-end" },
      ],
    },
    href: { type: "text", label: "Link URL (optional)" },
    target: { type: "select", label: "Open in", options: targetOptions },
    ...spacingFields,
  },
  defaultProps: {
    icon: "fa-solid fa-star",
    size: "40",
    color: "#e5306b",
    align: "center",
    href: "",
    target: "_self",
    ...spacingDefaults,
  },
  render: ({ icon, size, color, align, href, target, ...rest }) => {
    const iconEl = (
      <i
        className={icon || "fa-solid fa-star"}
        style={{ fontSize: `${size || 40}px`, color: color || undefined, lineHeight: 1 }}
        aria-hidden="true"
      />
    );
    return (
      <div style={{ display: "flex", justifyContent: align || "center", ...spacingStyle(rest) }}>
        {maybeLink(href, target, iconEl)}
      </div>
    );
  },
};
