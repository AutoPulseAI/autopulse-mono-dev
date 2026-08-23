import mongoose from "mongoose";

const MENU_LOCATIONS = ["header", "footer", "footer2", "legal"];

const MenuItemSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
    visible: { type: Boolean, default: true },
    target: { type: String, enum: ["_self", "_blank"], default: "_self" },
    location: { type: String, enum: MENU_LOCATIONS, default: "header" },
  },
  { timestamps: true }
);

MenuItemSchema.index({ location: 1, order: 1 });

export { MENU_LOCATIONS };

export default mongoose.models.MenuItem || mongoose.model("MenuItem", MenuItemSchema);
