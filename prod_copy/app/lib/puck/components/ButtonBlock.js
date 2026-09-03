"use client";

import { createColorField } from "../fields";
import {
  spacingFields,
  spacingDefaults,
  spacingStyle,
  radiusOptions,
  radiusValue,
  targetOptions,
} from "../styleFields";

export const ButtonBlock = {
  label: "Button",
  fields: {
    label: { type: "text", label: "Button text" },
    href: { type: "text", label: "Link URL" },
    target: { type: "select", label: "Open in", options: targetOptions },
    icon: { type: "text", label: "Icon class (Font Awesome, optional)" },
    iconPosition: {
      type: "radio",
      label: "Icon position",
      options: [
        { label: "Left", value: "left" },
        { label: "Right", value: "right" },
      ],
    },
    variant: {
      type: "select",
      label: "Preset style",
      options: [
        { label: "Custom colors", value: "custom" },
        { label: "Brand filled", value: "frontfilled" },
        { label: "Brand outline", value: "nofrontfilled" },
        { label: "Primary", value: "primary" },
        { label: "Dark", value: "dark" },
      ],
    },
    bgColor: createColorField("Background color"),
    textColor: createColorField("Text color"),
    size: {
      type: "select",
      label: "Size",
      options: [
        { label: "Small", value: "sm" },
        { label: "Medium", value: "md" },
        { label: "Large", value: "lg" },
      ],
    },
    radius: { type: "select", label: "Corner radius", options: radiusOptions },
    fullWidth: {
      type: "radio",
      label: "Full width",
      options: [
        { label: "No", value: false },
        { label: "Yes", value: true },
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
    ...spacingFields,
  },
  defaultProps: {
    label: "Click here",
    href: "#",
    target: "_self",
    icon: "",
    iconPosition: "left",
    variant: "custom",
    bgColor: "#e5306b",
    textColor: "#ffffff",
    size: "md",
    radius: "6",
    fullWidth: false,
    align: "flex-start",
    ...spacingDefaults,
  },
  render: ({
    label,
    href,
    target,
    icon,
    iconPosition,
    variant,
    bgColor,
    textColor,
    size,
    radius,
    fullWidth,
    align,
    ...rest
  }) => {
    const pad = size === "sm" ? "8px 16px" : size === "lg" ? "16px 34px" : "12px 26px";
    const fontSize = size === "sm" ? 13 : size === "lg" ? 18 : 15;

    const usePreset = variant && variant !== "custom";
    const presetClass = usePreset ? `btn btn-${variant}` : "";

    const style = {
      display: fullWidth ? "block" : "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      textAlign: "center",
      textDecoration: "none",
      cursor: "pointer",
      fontWeight: 600,
      fontSize,
      padding: pad,
      borderRadius: radiusValue(radius),
      width: fullWidth ? "100%" : undefined,
      ...(usePreset
        ? {}
        : { background: bgColor || "#e5306b", color: textColor || "#fff", border: "none" }),
    };

    const iconEl = icon ? <i className={icon} aria-hidden="true" /> : null;

    return (
      <div style={{ display: "flex", justifyContent: align || "flex-start", ...spacingStyle(rest) }}>
        <a
          href={href || "#"}
          target={target || "_self"}
          rel={target === "_blank" ? "noopener noreferrer" : undefined}
          className={presetClass || undefined}
          style={style}
        >
          {iconPosition === "left" && iconEl}
          {label}
          {iconPosition === "right" && iconEl}
        </a>
      </div>
    );
  },
};
