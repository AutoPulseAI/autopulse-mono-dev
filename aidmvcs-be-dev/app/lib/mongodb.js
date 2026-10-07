import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env files — production servers often use .env instead of .env.local
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// `make crm-live-db`: never build indexes on the live database from a local copy (Mongoose's autoIndex
// would create every model's indexes on the production collections at first use).
if (["1", "true", "yes"].includes(String(process.env.CRM_LIVE_DB || "").toLowerCase())) {
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
}

function getMongoUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not defined in environment variables (.env or .env.local)");
  }
  return uri;
}

function sanitizedConnectionFailure(error) {
  const safeNames = new Set([
    "MongoServerError", "MongoServerSelectionError", "MongoNetworkError",
    "MongoNetworkTimeoutError", "MongooseServerSelectionError",
  ]);
  const errorName = safeNames.has(error?.name) ? error.name : "Error";
  const errorCode = typeof error?.code === "number" || /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code)
    ? error.code : undefined;
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    event: "mongodb_connection_failed",
    code: "DATABASE_FAILURE",
    error_name: errorName,
    ...(errorCode !== undefined ? { error_code: errorCode } : {}),
  });
}

async function dbConnect({ reportErrors = true } = {}) {
  try {
    if (mongoose.connection.readyState === 1) {
      return;
    }

    if (mongoose.connection.readyState === 2) {
      // Another module started connecting (the workers await dbConnect() at
      // load time in several modules). Wait as long as that connect may take,
      // and check the state again before giving up: under startup load the
      // timer can fire before the "connected" event is handled.
      await new Promise((resolve, reject) => {
        mongoose.connection.once("connected", resolve);
        mongoose.connection.once("error", reject);
        setTimeout(() => (mongoose.connection.readyState === 1
          ? resolve()
          : reject(new Error("Connection timeout"))), 30000);
      });
      return;
    }

    await mongoose.connect(getMongoUri(), {
      bufferCommands: true,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 1,
    });

    await new Promise((resolve, reject) => {
      if (mongoose.connection.readyState === 1) {
        resolve();
      } else {
        mongoose.connection.once("connected", resolve);
        mongoose.connection.once("error", reject);
        setTimeout(() => (mongoose.connection.readyState === 1
          ? resolve()
          : reject(new Error("Connection timeout"))), 30000);
      }
    });
  } catch (error) {
    // Ingestion emits only its own safe operational codes, including failures
    // before a query starts. Preserve existing callers' diagnostics by default.
    if (!reportErrors) {
      // Emit enough structured context to diagnose an outage without leaking a
      // URI, host, credential, database error message, or source record value.
      console.error(sanitizedConnectionFailure(error));
      throw new Error("DATABASE_FAILURE");
    }
    console.error("MongoDB connection error:", error);
    throw new Error(`Failed to connect to MongoDB: ${error.message}`);
  }
}

export default dbConnect;
