"use client";

import { Tab, Tabs } from "react-bootstrap";
import { spacingFields, spacingDefaults, spacingStyle } from "../styleFields";

export const TabsWidget = {
  label: "Tabs",
  fields: {
    variant: {
      type: "select",
      label: "Style",
      options: [
        { label: "Tabs", value: "tabs" },
        { label: "Pills", value: "pills" },
        { label: "Underline", value: "underline" },
      ],
    },
    fill: {
      type: "radio",
      label: "Stretch full width",
      options: [
        { label: "No", value: false },
        { label: "Yes", value: true },
      ],
    },
    items: {
      type: "array",
      label: "Tabs",
      arrayFields: {
        label: { type: "text", label: "Tab label" },
        content: { type: "textarea", label: "Content (HTML allowed)" },
      },
      defaultItemProps: { label: "New tab", content: "<p>Tab content…</p>" },
      getItemSummary: (item, i) => item.label || `Tab ${i + 1}`,
    },
    ...spacingFields,
  },
  defaultProps: {
    variant: "tabs",
    fill: false,
    items: [
      { label: "Tab One", content: "<p>Content for the first tab.</p>" },
      { label: "Tab Two", content: "<p>Content for the second tab.</p>" },
      { label: "Tab Three", content: "<p>Content for the third tab.</p>" },
    ],
    ...spacingDefaults,
  },
  render: ({ variant, fill, items, ...rest }) => (
    <div style={spacingStyle(rest)}>
      <Tabs defaultActiveKey="0" variant={variant || "tabs"} fill={!!fill} className="mb-3">
        {(items || []).map((tab, i) => (
          <Tab eventKey={String(i)} title={tab.label || `Tab ${i + 1}`} key={i}>
            <div dangerouslySetInnerHTML={{ __html: tab.content || "" }} />
          </Tab>
        ))}
      </Tabs>
    </div>
  ),
};
