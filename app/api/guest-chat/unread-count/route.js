import { createClient } from '@supabase/supabase-js'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const threadId = searchParams.get('threadId')

  if (!threadId) {
    return Response.json({ error: 'threadId is required.' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data, error } = await supabase
    .from('guest_threads')
    .select('guest_unread_count')
    .eq('id', threadId)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ unreadCount: data?.guest_unread_count || 0 })
}