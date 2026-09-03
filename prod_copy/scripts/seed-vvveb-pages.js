/** @deprecated Use: npm run seed:cms:vvveb */
import { connectDb, disconnectDb } from "./seed/connect.js";
import { seedVvvebPages } from "./seed/vvveb-pages.js";

await connectDb();
await seedVvvebPages();
await disconnectDb();
