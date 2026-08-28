// app/api/stripe/finalize-bank-link/route.js
//
// Called right after Stripe's bank-linking popup closes successfully.
// Takes the linked account Stripe gave us and turns it into something
// we can actually charge (a PaymentMethod), then remembers it for
// this user going forward.

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

  const { financialConnectionsAccountId } = await request.json();
  if (!financialConnectionsAccountId) {
    return NextResponse.json({ error: "Missing account id" }, { status: 400 });
  }

  const stripe = getStripe();

  try {
    // Get the human-readable details (bank name, last 4 digits) so the
    // UI can show "Chase •••• 4821" instead of a raw Stripe ID.
    const account = await stripe.financialConnections.accounts.retrieve(
      financialConnectionsAccountId
    );

    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, full_name, email")
      .eq("id", user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ error: "No Stripe customer on file for this user" }, { status: 400 });
    }

    // Stripe REQUIRES billing_details.name for us_bank_account payment
    // methods — it does not fill this in automatically from the linked
    // account, despite what you might expect. Fall back to email if
    // the user hasn't set a full name on their profile.
    const billingName = profile.full_name || profile.email || user.email;
    if (!billingName) {
      return NextResponse.json({ error: "No name or email on file to use for billing details" }, { status: 400 });
    }

    const paymentMethod = await stripe.paymentMethods.create({
      type: "us_bank_account",
      us_bank_account: {
        financial_connections_account: financialConnectionsAccountId,
      },
      billing_details: {
        name: billingName,
      },
    });

    await stripe.paymentMethods.attach(paymentMethod.id, {
      customer: profile.stripe_customer_id,
    });

    const { data: saved, error: saveError } = await supabase
      .from("linked_bank_accounts")
      .insert({
        user_id: user.id,
        stripe_financial_connections_account_id: financialConnectionsAccountId,
        stripe_payment_method_id: paymentMethod.id,
        bank_name: account.institution_name || "Bank account",
        last4: account.last4 || null,
        status: "active",
      })
      .select()
      .single();

    if (saveError) throw saveError;

    return NextResponse.json({ success: true, linkedAccount: saved });
  } catch (err) {
    console.error("Failed to finalize bank link:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}