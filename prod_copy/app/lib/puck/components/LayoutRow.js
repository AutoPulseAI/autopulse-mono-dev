"use client";

import { Container, Row } from "react-bootstrap";

const gutterClass = {
  none: "g-0",
  sm: "g-2",
  md: "g-3",
  lg: "g-4",
  xl: "g-5",
};

export const LayoutRow = {
  label: "Row",
  fields: {
    className: {
      type: "text",
      label: "Row CSS classes",
    },
    sectionClass: {
      type: "text",
      label: "Section wrapper classes",
    },
    useContainer: {
      type: "radio",
      label: "Wrap in container",
      options: [
        { label: "Yes", value: true },
        { label: "No (full width)", value: false },
      ],
    },
    containerFluid: {
      type: "radio",
      label: "Fluid container",
      options: [
        { label: "No", value: false },
        { label: "Yes", value: true },
      ],
    },
    containerClass: {
      type: "text",
      label: "Container CSS classes",
    },
    gutter: {
      type: "select",
      label: "Column gutter",
      options: [
        { label: "Default", value: "lg" },
        { label: "None", value: "none" },
        { label: "Small", value: "sm" },
        { label: "Medium", value: "md" },
        { label: "Large", value: "lg" },
        { label: "Extra large", value: "xl" },
      ],
    },
    columns: {
      type: "slot",
      label: "Columns",
      allow: ["LayoutColumn"],
    },
  },
  defaultProps: {
    className: "",
    sectionClass: "",
    useContainer: true,
    containerFluid: false,
    containerClass: "",
    gutter: "lg",
    columns: [],
  },
  render: ({
    className,
    sectionClass,
    useContainer,
    containerFluid,
    containerClass,
    gutter,
    columns: Columns,
  }) => {
    const rowClasses = [gutterClass[gutter] || "g-4", className].filter(Boolean).join(" ");
    const row = (
      <Row className={rowClasses || undefined}>
        <Columns style={{ display: "contents" }} minEmptyHeight={80} />
      </Row>
    );

    const inner = useContainer ? (
      <Container fluid={containerFluid} className={containerClass || undefined}>
        {row}
      </Container>
    ) : (
      row
    );

    if (sectionClass) {
      return <section className={sectionClass}>{inner}</section>;
    }

    return inner;
  },
};
