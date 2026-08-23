"use client";

import { Container, Row } from "react-bootstrap";

const gutterClass = { none: "g-0", sm: "g-2", md: "g-3", lg: "g-4", xl: "g-5" };

const gutterField = {
  type: "select",
  label: "Gap between columns",
  options: [
    { label: "None", value: "none" },
    { label: "Small", value: "sm" },
    { label: "Medium", value: "md" },
    { label: "Large", value: "lg" },
    { label: "Extra large", value: "xl" },
  ],
};

const containerField = {
  type: "radio",
  label: "Wrap in container",
  options: [
    { label: "No (inside a Section)", value: false },
    { label: "Yes", value: true },
  ],
};

// Build a real LayoutColumn child so each column is an independent, proven
// drop zone (same component used everywhere else). Puck assigns ids on insert.
const makeColumn = (width) => ({
  type: "LayoutColumn",
  props: {
    className: "",
    colXs: "12",
    colSm: "",
    colMd: String(width),
    colLg: String(width),
    colXl: "",
    content: [],
  },
});

/**
 * Factory for a fixed-structure columns block.
 * @param {string} label   Drawer label
 * @param {number[]} widths Bootstrap widths (out of 12) for each column
 */
function columnsPreset(label, widths) {
  return {
    label,
    fields: {
      gutter: gutterField,
      useContainer: containerField,
      columns: {
        type: "slot",
        label: "Columns",
        allow: ["LayoutColumn"],
      },
    },
    defaultProps: {
      gutter: "lg",
      useContainer: false,
      columns: widths.map(makeColumn),
    },
    render: ({ gutter, useContainer, columns: ColumnsSlot }) => {
      const row = (
        <Row className={gutterClass[gutter] || "g-4"}>
          <ColumnsSlot style={{ display: "contents" }} minEmptyHeight={100} />
        </Row>
      );
      return useContainer ? <Container>{row}</Container> : row;
    },
  };
}

export const Columns2 = columnsPreset("2 Columns", [6, 6]);
export const Columns3 = columnsPreset("3 Columns", [4, 4, 4]);
export const Columns4 = columnsPreset("4 Columns", [3, 3, 3, 3]);
