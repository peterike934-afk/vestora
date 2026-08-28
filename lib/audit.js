// lib/audit.js
//
// Call logAdminAction(...) from any server action or route handler
// where an admin does something that changes state (approve/reject a
// deposit or withdrawal, adjust a wallet, edit a plan, change settings...).
//
// It's a thin wrapper around the `log_admin_action` RPC in Supabase —
// the actual insert + admin-check happens in Postgres (see
// 002_audit_logs.sql), so this file only has to gather the IP and
// pass through the params.

import { headers } from "next/headers";

/**
 * Best-effort client IP from standard proxy headers.
 * Works behind Vercel / most reverse proxies. Falls back to null
 * if nothing is present (e.g. local dev).
 */
export async function getClientIp() {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  if (forwardedFor) {
    // x-forwarded-for can be a comma-separated list; the first is the client
    return forwardedFor.split(",")[0].trim();
  }
  return headerList.get("x-real-ip") ?? null;
}

/**
 * Record an admin action in audit_logs.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 *   A server-side Supabase client for the CURRENT admin's session
 *   (so auth.uid() resolves correctly inside the RPC). Do NOT pass
 *   a service-role client here — the point is that it runs as the
 *   admin, so the DB can verify they're actually an admin.
 * @param {{
 *   action: string,          // e.g. 'deposit_verified', 'wallet_debit', 'settings_updated'
 *   targetUserId?: string,   // the user affected, if any
 *   amountUsd?: number,      // dollar amount, if any
 *   reason?: string          // admin's note / justification
 * }} params
 */
export async function logAdminAction(supabase, { action, targetUserId, amountUsd, reason }) {
  const ip = await getClientIp();

  const { data, error } = await supabase.rpc("log_admin_action", {
    p_action: action,
    p_target_user_id: targetUserId ?? null,
    p_amount_usd: amountUsd ?? null,
    p_reason: reason ?? null,
    p_ip_address: ip,
  });

  if (error) {
    // Deliberately loud: an admin action whose audit log silently fails
    // to record is worse than one that fails loudly and gets noticed.
    console.error("Audit log failed:", error);
    throw new Error(`Failed to record audit log for action "${action}": ${error.message}`);
  }

  return data; // the new audit_logs.id
}