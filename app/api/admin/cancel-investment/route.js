import { createClient } from "@/lib/supabase/server";
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
    return NextResponse.json(
      { error: "A reason is required — it's shown to the user in their transaction history." },
      { status: 400 }
    );
  }

  const { data: result, error } = await supabase.rpc("cancel_investment_atomically", {
    p_investment_id: investmentId,
    p_reason: reason.trim(),
  });

  if (error) {
    const status = error.message?.includes("processing")
      ? 409
      : error.message?.includes("Wallet not found") ? 500 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  const reversedPendingClaims = result.reversedPendingClaims || [];

  try {
    await logAdminAction(supabase, {
      action: "investment_cancelled",
      targetUserId: result.userId,
      amountUsd: result.amountUsd,
      reason: reason || "Investment cancelled by admin — principal refunded to wallet",
      metadata: reversedPendingClaims.length
        ? { reversedPendingClaims }
        : undefined,
    });
  } catch (auditError) {
    console.error("Audit log failed after investment cancellation:", auditError);
  }

  return NextResponse.json({
    success: true,
    newBalance: result.newBalance,
    reversedPendingClaims,
  });
}
