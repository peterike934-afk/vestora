import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const { data: txns, error } = await supabase
    .from('transactions')
   .select('user_id, amount_usd, profiles!transactions_user_id_fkey(full_name, email)')
    .eq('status', 'verified')
    .in('type', ['deposit', 'admin_credit'])
    .gte('created_at', startOfMonth.toISOString())

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const byUser = {}
  for (const t of txns) {
    const key = t.user_id
    if (!byUser[key]) {
      byUser[key] = { userId: key, fullName: t.profiles?.full_name, email: t.profiles?.email, total: 0 }
    }
    byUser[key].total += Number(t.amount_usd)
  }

  const ranked = Object.values(byUser).sort((a, b) => b.total - a.total)
  return Response.json({ investors: ranked })
}