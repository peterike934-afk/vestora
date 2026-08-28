import { createClient } from '@supabase/supabase-js'

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    // Confirms we can read the transactions table, a proxy for "sync is healthy"
    const { error } = await supabase.from('transactions').select('id').limit(1)
    if (error) throw error

    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 })
  }
}