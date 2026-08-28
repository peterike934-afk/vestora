import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/audit";
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

  const { investmentId, reason } = await request.json();
  if (!investmentId) {
    return NextResponse.json({ error: "Missing investmentId" }, { status: 400 });
  }
  if (!reason || !reason.trim()) {
    return NextResponse.json({ error: "A reason is required — it's shown to the user in their transaction history." }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: investment, error: fetchError } = await supabaseAdmin
    .from("investments")
    .select("*")
    .eq("id", investmentId)
    .single();

  if (fetchError || !investment) {
    return NextResponse.json({ error: "Investment not found" }, { status: 404 });
  }
  if (investment.status !== "active") {
    return NextResponse.json({ error: "Only active investments can be cancelled" }, { status: 400 });
  }

  // Refund the ORIGINAL PRINCIPAL only — not the accrued value. Early
  // cancellation forfeiting unearned interest is standard behavior for
  // fixed-term products; if you want a different policy (full payout,
  // partial penalty, etc.) this is the one line to change.
  const { data: wallet, error: walletFetchError } = await supabaseAdmin
    .from("wallets")
    .select("balance_usd")
    .eq("user_id", investment.user_id)
    .single();

  if (walletFetchError || !wallet) {
    return NextResponse.json({ error: "Wallet not found for this user" }, { status: 500 });
  }

  const newBalance = Number(wallet.balance_usd) + Number(investment.amount_usd);

  const { error: walletUpdateError } = await supabaseAdmin
    .from("wallets")
    .update({ balance_usd: newBalance, updated_at: new Date().toISOString() })
    .eq("user_id", investment.user_id);

  if (walletUpdateError) {
    return NextResponse.json({ error: walletUpdateError.message }, { status: 500 });
  }

  const { error: invUpdateError } = await supabaseAdmin
    .from("investments")
    .update({ status: "cancelled" })
    .eq("id", investmentId);

  if (invUpdateError) {
    return NextResponse.json({ error: invUpdateError.message }, { status: 500 });
  }

  // Records the cancellation as a real transaction — otherwise the
  // user's balance would just jump with nothing in their history
  // explaining why. status is "verified" immediately since an admin
  // action IS the approval; there's nothing left to review.
  const { error: cancelTxnError } = await supabaseAdmin
    .from("transactions")
    .insert({
      user_id: investment.user_id,
      type: "investment_cancelled",
      amount_usd: investment.amount_usd,
      status: "verified",
      investment_id: investmentId,
      admin_note: reason.trim(),
      verified_by: admin.id,
      verified_at: new Date().toISOString(),
    });

  if (cancelTxnError) {
    console.error("Failed to record cancellation transaction (refund already happened):", cancelTxnError);
    // Don't fail the whole request — the refund and status change
    // already succeeded and are the important part.
  }

  // Reverse any PENDING claims tied to this investment — both interest
  // claims and principal withdrawal requests. Since cancellation just
  // refunded the full principal directly, letting an old pending
  // request get approved later would double-pay it (or pay out
  // interest the cancellation policy already forfeits). Only pending
  // ones are touched — anything already verified/rejected is history
  // and stays untouched.
  const { data: reversedTxns, error: reverseError } = await supabaseAdmin
    .from("transactions")
    .update({
      status: "rejected",
      admin_note: "Auto-rejected — investment was cancelled by admin",
      verified_by: admin.id,
      verified_at: new Date().toISOString(),
    })
    .eq("investment_id", investmentId)
    .eq("status", "pending")
    .in("type", ["investment_interest_claim", "investment_withdrawal"])
    .select("id, type, amount_usd");

  if (reverseError) {
    // Don't fail the whole cancellation over this — the principal
    // refund and status change already succeeded and are the
    // important part. Surface it for manual follow-up instead.
    console.error("Failed to auto-reject pending claims after cancellation:", reverseError);
  }

  try {
    await logAdminAction(supabase, {
      action: "investment_cancelled",
      targetUserId: investment.user_id,
      amountUsd: investment.amount_usd,
      reason: reason || "Investment cancelled by admin — principal refunded to wallet",
      metadata: reversedTxns?.length ? { reversedPendingClaims: reversedTxns } : undefined,
    });
  } catch (auditError) {
    console.error("Audit log failed after investment cancellation:", auditError);
  }

  return NextResponse.json({ success: true, newBalance, reversedPendingClaims: reversedTxns || [] });
}