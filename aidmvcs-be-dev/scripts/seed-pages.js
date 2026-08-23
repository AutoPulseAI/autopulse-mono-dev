/**
 * Seeds marketing pages composed from the dynamic Puck widget library
 * (Heading, Text Editor, Button, Image Box, Icon Box, Accordion, …).
 * Run: node scripts/seed-pages.js
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

import { normalizePuckData } from "../app/lib/puck/normalizeData.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const PageSchema = new mongoose.Schema(
  {
    title: String,
    slug: { type: String, unique: true },
    status: String,
    showInNav: Boolean,
    navOrder: Number,
    navLabel: String,
    meta: Object,
    content: Object,
    pageType: String,
    publishedAt: Date,
  },
  { timestamps: true }
);
const Page = mongoose.models.Page || mongoose.model("Page", PageSchema);

/* ------------------------------------------------------------------ *
 * Widget builder helpers — each returns a Puck item { type, props }.  *
 * Ids are added automatically by normalizePuckData().                 *
 * ------------------------------------------------------------------ */
const section = (content, props = {}) => ({
  type: "LayoutSection",
  props: {
    className: "section_padding",
    useContainer: true,
    containerFluid: false,
    containerClass: "",
    background: "",
    padding: "",
    align: "",
    minHeight: "auto",
    ...props,
    content,
  },
});

const row = (columns, props = {}) => ({
  type: "LayoutRow",
  props: { gutter: "lg", useContainer: false, columns, ...props },
});

const col = (lg, content, props = {}) => ({
  type: "LayoutColumn",
  props: { colXs: "12", colLg: String(lg), content, ...props },
});

const heading = (text, props = {}) => ({
  type: "Heading",
  props: { text, tag: "h2", align: "center", ...props },
});

const richText = (content, props = {}) => ({
  type: "TextBlock",
  props: { content, align: "left", ...props },
});

const button = (label, href, props = {}) => ({
  type: "ButtonBlock",
  props: { label, href, target: "_self", variant: "frontfilled", size: "md", align: "flex-start", ...props },
});

const image = (src, props = {}) => ({
  type: "ImageWidget",
  props: { image: src, alt: "", width: "100%", align: "center", radius: "12", shadow: "soft", ...props },
});

const imageBox = (props) => ({ type: "ImageBox", props });
const iconBox = (props) => ({ type: "IconBox", props });
const spacer = (height = 48) => ({ type: "Spacer", props: { height } });

/** Two-column image + text split. */
const split = ({ eyebrow, title, body, img, reverse, buttons = [] }) => {
  const textCol = col(6, [
    ...(eyebrow ? [heading(eyebrow, { tag: "h6", align: "left", color: "#e5306b", fontSize: "14", fontWeight: "700", marginBottom: "8" })] : []),
    heading(title, { tag: "h2", align: "left", marginBottom: "16" }),
    richText(body),
    ...(buttons.length
      ? [row(buttons.map((b) => col(6, [button(b.label, b.href, { variant: b.variant, marginTop: "16" })])))]
      : []),
  ]);
  const imgCol = col(6, [image(img)]);
  return section(reverse ? [row([imgCol, textCol])] : [row([textCol, imgCol])]);
};

/* ------------------------------------------------------------------ *
 * Long-form legal copy                                                *
 * ------------------------------------------------------------------ */
