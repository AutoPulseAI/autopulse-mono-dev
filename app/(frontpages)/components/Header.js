"use client";

import React, { useEffect, useState } from "react";
import { Navbar, Nav, Container, Button, Image, Spinner } from "react-bootstrap";
import { usePathname, useRouter } from "next/navigation";

const FALLBACK_NAV = [
  { title: "Home", href: "/" },
  { title: "Pricing", href: "/pricing" },
  { title: "Book A Demo", href: "/book-a-demo" },
  { title: "Contact", href: "/contact" },
];

const Header = () => {
  const pathname = usePathname();
  const router = useRouter();
  const [clickedPath, setClickedPath] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [navItems, setNavItems] = useState(FALLBACK_NAV);
  const [loadingNav, setLoadingNav] = useState(true);

  useEffect(() => {
    setClickedPath(null);
    setExpanded(false);
  }, [pathname]);

  useEffect(() => {
    // Admin-managed menu first; fall back to published pages nav
    fetch("/api/menu")
      .then((res) => res.json())
      .then(async (data) => {
        if (data.items?.length > 0) {
          setNavItems(
            data.items.map((item) => ({
              title: item.label,
              href: item.url,
              target: item.target,
            }))
          );
          return;
        }
        const res = await fetch("/api/pages/nav");
        const pagesNav = await res.json();
        if (pagesNav.navItems?.length > 0) {
          setNavItems(pagesNav.navItems);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingNav(false));
  }, []);

  const handleClick = (path) => (e) => {
    e.preventDefault();
    setClickedPath(path);
    setExpanded(false);
    setTimeout(() => router.push(path), 100);
  };

  const isActive = (path) => {
    if (clickedPath) return clickedPath === path;
    if (path === "/") return pathname === "/";
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  return (
    <Navbar
      expand="lg"
      bg="none"
      expanded={expanded}
      onToggle={(val) => setExpanded(val)}
      className="header_main position-absolute start-0 end-0 top-0"
    >
      <Container fluid>
        <Navbar.Toggle aria-controls="main-navbar" />
        <Navbar.Brand href="/" className="me-lg-0 me-auto">
          <Image
            src="/Images/logo-w.png"
            alt="Logo"
            height="60"
            className="d-inline-block align-top"
          />
        </Navbar.Brand>

        <Navbar.Collapse id="main-navbar">
          <Nav className="mx-lg-auto">
            {loadingNav ? (
              <Spinner size="sm" animation="border" className="my-2" />
            ) : (
              navItems.map((item) =>
                item.target === "_blank" ? (
                  <Nav.Link
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.title}
                  </Nav.Link>
                ) : (
                  <Nav.Link
                    key={item.href}
                    href={item.href}
                    onClick={handleClick(item.href)}
                    className={isActive(item.href) ? "active" : ""}
                  >
                    {item.title}
                  </Nav.Link>
                )
              )
            )}
            {!navItems.some((i) => i.href === "/book-a-demo") && (
              <Nav.Link
                href="/book-a-demo"
                onClick={handleClick("/book-a-demo")}
                className={isActive("/book-a-demo") ? "active" : ""}
              >
                Book A Demo
              </Nav.Link>
            )}
          </Nav>
        </Navbar.Collapse>

        <div className="d-flex align-items-center">
          <Button variant="link" as="a" href="/dealer">
            <i className="fa-regular fa-arrow-right-to-bracket me-2"></i>Dealer
          </Button>
          <Button variant="frontbluefilled" as="a" href="/agency" className="ms-xl-3 ms-lg-2">
            <i className="fa-regular fa-arrow-right-to-bracket me-2"></i>Agency
          </Button>
        </div>
      </Container>
    </Navbar>
  );
};

export default Header;
