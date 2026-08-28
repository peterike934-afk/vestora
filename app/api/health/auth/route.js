import { createClient } from '@supabase/supabase-js'

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    // A cheap, harmless call that proves auth is reachable
    const { error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 })
    if (error) throw error

    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 })
  }
}