const privacyHtml = `<p>Autopulse, Inc. ("Autopulse," "we," "our," or "us") respects your privacy. This Privacy Policy explains how we collect, use, share, and protect personal information when you use our website, services, and platform (collectively, the "Services").</p>
<p>By using our Services, you agree to the practices described in this Privacy Policy.</p>
<h3>1. Information We Collect</h3>
<h4>a. Information You Provide</h4>
<p>We collect personal information you submit to us directly, including:</p>
<ul><li>Name, email address, phone number, company name</li><li>Account credentials and preferences</li><li>Comments or messages submitted via forms</li></ul>
<h4>b. Information We Collect Automatically</h4>
<p>When you use our platform, we may automatically collect IP address, browser type, device info, pages visited, and cookies.</p>
<h3>2. How We Use Your Information</h3>
<p>We use your information to provide and improve our platform, communicate with you, customize your experience, ensure security, and comply with legal obligations.</p>
<h3>3. Sharing Your Information</h3>
<p>We may share data with service providers, affiliated dealerships, law enforcement when required, and during business transfers. We do <strong>not</strong> sell your personal data.</p>
<h3>4. Data Retention</h3>
<p>We retain personal data only as long as necessary to fulfill the purposes outlined in this policy.</p>
<h3>5. Data Security</h3>
<p>We implement industry-standard safeguards including encryption and access controls.</p>
<h3>6. Cookies and Tracking</h3>
<p>We use cookies to analyze usage, improve performance, and personalize content.</p>
<h3>7. Your Rights</h3>
<p>Depending on your location, you may have rights to access, correct, delete, or restrict use of your personal data.</p>
<h3>8. Children's Privacy</h3>
<p>Our Services are not directed to children under 13.</p>
<h3>9. International Users</h3>
<p>If you access our Services from outside the United States, your data may be transferred to the U.S.</p>
<h3>10. Changes to This Policy</h3>
<p>We may update this Privacy Policy from time to time.</p>
<h3>11. Contact Us</h3>
<p>Questions? Contact us at <a href="mailto:support@autopulse.ai">support@autopulse.ai</a>.</p>`;

const termsHtml = `<p>Welcome to Autopulse. These Terms of Service govern your use of our website, platform, and services.</p>
<p>By accessing or using Autopulse, you agree to be bound by these Terms.</p>
<h3>1. Acceptance of Terms</h3>
<p>By creating an account or using our Services, you confirm that you accept these Terms.</p>
<h3>2. Description of Services</h3>
<p>Autopulse provides AI-powered lead management and communication tools for auto dealerships and agencies.</p>
<h3>3. Account Registration</h3>
<p>You must provide accurate information and maintain the security of your account credentials.</p>
<h3>4. Subscription and Billing</h3>
<p>Paid plans are billed according to the pricing selected. Fees are non-refundable except as required by law.</p>
<h3>5. Acceptable Use</h3>
<p>You agree not to misuse the platform, violate laws, or infringe on others' rights.</p>
<h3>6. Intellectual Property</h3>
<p>All content, trademarks, and technology on Autopulse are owned by Autopulse, Inc.</p>
<h3>7. Data and Privacy</h3>
<p>Our collection and use of personal data is described in our Privacy Policy.</p>
<h3>8. Third-Party Services</h3>
<p>Integrations with third-party services are subject to their own terms.</p>
<h3>9. Disclaimers</h3>
<p>Services are provided "as is" without warranties of any kind.</p>
<h3>10. Limitation of Liability</h3>
<p>Autopulse shall not be liable for indirect, incidental, or consequential damages.</p>
<h3>11. Termination</h3>
<p>We may suspend or terminate access for violations of these Terms.</p>
<h3>12. Governing Law</h3>
<p>These Terms are governed by the laws of the State of Delaware, USA.</p>
<h3>13. Changes</h3>
<p>We may modify these Terms at any time. Continued use constitutes acceptance.</p>
<h3>14. Contact</h3>
<p>Questions? Contact <a href="mailto:support@autopulse.ai">support@autopulse.ai</a>.</p>`;

/* ------------------------------------------------------------------ *
 * Pages                                                               *
 * ------------------------------------------------------------------ */
