// app/api/stripe/create-fc-session/route.js
//
// Starts the bank-linking process. The browser calls this, gets back a
// "client secret," and uses it to open Stripe's secure bank-linking popup.
// Your server never sees the user's bank login — Stripe handles that
// entirely inside their own popup window.

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

  try {
    // Creating this "session" is what tells Stripe: "let this specific
    // user link a bank account for the purpose of ACH payments." Stripe
    // handles the actual bank login UI — we never touch it.
    const session = await stripe.financialConnections.sessions.create({
      account_holder: {
        type: "customer",
        customer: await getOrCreateStripeCustomer(stripe, supabase, user),
      },
      permissions: ["payment_method", "balances"],
      filters: {
        countries: ["US"],
      },
    });

    return NextResponse.json({ clientSecret: session.client_secret });
  } catch (err) {
    console.error("Failed to create Financial Connections session:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Every user needs a corresponding Stripe Customer object before they can
// link a bank account — this creates one on first use and remembers it
// on their profile so we don't create duplicates on every deposit.
async function getOrCreateStripeCustomer(stripe, supabase, user) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id, email, full_name")
    .eq("id", user.id)
    .single();

  if (profile?.stripe_customer_id) {
    return profile.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: profile?.email || user.email,
    name: profile?.full_name || undefined,
    metadata: { supabase_user_id: user.id },
  });

  await supabase
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", user.id);

  return customer.id;
}