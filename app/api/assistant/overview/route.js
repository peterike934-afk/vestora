import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, private" };

// The Investment Chat's data source. It takes no user ID from the client:
// the user is the one in the session cookie, every query is filtered by
// that ID, and the queries run with the user's own Supabase session, so
// row-level security applies as well. Only fields the chat needs are
// returned.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401, headers: NO_STORE });
  }

  const [walletRes, investmentsRes, transactionsRes, holdsRes, profileRes] = await Promise.all([
    supabase.from("wallets").select("balance_usd").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("investments_with_value")
      .select("id, plan_name, amount_usd, current_value, apy_percent, days_remaining, started_at, matures_at, status, withdrawn_principal, claimed_interest, available_to_claim, available_to_withdraw")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false }),
    supabase
      .from("transactions")
      .select("id, type, status, amount_usd, created_at, verified_at, investment_id, principal_portion, payment_method, crypto_currency, admin_note")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1000),
    // Present once 20261122000000_withdrawal_reservations.sql is applied.
    supabase.from("withdrawal_reservations").select("amount").eq("user_id", user.id).eq("state", "held"),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  const failed = [walletRes, investmentsRes, transactionsRes].find((r) => r.error);
  if (failed) {
    console.error("Assistant overview query failed.", failed.error.code || "query_error");
    return NextResponse.json({ error: "Could not load your account overview." }, { status: 500, headers: NO_STORE });
  }

  const transactions = (transactionsRes.data || []).map(({ admin_note, ...t }) => ({
    ...t,
    // admin_note also carries user-entered notes and wire details on
    // pending rows; the chat only needs it as the rejection reason.
    rejection_reason: t.status === "rejected" ? admin_note || null : null,
  }));

  const heldWithdrawals = holdsRes.error
    ? null
    : Math.round((holdsRes.data || []).reduce((s, r) => s + Number(r.amount || 0), 0) * 100) / 100;

  const fullName = profileRes.data?.full_name || user.user_metadata?.full_name || "";

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      firstName: fullName.trim().split(/\s+/)[0] || "",
      balance: Number(walletRes.data?.balance_usd ?? 0),
      heldWithdrawals,
      investments: investmentsRes.data || [],
      transactions,
    },
    { headers: NO_STORE }
  );
}
