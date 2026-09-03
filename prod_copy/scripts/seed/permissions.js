/**
 * Seeds the "Manage Pages" admin permission and assigns it to all admin roles.
 * Required for Website CMS sidebar (Pages, Menu, Site Settings).
 *
 * Run: npm run seed:cms:permissions
 * Or as part of: npm run seed:cms
 */
import { connectDb, disconnectDb, mongoose } from "./connect.js";

const PermissionSchema = new mongoose.Schema(
  {
    permission_name: { type: String, required: true },
    entity: { type: String, enum: ["admin", "dealer", "vendor"], required: true },
    group: { type: String },
  },
  { timestamps: true }
);
const Permission = mongoose.models.Permission || mongoose.model("Permission", PermissionSchema);

const RoleSchema = new mongoose.Schema({
  name: String,
  entity: String,
  permissions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Permission" }],
});
const Role = mongoose.models.Role || mongoose.model("Role", RoleSchema);

export async function seedPermissions() {
  let permission = await Permission.findOne({ permission_name: "Manage Pages", entity: "admin" });
  if (!permission) {
    permission = await Permission.create({
      permission_name: "Manage Pages",
      entity: "admin",
      group: "Content",
    });
    console.log("Created Manage Pages permission:", permission._id.toString());
  } else {
    console.log("Manage Pages permission already exists:", permission._id.toString());
  }

  const adminRoles = await Role.find({ entity: "admin" });
  if (adminRoles.length === 0) {
    console.warn('No admin roles found — create an admin role first, then re-run seed:cms:permissions');
    return;
  }

  let assigned = 0;
  for (const role of adminRoles) {
    const hasPermission = role.permissions?.some((p) => p.toString() === permission._id.toString());
    if (!hasPermission) {
      role.permissions = [...(role.permissions || []), permission._id];
      await role.save();
      assigned += 1;
      console.log(`Added Manage Pages to role: ${role.name}`);
    }
  }

  if (assigned === 0) {
    console.log("All admin roles already have Manage Pages permission");
  }
}

async function main() {
  await connectDb();
  await seedPermissions();
  await disconnectDb();
}

if (process.argv[1]?.endsWith("permissions.js")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
