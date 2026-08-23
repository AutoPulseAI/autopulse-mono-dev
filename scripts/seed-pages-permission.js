/** @deprecated Use: npm run seed:cms:permissions */
import { connectDb, disconnectDb } from "./seed/connect.js";
import { seedPermissions } from "./seed/permissions.js";

await connectDb();
await seedPermissions();
await disconnectDb();
