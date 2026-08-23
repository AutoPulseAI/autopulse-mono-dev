"use client";

/**
 * Widget metadata for the Elementor-style component drawer.
 * Maps each Puck component name to an icon + short description so the
 * left panel can render polished widget tiles instead of plain rows.
 */
import {
  TbLayout,
  TbColumns2,
  TbColumns3,
  TbLayoutGrid,
  TbLayoutRows,
  TbLayoutColumns,
  TbHeading,
  TbTypography,
  TbPointer,
  TbPhoto,
  TbStar,
  TbSeparatorHorizontal,
  TbArrowsVertical,
  TbLayoutSidebar,
  TbSticker,
  TbVideo,
  TbGridDots,
  TbLayoutNavbar,
  TbListDetails,
  TbListCheck,
  TbQuote,
  TbInfoCircle,
  TbCode,
  TbMap,
  TbMail,
  TbBox,
} from "react-icons/tb";

export const componentMeta = {
  // Layout
  LayoutSection: { icon: TbLayout, description: "Full-width block wrapper" },
  Columns2: { icon: TbColumns2, description: "Two equal columns" },
  Columns3: { icon: TbColumns3, description: "Three equal columns" },
  Columns4: { icon: TbLayoutGrid, description: "Four equal columns" },
  LayoutRow: { icon: TbLayoutRows, description: "Row of columns" },
  LayoutColumn: { icon: TbLayoutColumns, description: "Resizable column" },
  // Basic
  Heading: { icon: TbHeading, description: "Title text (H1–H6)" },
  TextBlock: { icon: TbTypography, description: "Rich text editor" },
  ButtonBlock: { icon: TbPointer, description: "Link button" },
  ImageWidget: { icon: TbPhoto, description: "Single image" },
  IconWidget: { icon: TbStar, description: "Font Awesome icon" },
  Divider: { icon: TbSeparatorHorizontal, description: "Horizontal line" },
  Spacer: { icon: TbArrowsVertical, description: "Vertical spacing" },
  // Media
  ImageBox: { icon: TbLayoutSidebar, description: "Image, text & link" },
  IconBox: { icon: TbSticker, description: "Icon, text & link" },
  VideoWidget: { icon: TbVideo, description: "YouTube / Vimeo / MP4" },
  Gallery: { icon: TbGridDots, description: "Image grid" },
  // Interactive
  TabsWidget: { icon: TbLayoutNavbar, description: "Tabbed content" },
  Accordion: { icon: TbListDetails, description: "Collapsible items" },
  IconList: { icon: TbListCheck, description: "Icon bullet list" },
  Testimonial: { icon: TbQuote, description: "Customer quote" },
  AlertBox: { icon: TbInfoCircle, description: "Notice / callout" },
  // Advanced
  HtmlEmbed: { icon: TbCode, description: "Custom HTML embed" },
  GoogleMap: { icon: TbMap, description: "Embedded map" },
  ContactForm: { icon: TbMail, description: "Lead capture form" },
};

export function getComponentMeta(name) {
  return componentMeta[name] || { icon: TbBox, description: "" };
}

export default componentMeta;
