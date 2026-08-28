import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// Confirms the requester is a real, logged-in admin.
// Returns the user if valid, or null if not.
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") return null;

  return user;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, email, role, status, created_at")
    .order("created_at", { ascending: false });

  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 });
  }

  const { data: wallets, error: walletsError } = await supabaseAdmin
    .from("wallets")
    .select("user_id, balance_usd");

  if (walletsError) {
    return NextResponse.json({ error: walletsError.message }, { status: 500 });
  }

  const walletMap = Object.fromEntries(
    (wallets || []).map((w) => [w.user_id, w.balance_usd])
  );

  const users = (profiles || []).map((p) => ({
    ...p,
    balance_usd: walletMap[p.id] ?? 0,
  }));

  return NextResponse.json({ users });
}