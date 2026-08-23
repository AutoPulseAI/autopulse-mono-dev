"use client";

import { useEffect } from "react";

export default function PageEditorLayout({ children }) {
  useEffect(() => {
    document.body.classList.add("page-editor-active");
    const sidebar = document.querySelector(".sidebar");
    const topbar = document.querySelector(".topbar");
    const mainContent = document.querySelector(".main_content");
    if (sidebar) sidebar.style.display = "none";
    if (topbar) topbar.style.display = "none";
    if (mainContent) {
      mainContent.style.marginLeft = "0";
      mainContent.style.padding = "0";
    }
    return () => {
      document.body.classList.remove("page-editor-active");
      if (sidebar) sidebar.style.display = "";
      if (topbar) topbar.style.display = "";
      if (mainContent) {
        mainContent.style.marginLeft = "";
        mainContent.style.padding = "";
      }
    };
  }, []);

  return <>{children}</>;
}
