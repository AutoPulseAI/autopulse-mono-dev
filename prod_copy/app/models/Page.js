import mongoose from "mongoose";

const PageMetaSchema = new mongoose.Schema(
  {
    title: { type: String },
    description: { type: String },
    ogImage: { type: String },
  },
  { _id: false }
);

const PageSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
    showInNav: { type: Boolean, default: false },
    navOrder: { type: Number, default: 0 },
    navLabel: { type: String },
    meta: { type: PageMetaSchema, default: () => ({}) },
    content: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ content: [], root: { props: {} } }),
    },
    // Raw HTML body saved from the VvvebJS editor (used when editor === "vvveb")
    html: { type: String },
    editor: {
      type: String,
      enum: ["puck", "vvveb"],
      default: "puck",
    },
    pageType: {
      type: String,
      enum: ["marketing", "legal", "custom"],
      default: "marketing",
    },
    publishedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

PageSchema.index({ slug: 1 });
PageSchema.index({ status: 1, showInNav: 1, navOrder: 1 });

export default mongoose.models.Page || mongoose.model("Page", PageSchema);
