import mongoose from "mongoose";

const PermissionSchema = new mongoose.Schema(
  {
    permission_name: { type: String,  required: true },
    entity: {
      type: String,
      enum: ["admin", "dealer", "vendor"],
      required: true,
    },
    group: {
        type: String,
    },
    
  },
  { timestamps: true }
);

export default mongoose.models.Permission || mongoose.model("Permission", PermissionSchema);
