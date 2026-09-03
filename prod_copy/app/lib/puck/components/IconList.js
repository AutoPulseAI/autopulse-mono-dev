"use client";

import { createColorField } from "../fields";
import { spacingFields, spacingDefaults, spacingStyle } from "../styleFields";

export const IconList = {
  label: "Icon List",
  fields: {
    iconColor: createColorField("Icon color"),
    gap: {
      type: "select",
      label: "Row spacing",
      options: [
        { label: "Tight", value: "6" },
        { label: "Normal", value: "12" },
        { label: "Relaxed", value: "18" },
      ],
    },
    items: {
      type: "array",
      label: "List items",
      arrayFields: {
        icon: { type: "text", label: "Icon class (Font Awesome)" },
        text: { type: "text", label: "Text" },
        href: { type: "text", label: "Link (optional)" },
      },
      defaultItemProps: { icon: "fa-solid fa-check", text: "List item", href: "" },
      getItemSummary: (item, i) => item.text || `Item ${i + 1}`,
    },
    ...spacingFields,
  },
  defaultProps: {
    iconColor: "#e5306b",
    gap: "12",
    items: [
      { icon: "fa-solid fa-check", text: "First benefit or feature", href: "" },
      { icon: "fa-solid fa-check", text: "Second benefit or feature", href: "" },
      { icon: "fa-solid fa-check", text: "Third benefit or feature", href: "" },
    ],
    ...spacingDefaults,
  },
  render: ({ iconColor, gap, items, ...rest }) => (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, ...spacingStyle(rest) }}>
      {(items || []).map((item, i) => (
        <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: `${gap || 12}px` }}>
          <i
            className={item.icon || "fa-solid fa-check"}
            style={{ color: iconColor || undefined, marginTop: 3, flex: "0 0 auto" }}
            aria-hidden="true"
          />
          <span>
            {item.href ? (
              <a href={item.href} style={{ color: "inherit", textDecoration: "none" }}>
                {item.text}
              </a>
            ) : (
              item.text
            )}
          </span>
        </li>
      ))}
    </ul>
  ),
};
