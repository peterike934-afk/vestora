import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/audit";
import { verifyTransaction } from "@/lib/blockchain";
import { sendCryptoPayout, getHotWalletBalance } from "@/lib/wallet";
import { getStripe } from "@/lib/stripe";
import { sendNotificationEmail, depositVerifiedEmail, depositRejectedEmail, withdrawalVerifiedEmail, withdrawalRejectedEmail, investmentWithdrawalVerifiedEmail, investmentWithdrawalRejectedEmail } from "@/lib/email";
import { NextResponse } from "next/server";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, supabase: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") return { user: null, supabase: null };
  return { user, supabase };
}

function addressColumnFor(currency) {
  const map = {
    BTC: "btc_deposit_address",
    ETH: "eth_deposit_address",
    USDT: "usdt_deposit_address",
  };
  return map[currency] || null;
}

export async function POST(request) {
  const { user: admin, supabase } = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { transactionId, action, adminNote, skipBlockchainCheck } = await request.json();

  if (!transactionId || !["verify", "reject", "check"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: txn, error: fetchError } = await supabaseAdmin
    .from("transactions")
    .select("*")
    .eq("id", transactionId)
    .single();

  if (fetchError || !txn) {
    return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  }

  // "check" — read-only blockchain verification for deposits, unchanged.
  if (action === "check") {
    if (!txn.crypto_currency || !txn.tx_hash) {
      return NextResponse.json({ error: "Nothing to check — no crypto currency or tx hash on this transaction" }, { status: 400 });
    }

    const { data: settings } = await supabaseAdmin
      .from("settings")
      .select("btc_deposit_address, eth_deposit_address, usdt_deposit_address")
      .single();

    const addressColumn = addressColumnFor(txn.crypto_currency);
    const expectedAddress = addressColumn ? settings?.[addressColumn] : null;

    if (!expectedAddress) {
      return NextResponse.json(
        { error: `No deposit address configured for ${txn.crypto_currency} in Settings` },
        { status: 400 }
      );
    }

    const result = await verifyTransaction(txn.crypto_currency, txn.tx_hash, expectedAddress, txn.crypto_amount);

    await supabaseAdmin
      .from("transactions")
      .update({ onchain_verification: result, onchain_checked_at: new Date().toISOString() })
      .eq("id", transactionId);

    return NextResponse.json({ success: true, blockchainResult: result });
  }

  if (txn.status !== "pending") {
    return NextResponse.json({ error: "Transaction has already been processed" }, { status: 400 });
  }

  if (action === "reject") {
    const { error } = await supabaseAdmin
      .from("transactions")
      .update({
        status: "rejected",
        admin_note: adminNote || null,
        verified_by: admin.id,
        verified_at: new Date().toISOString(),
      })
      .eq("id", transactionId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    try {
      await logAdminAction(supabase, {
        action: `${txn.type}_rejected`,
        targetUserId: txn.user_id,
        amountUsd: txn.amount_usd,
        reason: adminNote || "Rejected by admin",
      });
    } catch (auditError) {
      console.error("Audit log failed after successful rejection:", auditError);
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email, email_notifications")
      .eq("id", txn.user_id)
      .single();

    if (profile) {
      // NOTE: investment_interest_claim rejections currently fall through
      // to the generic withdrawalRejectedEmail wording ("your withdrawal
      // was rejected"), same as admin_credit does today. Add a dedicated
      // investmentGainClaimRejectedEmail in lib/email.js if you want
      // wording specific to gains claims — this route already has the
      // right branch point to plug it into.
      const emailContent = txn.type === "deposit"
        ? depositRejectedEmail(txn.amount_usd, adminNote)
        : txn.type === "investment_withdrawal"
        ? investmentWithdrawalRejectedEmail(txn.amount_usd, adminNote)
        : withdrawalRejectedEmail(txn.amount_usd, adminNote);
      await sendNotificationEmail({ to: profile.email, notificationsEnabled: profile.email_notifications, ...emailContent });
    }

    return NextResponse.json({ success: true });
  }

  // ── action === "verify" ──────────────────────────────────────────

  // 1. Deposit blockchain verification (unchanged from before)
  let blockchainResult = null;

  if (txn.type === "deposit" && txn.crypto_currency && txn.tx_hash) {
    const checkedRecently =
      txn.onchain_checked_at &&
      Date.now() - new Date(txn.onchain_checked_at).getTime() < 5 * 60 * 1000;

    if (checkedRecently && txn.onchain_verification) {
      blockchainResult = txn.onchain_verification;
    } else {
      const { data: settings } = await supabaseAdmin
        .from("settings")
        .select("btc_deposit_address, eth_deposit_address, usdt_deposit_address")
        .single();

      const addressColumn = addressColumnFor(txn.crypto_currency);
      const expectedAddress = addressColumn ? settings?.[addressColumn] : null;

      if (!expectedAddress) {
        return NextResponse.json({ error: `No deposit address configured for ${txn.crypto_currency} in Settings` }, { status: 400 });
      }

      blockchainResult = await verifyTransaction(txn.crypto_currency, txn.tx_hash, expectedAddress, txn.crypto_amount);

      await supabaseAdmin
        .from("transactions")
        .update({ onchain_verification: blockchainResult, onchain_checked_at: new Date().toISOString() })
        .eq("id", transactionId);
    }

    const isClean =
      blockchainResult.found && blockchainResult.succeeded &&
      blockchainResult.matchesAddress && blockchainResult.amountMatches && blockchainResult.confirmed;

    if (!isClean && !skipBlockchainCheck) {
      return NextResponse.json({ error: "Blockchain verification did not pass — review before overriding", blockchainResult }, { status: 409 });
    }
  }

  // 1b. Bank deposit (Stripe ACH) — the pull is attempted here, on admin
  // approval, and the wallet is credited as soon as Stripe ACCEPTS the
  // attempt (status "processing" or "succeeded") — not once it fully
  // clears with the real bank days later. Known tradeoff: if a pull later
  // bounces (insufficient funds, closed account), the balance won't
  // automatically reverse. A webhook-based version that waits for real
  // confirmation exists in app/api/stripe/webhook/route.js if you want
  // to switch to the safer version later — not wired in for now per your
  // choice to keep this simple and immediate.
  let stripePaymentIntentStatus = null;

  if (txn.type === "deposit" && txn.payment_method === "bank" && txn.linked_bank_account_id) {
    const stripe = getStripe();

    const { data: bankAccount, error: bankFetchError } = await supabaseAdmin
      .from("linked_bank_accounts")
      .select("stripe_payment_method_id, status")
      .eq("id", txn.linked_bank_account_id)
      .single();

    if (bankFetchError || !bankAccount || bankAccount.status !== "active") {
      return NextResponse.json({ error: "Linked bank account not found or no longer active" }, { status: 400 });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", txn.user_id)
      .single();

    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ error: "No Stripe customer on file for this user" }, { status: 400 });
    }

    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(Number(txn.amount_usd) * 100), // Stripe uses cents
        currency: "usd",
        customer: profile.stripe_customer_id,
        payment_method: bankAccount.stripe_payment_method_id,
        payment_method_types: ["us_bank_account"],
        confirm: true,
        off_session: true,
      });

      stripePaymentIntentStatus = paymentIntent.status;

      await supabaseAdmin
        .from("transactions")
        .update({
          stripe_payment_intent_id: paymentIntent.id,
          stripe_payment_intent_status: paymentIntent.status,
        })
        .eq("id", transactionId);

      // ACH pulls normally come back "processing" immediately — that's
      // expected and treated as accepted, not a failure. Only a hard
      // decline/error is treated as a real failure here.
      if (!["processing", "succeeded"].includes(paymentIntent.status)) {
        return NextResponse.json(
          { error: `Stripe did not accept this pull (status: ${paymentIntent.status})` },
          { status: 400 }
        );
      }
      // Falls through to the shared wallet-credit logic below —
      // balance updates now, regardless of "processing" vs "succeeded".
    } catch (stripeError) {
      console.error("Stripe ACH pull failed:", stripeError);
      await supabaseAdmin
        .from("transactions")
        .update({ stripe_payment_intent_status: "failed" })
        .eq("id", transactionId);
      return NextResponse.json({ error: `Bank pull failed: ${stripeError.message}` }, { status: 500 });
    }
  }

  // 2. REAL crypto payout for external withdrawals — this is the new part.
  //
  // Critical ordering: we attempt the actual send BEFORE touching the
  // wallet balance. If the send fails (insufficient hot wallet funds,
  // network error, bad address), nothing about the user's balance
  // changes and the transaction stays pending — instead of the old
  // behavior where a database number would just go down regardless
  // of whether money actually moved anywhere.
  let sentTxHash = null;

  if (txn.type === "withdrawal" && txn.crypto_currency && txn.destination_address) {
    try {
      const hotBalance = await getHotWalletBalance(txn.crypto_currency);
      if (hotBalance < Number(txn.crypto_amount)) {
        return NextResponse.json(
          { error: `Platform hot wallet only has ${hotBalance} ${txn.crypto_currency} — cannot cover this ${txn.crypto_amount} ${txn.crypto_currency} withdrawal. Fund the wallet first.` },
          { status: 400 }
        );
      }

      const result = await sendCryptoPayout(txn.crypto_currency, txn.destination_address, txn.crypto_amount);
      sentTxHash = result.txHash;

      await supabaseAdmin
        .from("transactions")
        .update({ sent_tx_hash: sentTxHash, sent_at: new Date().toISOString(), send_error: null })
        .eq("id", transactionId);
    } catch (sendError) {
      console.error("Crypto send failed:", sendError);
      await supabaseAdmin
        .from("transactions")
        .update({ send_error: sendError.message })
        .eq("id", transactionId);
      return NextResponse.json({ error: `Failed to send crypto: ${sendError.message}` }, { status: 500 });
    }
  }

  // 3. Wallet balance update (deposits, admin credits/debits, investment
  //    withdrawals, investment gain claims, and now also confirmed
  //    external withdrawals whose send just succeeded above)
  // 2b. REAL bank payout for withdrawals via Stripe Connect — same
  // "send before touching balance" pattern as crypto. Only runs for
  // withdrawals where payment_method === "bank" (Withdraw page needs
  // updating to actually offer this — currently crypto-only).
  let stripeTransferId = null;

  if (txn.type === "withdrawal" && txn.payment_method === "bank") {
    const stripe = getStripe();

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("stripe_connect_account_id, stripe_connect_onboarded")
      .eq("id", txn.user_id)
      .single();

    if (!profile?.stripe_connect_account_id || !profile?.stripe_connect_onboarded) {
      return NextResponse.json(
        { error: "User has not completed bank payout onboarding with Stripe — cannot send funds." },
        { status: 400 }
      );
    }

    try {
      const transfer = await stripe.transfers.create({
        amount: Math.round(Number(txn.amount_usd) * 100),
        currency: "usd",
        destination: profile.stripe_connect_account_id,
      });
      stripeTransferId = transfer.id;

      await supabaseAdmin
        .from("transactions")
        .update({ sent_tx_hash: transfer.id, sent_at: new Date().toISOString() }) // reusing sent_tx_hash/sent_at columns — same "proof money left the platform" concept as crypto
        .eq("id", transactionId);
    } catch (transferError) {
      console.error("Stripe transfer failed:", transferError);
      await supabaseAdmin
        .from("transactions")
        .update({ send_error: transferError.message })
        .eq("id", transactionId);
      return NextResponse.json({ error: `Bank payout failed: ${transferError.message}` }, { status: 500 });
    }
  }

  const { data: wallet, error: walletFetchError } = await supabaseAdmin
    .from("wallets")
    .select("balance_usd")
    .eq("user_id", txn.user_id)
    .single();

  if (walletFetchError || !wallet) {
    return NextResponse.json({ error: "Wallet not found for this user" }, { status: 500 });
  }

  // Added "investment_interest_claim" here — same credit direction as
  // an investment_withdrawal, just a different transaction type.
  const isCredit = txn.type === "deposit" || txn.type === "admin_credit" || txn.type === "investment_withdrawal" || txn.type === "investment_interest_claim";
  const delta = isCredit ? Number(txn.amount_usd) : -Number(txn.amount_usd);
  const newBalance = Number(wallet.balance_usd) + delta;

  if (newBalance < 0) {
    return NextResponse.json({ error: "This would take the user's balance negative — cannot approve." }, { status: 400 });
  }

  const { error: walletUpdateError } = await supabaseAdmin
    .from("wallets")
    .update({ balance_usd: newBalance, updated_at: new Date().toISOString() })
    .eq("user_id", txn.user_id);

  if (walletUpdateError) {
    return NextResponse.json({ error: walletUpdateError.message }, { status: 500 });
  }

  // 4. Investment record update (unchanged from before)
  if (txn.type === "investment_withdrawal" && txn.investment_id) {
    const { data: inv, error: invFetchError } = await supabaseAdmin
      .from("investments")
      .select("amount_usd, withdrawn_principal")
      .eq("id", txn.investment_id)
      .single();

    if (invFetchError || !inv) {
      return NextResponse.json({ error: "Investment not found — wallet was credited but investment record could not be updated. Investigate manually." }, { status: 500 });
    }

    const newWithdrawnPrincipal = Number(inv.withdrawn_principal) + Number(txn.principal_portion || 0);
    const isFullyWithdrawn = newWithdrawnPrincipal >= Number(inv.amount_usd) - 0.005;

    const { error: invUpdateError } = await supabaseAdmin
      .from("investments")
      .update({ withdrawn_principal: newWithdrawnPrincipal, status: isFullyWithdrawn ? "withdrawn" : "active" })
      .eq("id", txn.investment_id);

    if (invUpdateError) {
      return NextResponse.json({ error: `Wallet was credited but investment record failed to update: ${invUpdateError.message}. Investigate manually.` }, { status: 500 });
    }
  }

  // 4b. NEW — investment gain claim: bumps claimed_interest so this
  // same accrued interest can't be paid out again on a future claim.
  // Never touches withdrawn_principal or status — principal stays
  // invested exactly as it was.
  if (txn.type === "investment_interest_claim" && txn.investment_id) {
    const { data: inv, error: invFetchError } = await supabaseAdmin
      .from("investments")
      .select("claimed_interest")
      .eq("id", txn.investment_id)
      .single();

    if (invFetchError || !inv) {
      return NextResponse.json({ error: "Investment not found — wallet was credited but investment record could not be updated. Investigate manually." }, { status: 500 });
    }

    const newClaimedInterest = Number(inv.claimed_interest) + Number(txn.amount_usd);

    const { error: invUpdateError } = await supabaseAdmin
      .from("investments")
      .update({ claimed_interest: newClaimedInterest })
      .eq("id", txn.investment_id);

    if (invUpdateError) {
      return NextResponse.json({ error: `Wallet was credited but investment record failed to update: ${invUpdateError.message}. Investigate manually.` }, { status: 500 });
    }
  }

  const { error: txnUpdateError } = await supabaseAdmin
    .from("transactions")
    .update({
      status: "verified",
      admin_note: adminNote || null,
      verified_by: admin.id,
      verified_at: new Date().toISOString(),
    })
    .eq("id", transactionId);

  if (txnUpdateError) {
    return NextResponse.json({ error: txnUpdateError.message }, { status: 500 });
  }

  try {
    await logAdminAction(supabase, {
      action: `${txn.type}_verified`,
      targetUserId: txn.user_id,
      amountUsd: txn.amount_usd,
      reason: adminNote || "Verified by admin",
      metadata: blockchainResult ? { onchain: blockchainResult } : (sentTxHash ? { sentTxHash } : (stripePaymentIntentStatus ? { stripePaymentIntentStatus } : undefined)),
    });
  } catch (auditError) {
    console.error("Audit log failed after successful verification:", auditError);
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("email, email_notifications")
    .eq("id", txn.user_id)
    .single();

  if (profile) {
    // Same note as the reject branch above — investment_interest_claim
    // currently uses the generic withdrawalVerifiedEmail wording.
    const emailContent = txn.type === "deposit"
      ? depositVerifiedEmail(txn.amount_usd)
      : txn.type === "investment_withdrawal"
      ? investmentWithdrawalVerifiedEmail(txn.amount_usd, txn.principal_portion, txn.forfeited_interest, txn.fee_charged)
      : withdrawalVerifiedEmail(txn.amount_usd);
    await sendNotificationEmail({ to: profile.email, notificationsEnabled: profile.email_notifications, ...emailContent });
  }

  return NextResponse.json({ success: true, newBalance, blockchainResult, sentTxHash, stripePaymentIntentStatus });
}