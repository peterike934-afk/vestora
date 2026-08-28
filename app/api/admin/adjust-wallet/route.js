import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/audit";
import { sendNotificationEmail, walletAdjustedEmail } from "@/lib/email";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user: admin } } = await supabase.auth.getUser();
  if (!admin) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", admin.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { userId, type, amount, reason } = await request.json();

  if (!userId || !["credit", "debit"].includes(type)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const amt = Number(amount);
  if (!amt || amt <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }
  // A required reason isn't optional politeness here — it's what
  // makes the audit trail actually mean something. "Admin adjusted
  // balance" with no reason is barely better than no log at all.
  if (!reason || !reason.trim()) {
    return NextResponse.json({ error: "A reason is required for manual wallet adjustments" }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: wallet, error: walletFetchError } = await supabaseAdmin
    .from("wallets")
    .select("balance_usd")
    .eq("user_id", userId)
    .single();

  if (walletFetchError || !wallet) {
    return NextResponse.json({ error: "Wallet not found for this user" }, { status: 404 });
  }

  const delta = type === "credit" ? amt : -amt;
  const newBalance = Number(wallet.balance_usd) + delta;

  if (newBalance < 0) {
    return NextResponse.json({ error: "This would take the user's balance negative." }, { status: 400 });
  }

  const { error: walletUpdateError } = await supabaseAdmin
    .from("wallets")
    .update({ balance_usd: newBalance, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (walletUpdateError) {
    return NextResponse.json({ error: walletUpdateError.message }, { status: 500 });
  }

  // Record it as a real transaction, not just a silent balance edit —
  // it shows up in the user's own transaction history (Dashboard,
  // Wallet page) exactly like a deposit or withdrawal would, already
  // verified since there's nothing pending about a direct admin action.
  const { error: txnError } = await supabaseAdmin
    .from("transactions")
    .insert({
      user_id: userId,
      type: type === "credit" ? "admin_credit" : "admin_debit",
      amount_usd: amt,
      status: "verified",
      admin_note: reason.trim(),
      verified_by: admin.id,
      verified_at: new Date().toISOString(),
    });

  if (txnError) {
    return NextResponse.json({ error: txnError.message }, { status: 500 });
  }

  try {
    await logAdminAction(supabase, {
      action: type === "credit" ? "admin_credit" : "admin_debit",
      targetUserId: userId,
      amountUsd: amt,
      reason: reason.trim(),
    });
  } catch (auditError) {
    console.error("Audit log failed after wallet adjustment:", auditError);
  }

  const { data: userProfile } = await supabaseAdmin
    .from("profiles")
    .select("email, email_notifications")
    .eq("id", userId)
    .single();

  if (userProfile) {
    await sendNotificationEmail({
      to: userProfile.email,
      notificationsEnabled: userProfile.email_notifications,
      ...walletAdjustedEmail(type, amt, reason.trim()),
    });
  }

  return NextResponse.json({ success: true, newBalance });
}