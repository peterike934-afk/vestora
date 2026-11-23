// lib/stripe.js
//
// Server-side Stripe client. Never import this in a client component —
// it uses the secret key, which must never reach the browser.

import Stripe from "stripe";
import { assertBankDepositPullsEnabled, assertWithdrawalPayoutsEnabled } from "./financial-controls";

let stripeInstance = null;

export function getStripe() {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set on the server");
    }
    stripeInstance = new Stripe(key, {
      apiVersion: "2024-06-20",
    });
  }
  return stripeInstance;
}
// ---------------------------------------------------------------------------
// The only two Stripe calls that move money. Each refuses before contacting
// Stripe unless its application switch is exactly 'true'
// (lib/financial-controls.js); the database switches are enforced separately
// by claim_transaction_for_approval. Everything else in the app uses
// getStripe() only for account and bank-link setup, which moves no money.


/** ACH pull from a customer's linked bank account (Bank Pull deposits). */
export async function createBankPullPaymentIntent(params, options) {
  assertBankDepositPullsEnabled();
  return getStripe().paymentIntents.create(params, options);
}

/** Transfer to a customer's Stripe Connect account (bank withdrawals). */
export async function createWithdrawalTransfer(params, options) {
  assertWithdrawalPayoutsEnabled();
  return getStripe().transfers.create(params, options);
}
