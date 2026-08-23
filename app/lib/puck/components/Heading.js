"use client";

import { createColorField, createAlignField } from "../fields";
import {
  spacingFields,
  spacingDefaults,
  spacingStyle,
  fontSizeOptions,
  fontWeightOptions,
} from "../styleFields";

export const Heading = {
  label: "Heading",
  fields: {
    text: { type: "text", label: "Text" },
    tag: {
      type: "select",
      label: "HTML tag",
      options: [
        { label: "H1", value: "h1" },
        { label: "H2", value: "h2" },
        { label: "H3", value: "h3" },
        { label: "H4", value: "h4" },
        { label: "H5", value: "h5" },
        { label: "H6", value: "h6" },
        { label: "Paragraph", value: "p" },
      ],
    },
    color: createColorField("Text color"),
    gradient: {
      type: "radio",
      label: "Gradient text",
      options: [
        { label: "Off", value: false },
        { label: "On", value: true },
      ],
    },
    align: createAlignField("Alignment"),
    fontSize: { type: "select", label: "Font size", options: fontSizeOptions },
    fontWeight: { type: "select", label: "Font weight", options: fontWeightOptions },
    className: { type: "text", label: "Extra CSS classes" },
    ...spacingFields,
  },
  defaultProps: {
    text: "Add your heading here",
    tag: "h2",
    color: "",
    gradient: false,
    align: "left",
    fontSize: "",
    fontWeight: "",
    className: "",
    ...spacingDefaults,
  },
  render: ({ text, tag, color, gradient, align, fontSize, fontWeight, className, ...rest }) => {
    const Tag = tag || "h2";
    const style = {
      textAlign: align || undefined,
      color: color || undefined,
      fontSize: fontSize ? `${fontSize}px` : undefined,
      fontWeight: fontWeight || undefined,
      ...spacingStyle(rest),
    };
    return (
      <Tag className={[gradient ? "gradient_text" : "", className].filter(Boolean).join(" ") || undefined} style={style}>
        {text}
      </Tag>
    );
  },
};
