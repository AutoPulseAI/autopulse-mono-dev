"use client";

import { spacingFields, spacingDefaults, spacingStyle } from "../styleFields";

const palette = {
  info: { bg: "#e7f1ff", border: "#9ec5ff", text: "#084298", icon: "fa-solid fa-circle-info" },
  success: { bg: "#e8f6ec", border: "#a3d9b1", text: "#0f5132", icon: "fa-solid fa-circle-check" },
  warning: { bg: "#fff6e5", border: "#ffd591", text: "#664d03", icon: "fa-solid fa-triangle-exclamation" },
  danger: { bg: "#fdecea", border: "#f1a9a0", text: "#842029", icon: "fa-solid fa-circle-exclamation" },
};

export const AlertBox = {
  label: "Alert / Notice",
  fields: {
    type: {
      type: "select",
      label: "Type",
      options: [
        { label: "Info", value: "info" },
        { label: "Success", value: "success" },
        { label: "Warning", value: "warning" },
        { label: "Danger", value: "danger" },
      ],
    },
    title: { type: "text", label: "Title (optional)" },
    text: { type: "textarea", label: "Message" },
    showIcon: {
      type: "radio",
      label: "Show icon",
      options: [
        { label: "Yes", value: true },
        { label: "No", value: false },
      ],
    },
    ...spacingFields,
  },
  defaultProps: {
    type: "info",
    title: "",
    text: "This is an important message for your visitors.",
    showIcon: true,
    ...spacingDefaults,
  },
  render: ({ type, title, text, showIcon, ...rest }) => {
    const c = palette[type] || palette.info;
    return (
      <div
        style={{
          display: "flex",
          gap: 12,
          background: c.bg,
          border: `1px solid ${c.border}`,
          color: c.text,
          borderRadius: 10,
          padding: "14px 18px",
          ...spacingStyle(rest),
        }}
      >
        {showIcon && <i className={c.icon} style={{ marginTop: 3 }} aria-hidden="true" />}
        <div>
          {title && <strong style={{ display: "block", marginBottom: 2 }}>{title}</strong>}
          <span>{text}</span>
        </div>
      </div>
    );
  },
};
