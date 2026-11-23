import 'server-only'

// Verifies the signed-in user is an admin, using the caller's own session
// (RLS applies). Database functions re-check admin status themselves.
export async function requireAdmin(authClient) {
  const { data: { user } = {} } = await authClient.auth.getUser()
  if (!user) return { error: { message: 'Not authenticated', status: 401 } }
  const { data: profile } = await authClient.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return { error: { message: 'Forbidden', status: 403 } }
  return { user }
}
