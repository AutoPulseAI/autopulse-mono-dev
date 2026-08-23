import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  CMS_SLUG_TO_FILE,
  CMS_SLUG_TITLES,
  CMS_BLANK_TEMPLATE,
  cmsPageBySlug,
} from "./cmsPageRegistry.js";

/** Resolve landing templates dir (works with next start and standalone builds). */
function resolveLandingDir() {
  const candidates = [
    path.join(process.cwd(), "public/vvvebjs/demo/landing"),
    path.join(process.cwd(), "../public/vvvebjs/demo/landing"),
    path.resolve(__dirname, "../../public/vvvebjs/demo/landing"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) {
      return dir;
    }
  }
  return candidates[0];
}

function extractBodyHtml(fullHtml) {
  const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(fullHtml);
  return (match ? match[1] : fullHtml).trim();
}

function extractSeoMeta(fullHtml) {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(fullHtml);
  const descMatch =
    /<meta\s+name=["']description["']\s+content=(?:"([^"]*)"|'([^']*)')/i.exec(fullHtml) ||
    /<meta\s+content=(?:"([^"]*)"|'([^']*)')\s+name=["']description["']/i.exec(fullHtml);
  return {
    title: titleMatch ? titleMatch[1].trim() : null,
    description: descMatch ? (descMatch[1] ?? descMatch[2] ?? "").trim() : null,
  };
}

export function getBlankVvvebBody() {
  const landingDir = resolveLandingDir();
  const filePath = path.join(landingDir, CMS_BLANK_TEMPLATE);
  if (!fs.existsSync(filePath)) return "";
  return extractBodyHtml(fs.readFileSync(filePath, "utf8"));
}

/**
 * Load a published Vvveb page from static HTML templates when the DB
 * has no record yet (e.g. fresh server before seed:cms:vvveb).
 */
export function getStaticVvvebPage(slug) {
  const file = CMS_SLUG_TO_FILE[slug];
  if (!file) return null;

  const landingDir = resolveLandingDir();
  const filePath = path.join(landingDir, file);
  if (!fs.existsSync(filePath)) {
    console.error(`getStaticVvvebPage: missing template ${filePath}`);
    return null;
  }

  const rawHtml = fs.readFileSync(filePath, "utf8");
  const bodyHtml = extractBodyHtml(rawHtml);
  if (!bodyHtml) return null;

  const seo = extractSeoMeta(rawHtml);
  const def = cmsPageBySlug(slug);

  return {
    slug,
    title: def?.title || CMS_SLUG_TITLES[slug] || slug,
    status: "published",
    editor: "vvveb",
    html: bodyHtml,
    meta: {
      title: seo.title || def?.title || slug,
      description: seo.description || undefined,
    },
    pageType: def?.pageType || "marketing",
  };
}

export { CMS_SLUG_TO_FILE as SLUG_TO_FILE };
