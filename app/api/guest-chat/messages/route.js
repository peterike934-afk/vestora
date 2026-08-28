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

  const { data: messages, error } = await supabase
    .from('guest_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // The guest is actively viewing this thread right now, so whatever
  // the admin sent has now been seen — reset their unread counter.
  await supabase.from('guest_threads').update({ guest_unread_count: 0 }).eq('id', threadId)

  return Response.json({ messages })
}