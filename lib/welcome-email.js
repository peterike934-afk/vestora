import "server-only";

import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";

const FROM_ADDRESS = "Vestora <no-reply@vestorainvestment.com>";
const LOGO_URL = "https://vestoras.vercel.app/images/vestora-logo.png";
const APP_URLS = new Set([
  "https://vestoras.vercel.app",
  "https://preview.vestorainvestment.com",
]);

function getAppUrl() {
  const configuredUrl = process.env.VESTORA_APP_URL;
  if (!configuredUrl) throw new Error("VESTORA_APP_URL is required.");

  const url = new URL(configuredUrl);
  if (
    url.protocol !== "https:" ||
    !APP_URLS.has(url.origin) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error("VESTORA_APP_URL is not an approved Vestora HTTPS origin.");
  }

  return url.origin;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function getFirstName(user) {
  const metadata = user?.user_metadata;
  const name = typeof metadata?.full_name === "string"
    ? metadata.full_name
    : typeof metadata?.name === "string"
      ? metadata.name
      : "";
  return name.trim().split(/\s+/)[0] || "there";
}

function renderWelcomeEmail(firstName, signInUrl, logoUrl) {
  const safeName = escapeHtml(firstName);
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Welcome to Vestora</title></head>
  <body style="margin:0;padding:0;background:#f3f6f3;color:#19352a;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f6f3;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e1e9e3;border-radius:16px;overflow:hidden;">
          <tr><td align="center" style="padding:34px 32px;background:#123d2c;background-image:linear-gradient(135deg,#123d2c 0%,#1f6f4a 100%);">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 10px;background:#ffffff;border-radius:12px;">
              <tr><td style="padding:7px 8px 8px;">
                <img src="${escapeHtml(logoUrl)}" width="46" height="51" alt="Vestora" style="display:block;width:46px;height:51px;border:0;">
              </td></tr>
            </table>
            <div style="font-size:22px;font-weight:700;letter-spacing:1px;color:#ffffff;">VESTORA</div>
            <div style="margin-top:8px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#c5e3d1;">A thoughtful way forward</div>
          </td></tr>
          <tr><td style="padding:42px 44px 24px;">
            <p style="margin:0 0 12px;font-size:15px;line-height:24px;color:#486457;">Hello ${safeName},</p>
            <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:38px;font-weight:500;color:#173b2c;">Congratulations!</h1>
            <p style="margin:0 0 16px;font-size:16px;line-height:27px;color:#53665c;">Your email address has been successfully verified, and your Vestora account is ready.</p>
            <p style="margin:0 0 28px;font-size:16px;line-height:27px;color:#53665c;">Welcome to Vestora. We're pleased to have you with us. You can now sign in to access your account and explore the platform.</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 28px;">
              <tr><td align="center" bgcolor="#1f6f4a" style="border-radius:8px;">
                <a href="${escapeHtml(signInUrl)}" style="display:inline-block;padding:15px 32px;border:1px solid #1f6f4a;border-radius:8px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Sign In to Vestora</a>
              </td></tr>
            </table>
            <p style="margin:0;font-size:13px;line-height:22px;color:#73847a;">If you did not create this account, please contact our support team.</p>
          </td></tr>
          <tr><td style="padding:22px 32px;background:#f8faf8;border-top:1px solid #e8eee9;text-align:center;">
            <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:1px;color:#1f6f4a;">VESTORA</p>
            <p style="margin:0;font-size:12px;line-height:20px;color:#829087;">Your account, ready when you are.</p>
            <p style="margin:8px 0 0;font-size:11px;color:#9aa69e;">© Vestora. All rights reserved.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

async function claimWelcomeEmail(admin, userId) {
  const { data, error } = await admin.rpc("claim_welcome_email", {
    p_user_id: userId,
    p_attempt_id: randomUUID(),
  });

  if (error) {
    console.error("Welcome email ledger claim failed.", error.code || "database_error");
    return null;
  }

  const claim = Array.isArray(data) ? data[0] : data;
  if (!claim?.delivery_id || !claim?.attempt_id || !claim?.attempt_count) return null;
  return { ...claim, user_id: userId };
}

async function completeWelcomeEmail(admin, claim, fields) {
  const { data, error } = await admin.rpc("complete_welcome_email", {
    p_user_id: claim.user_id,
    p_attempt_id: claim.attempt_id,
    p_expected_attempt_count: claim.attempt_count,
    p_status: fields.status,
    p_provider_message_id: fields.provider_message_id || null,
    p_failure_code: fields.failure_code || null,
  });

  const result = Array.isArray(data) ? data[0] : data;
  if (error || !result?.id) {
    console.error("Welcome email completion RPC failed.", error?.code || "state_conflict");
    return false;
  }
  return true;
}

export async function sendClaimedWelcomeEmail(admin, user, claim) {
  let appUrl;
  try {
    appUrl = getAppUrl();
  } catch {
    await completeWelcomeEmail(admin, claim, {
      status: "failed",
      failure_code: "app_url_not_configured",
    });
    console.error("Welcome email was not sent: VESTORA_APP_URL is missing or invalid.");
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    await completeWelcomeEmail(admin, claim, {
      status: "failed",
      failure_code: "provider_not_configured",
    });
    console.error("Welcome email was not sent: provider configuration is missing.");
    return;
  }

  const firstName = getFirstName(user);
  const resend = new Resend(process.env.RESEND_API_KEY);
  let result;

  try {
    result = await resend.emails.send(
      {
        from: FROM_ADDRESS,
        to: user.email,
        subject: "Welcome to Vestora – Your Account Is Ready!",
        html: renderWelcomeEmail(firstName, `${appUrl}/login`, LOGO_URL),
        text: `Congratulations, ${firstName}! Your email address has been successfully verified, and your Vestora account is ready. Welcome to Vestora. We're pleased to have you with us. Sign in at ${appUrl}/login to access your account and explore the platform.`,
      },
      { idempotencyKey: `welcome/${user.id}/${claim.attempt_id}` }
    );
  } catch {
    await completeWelcomeEmail(admin, claim, {
      status: "uncertain",
      failure_code: "provider_response_uncertain",
    });
    console.error("Welcome email provider response was uncertain.");
    return;
  }

  if (result.data?.id) {
    await completeWelcomeEmail(admin, claim, {
      status: "sent",
      provider_message_id: result.data.id,
      failure_code: null,
    });
    return;
  }

  if (result.error) {
    const status = Number(result.error.statusCode);
    const ambiguousStatus = [408, 409, 425, 429].includes(status);
    const rejected = status >= 400 && status < 500 && !ambiguousStatus;
    await completeWelcomeEmail(admin, claim, {
      status: rejected ? "failed" : "uncertain",
      failure_code: Number.isInteger(status) ? `provider_${status}` : "provider_response_uncertain",
    });
    console.error(
      rejected ? "Welcome email provider rejected the request." : "Welcome email provider response was uncertain.",
      Number.isInteger(status) ? `provider_${status}` : "provider_error"
    );
    return;
  }

  await completeWelcomeEmail(admin, claim, {
    status: "uncertain",
    failure_code: "provider_message_id_missing",
  });
  console.error("Welcome email provider response was uncertain.", "missing_message_id");
}

export async function sendWelcomeEmailOnce(user) {
  if (
    typeof user?.id !== "string" ||
    typeof user.email !== "string" ||
    !user.email.trim()
  ) {
    console.error("Welcome email skipped because verified user details are incomplete.");
    return;
  }

  try {
    const admin = createAdminClient();
    const claim = await claimWelcomeEmail(admin, user.id);
    if (claim) await sendClaimedWelcomeEmail(admin, user, claim);
  } catch {
    console.error("Welcome email processing failed; verification remains successful.");
  }
}

// How recently the email must have been confirmed for a welcome email
// to be sent. Keeps the ledger RPC off the hot path for established
// users and stops anyone who verified before this feature existed from
// receiving a welcome email the first time they pass through a trigger.
export const WELCOME_EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isNewlyVerified(user, now = Date.now()) {
  const confirmedAt = Date.parse(user?.email_confirmed_at ?? "");
  if (!Number.isFinite(confirmedAt)) return false;
  const age = now - confirmedAt;
  return age >= -5 * 60 * 1000 && age <= WELCOME_EMAIL_WINDOW_MS;
}

// Entry point for every trigger (the verification callback for both
// token_hash and code links, and the dashboard after a manual sign-in on
// another device). Exactly-once delivery is enforced by the
// email_delivery_events ledger inside sendWelcomeEmailOnce; this only
// decides whether the user is new enough to be considered at all.
export async function sendWelcomeEmailIfNewlyVerified(user) {
  if (!isNewlyVerified(user)) return;
  await sendWelcomeEmailOnce(user);
}

export async function getWelcomeEmailDeliveryEvent(userId) {
  if (typeof userId !== "string") {
    console.error("Welcome email ledger lookup requires a user ID.");
    return null;
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("get_welcome_email_delivery_event", {
      p_user_id: userId,
    });
    if (error) {
      console.error("Welcome email ledger lookup failed.", error.code || "database_error");
      return null;
    }
    return Array.isArray(data) ? data[0] || null : data || null;
  } catch {
    console.error("Welcome email ledger lookup failed.");
    return null;
  }
}

export async function retryFailedWelcomeEmail({
  userId,
  expectedAttemptCount,
  approved,
  operatorLabel,
  operatorNote,
  providerEvidence,
}) {
  if (
    typeof userId !== "string" ||
    !Number.isInteger(expectedAttemptCount) ||
    expectedAttemptCount < 1 ||
    approved !== true ||
    typeof operatorLabel !== "string" ||
    !operatorLabel.trim() ||
    typeof operatorNote !== "string" ||
    !operatorNote.trim() ||
    typeof providerEvidence !== "string" ||
    !providerEvidence.trim()
  ) {
    console.error("Welcome email retry requires explicit approval and provider evidence.");
    return;
  }

  try {
    const admin = createAdminClient();
    const { data: userData, error } = await admin.auth.admin.getUserById(userId);
    if (error || !userData?.user?.email) {
      console.error("Welcome email recovery could not load the account.", error?.code || "user_unavailable");
      return;
    }

    const { data: claimData, error: claimError } = await admin.rpc("retry_failed_welcome_email", {
      p_user_id: userId,
      p_expected_attempt_count: expectedAttemptCount,
      p_attempt_id: randomUUID(),
      p_approved: approved,
      p_operator_label: operatorLabel.trim().slice(0, 200),
      p_operator_note: operatorNote.trim().slice(0, 500),
      p_provider_evidence: providerEvidence.trim().slice(0, 500),
    });
    if (claimError) {
      console.error("Welcome email recovery claim failed.", claimError.code || "database_error");
      return;
    }
    const claim = Array.isArray(claimData) ? claimData[0] : claimData;
    if (claim) {
      await sendClaimedWelcomeEmail(admin, {
        ...userData.user,
        id: userId,
      }, {
        ...claim,
        user_id: userId,
      });
    }
  } catch {
    console.error("Welcome email recovery failed.");
  }
}

export async function reconcileUncertainWelcomeEmail({
  userId,
  attemptId,
  expectedAttemptCount,
  outcome,
  providerMessageId,
  providerEvidence,
  operatorLabel,
  operatorNote,
}) {
  if (
    typeof userId !== "string" ||
    typeof attemptId !== "string" ||
    !Number.isInteger(expectedAttemptCount) ||
    expectedAttemptCount < 1 ||
    typeof providerEvidence !== "string" ||
    !providerEvidence.trim() ||
    typeof operatorLabel !== "string" ||
    !operatorLabel.trim() ||
    typeof operatorNote !== "string" ||
    !operatorNote.trim() ||
    !["accepted", "not_accepted"].includes(outcome)
  ) {
    console.error("Welcome email reconciliation requires exact attempt details and Resend log evidence.");
    return false;
  }

  if (outcome === "accepted" && providerMessageId != null && typeof providerMessageId !== "string") {
    console.error("Welcome email provider message ID must be a string when supplied.");
    return false;
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("reconcile_uncertain_welcome_email", {
      p_user_id: userId,
      p_attempt_id: attemptId,
      p_expected_attempt_count: expectedAttemptCount,
      p_outcome: outcome,
      p_provider_message_id: providerMessageId || null,
      p_provider_evidence: providerEvidence.trim().slice(0, 500),
      p_operator_label: operatorLabel.trim().slice(0, 200),
      p_operator_note: operatorNote.trim().slice(0, 500),
    });

    const result = Array.isArray(data) ? data[0] : data;
    if (error || !result?.id) {
      console.error("Welcome email reconciliation did not change an uncertain event.", error?.code || "state_conflict");
      return false;
    }
    return true;
  } catch {
    console.error("Welcome email reconciliation failed.");
    return false;
  }
}

export async function recoverStaleSendingWelcomeEmail({
  userId,
  attemptId,
  expectedAttemptCount,
  leaseSeconds,
  operatorLabel,
  operatorNote,
}) {
  if (
    typeof userId !== "string" ||
    typeof attemptId !== "string" ||
    !Number.isInteger(expectedAttemptCount) ||
    expectedAttemptCount < 1 ||
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 60 ||
    leaseSeconds > 86400 ||
    typeof operatorLabel !== "string" ||
    !operatorLabel.trim() ||
    typeof operatorNote !== "string" ||
    !operatorNote.trim()
  ) {
    console.error("Stale welcome recovery requires exact attempt details, a 60-86400 second lease, and operator approval.");
    return false;
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("recover_stale_welcome_email", {
      p_user_id: userId,
      p_attempt_id: attemptId,
      p_expected_attempt_count: expectedAttemptCount,
      p_lease_seconds: leaseSeconds,
      p_operator_label: operatorLabel.trim().slice(0, 200),
      p_operator_note: operatorNote.trim().slice(0, 500),
    });

    const result = Array.isArray(data) ? data[0] : data;
    if (error || !result?.id) {
      console.error("Stale welcome recovery did not change the event.", error?.code || "state_conflict");
      return false;
    }

    return true;
  } catch {
    console.error("Stale welcome recovery failed.");
    return false;
  }
}
