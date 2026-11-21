// lib/authMessages.js
//
// User-facing messages for sign-in errors and email-verification
// outcomes. Kept out of the page file because Next.js page modules may
// only export the page component and route config.

// Turns a Supabase sign-in error into a clear message. Each case is
// matched on Supabase's error code, so an unconfirmed email or a rate
// limit is never reported as wrong credentials; anything unrecognised
// shows Supabase's own message rather than being hidden.
export function getSignInErrorMessage(error) {
  switch (error?.code) {
    case 'invalid_credentials':
      return 'Incorrect email or password.'
    case 'email_not_confirmed':
      return 'Please confirm your email address before signing in. Open the confirmation link we emailed you.'
    case 'over_request_rate_limit':
      return 'Too many sign-in attempts. Please wait a few minutes and try again.'
    case 'user_banned':
      return 'This account is currently unable to sign in. Please contact support.'
    default:
      if (error?.status === 429) return 'Too many sign-in attempts. Please wait a few minutes and try again.'
      return error?.message || 'Sign in failed. Please try again.'
  }
}

// Keyed by the ?verification= value that app/(auth)/callback/route.js
// sends to /login.
export const VERIFICATION_MESSAGES = {
  confirmed: 'Your email is verified. Sign in to continue.',
  signin_required: 'Your email is verified, but we could not sign you in automatically on this device or browser. Please sign in here to continue.',
  expired: 'This verification link has expired. Request a fresh verification email.',
  used: 'This verification link has already been used. Try signing in to your account.',
  invalid: 'This verification link is invalid or has already been used. Request a fresh link or sign in if your email is verified.',
  missing: 'The verification link is incomplete. Open the full link from your email or request a new one.',
  failed: 'We could not complete email verification right now. Please try again later.',
}

export const SUCCESS_VERIFICATION_STATUSES = new Set(['confirmed', 'signin_required'])
