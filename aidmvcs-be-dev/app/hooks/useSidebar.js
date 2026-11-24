"use client";
// The side menu of the dealer, agency and super admin screens (18 Nov 2026: "closing the drawer does not mean it
// should fully remove the side panel ... it keeps the icons clickable, and only the text is hidden").
//   - Wide screens (992px and up): the menu is open (icons + names) or narrow (icons only, the name on hover). The
//     choice is remembered in this browser.
//   - Smaller screens: the menu slides in over the page and closes again, as before.
import { useCallback, useEffect, useState } from "react";

// 24 Nov 2026 (the user: "when we are moving to the smaller screen, we should automatically close the drawer to get
// more room"): below ROOMY (a laptop, or a big screen zoomed in) the menu goes narrow by itself; back above it, the
// person's own choice returns. Zooming in changes the width the page sees, so it follows zoom too.
const WIDE = 992;
const ROOMY = 1400;
const KEY = "sidebar_narrow";
const isWide = () => typeof window !== "undefined" && window.innerWidth >= WIDE;
const isRoomy = () => typeof window !== "undefined" && window.innerWidth >= ROOMY;
const remembered = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const startOpen = () => isWide() && isRoomy() && !remembered();
const remember = (narrow) => { try { localStorage.setItem(KEY, narrow ? "1" : "0"); } catch { /* private window */ } };

/** [isOpen, toggle, close] for the layout. */
export function useSidebar() {
  const [isOpen, setIsOpen] = useState(true);
  useEffect(() => {
    const size = () => (isRoomy() ? "roomy" : isWide() ? "wide" : "small");
    let was = size();
    setIsOpen(startOpen());
    // Only crossing a breakpoint changes it (a small resize keeps what the person picked).
    const onResize = () => {
      const now = size();
      if (now !== was) { was = now; setIsOpen(startOpen()); }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Only a choice made with room to spare is remembered (narrowing on a small screen is not a preference).
  const toggle = useCallback(() => setIsOpen((open) => { if (isRoomy()) remember(open); return !open; }), []);
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
