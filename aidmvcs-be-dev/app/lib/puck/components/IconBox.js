"use client";

import { createColorField, createAlignField } from "../fields";
import {
  spacingFields,
  spacingDefaults,
  spacingStyle,
  targetOptions,
} from "../styleFields";

export const IconBox = {
  label: "Icon Box",
  fields: {
    icon: { type: "text", label: "Icon class (Font Awesome)" },
    iconColor: createColorField("Icon color"),
    iconBg: createColorField("Icon background"),
    iconSize: {
      type: "select",
      label: "Icon size",
      options: [
        { label: "Small (28px)", value: "28" },
        { label: "Medium (40px)", value: "40" },
        { label: "Large (56px)", value: "56" },
      ],
    },
    title: { type: "text", label: "Title" },
    text: { type: "textarea", label: "Description" },
    linkLabel: { type: "text", label: "Link text (optional)" },
    linkHref: { type: "text", label: "Link URL" },
    linkTarget: { type: "select", label: "Open in", options: targetOptions },
    align: createAlignField("Alignment"),
    ...spacingFields,
  },
  defaultProps: {
    icon: "fa-solid fa-bolt",
    iconColor: "#e5306b",
    iconBg: "",
    iconSize: "40",
    title: "Icon box title",
    text: "A short supporting sentence that explains this point.",
    linkLabel: "",
    linkHref: "",
    linkTarget: "_self",
    align: "center",
    ...spacingDefaults,
  },
  render: ({
    icon,
    iconColor,
    iconBg,
    iconSize,
    title,
    text,
    linkLabel,
    linkHref,
    linkTarget,
    align,
    ...rest
  }) => {
    const iconWrap = iconBg
      ? {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: Number(iconSize) * 2,
          height: Number(iconSize) * 2,
          borderRadius: "50%",
          background: iconBg,
          marginBottom: 14,
        }
      : { display: "block", marginBottom: 12 };

    const alignItems = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";

    return (
      <div style={{ textAlign: align || "center", display: "flex", flexDirection: "column", alignItems, ...spacingStyle(rest) }}>
        <span style={iconWrap}>
          <i className={icon || "fa-solid fa-bolt"} style={{ fontSize: `${iconSize || 40}px`, color: iconColor || undefined, lineHeight: 1 }} aria-hidden="true" />
        </span>
        {title && <h4 style={{ marginBottom: 8 }}>{title}</h4>}
        {text && <p style={{ marginBottom: linkLabel ? 12 : 0, opacity: 0.85 }}>{text}</p>}
        {linkLabel && linkHref && (
          <a
            href={linkHref}
            target={linkTarget || "_self"}
            rel={linkTarget === "_blank" ? "noopener noreferrer" : undefined}
            style={{ fontWeight: 600, color: "#e5306b", textDecoration: "none" }}
          >
            {linkLabel} →
          </a>
        )}
      </div>
    );
  },
};