const homeContent = [
  // Hero
  section(
    [
      row([
        col(7, [
          heading("Autopulse – Your AI-Powered Sales Partner", {
            tag: "h1",
            align: "left",
            gradient: true,
            fontSize: "48",
            fontWeight: "700",
            marginBottom: "16",
          }),
          richText(
            "<p>In today's fast-moving auto sales environment, customers expect instant responses, accurate information, and personalized attention. Autopulse delivers all three — powered by AI, trained for the auto industry, and built specifically for USA auto dealerships and agencies that want to convert more leads, 24/7.</p>",
            { fontSize: "18", marginBottom: "24" }
          ),
          row([
            col(4, [button("Start As Dealer", "/dealer/register")]),
            col(4, [button("Start As Agency", "/agency/register")]),
            col(4, [button("Book A Demo", "/book-a-demo", { variant: "nofrontfilled" })]),
          ]),
        ]),
        col(5, [image("Images/front/screenshot.png", { shadow: "medium" })]),
      ]),
    ],
    { className: "front_banner section_padding" }
  ),

  // Why heading
  section([heading("Why Top Dealerships Are Switching to Autopulse", { fontSize: "36" })]),

  // Splits
  split({
    title: "Built Just for Auto Dealerships",
    body: '<p>"Other tools are built for every industry. We built Autopulse <b>just for auto dealerships.</b>"</p><p>Autopulse isn\'t just another chatbot. It\'s an <b>intelligent lead management system</b> that speaks your language — car models, price inquiries, trade-ins, financing, service requests — <b>and knows how to close the deal.</b></p>',
    img: "Images/front/about.png",
  }),
  split({
    eyebrow: "Who It's Built For",
    title: "Independent Dealerships",
    body: "<p>You're busy closing deals — let Autopulse handle the rest. Our subscription plans are priced to give small teams big-league automation.</p>",
    img: "Images/front/dealer.png",
    buttons: [
      { label: "Get Started", href: "/dealer" },
      { label: "Book A Demo", href: "/book-a-demo", variant: "nofrontfilled" },
    ],
  }),
  split({
    title: "Auto Agencies Managing Multiple Stores",
    body: "<p>Juggling multiple rooftops? Autopulse gives you one dashboard to monitor all locations, assign leads, analyze performance, and scale operations.</p>",
    img: "Images/front/agency.png",
    reverse: true,
    buttons: [
      { label: "Get Started", href: "/agency" },
      { label: "Book A Demo", href: "/book-a-demo", variant: "nofrontfilled" },
    ],
  }),

  // Feature grid (icon boxes)
  section([
    heading("Key Features That Drive Sales", { marginBottom: "16" }),
    spacer(24),
    row([
      col(4, [iconBox({ icon: "fa-solid fa-bolt", iconColor: "#e5306b", iconSize: "40", title: "Instant Vehicle Info", text: "Pricing, availability and features on demand.", align: "center" })]),
      col(4, [iconBox({ icon: "fa-solid fa-clock", iconColor: "#e5306b", iconSize: "40", title: "24/7 AI Responses", text: "Never miss a lead again, day or night.", align: "center" })]),
      col(4, [iconBox({ icon: "fa-solid fa-comment-dots", iconColor: "#e5306b", iconSize: "40", title: "SMS & Email", text: "Multi-channel communication that converts.", align: "center" })]),
    ]),
    spacer(24),
    row([
      col(4, [iconBox({ icon: "fa-solid fa-calendar-check", iconColor: "#e5306b", iconSize: "40", title: "Appointment Booking", text: "Schedule test drives automatically.", align: "center" })]),
      col(4, [iconBox({ icon: "fa-solid fa-plug", iconColor: "#e5306b", iconSize: "40", title: "CRM Integration", text: "Sync with your existing tools.", align: "center" })]),
      col(4, [iconBox({ icon: "fa-solid fa-chart-line", iconColor: "#e5306b", iconSize: "40", title: "Analytics Dashboard", text: "Track performance in real time.", align: "center" })]),
    ]),
  ]),

  // CTA
  section(
    [
      heading("Ready to Close More Deals with Less Work?", { color: "#ffffff", fontSize: "36", marginBottom: "12" }),
      richText(
        "<p style='color:#fff'><b>Autopulse is the competitive edge your dealership needs.</b> Don't settle for generic tools — choose the AI platform built for automotive sales success in the USA market.</p>",
        { align: "center", maxWidth: "820" }
      ),
      spacer(24),
      row([
        col(3, [button("Schedule a Demo", "/book-a-demo", { variant: "nofrontfilled", align: "flex-end" })]),
        col(3, [button("Start Now", "/dealer/register", { align: "flex-start" })]),
      ], { useContainer: false }),
    ],
    { background: "#12141c", padding: "lg", align: "center" }
  ),
];

