import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/audit";
import { NextResponse } from "next/server";

// Lets an admin add or edit the reason shown to a user for a REJECTED
// transaction, after the fact — separate from the reject action itself
// (which already accepts a note at reject-time). Only touches
// admin_note; never changes status, amounts, or anything else.
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

  const { transactionId, note } = await request.json();

  if (!transactionId) {
    return NextResponse.json({ error: "Missing transactionId" }, { status: 400 });
  }
  if (!note || !note.trim()) {
    return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: txn, error: fetchError } = await supabaseAdmin
    .from("transactions")
    .select("id, status, user_id, type")
    .eq("id", transactionId)
    .single();

  if (fetchError || !txn) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  if (txn.status !== "rejected") {
    return NextResponse.json({ error: "Only rejected transactions can have their reason edited here." }, { status: 400 });
  }

  const { error: updateError } = await supabaseAdmin
    .from("transactions")
    .update({ admin_note: note.trim() })
    .eq("id", transactionId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  try {
    await logAdminAction(supabase, {
      action: "rejection_reason_edited",
      targetUserId: txn.user_id,
      amountUsd: null,
      reason: `Edited rejection reason for a ${txn.type} transaction: "${note.trim()}"`,
    });
  } catch (auditError) {
    console.error("Audit log failed after editing rejection reason:", auditError);
  }

  return NextResponse.json({ success: true });
}