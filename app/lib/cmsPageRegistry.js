/**
 * Single source of truth for Vvveb CMS marketing pages.
 *
 * When adding a page:
 *   1. Create public/vvvebjs/demo/landing/{file}.html
 *   2. Add an entry below
 *   3. Run: npm run seed:cms:vvveb
 *
 * Used by: seed scripts, vvveb-load API, static page fallback.
 */
export const CMS_VVVEB_PAGES = [
  {
    file: "index.html",
    slug: "home",
    title: "Home",
    pageType: "marketing",
    showInNav: true,
    navOrder: 0,
    navLabel: "Home",
  },
  {
    file: "about.html",
    slug: "about",
    title: "About Us",
    pageType: "marketing",
  },
  {
    file: "pricing.html",
    slug: "pricing",
    title: "Pricing",
    pageType: "marketing",
    showInNav: true,
    navOrder: 1,
    navLabel: "Pricing",
  },
  {
    file: "book-a-demo.html",
    slug: "book-a-demo",
    title: "Book A Demo",
    pageType: "marketing",
    showInNav: true,
    navOrder: 2,
    navLabel: "Book A Demo",
  },
  {
    file: "contact.html",
    slug: "contact",
    title: "Contact",
    pageType: "marketing",
    showInNav: true,
    navOrder: 3,
    navLabel: "Contact",
  },
  {
    file: "terms-of-services.html",
    slug: "terms-of-services",
    title: "Terms of Service",
    pageType: "legal",
    navOrder: 0,
    navLabel: "Terms of Services",
  },
  {
    file: "privacy-policy.html",
    slug: "privacy-policy",
    title: "Privacy Policy",
    pageType: "legal",
    navOrder: 1,
    navLabel: "Privacy Policy",
  },
];

/** Blank template for new custom pages in the editor (not seeded as a route). */
export const CMS_BLANK_TEMPLATE = "blank.html";

export function cmsPageUrl(slug) {
  return slug === "home" ? "/" : `/${slug}`;
}

export function cmsPageBySlug(slug) {
  return CMS_VVVEB_PAGES.find((p) => p.slug === slug) || null;
}

export function cmsNavPages() {
  return CMS_VVVEB_PAGES.filter((p) => p.showInNav)
    .sort((a, b) => (a.navOrder ?? 0) - (b.navOrder ?? 0))
    .map((p) => ({
      label: p.navLabel || p.title,
      url: cmsPageUrl(p.slug),
      order: p.navOrder ?? 0,
    }));
}

export function cmsLegalPages() {
  return CMS_VVVEB_PAGES.filter((p) => p.pageType === "legal")
    .sort((a, b) => (a.navOrder ?? 0) - (b.navOrder ?? 0))
    .map((p) => ({
      label: p.navLabel || p.title,
      url: cmsPageUrl(p.slug),
      order: p.navOrder ?? 0,
    }));
}

export const CMS_SLUG_TO_FILE = Object.fromEntries(
  CMS_VVVEB_PAGES.map((p) => [p.slug, p.file])
);

export const CMS_SLUG_TITLES = Object.fromEntries(
  CMS_VVVEB_PAGES.map((p) => [p.slug, p.title])
);
