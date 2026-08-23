"use client";

/**
 * Shared, rich style controls reused by every dynamic widget so each block
 * exposes a consistent set of Elementor-like options (spacing, alignment,
 * colors) without repeating field definitions everywhere.
 */

const spaceOptions = (defaultLabel = "Default") => [
  { label: defaultLabel, value: "" },
  { label: "0", value: "0" },
  { label: "4px", value: "4" },
  { label: "8px", value: "8" },
  { label: "12px", value: "12" },
  { label: "16px", value: "16" },
  { label: "24px", value: "24" },
  { label: "32px", value: "32" },
  { label: "48px", value: "48" },
  { label: "64px", value: "64" },
  { label: "80px", value: "80" },
  { label: "120px", value: "120" },
];

/** Spacing field fragment — spread into a widget's `fields`. */
export const spacingFields = {
  marginTop: { type: "select", label: "Margin top", options: spaceOptions() },
  marginBottom: { type: "select", label: "Margin bottom", options: spaceOptions() },
  paddingY: { type: "select", label: "Padding (top & bottom)", options: spaceOptions() },
  paddingX: { type: "select", label: "Padding (left & right)", options: spaceOptions() },
};

export const spacingDefaults = {
  marginTop: "",
  marginBottom: "",
  paddingY: "",
  paddingX: "",
};

/** Convert spacing props into an inline style object. */
export function spacingStyle({ marginTop, marginBottom, paddingY, paddingX } = {}) {
  const s = {};
  if (marginTop) s.marginTop = `${marginTop}px`;
  if (marginBottom) s.marginBottom = `${marginBottom}px`;
  if (paddingY) {
    s.paddingTop = `${paddingY}px`;
    s.paddingBottom = `${paddingY}px`;
  }
  if (paddingX) {
    s.paddingLeft = `${paddingX}px`;
    s.paddingRight = `${paddingX}px`;
  }
  return s;
}

export const alignOptions = [
  { label: "Left", value: "left" },
  { label: "Center", value: "center" },
  { label: "Right", value: "right" },
];

export const radiusOptions = [
  { label: "None", value: "0" },
  { label: "Small", value: "6" },
  { label: "Medium", value: "12" },
  { label: "Large", value: "20" },
  { label: "Pill", value: "999" },
  { label: "Circle", value: "50%" },
];

export function radiusValue(v) {
  if (!v || v === "0") return undefined;
  return v === "50%" ? "50%" : `${v}px`;
}

export const shadowOptions = [
  { label: "None", value: "none" },
  { label: "Soft", value: "0 6px 20px rgba(0,0,0,.08)" },
  { label: "Medium", value: "0 12px 32px rgba(0,0,0,.14)" },
  { label: "Strong", value: "0 20px 50px rgba(0,0,0,.22)" },
];

export const fontSizeOptions = [
  { label: "Default", value: "" },
  { label: "XS (12px)", value: "12" },
  { label: "Small (14px)", value: "14" },
  { label: "Base (16px)", value: "16" },
  { label: "Medium (18px)", value: "18" },
  { label: "Large (22px)", value: "22" },
  { label: "XL (28px)", value: "28" },
  { label: "2XL (36px)", value: "36" },
  { label: "3XL (48px)", value: "48" },
  { label: "4XL (64px)", value: "64" },
];

export const fontWeightOptions = [
  { label: "Default", value: "" },
  { label: "Light (300)", value: "300" },
  { label: "Normal (400)", value: "400" },
  { label: "Medium (500)", value: "500" },
  { label: "Semibold (600)", value: "600" },
  { label: "Bold (700)", value: "700" },
  { label: "Extra bold (800)", value: "800" },
];

export const targetOptions = [
  { label: "Same tab", value: "_self" },
  { label: "New tab", value: "_blank" },
];

/** Wrap children in a link when href is set, otherwise return children as-is. */
export function maybeLink(href, target, children, className, style) {
  if (!href) return children;
  return (
    <a
      href={href}
      target={target || "_self"}
      rel={target === "_blank" ? "noopener noreferrer" : undefined}
      className={className}
      style={style}
    >
      {children}
    </a>
  );
}
