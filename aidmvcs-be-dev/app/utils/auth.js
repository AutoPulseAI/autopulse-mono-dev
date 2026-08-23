import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import User from "@models/User";
import { connectDB } from "@lib/mongodb";
import { normalizeUserEmail } from "@utils/userEmail";

export async function authenticateUser(email, password, role) {
  await connectDB();
  const user = await User.findOne({ email: normalizeUserEmail(email), role }).select("+password");
  
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return { error: "Invalid credentials" };
  }

  const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" });
  return { token, user: { id: user._id, name: user.name, email: user.email, role: user.role } };
}
