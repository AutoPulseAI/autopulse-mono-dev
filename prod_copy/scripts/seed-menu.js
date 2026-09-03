/** @deprecated Use: npm run seed:cms:menu */
import { connectDb, disconnectDb } from "./seed/connect.js";
import { seedMenu } from "./seed/menu.js";

const force = process.argv.includes("--force");
await connectDb();
await seedMenu({ force });
await disconnectDb();