const aboutContent = [
  section(
    [
      row([
        col(7, [
          heading("About Autopulse", { tag: "h1", align: "left", gradient: true, fontSize: "48", marginBottom: "16" }),
          richText(
            "<p>We're on a mission to help auto dealerships and agencies convert more leads with AI-powered communication — built specifically for the automotive industry.</p>",
            { fontSize: "18", marginBottom: "24" }
          ),
          button("Book A Demo", "/book-a-demo"),
        ]),
        col(5, [image("Images/front/about.png", { shadow: "medium" })]),
      ]),
    ],
    { className: "front_banner section_padding" }
  ),
  split({
    eyebrow: "Our Story",
    title: "Built by Auto Industry Veterans",
    body: "<p>Autopulse was founded by a team that understands the unique challenges of auto sales — long response times, missed leads after hours, and generic chatbots that can't answer real vehicle questions.</p><p>We built a platform that speaks the language of car buyers and gives dealerships the tools to close more deals, 24/7.</p>",
    img: "Images/front/dealer.png",
  }),
  section(
    [
      heading("Join Hundreds of Dealerships Using Autopulse", { color: "#ffffff", fontSize: "34", marginBottom: "12" }),
      richText("<p style='color:#fff'>See why top dealerships are switching to AI-powered lead management.</p>", { align: "center" }),
      spacer(24),
      row([
        col(3, [button("Get Started", "/dealer/register", { align: "flex-end" })]),
        col(3, [button("Contact Us", "/contact", { variant: "nofrontfilled", align: "flex-start" })]),
      ], { useContainer: false }),
    ],
    { background: "#12141c", padding: "lg", align: "center" }
  ),
];

/** One pricing plan rendered as a bordered card column. */
const planCard = ({ title, desc, price, features, cta, highlight }) =>
  col(3, [
    imageBox({
      image: "",
      alt: "",
      title,
      titleTag: "h4",
      text: desc,
      linkLabel: "",
      linkHref: "",
      linkTarget: "_self",
      align: "center",
      background: highlight ? "#fdeef3" : "#ffffff",
      radius: "16",
      shadow: "soft",
      paddingY: "8",
    }),
    heading(price, { tag: "h3", align: "center", color: highlight ? "#c81e58" : undefined, marginTop: "8", marginBottom: "8" }),
    {
      type: "IconList",
      props: {
        iconColor: "#e5306b",
        gap: "12",
        items: features.map((f) => ({ icon: "fa-solid fa-check", text: f, href: "" })),
        marginBottom: "16",
      },
    },
    button(cta.label, cta.href, { fullWidth: true, align: "center", variant: highlight ? "frontfilled" : "nofrontfilled" }),
  ]);

