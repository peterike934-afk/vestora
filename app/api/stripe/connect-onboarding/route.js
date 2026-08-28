// app/api/stripe/connect-onboarding/route.js
//
// Creates (or reuses) a Stripe Connect Express account for the current
// user, and returns a real Stripe-hosted onboarding link — Stripe
// collects identity/bank details directly, your code never touches it.

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

  const stripe = getStripe();
  const origin = request.headers.get("origin");

  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_connect_account_id, email, full_name")
      .eq("id", user.id)
      .single();

    let accountId = profile?.stripe_connect_account_id;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: profile?.email || user.email,
        capabilities: {
          transfers: { requested: true }, // what lets us pay OUT to this account
        },
      });
      accountId = account.id;

      await supabase
        .from("profiles")
        .update({ stripe_connect_account_id: accountId })
        .eq("id", user.id);
    }

    // This link expires quickly and is single-use by design — Stripe's
    // own hosted flow, not anything we build ourselves.
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/withdraw?connect=refresh`,
      return_url: `${origin}/withdraw?connect=complete`,
      type: "account_onboarding",
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (err) {
    console.error("Failed to create Connect onboarding link:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}