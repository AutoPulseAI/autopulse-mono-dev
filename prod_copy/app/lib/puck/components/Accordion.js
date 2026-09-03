"use client";

import { Accordion as BsAccordion } from "react-bootstrap";
import { spacingFields, spacingDefaults, spacingStyle } from "../styleFields";

export const Accordion = {
  label: "Accordion",
  fields: {
    alwaysOpen: {
      type: "radio",
      label: "Allow multiple open",
      options: [
        { label: "No", value: false },
        { label: "Yes", value: true },
      ],
    },
    flush: {
      type: "radio",
      label: "Flush (borderless)",
      options: [
        { label: "No", value: false },
        { label: "Yes", value: true },
      ],
    },
    items: {
      type: "array",
      label: "Items",
      arrayFields: {
        title: { type: "text", label: "Question / title" },
        content: { type: "textarea", label: "Answer (HTML allowed)" },
      },
      defaultItemProps: { title: "New question", content: "<p>Answer goes here…</p>" },
      getItemSummary: (item, i) => item.title || `Item ${i + 1}`,
    },
    ...spacingFields,
  },
  defaultProps: {
    alwaysOpen: false,
    flush: false,
    items: [
      { title: "What is your refund policy?", content: "<p>Explain your policy here.</p>" },
      { title: "How do I get started?", content: "<p>Describe the onboarding steps.</p>" },
    ],
    ...spacingDefaults,
  },
  render: ({ alwaysOpen, flush, items, ...rest }) => (
    <div style={spacingStyle(rest)}>
      <BsAccordion alwaysOpen={!!alwaysOpen} flush={!!flush} defaultActiveKey={alwaysOpen ? undefined : "0"}>
        {(items || []).map((item, i) => (
          <BsAccordion.Item eventKey={String(i)} key={i}>
            <BsAccordion.Header>{item.title || `Item ${i + 1}`}</BsAccordion.Header>
            <BsAccordion.Body>
              <div dangerouslySetInnerHTML={{ __html: item.content || "" }} />
            </BsAccordion.Body>
          </BsAccordion.Item>
        ))}
      </BsAccordion>
    </div>
  ),
};