const pricingContent = [
  section(
    [
      heading("Simple, Transparent Pricing", { tag: "h1", gradient: true, fontSize: "46", marginBottom: "16" }),
      richText(
        "<p>Choose the plan that fits your dealership. All plans include AI-powered lead management, SMS &amp; email communication, and dedicated support.</p>",
        { align: "center", maxWidth: "760" }
      ),
    ],
    { className: "section_padding", align: "center" }
  ),
  section([
    heading("Choose Your Plan", { marginBottom: "8" }),
    spacer(24),
    row([
      planCard({ title: "Growth Plan", desc: "Ideal for small dealerships.", price: "$1,099/mo", features: ["2,000 credits / month", "5 template bots", "10 flow bots", "Limited plugin access"], cta: { label: "Get Started", href: "/dealer/register" } }),
      planCard({ title: "Business Plan", desc: "Best for growing teams.", price: "$1,699/mo", features: ["5,000 credits / month", "10 template bots", "20 flow bots", "Full plugin access"], cta: { label: "Get Started", href: "/dealer/register" }, highlight: true }),
      planCard({ title: "Enterprise Plus", desc: "For high-traffic dealerships.", price: "$2,199/mo", features: ["10,000 credits / month", "Unlimited template bots", "Unlimited flow bots", "Full plugin access"], cta: { label: "Get Started", href: "/dealer/register" } }),
      planCard({ title: "Enterprise", desc: "Tailored for OEMs & dealer groups.", price: "Custom", features: ["Unlimited credits", "Dedicated AI model training", "CRM & inventory integrations", "24/7 support with SLA"], cta: { label: "Contact Sales", href: "/contact" } }),
    ]),
  ]),
  section([
    heading("Frequently Asked Questions", { marginBottom: "24" }),
    {
      type: "Accordion",
      props: {
        alwaysOpen: false,
        flush: false,
        items: [
          { title: "Do you offer a free trial?", content: "<p>We do not offer a free trial at this time. Our plans are structured to suit various dealership sizes.</p>" },
          { title: "Do you offer discounts for annual billing?", content: "<p>Yes! Annual billing receives a 15% discount on the total subscription amount.</p>" },
          { title: "Can I switch or cancel my plan anytime?", content: "<p>Yes. You can upgrade, downgrade, or cancel anytime from your dashboard.</p>" },
          { title: "Can Autopulse AI answer detailed vehicle queries?", content: "<p>Yes. The AI bot can respond to questions about car models, prices, features and availability, 24/7.</p>" },
          { title: "Does the system support both SMS and email?", content: "<p>Absolutely. Autopulse automatically replies via SMS or email as configured.</p>" },
        ],
      },
    },
  ]),
];

const contactContent = [
  section(
    [
      heading("Get in Touch", { tag: "h1", gradient: true, fontSize: "46", marginBottom: "16" }),
      richText(
        "<p>Questions or need assistance? Reach out anytime. Our team is here to guide you to the right solutions with confidence.</p>",
        { align: "center", maxWidth: "720" }
      ),
    ],
    { className: "section_padding", align: "center" }
  ),
  section([
    {
      type: "ContactForm",
      props: {
        formTitle: "Connect with Us for Questions, Support, or a Friendly Chat",
        formDescription:
          "Have a question about pricing, integration, AI capabilities, or partnership opportunities? We're happy to help — just drop your details below.",
        sidebarItems: [
          { icon: "fa-regular fa-messages-question", title: "Access Support", body: "Join our expert support team for on-demand help. <a href='mailto:support@autopulse.ai'>support@autopulse.ai</a>" },
          { icon: "fa-regular fa-envelope", title: "Secured Communication", body: "For security concerns: <a href='mailto:support@autopulse.ai'>support@autopulse.ai</a>" },
          { icon: "fa-regular fa-comments", title: "Ready to Chat?", body: "Live Chat available Monday to Friday, 10 AM – 5 PM EST. <a href='mailto:contact@autopulse.ai'>contact@autopulse.ai</a>" },
        ],
      },
    },
  ]),
];

const legalPage = (title, html, effectiveDate, lastUpdated) => [
  section(
    [
      heading(title, { tag: "h1", gradient: true, fontSize: "40", marginBottom: "8" }),
      richText(
        `<p><small>Effective Date: ${effectiveDate} &nbsp;|&nbsp; Last Updated: ${lastUpdated}</small></p>`,
        { align: "center" }
      ),
    ],
    { className: "section_padding", align: "center" }
  ),
  section([richText(html, { maxWidth: "820" })]),
];

