"use client";

import { createColorField } from "../fields";

export const Spacer = {
  label: "Spacer",
  fields: {
    height: {
      type: "number",
      label: "Height (px)",
      min: 0,
      max: 600,
    },
  },
  defaultProps: { height: 48 },
  render: ({ height }) => <div style={{ height: `${height ?? 48}px` }} aria-hidden="true" />,
};

export const Divider = {
  label: "Divider",
  fields: {
    style: {
      type: "select",
      label: "Line style",
      options: [
        { label: "Solid", value: "solid" },
        { label: "Dashed", value: "dashed" },
        { label: "Dotted", value: "dotted" },
      ],
    },
    color: createColorField("Color"),
    thickness: {
      type: "select",
      label: "Thickness",
      options: [
        { label: "1px", value: "1" },
        { label: "2px", value: "2" },
        { label: "3px", value: "3" },
        { label: "5px", value: "5" },
      ],
    },
    width: {
      type: "select",
      label: "Width",
      options: [
        { label: "Full", value: "100%" },
        { label: "75%", value: "75%" },
        { label: "50%", value: "50%" },
        { label: "25%", value: "25%" },
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
    gap: {
      type: "select",
      label: "Vertical spacing",
      options: [
        { label: "Small", value: "12" },
        { label: "Medium", value: "24" },
        { label: "Large", value: "48" },
      ],
    },
  },
  defaultProps: {
    style: "solid",
    color: "#d9dee7",
    thickness: "1",
    width: "100%",
    align: "center",
    gap: "24",
  },
  render: ({ style, color, thickness, width, align, gap }) => (
    <div style={{ display: "flex", justifyContent: align || "center", margin: `${gap || 24}px 0` }}>
      <hr
        style={{
          width: width || "100%",
          border: 0,
          borderTop: `${thickness || 1}px ${style || "solid"} ${color || "#d9dee7"}`,
          opacity: 1,
          margin: 0,
        }}
      />
    </div>
  ),
};
