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

  const { userId, type, amount, reason, requestId } = await request.json();

  if (!userId || !requestId || !["credit", "debit"].includes(type)) {
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

  const { data: adjustment, error: adjustmentError } = await supabase.rpc(
    "adjust_wallet_with_transaction",
    {
      p_request_id: requestId,
      p_user_id: userId,
      p_adjustment_type: type,
      p_amount: amt,
      p_reason: reason.trim(),
    }
  );

  if (adjustmentError) {
    console.error("Atomic wallet adjustment failed.", adjustmentError.code || "adjustment_error");
    const status = adjustmentError.message?.includes("Wallet not found") ? 404 : 400;
    return NextResponse.json({ error: adjustmentError.message }, { status });
  }

  if (!adjustment.duplicate) {
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

    const supabaseAdmin = createAdminClient();
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
  }

  return NextResponse.json({
    success: true,
    newBalance: adjustment.newBalance,
    transactionId: adjustment.transactionId,
  });
}