const pages = [
  {
    title: "Home",
    slug: "home",
    status: "published",
    showInNav: true,
    navOrder: 1,
    navLabel: "Home",
    pageType: "marketing",
    meta: {
      title: "Autopulse.Ai | AI-Powered Sales Partner for Dealerships",
      description: "Autopulse delivers instant AI-powered lead management for USA auto dealerships and agencies.",
    },
    content: { root: { props: { title: "Home" } }, content: homeContent },
  },
  {
    title: "About Us",
    slug: "about",
    status: "published",
    showInNav: true,
    navOrder: 2,
    navLabel: "About",
    pageType: "marketing",
    meta: { title: "About Autopulse | AI for Auto Dealerships", description: "Learn about Autopulse and our mission to transform auto sales." },
    content: { root: { props: { title: "About Us" } }, content: aboutContent },
  },
  {
    title: "Pricing",
    slug: "pricing",
    status: "published",
    showInNav: true,
    navOrder: 3,
    navLabel: "Pricing",
    pageType: "marketing",
    meta: { title: "Pricing | Autopulse", description: "Flexible pricing plans for dealerships of all sizes." },
    content: { root: { props: { title: "Pricing" } }, content: pricingContent },
  },
  {
    title: "Contact",
    slug: "contact",
    status: "published",
    showInNav: true,
    navOrder: 5,
    navLabel: "Contact",
    pageType: "marketing",
    meta: { title: "Contact Us | Autopulse", description: "Get in touch with the Autopulse team." },
    content: { root: { props: { title: "Contact" } }, content: contactContent },
  },
  {
    title: "Privacy Policy",
    slug: "privacy-policy",
    status: "published",
    showInNav: false,
    navOrder: 0,
    pageType: "legal",
    meta: { title: "Privacy Policy | Autopulse", description: "Autopulse privacy policy." },
    content: { root: { props: { title: "Privacy Policy" } }, content: legalPage("Privacy Policy", privacyHtml, "29th July 2025", "25th July 2025") },
  },
  {
    title: "Terms of Service",
    slug: "terms-of-services",
    status: "published",
    showInNav: false,
    navOrder: 0,
    pageType: "legal",
    meta: { title: "Terms of Service | Autopulse", description: "Autopulse terms of service." },
    content: { root: { props: { title: "Terms of Service" } }, content: legalPage("Terms of Service", termsHtml, "29th July 2025", "25th July 2025") },
  },
];

async function main() {
  // Validate the generated content without touching the database:
  //   SEED_DRY_RUN=1 node scripts/seed-pages.js
  if (process.env.SEED_DRY_RUN) {
    let blocks = 0;
    let missing = 0;
    const walk = (arr) =>
      (arr || []).forEach((item) => {
        if (item && item.type) {
          blocks += 1;
          if (!item.props?.id) missing += 1;
          Object.values(item.props || {}).forEach((v) => {
            if (Array.isArray(v) && v.some((x) => x && x.type)) walk(v);
          });
        }
      });
    for (const p of pages) {
      const normalized = normalizePuckData(p.content);
      walk(normalized.content);
      console.log(`✓ ${p.slug.padEnd(18)} top-level blocks: ${normalized.content.length}`);
    }
    console.log(
      `\nDry run OK — ${pages.length} pages, ${blocks} total blocks, ${missing} missing ids. No DB writes.`
    );
    return;
  }

  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI not set in .env.local");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  for (const pageData of pages) {
    const normalized = {
      ...pageData,
      content: normalizePuckData(pageData.content),
      publishedAt: new Date(),
    };
    const existing = await Page.findOne({ slug: pageData.slug });
    if (existing) {
      await Page.updateOne({ slug: pageData.slug }, { $set: normalized });
      console.log(`Updated page: ${pageData.slug}`);
    } else {
      await Page.create(normalized);
      console.log(`Created page: ${pageData.slug}`);
    }
  }

  console.log(`\nSeeded ${pages.length} pages successfully.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
