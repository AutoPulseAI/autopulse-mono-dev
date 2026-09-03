"use client";

import { createColorField, createAlignField, createRichTextField } from "../fields";
import {
  spacingFields,
  spacingDefaults,
  spacingStyle,
  fontSizeOptions,
} from "../styleFields";

export const TextBlock = {
  label: "Text Editor",
  fields: {
    content: createRichTextField("Content"),
    color: createColorField("Text color"),
    align: createAlignField("Alignment"),
    fontSize: { type: "select", label: "Font size", options: fontSizeOptions },
    maxWidth: {
      type: "select",
      label: "Max width",
      options: [
        { label: "Full", value: "" },
        { label: "Narrow (640px)", value: "640" },
        { label: "Medium (820px)", value: "820" },
        { label: "Wide (1040px)", value: "1040" },
      ],
    },
    ...spacingFields,
  },
  defaultProps: {
    content: "<p>Start writing your content here. Use the toolbar to format text, add links and more.</p>",
    color: "",
    align: "left",
    fontSize: "",
    maxWidth: "",
    ...spacingDefaults,
  },
  render: ({ content, color, align, fontSize, maxWidth, ...rest }) => {
    const style = {
      textAlign: align || undefined,
      color: color || undefined,
      fontSize: fontSize ? `${fontSize}px` : undefined,
      maxWidth: maxWidth ? `${maxWidth}px` : undefined,
      marginLeft: maxWidth && align === "center" ? "auto" : undefined,
      marginRight: maxWidth && align === "center" ? "auto" : undefined,
      ...spacingStyle(rest),
    };
    return (
      <div
        className="puck-text-block"
        style={style}
        dangerouslySetInnerHTML={{ __html: content || "" }}
      />
    );
  },
};
