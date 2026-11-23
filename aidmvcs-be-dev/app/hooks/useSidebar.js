"use client";
// The side menu of the dealer, agency and super admin screens (18 Nov 2026: "closing the drawer does not mean it
// should fully remove the side panel ... it keeps the icons clickable, and only the text is hidden").
//   - Wide screens (992px and up): the menu is open (icons + names) or narrow (icons only, the name on hover). The
//     choice is remembered in this browser.
//   - Smaller screens: the menu slides in over the page and closes again, as before.
import { useCallback, useEffect, useState } from "react";

const WIDE = 992;
const KEY = "sidebar_narrow";
const isWide = () => typeof window !== "undefined" && window.innerWidth >= WIDE;
const remembered = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const remember = (narrow) => { try { localStorage.setItem(KEY, narrow ? "1" : "0"); } catch { /* private window */ } };

/** [isOpen, toggle, close] for the layout. */
export function useSidebar() {
  const [isOpen, setIsOpen] = useState(true);
  useEffect(() => {
    let wide = isWide();
    setIsOpen(wide && !remembered());
    // Only crossing the breakpoint changes it (a small resize keeps what the person picked).
    const onResize = () => {
      const now = isWide();
      if (now !== wide) { wide = now; setIsOpen(now && !remembered()); }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const toggle = useCallback(() => setIsOpen((open) => { if (isWide()) remember(open); return !open; }), []);
  const close = useCallback(() => setIsOpen(false), []);
  return [isOpen, toggle, close];
}

/** While the menu is narrow, each item's name shows on hover (its title). */
export function useSidebarTitles(ref, isOpen) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const apply = () => root.querySelectorAll(".nav-link").forEach((el) => {
      const name = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").trim();
      if (!isOpen && name) el.setAttribute("title", name); else el.removeAttribute("title");
    });
    apply();
    // Submenus open and close: their items get the title too.
    const observer = new MutationObserver(apply);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ref, isOpen]);
}
