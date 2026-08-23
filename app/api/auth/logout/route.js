import { cookies } from "next/headers";

export async function POST(request) {
  try {
    const { type } = await request.json();
    const cookieStore = await cookies();
    
    // Determine which cookie to clear based on type
    const cookieName = 
      type === 'vendor' ? 'vendortoken' :
      type === 'admin' ? 'admintoken' :
      type === 'dealer' ? 'dealertoken' :
      'vendortoken'; // default
    
    cookieStore.set(cookieName, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      path: "/",
      maxAge: 0, // Expire immediately
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `${type} logged out successfully` 
      }), 
      { 
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        success: false,
        message: 'Logout failed',
        error: error.message 
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }
}