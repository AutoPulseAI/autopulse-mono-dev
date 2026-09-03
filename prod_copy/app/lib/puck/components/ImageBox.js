"use client";

import { createImageField, createColorField, createAlignField } from "../fields";
import {
  spacingFields,
  spacingDefaults,
  spacingStyle,
  radiusOptions,
  radiusValue,
  shadowOptions,
  targetOptions,
} from "../styleFields";

export const ImageBox = {
  label: "Image Box",
  fields: {
    image: createImageField("Image"),
    alt: { type: "text", label: "Alt text" },
    title: { type: "text", label: "Title" },
    titleTag: {
      type: "select",
      label: "Title tag",
      options: [
        { label: "H3", value: "h3" },
        { label: "H4", value: "h4" },
        { label: "H5", value: "h5" },
      ],
    },
    text: { type: "textarea", label: "Description" },
    linkLabel: { type: "text", label: "Link / button text" },
    linkHref: { type: "text", label: "Link URL" },
    linkTarget: { type: "select", label: "Open in", options: targetOptions },
    align: createAlignField("Content alignment"),
    background: createColorField("Card background"),
    radius: { type: "select", label: "Corner radius", options: radiusOptions },
    shadow: { type: "select", label: "Card shadow", options: shadowOptions },
    ...spacingFields,
  },
  defaultProps: {
    image: "",
    alt: "",
    title: "Feature title",
    titleTag: "h3",
    text: "Describe this feature or service in a couple of short sentences.",
    linkLabel: "Learn more",
    linkHref: "#",
    linkTarget: "_self",
    align: "center",
    background: "",
    radius: "12",
    shadow: "soft",
    ...spacingDefaults,
  },
  render: ({
    image,
    alt,
    title,
    titleTag,
    text,
    linkLabel,
    linkHref,
    linkTarget,
    align,
    background,
    radius,
    shadow,
    ...rest
  }) => {
    const Tag = titleTag || "h3";
    const shadowVal =
      shadow === "soft"
        ? "0 6px 20px rgba(0,0,0,.08)"
        : shadow === "medium"
        ? "0 12px 32px rgba(0,0,0,.14)"
        : shadow === "strong"
        ? "0 20px 50px rgba(0,0,0,.22)"
        : undefined;

    return (
      <div
        style={{
          textAlign: align || "center",
          background: background || undefined,
          borderRadius: radiusValue(radius),
          boxShadow: shadowVal,
          overflow: "hidden",
          height: "100%",
          ...spacingStyle(rest),
        }}
      >
        {image && (
          <img src={image} alt={alt || ""} style={{ width: "100%", height: "auto", display: "block" }} />
        )}
        <div style={{ padding: background || shadowVal ? 20 : "16px 0" }}>
          {title && <Tag style={{ marginBottom: 8 }}>{title}</Tag>}
          {text && <p style={{ marginBottom: linkLabel ? 14 : 0, opacity: 0.85 }}>{text}</p>}
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
      </div>
    );
  },
};
