"use client";

import { LayoutSection } from "./components/LayoutSection";
import { Columns2, Columns3, Columns4 } from "./components/Columns";
import { LayoutRow } from "./components/LayoutRow";
import { LayoutColumn } from "./components/LayoutColumn";
import { Heading } from "./components/Heading";
import { TextBlock } from "./components/TextBlock";
import { ButtonBlock } from "./components/ButtonBlock";
import { ImageWidget } from "./components/ImageWidget";
import { IconWidget } from "./components/IconWidget";
import { Spacer, Divider } from "./components/Spacer";
import { ImageBox } from "./components/ImageBox";
import { IconBox } from "./components/IconBox";
import { VideoWidget } from "./components/VideoWidget";
import { Gallery } from "./components/Gallery";
import { TabsWidget } from "./components/TabsWidget";
import { Accordion } from "./components/Accordion";
import { IconList } from "./components/IconList";
import { Testimonial } from "./components/Testimonial";
import { AlertBox } from "./components/AlertBox";
import { HtmlEmbed } from "./components/HtmlEmbed";
import { GoogleMap } from "./components/GoogleMap";
import { ContactForm } from "./components/ContactForm";

export const puckConfig = {
  components: {
    // Layout
    LayoutSection,
    Columns2,
    Columns3,
    Columns4,
    LayoutRow,
    LayoutColumn,
    // Basic
    Heading,
    TextBlock,
    ButtonBlock,
    ImageWidget,
    IconWidget,
    Divider,
    Spacer,
    // Media
    ImageBox,
    IconBox,
    VideoWidget,
    Gallery,
    // Interactive
    TabsWidget,
    Accordion,
    IconList,
    Testimonial,
    AlertBox,
    // Advanced
    HtmlEmbed,
    GoogleMap,
    ContactForm,
  },
  categories: {
    layout: {
      title: "Layout",
      components: ["LayoutSection", "Columns2", "Columns3", "Columns4", "LayoutRow", "LayoutColumn"],
    },
    basic: {
      title: "Basic",
      components: ["Heading", "TextBlock", "ButtonBlock", "ImageWidget", "IconWidget", "Divider", "Spacer"],
    },
    media: {
      title: "Media",
      components: ["ImageBox", "IconBox", "VideoWidget", "Gallery"],
    },
    interactive: {
      title: "Interactive",
      components: ["TabsWidget", "Accordion", "IconList", "Testimonial", "AlertBox"],
    },
    advanced: {
      title: "Advanced",
      components: ["HtmlEmbed", "GoogleMap", "ContactForm"],
    },
  },
  root: {
    fields: {
      title: { type: "text", label: "Page title (internal)" },
    },
    render: ({ children }) => <>{children}</>,
  },
};

export default puckConfig;
