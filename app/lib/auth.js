import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const SECRET_KEY = process.env.JWT_SECRET || "your-secret-key";

/**
 
 * @param {string} token
 * @returns {object|null} Decoded user data or null if invalid
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET_KEY);
  } catch (error) {
    return null; // Return null if token is invalid
  }
}

/**
 
 * @param {object} payload
 * @returns {string} JWT Token
 */
export function generateToken(payload) {
  return jwt.sign(payload, SECRET_KEY, { expiresIn: "7d" }); // Token valid for 7 days
}
