"use client";

import { Container } from "react-bootstrap";
import { createColorField, createAlignField } from "../fields";

const paddingMap = {
  "": null,
  none: "0px",
  sm: "24px",
  md: "48px",
  lg: "80px",
  xl: "120px",
};

const minHeightMap = {
  auto: null,
  half: "50vh",
  full: "100vh",
};

export const LayoutSection = {
  label: "Section",
  fields: {
    className: {
      type: "text",
      label: "Section CSS classes",
    },
    useContainer: {
      type: "radio",
      label: "Wrap in container",
      options: [
        { label: "Yes", value: true },
        { label: "No", value: false },
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
    // --- Style controls (Elementor-like) ---
    background: createColorField("Background color"),
    padding: {
      type: "select",
      label: "Vertical padding",
      options: [
        { label: "Use CSS class", value: "" },
        { label: "None", value: "none" },
        { label: "Small", value: "sm" },
        { label: "Medium", value: "md" },
        { label: "Large", value: "lg" },
        { label: "Extra large", value: "xl" },
      ],
    },
    align: createAlignField("Content alignment"),
    minHeight: {
      type: "select",
      label: "Minimum height",
      options: [
        { label: "Auto", value: "auto" },
        { label: "Half screen (50vh)", value: "half" },
        { label: "Full screen (100vh)", value: "full" },
      ],
    },
    content: {
      type: "slot",
      label: "Rows & blocks",
    },
  },
  defaultProps: {
    className: "section_padding",
    useContainer: true,
    containerFluid: false,
    containerClass: "",
    background: "",
    padding: "",
    align: "",
    minHeight: "auto",
    content: [],
  },
  render: ({
    className,
    useContainer,
    containerFluid,
    containerClass,
    background,
    padding,
    align,
    minHeight,
    content: Content,
  }) => {
    const body = <Content className="puck-layout-section-content" minEmptyHeight={100} />;

    const pad = paddingMap[padding];
    const minH = minHeightMap[minHeight];

    const style = {};
    if (background) style.background = background;
    if (pad) {
      style.paddingTop = pad;
      style.paddingBottom = pad;
    }
    if (align) style.textAlign = align;
    if (minH) {
      style.minHeight = minH;
      style.display = "flex";
      style.flexDirection = "column";
      style.justifyContent = "center";
    }

    return (
      <section
        className={className || undefined}
        style={Object.keys(style).length ? style : undefined}
      >
        {useContainer ? (
          <Container fluid={containerFluid} className={containerClass || undefined} style={{ width: "100%" }}>
            {body}
          </Container>
        ) : (
          body
        )}
      </section>
    );
  },
};
