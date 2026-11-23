// Stand-in for @/lib/supabase/server: the signed-in user's session client.
export async function createClient() {
  return globalThis.__t.auth
}
