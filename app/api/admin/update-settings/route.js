import { createClient } from "@/lib/supabase/server";
import { logAdminAction } from "@/lib/audit";
import { NextResponse } from "next/server";

const EDITABLE_FIELDS = [
  "company_name",
  "company_logo_url",
  "withdrawal_fee_percent",
  "min_deposit_usd",
  "min_withdrawal_usd",
  "daily_withdrawal_limit_usd",
  "maintenance_mode",
  "btc_deposit_address",
  "eth_deposit_address",
  "usdt_deposit_address",
  "show_investor_activity",
  "bank_transfer_enabled",
  "bank_wire_enabled", 
  "bank_name",
  "bank_account_name",
  "bank_routing_number",
  "bank_account_number",
];

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  // Only allow known, editable columns through — never trust the
  // client's object shape wholesale.
  const updates = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data: before } = await supabase.from("settings").select("*").eq("id", true).single();

  const { data: updated, error } = await supabase
    .from("settings")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", true)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Describe exactly what changed, not just "settings updated" —
  // makes the audit log actually useful when reviewed later.
  const changedFields = Object.keys(updates)
    .filter(k => String(before?.[k]) !== String(updated[k]))
    .map(k => `${k}: ${before?.[k]} → ${updated[k]}`)
    .join(", ");

  try {
    await logAdminAction(supabase, {
      action: "settings_updated",
      reason: changedFields || "Settings saved (no field changes detected)",
    });
  } catch (auditError) {
    console.error("Audit log failed after settings update:", auditError);
  }

  return NextResponse.json({ success: true, settings: updated });
}