// lib/stripe.js
//
// Server-side Stripe client. Never import this in a client component —
// it uses the secret key, which must never reach the browser.

import Stripe from "stripe";

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