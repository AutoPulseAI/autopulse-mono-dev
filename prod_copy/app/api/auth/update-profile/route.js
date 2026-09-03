import dbConnect from "@lib/mongodb"; //  Correct Relative Import
import User from "@models/User";

export async function PUT(req) {
  try {
    await dbConnect();
    const { userId, name, email,phone,website } = await req.json();

    const user = await User.findById(userId);
    if (!user) {
      return new Response(JSON.stringify({ message: "User not found" }), { status: 404 });
    }
    if (phone) {
      const phoneExists = await User.findOne({ phone });
      if (phoneExists) {
        return new Response(JSON.stringify({ message: "Phone number already in use by another vendor." }), { status: 400 });
      }
    }

    // Check for unique website (if provided)
    if (website) {
      const websiteExists = await User.findOne({ website });
      if (websiteExists) {
        return new Response(JSON.stringify({ message: "Website URL already in use by another vendor." }), { status: 400 });
      }
    }

    user.name = name || user.name;
    user.email = email || user.email;
    user.website = website || user.website;
    user.phone = phone || user.phone;
    await user.save();

    return new Response(JSON.stringify({ message: "Profile updated successfully", user }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), { status: 500 });
  }
}
