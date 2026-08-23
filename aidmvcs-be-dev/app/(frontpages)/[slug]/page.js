import { notFound } from "next/navigation";
import { getPublishedPage } from "@lib/pages";
import MarketingPageContent from "../components/MarketingPageContent";

const RESERVED_SLUGS = ["booking"];

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  if (RESERVED_SLUGS.includes(slug)) return {};
  const page = await getPublishedPage(slug);
  if (!page) return {};
  return {
    title: page.meta?.title || page.title,
    description: page.meta?.description || undefined,
    openGraph: page.meta?.ogImage ? { images: [page.meta.ogImage] } : undefined,
  };
}

export default async function DynamicMarketingPage({ params }) {
  const { slug } = await params;
  if (RESERVED_SLUGS.includes(slug) || slug === "home") {
    notFound();
  }

  const page = await getPublishedPage(slug);
  if (!page) {
    notFound();
  }

  return <MarketingPageContent page={page} />;
}
