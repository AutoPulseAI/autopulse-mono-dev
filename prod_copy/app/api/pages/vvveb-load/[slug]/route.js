import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import dbConnect from "@lib/mongodb";
import Page from "@models/Page";
import { normalizeSlug } from "@lib/pages";
import { getBlankVvvebBody } from "@lib/vvvebStatic";
import { CMS_SLUG_TO_FILE, CMS_BLANK_TEMPLATE } from "@lib/cmsPageRegistry";

const SLUG_TO_FILE = {
  ...CMS_SLUG_TO_FILE,
  blank: CMS_BLANK_TEMPLATE,
};

const LANDING_DIR_CANDIDATES = [
  path.join(process.cwd(), "public/vvvebjs/demo/landing"),
  path.join(process.cwd(), "../public/vvvebjs/demo/landing"),
];

function resolveLandingDir() {
  for (const dir of LANDING_DIR_CANDIDATES) {
    if (fs.existsSync(path.join(dir, "blank.html"))) return dir;
  }
  return LANDING_DIR_CANDIDATES[0];
}

function htmlResponse(html) {
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapDocument(page, bodyHtml) {
  const title = page.meta?.title || `${page.title || page.slug} | Autopulse.Ai`;
  const description = page.meta?.description || "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="/fontawesome/css/all.min.css" rel="stylesheet">
  <link href="/vvvebjs/demo/landing/styles/autopulse.css" rel="stylesheet">
</head>
<body>
${bodyHtml}
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>`;
}

function readStaticTemplate(slug) {
  const file = SLUG_TO_FILE[slug];
  if (!file) return null;
  const filePath = path.join(resolveLandingDir(), file);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

export async function GET(request, { params }) {
  const { slug: rawSlug } = await params;
  const slug = normalizeSlug(rawSlug === "index" ? "home" : rawSlug);

  let page = null;
  if (slug !== "blank") {
    try {
      await dbConnect();
      page = await Page.findOne({ slug }).lean();
      if (page?.html?.trim()) {
        return htmlResponse(wrapDocument(page, page.html));
      }
    } catch (error) {
      console.error("vvveb-load: DB lookup failed, using template fallback", error);
    }
  }

  const staticHtml = readStaticTemplate(slug);
  if (staticHtml) {
    return htmlResponse(staticHtml);
  }

  // New/custom pages: use blank template with page metadata from DB
  if (page) {
    const blankBody = getBlankVvvebBody();
    if (blankBody) {
      return htmlResponse(wrapDocument(page, blankBody));
    }
  }

  return new NextResponse("Page not found", { status: 404 });
}
