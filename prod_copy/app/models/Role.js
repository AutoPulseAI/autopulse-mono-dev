import mongoose from "mongoose";

const RoleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    entity: {
      type: String,
      enum: ["admin", "dealer", "vendor"],
      required: true,
    },
    permissions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Permission" }],
    entity_id: { type: mongoose.Schema.Types.ObjectId, ref: "User"}, //  Required entity_id
  },
  { timestamps: true }
);

//  Ensure `name` is unique for each combination of `entity` and `entity_id`
RoleSchema.index({ name: 1, entity: 1, entity_id: 1 }, { unique: true });

export default mongoose.models.Role || mongoose.model("Role", RoleSchema);