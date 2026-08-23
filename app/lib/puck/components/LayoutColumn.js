"use client";

import { Col } from "react-bootstrap";

const colOptions = [
  { label: "Equal (auto)", value: "auto" },
  { label: "Inherit", value: "" },
  { label: "12 (full)", value: "12" },
  { label: "9", value: "9" },
  { label: "8", value: "8" },
  { label: "7", value: "7" },
  { label: "6 (half)", value: "6" },
  { label: "5", value: "5" },
  { label: "4 (third)", value: "4" },
  { label: "3 (quarter)", value: "3" },
  { label: "2", value: "2" },
  { label: "1", value: "1" },
];

function toColProp(value) {
  if (value === "auto") return true; // bootstrap equal-width auto column
  if (!value || value === "") return undefined;
  const num = parseInt(value, 10);
  return Number.isNaN(num) ? undefined : num;
}

export const LayoutColumn = {
  label: "Column",
  fields: {
    className: {
      type: "text",
      label: "Column CSS classes",
    },
    colXs: { type: "select", label: "Width (XS)", options: colOptions },
    colSm: { type: "select", label: "Width (SM)", options: colOptions },
    colMd: { type: "select", label: "Width (MD)", options: colOptions },
    colLg: { type: "select", label: "Width (LG)", options: colOptions },
    colXl: { type: "select", label: "Width (XL)", options: colOptions },
    content: {
      type: "slot",
      label: "Content blocks",
      disallow: ["LayoutColumn"],
    },
  },
  defaultProps: {
    className: "",
    colXs: "12",
    colSm: "",
    colMd: "auto",
    colLg: "auto",
    colXl: "",
    content: [],
  },
  render: ({ className, colXs, colSm, colMd, colLg, colXl, content: Content }) => (
    <Col
      xs={toColProp(colXs)}
      sm={toColProp(colSm)}
      md={toColProp(colMd)}
      lg={toColProp(colLg)}
      xl={toColProp(colXl)}
      className={[className, "puck-layout-column"].filter(Boolean).join(" ")}
    >
      <Content className="puck-layout-column-content" minEmptyHeight={120} />
    </Col>
  ),
};
