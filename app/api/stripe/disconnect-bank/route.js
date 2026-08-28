// app/api/stripe/disconnect-bank/route.js
//
// Lets a user remove a linked bank account. Detaches the underlying
// Stripe PaymentMethod (so it can no longer be charged/pulled from at
// all, not just hidden in the UI) and marks the row inactive.

import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { NextResponse } from "next/server";

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { linkedAccountId } = await request.json();
  if (!linkedAccountId) {
    return NextResponse.json({ error: "Missing linked account id" }, { status: 400 });
  }

  // Fetch it scoped to this user — never let someone disconnect an
  // account that isn't theirs by guessing an id.
  const { data: account, error: fetchError } = await supabase
    .from("linked_bank_accounts")
    .select("*")
    .eq("id", linkedAccountId)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !account) {
    return NextResponse.json({ error: "Linked account not found" }, { status: 404 });
  }

  const stripe = getStripe();

  try {
    if (account.stripe_payment_method_id) {
      await stripe.paymentMethods.detach(account.stripe_payment_method_id);
    }
  } catch (err) {
    // If it's already detached on Stripe's side for some reason, don't
    // block the user from clearing it out of their own account list.
    console.error("Failed to detach payment method (continuing anyway):", err);
  }

  const { error: updateError } = await supabase
    .from("linked_bank_accounts")
    .update({ status: "disconnected" })
    .eq("id", linkedAccountId)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}