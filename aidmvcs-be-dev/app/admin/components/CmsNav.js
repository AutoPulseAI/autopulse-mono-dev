"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Nav } from "react-bootstrap";

const CMS_TABS = [
  { href: "/admin/pages", label: "Pages", icon: "fa-regular fa-file-lines" },
  { href: "/admin/menu", label: "Menu", icon: "fa-regular fa-bars" },
  { href: "/admin/site-settings", label: "Site Settings", icon: "fa-regular fa-gear" },
];

export default function CmsNav() {
  const pathname = usePathname();

  return (
    <Nav variant="pills" className="cms-nav flex-wrap">
      {CMS_TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Nav.Item key={tab.href}>
            <Link href={tab.href} className={`nav-link${active ? " active" : ""}`}>
              <i className={`${tab.icon} me-2`}></i>
              {tab.label}
            </Link>
          </Nav.Item>
        );
      })}
    </Nav>
  );
}
