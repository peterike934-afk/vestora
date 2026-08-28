// app/api/stripe/check-connect-status/route.js
//
// Called when the user lands back on /withdraw after completing (or
// abandoning) Stripe's hosted onboarding. Checks the REAL status with
// Stripe directly, rather than trusting the URL params alone.

import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const stripe = getStripe();

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_connect_account_id")
    .eq("id", user.id)
    .single();

  if (!profile?.stripe_connect_account_id) {
    return NextResponse.json({ onboarded: false });
  }

  const account = await stripe.accounts.retrieve(profile.stripe_connect_account_id);

  // payouts_enabled is the real signal — it means Stripe has actually
  // verified enough to let money flow to this account, not just that
  // the user clicked through some steps.
  const onboarded = !!account.payouts_enabled;

  await supabase
    .from("profiles")
    .update({ stripe_connect_onboarded: onboarded })
    .eq("id", user.id);

  return NextResponse.json({ onboarded });
}