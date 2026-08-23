import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

export async function connectDb() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set in .env.local");
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");
}

export async function disconnectDb() {
  await mongoose.disconnect();
  console.log("Disconnected from MongoDB");
}

export { mongoose };
