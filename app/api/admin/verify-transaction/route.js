import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction } from "@/lib/audit";
import { verifyTransaction } from "@/lib/blockchain";
import { sendCryptoPayout, getHotWalletBalance } from "@/lib/wallet";
import { getStripe } from "@/lib/stripe";
import {
  sendNotificationEmail,
  depositVerifiedEmail,
  depositRejectedEmail,
  withdrawalVerifiedEmail,
  withdrawalRejectedEmail,
  investmentWithdrawalVerifiedEmail,
  investmentWithdrawalRejectedEmail,
} from "@/lib/email";
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

function isDefinitiveStripeRejection(error) {
  return (
    Number(error?.statusCode) >= 400 &&
    Number(error?.statusCode) < 500 &&
    !["StripeRateLimitError", "StripeAPIError"].includes(error?.type)
  );
}

async function updateClaim(supabase, rpcName, transactionId, claimToken, evidence) {
  const { error } = await supabase.rpc(rpcName, {
    p_transaction_id: transactionId,
    p_claim_token: claimToken,
    p_provider_evidence: evidence,
  });
  return error;
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

    const result = await verifyTransaction(
      txn.crypto_currency,
      txn.tx_hash,
      expectedAddress,
      txn.crypto_amount
    );
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
    const { error } = await supabase.rpc("reject_pending_transaction", {
      p_transaction_id: transactionId,
      p_admin_note: adminNote || null,
    });

    if (error) {
      const status = error.message?.includes("no longer pending") ||
        error.message?.includes("processing claim") ? 409 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }

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
      const emailContent = txn.type === "deposit"
        ? depositRejectedEmail(txn.amount_usd, adminNote)
        : txn.type === "investment_withdrawal"
          ? investmentWithdrawalRejectedEmail(txn.amount_usd, adminNote)
          : withdrawalRejectedEmail(txn.amount_usd, adminNote);
      await sendNotificationEmail({
        to: profile.email,
        notificationsEnabled: profile.email_notifications,
        ...emailContent,
      });
    }

    return NextResponse.json({ success: true });
  }

  const { data: claimToken, error: claimError } = await supabase.rpc(
    "claim_transaction_for_approval",
    {
      p_transaction_id: transactionId,
      p_admin_note: adminNote || null,
    }
  );

  if (claimError || !claimToken) {
    return NextResponse.json(
      { error: claimError?.message || "Transaction could not be claimed for approval" },
      { status: 409 }
    );
  }

  const releaseClaim = async (evidence = {}) => {
    const error = await updateClaim(
      supabase,
      "release_transaction_claim",
      transactionId,
      claimToken,
      evidence
    );
    if (error) {
      console.error("Unable to release transaction claim.", error.code || "claim_release_error");
      return false;
    }
    return true;
  };

  const markUncertain = async (evidence = {}) => {
    const error = await updateClaim(
      supabase,
      "mark_transaction_claim_uncertain",
      transactionId,
      claimToken,
      evidence
    );
    if (error) {
      console.error("Unable to mark transaction claim uncertain.", error.code || "claim_state_error");
      return false;
    }
    return true;
  };

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
        const released = await releaseClaim({ reason: "missing_deposit_address" });
        return NextResponse.json(
          { error: released
            ? `No deposit address configured for ${txn.crypto_currency} in Settings`
            : "Could not safely release transaction processing; contact support." },
          { status: released ? 400 : 500 }
        );
      }

      try {
        blockchainResult = await verifyTransaction(
          txn.crypto_currency,
          txn.tx_hash,
          expectedAddress,
          txn.crypto_amount
        );
      } catch (verificationError) {
        const released = await releaseClaim({ reason: "blockchain_verification_unavailable" });
        return NextResponse.json(
          { error: released
            ? "Blockchain verification is temporarily unavailable."
            : "Could not safely release transaction processing." },
          { status: released ? 503 : 500 }
        );
      }
      await supabaseAdmin
        .from("transactions")
        .update({
          onchain_verification: blockchainResult,
          onchain_checked_at: new Date().toISOString(),
        })
        .eq("id", transactionId);
    }

    const isClean =
      blockchainResult.found &&
      blockchainResult.succeeded &&
      blockchainResult.matchesAddress &&
      blockchainResult.amountMatches &&
      blockchainResult.confirmed;

    if (!isClean && !skipBlockchainCheck) {
      const released = await releaseClaim({ reason: "blockchain_verification_failed" });
      return NextResponse.json(
        { error: released
          ? "Blockchain verification did not pass — review before overriding"
          : "Could not safely release transaction processing; contact support.",
        blockchainResult },
        { status: released ? 409 : 500 }
      );
    }
  }

  let stripePaymentIntentStatus = null;
  let sentTxHash = null;
  const providerEvidence = {};
  let externalPaymentAccepted = false;

  if (txn.type === "deposit" && txn.payment_method === "bank" && txn.linked_bank_account_id) {
    const { data: bankAccount, error: bankFetchError } = await supabaseAdmin
      .from("linked_bank_accounts")
      .select("stripe_payment_method_id, status")
      .eq("id", txn.linked_bank_account_id)
      .single();

    if (bankFetchError || !bankAccount || bankAccount.status !== "active") {
      const released = await releaseClaim({ reason: "linked_bank_account_unavailable" });
      return NextResponse.json(
        { error: released
          ? "Linked bank account not found or no longer active"
          : "Could not safely release transaction processing; contact support." },
        { status: released ? 400 : 500 }
      );
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", txn.user_id)
      .single();

    if (!profile?.stripe_customer_id) {
      const released = await releaseClaim({ reason: "stripe_customer_missing" });
      return NextResponse.json(
        { error: released
          ? "No Stripe customer on file for this user"
          : "Could not safely release transaction processing; contact support." },
        { status: released ? 400 : 500 }
      );
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      const released = await releaseClaim({ reason: "stripe_secret_not_configured" });
      return NextResponse.json(
        { error: released
          ? "Payment processing is not configured."
          : "Could not safely release transaction processing." },
        { status: 500 }
      );
    }

    try {
      const paymentIntent = await getStripe().paymentIntents.create(
        {
          amount: Math.round(Number(txn.amount_usd) * 100),
          currency: "usd",
          customer: profile.stripe_customer_id,
          payment_method: bankAccount.stripe_payment_method_id,
          payment_method_types: ["us_bank_account"],
          confirm: true,
          off_session: true,
        },
        { idempotencyKey: `vestora-transaction-${txn.id}-ach-deposit` }
      );

      stripePaymentIntentStatus = paymentIntent.status;
      providerEvidence.stripePaymentIntentId = paymentIntent.id;
      providerEvidence.stripePaymentIntentStatus = paymentIntent.status;

      if (!["processing", "succeeded"].includes(paymentIntent.status)) {
        const released = await releaseClaim(providerEvidence);
        return NextResponse.json(
          { error: released
            ? `Stripe did not accept this pull (status: ${paymentIntent.status})`
            : "Stripe response received, but transaction recovery state could not be saved." },
          { status: released ? 400 : 500 }
        );
      }
      externalPaymentAccepted = true;
    } catch (stripeError) {
      console.error("Stripe ACH pull failed:", stripeError);
      const evidence = {
        sendError: stripeError.message || "Stripe payment request failed",
        stripeErrorType: stripeError.type || null,
        stripeStatusCode: stripeError.statusCode || null,
      };
      if (isDefinitiveStripeRejection(stripeError)) {
        await releaseClaim(evidence);
        return NextResponse.json(
          { error: stripeError.message },
          { status: 500 }
        );
      }

      await markUncertain(evidence);
      return NextResponse.json(
        { error: "Stripe payment outcome is uncertain; this transaction is blocked pending reconciliation." },
        { status: 503 }
      );
    }
  }

  if (txn.type === "withdrawal" && txn.crypto_currency && txn.destination_address) {
    let hotBalance;
    try {
      hotBalance = await getHotWalletBalance(txn.crypto_currency);
    } catch (balanceError) {
      const released = await releaseClaim({ reason: "hot_wallet_balance_unavailable" });
      return NextResponse.json(
        { error: released ? balanceError.message : "Could not safely release transaction processing." },
        { status: released ? 500 : 500 }
      );
    }

    if (hotBalance < Number(txn.crypto_amount)) {
      const released = await releaseClaim({ reason: "insufficient_hot_wallet_balance" });
      return NextResponse.json(
        { error: released
          ? `Platform hot wallet only has ${hotBalance} ${txn.crypto_currency} — cannot cover this ${txn.crypto_amount} ${txn.crypto_currency} withdrawal. Fund the wallet first.`
          : "Could not safely release transaction processing." },
        { status: released ? 400 : 500 }
      );
    }

    try {
      const result = await sendCryptoPayout(
        txn.crypto_currency,
        txn.destination_address,
        txn.crypto_amount
      );
      sentTxHash = result.txHash;
      providerEvidence.sentTxHash = sentTxHash;
      providerEvidence.sentAt = new Date().toISOString();
      externalPaymentAccepted = true;
    } catch (sendError) {
      console.error("Crypto send outcome requires reconciliation:", sendError);
      await markUncertain({
        sendError: sendError.message || "Crypto send outcome is uncertain",
        cryptoCurrency: txn.crypto_currency,
        destinationAddress: txn.destination_address,
        cryptoAmount: txn.crypto_amount,
      });
      return NextResponse.json(
        { error: "Crypto payment outcome is uncertain; this transaction is blocked pending reconciliation." },
        { status: 503 }
      );
    }
  }

  if (txn.type === "withdrawal" && txn.payment_method === "bank") {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("stripe_connect_account_id, stripe_connect_onboarded")
      .eq("id", txn.user_id)
      .single();

    if (!profile?.stripe_connect_account_id || !profile?.stripe_connect_onboarded) {
      const released = await releaseClaim({ reason: "stripe_connect_not_ready" });
      return NextResponse.json(
        { error: released
          ? "User has not completed bank payout onboarding with Stripe — cannot send funds."
          : "Could not safely release transaction processing." },
        { status: released ? 400 : 500 }
      );
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      const released = await releaseClaim({ reason: "stripe_secret_not_configured" });
      return NextResponse.json(
        { error: released
          ? "Payment processing is not configured."
          : "Could not safely release transaction processing." },
        { status: 500 }
      );
    }

    try {
      const transfer = await getStripe().transfers.create(
        {
          amount: Math.round(Number(txn.amount_usd) * 100),
          currency: "usd",
          destination: profile.stripe_connect_account_id,
        },
        { idempotencyKey: `vestora-transaction-${txn.id}-bank-withdrawal` }
      );
      providerEvidence.sentTxHash = transfer.id;
      providerEvidence.sentAt = new Date().toISOString();
      externalPaymentAccepted = true;
    } catch (transferError) {
      console.error("Stripe transfer outcome requires review:", transferError);
      const evidence = {
        sendError: transferError.message || "Stripe transfer failed",
        stripeErrorType: transferError.type || null,
        stripeStatusCode: transferError.statusCode || null,
      };
      if (isDefinitiveStripeRejection(transferError)) {
        await releaseClaim(evidence);
        return NextResponse.json(
          { error: transferError.message },
          { status: 500 }
        );
      }

      await markUncertain(evidence);
      return NextResponse.json(
        { error: "Stripe transfer outcome is uncertain; this transaction is blocked pending reconciliation." },
        { status: 503 }
      );
    }
  }

  if (Object.keys(providerEvidence).length > 0) {
    const evidenceError = await updateClaim(
      supabase,
      "record_transaction_claim_evidence",
      transactionId,
      claimToken,
      providerEvidence
    );
    if (evidenceError) {
      console.error("Provider accepted payment but evidence could not be persisted.", evidenceError.code || "evidence_error");
      return NextResponse.json(
        { error: "Payment was accepted, but completion is blocked pending reconciliation." },
        { status: 503 }
      );
    }
  }

  const { data: completion, error: completionError } = await supabase.rpc(
    "finalize_transaction_approval",
    {
      p_transaction_id: transactionId,
      p_claim_token: claimToken,
    }
  );

  if (completionError) {
    if (externalPaymentAccepted) {
      await markUncertain({
        finalizationError: completionError.message,
        ...providerEvidence,
      });
    } else {
      await releaseClaim({ finalizationError: completionError.message });
    }
    console.error("Transaction approval finalization failed.", completionError.code || "finalization_error");
    return NextResponse.json(
      { error: externalPaymentAccepted
        ? "Payment was accepted but database completion needs reconciliation."
        : completionError.message },
      { status: externalPaymentAccepted ? 503 : 500 }
    );
  }

  try {
    await logAdminAction(supabase, {
      action: `${txn.type}_verified`,
      targetUserId: txn.user_id,
      amountUsd: txn.amount_usd,
      reason: adminNote || "Verified by admin",
      metadata: blockchainResult
        ? { onchain: blockchainResult }
        : (sentTxHash
          ? { sentTxHash }
          : (stripePaymentIntentStatus ? { stripePaymentIntentStatus } : undefined)),
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
    const emailContent = txn.type === "deposit"
      ? depositVerifiedEmail(txn.amount_usd)
      : txn.type === "investment_withdrawal"
        ? investmentWithdrawalVerifiedEmail(
          txn.amount_usd,
          txn.principal_portion,
          txn.forfeited_interest,
          txn.fee_charged
        )
        : withdrawalVerifiedEmail(txn.amount_usd);
    await sendNotificationEmail({
      to: profile.email,
      notificationsEnabled: profile.email_notifications,
      ...emailContent,
    });
  }

  return NextResponse.json({
    success: true,
    newBalance: completion.newBalance,
    blockchainResult,
    sentTxHash: providerEvidence.sentTxHash || null,
    stripePaymentIntentStatus,
  });
}
