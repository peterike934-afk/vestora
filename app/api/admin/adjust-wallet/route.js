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

  const { userId, type, amount, reason, investmentId } = await request.json();

  if (!userId || !["credit", "debit"].includes(type)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const amt = Number(amount);
  if (!amt || amt <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }
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

  // A credit with an investment chosen = profit on that investment.
  // Anything else (bonus, debit) goes straight through the wallet.
  const toInvestment = type === "credit" && !!investmentId;
  let newBalance = Number(wallet.balance_usd);
  let investment = null;

  if (toInvestment) {
    const { data: inv, error: invError } = await supabaseAdmin
      .from("investments")
      .select("id, user_id, status, admin_profit")
      .eq("id", investmentId)
      .single();

    if (invError || !inv || inv.user_id !== userId) {
      return NextResponse.json({ error: "Investment not found for this user" }, { status: 404 });
    }
    if (inv.status !== "active") {
      return NextResponse.json({ error: "Profit can only be added to an active investment" }, { status: 400 });
    }
    investment = inv;
  } else {
    const delta = type === "credit" ? amt : -amt;
    newBalance = newBalance + delta;

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
  }

  const { data: txn, error: txnError } = await supabaseAdmin
    .from("transactions")
    .insert({
      user_id: userId,
      type: type === "credit" ? "admin_credit" : "admin_debit",
      amount_usd: amt,
      status: "verified",
      admin_note: reason.trim(),
      verified_by: admin.id,
      verified_at: new Date().toISOString(),
      investment_id: toInvestment ? investmentId : null,
    })
    .select("id")
    .single();

  if (txnError) {
    return NextResponse.json({ error: txnError.message }, { status: 500 });
  }

  if (toInvestment) {
    const { error: profitError } = await supabaseAdmin
      .from("investments")
      .update({ admin_profit: Number(investment.admin_profit) + amt })
      .eq("id", investmentId);

    if (profitError) {
      await supabaseAdmin.from("transactions").delete().eq("id", txn.id);
      return NextResponse.json({ error: profitError.message }, { status: 500 });
    }
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