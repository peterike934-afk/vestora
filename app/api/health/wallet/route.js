import { createClient } from '@supabase/supabase-js'

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    // Just confirms we can read from the wallets table — not touching any real balance
   const { error } = await supabase.from('wallets').select('user_id').limit(1)
    if (error) throw error

    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 })
  }
}