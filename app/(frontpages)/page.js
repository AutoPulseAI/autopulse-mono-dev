import { notFound } from "next/navigation";
import { getPublishedPage } from "@lib/pages";
import MarketingPageContent from "./components/MarketingPageContent";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const page = await getPublishedPage("home");
  if (!page) {
    return { title: "Autopulse.Ai | Keeping your dealership's lead management alive" };
  }
  return {
    title: page.meta?.title || page.title,
    description: page.meta?.description || undefined,
    openGraph: page.meta?.ogImage ? { images: [page.meta.ogImage] } : undefined,
  };
}

export default async function HomePage() {
  const page = await getPublishedPage("home");
  if (!page) {
    notFound();
  }
  return <MarketingPageContent page={page} />;
}
