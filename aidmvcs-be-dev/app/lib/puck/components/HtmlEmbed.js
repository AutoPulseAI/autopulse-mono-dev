"use client";

import { spacingFields, spacingDefaults, spacingStyle } from "../styleFields";

export const HtmlEmbed = {
  label: "HTML / Embed",
  fields: {
    html: {
      type: "textarea",
      label: "Custom HTML / embed code",
    },
    ...spacingFields,
  },
  defaultProps: {
    html: "<!-- Paste custom HTML or an embed snippet here -->",
    ...spacingDefaults,
  },
  render: ({ html, ...rest }) => (
    <div style={spacingStyle(rest)} dangerouslySetInnerHTML={{ __html: html || "" }} />
  ),
};
