import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Handles the redirect back from Google after OAuth sign-in,
// exchanging the auth code for a real session.
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/dashboard`);
    }
  }

  // Something went wrong — send them back to login with an error flag
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
