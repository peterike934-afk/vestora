import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Top investors this month (verified deposits and admin credits), for the
// admin dashboard. Admins only: the caller's own session must belong to an
// admin before the service-role query runs. Everyone else gets 401/403 and
// no customer data.
const NO_STORE = { 'cache-control': 'no-store' }

export async function GET() {
  const authClient = await createClient()
  const { data: { user } = {} } = await authClient.auth.getUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401, headers: NO_STORE })

  const { data: profile } = await authClient.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })

  const supabase = createAdminClient()

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const { data: txns, error } = await supabase
    .from('transactions')
    .select('user_id, amount_usd, profiles!transactions_user_id_fkey(full_name, email)')
    .eq('status', 'verified')
    .in('type', ['deposit', 'admin_credit'])
    .gte('created_at', startOfMonth.toISOString())

  if (error) {
    console.error('Top investors query failed.', error.code || 'database_error')
    return Response.json({ error: 'Could not load top investors' }, { status: 500, headers: NO_STORE })
  }

  const byUser = {}
  for (const t of txns || []) {
    const key = t.user_id
    if (!byUser[key]) {
      byUser[key] = { userId: key, fullName: t.profiles?.full_name, email: t.profiles?.email, total: 0 }
    }
    byUser[key].total += Number(t.amount_usd)
  }

  const ranked = Object.values(byUser).sort((a, b) => b.total - a.total)
  return Response.json({ investors: ranked }, { headers: NO_STORE })
}
