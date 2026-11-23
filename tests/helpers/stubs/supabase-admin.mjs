// Stand-in for @/lib/supabase/admin: the service-role client.
export function createAdminClient() {
  if (!globalThis.__t?.service) throw new Error('service client not configured in test')
  return globalThis.__t.service
}
