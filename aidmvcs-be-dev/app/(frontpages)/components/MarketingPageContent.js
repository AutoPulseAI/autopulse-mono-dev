import { notFound } from "next/navigation";
import PuckPageRenderer from "../../components/PuckPageRenderer";
import HtmlPageRenderer from "../../components/HtmlPageRenderer";
import { isPageRenderable } from "@lib/pages";
import { withSmsConsentHtml } from "@lib/smsConsent";

export default function MarketingPageContent({ page }) {
  if (!isPageRenderable(page)) {
    notFound();
  }
  if (page.editor === "vvveb" && page.html) {
    return <HtmlPageRenderer html={withSmsConsentHtml(page.html)} />;
  }
  return <PuckPageRenderer data={page.content} />;
}
