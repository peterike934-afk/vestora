import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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

function getSafeDestination(next, origin) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/dashboard";
  }

  const destination = new URL(next, origin);
  if (destination.origin !== origin || destination.pathname === "/callback") {
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
      console.error("Email auth callback failed:", error.message);
      return redirectToLogin(request, getVerificationStatus(error.code, error.message));
    }

    const destination = getSafeDestination(next, origin);
    if (!data.session) {
      const loginUrl = new URL("/login", origin);
      loginUrl.searchParams.set("verification", "confirmed");
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.redirect(new URL(destination, origin));
  } catch (error) {
    console.error("Email auth callback could not complete:", error?.message ?? "Unknown callback error");
    return redirectToLogin(request, "failed");
  }
}
