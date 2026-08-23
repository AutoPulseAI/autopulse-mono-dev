import { NextResponse } from "next/server";
import { getPublishedNavPages } from "@lib/pages";

export async function GET() {
  try {
    const pages = await getPublishedNavPages();
    const navItems = pages.map((page) => ({
      title: page.navLabel || page.title,
      slug: page.slug,
      href: page.slug === "home" ? "/" : `/${page.slug}`,
    }));
    return NextResponse.json({ navItems });
  } catch (error) {
    console.error("Error fetching nav pages:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
