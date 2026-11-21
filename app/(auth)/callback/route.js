import { createClient } from "@/lib/supabase/server";
import { sendWelcomeEmailIfNewlyVerified } from "@/lib/welcome-email";
import { after, NextResponse } from "next/server";

export const runtime = "nodejs";

const EMAIL_OTP_TYPES = new Set([
  "signup",
  "email",
  "magiclink",
  "recovery",
  "invite",
  "email_change",
]);

function getVerificationStatus(code, description = "") {
  const errorCode = `${code ?? ""}`.toLowerCase();
  const reason = `${description}`.toLowerCase();
  if (errorCode.includes("expired") || reason.includes("expired")) return "expired";
  if (reason.includes("already used") || reason.includes("already_used")) return "used";
  if (reason.includes("missing")) return "missing";
  return "invalid";
}

// Code-exchange failures meaning the link was opened on a different
// browser or device from the one that signed up (the PKCE code verifier
// cookie only exists in the original browser). For email links, Supabase
// has already confirmed the address before redirecting here with ?code=,
// so the user only needs to sign in on this device.
const DIFFERENT_DEVICE_CODE_ERRORS = new Set([
  "pkce_code_verifier_not_found",
  "bad_code_verifier",
  "flow_state_not_found",
]);

function getSafeDestination(next, origin) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/dashboard";
  }

  const destination = new URL(next, origin);
  // A signed-in user is never sent back to /login. This also covers links
  // already emailed with the older next=/login?verification=confirmed.
  if (
    destination.origin !== origin ||
    destination.pathname === "/callback" ||
    destination.pathname === "/login"
  ) {
    return "/dashboard";
  }

  return `${destination.pathname}${destination.search}${destination.hash}`;
}

function redirectToLogin(request, verification) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("verification", verification);
  return NextResponse.redirect(loginUrl);
}

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const authError = searchParams.get("error");
  const authErrorCode = searchParams.get("error_code");
  const authErrorDescription = searchParams.get("error_description");

  if (authError || authErrorCode || authErrorDescription) {
    return redirectToLogin(
      request,
      getVerificationStatus(authErrorCode ?? authError, authErrorDescription ?? "")
    );
  }

  if (!tokenHash && !code) {
    return redirectToLogin(request, "missing");
  }

  if (tokenHash && (!type || !EMAIL_OTP_TYPES.has(type))) {
    return redirectToLogin(request, type ? "invalid" : "missing");
  }

  try {
    const supabase = await createClient();
    const { data, error } = tokenHash
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("Email auth callback failed.", error.code || "verification_error");
      if (!tokenHash && DIFFERENT_DEVICE_CODE_ERRORS.has(error.code)) {
        return redirectToLogin(request, "signin_required");
      }
      return redirectToLogin(request, getVerificationStatus(error.code, error.message));
    }

    // Both link formats: token_hash (verifyOtp) and code
    // (exchangeCodeForSession). Only users whose email was confirmed in
    // the last 24 hours qualify, and the ledger guarantees one send.
    if (data.user) {
      try {
        after(() => sendWelcomeEmailIfNewlyVerified(data.user));
      } catch {
        console.error("Welcome email could not be scheduled; verification remains successful.");
      }
    }

    const destination = getSafeDestination(next, origin);
    if (!data.session) {
      // Verified, but no session could be created on this device.
      return redirectToLogin(request, "signin_required");
    }

    return NextResponse.redirect(new URL(destination, origin));
  } catch (error) {
    console.error("Email auth callback could not complete.", error?.code || "callback_error");
    return redirectToLogin(request, "failed");
  }
}
