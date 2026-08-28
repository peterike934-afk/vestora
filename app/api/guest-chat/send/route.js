import { createClient } from '@supabase/supabase-js'

export async function POST(request) {
  const { threadId, sender, body } = await request.json()

  if (!threadId || !sender || !body?.trim()) {
    return Response.json({ error: 'Missing required fields.' }, { status: 400 })
  }
  if (!['guest', 'admin'].includes(sender)) {
    return Response.json({ error: 'Invalid sender.' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: message, error } = await supabase
    .from('guest_messages')
    .insert({ thread_id: threadId, sender, body: body.trim() })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Bump the thread's preview + the correct unread counter, mirroring
  // how your existing message_threads view keeps itself current.
  const unreadField = sender === 'guest' ? 'unread_count' : 'guest_unread_count'
  const { data: current } = await supabase
    .from('guest_threads')
    .select(unreadField)
    .eq('id', threadId)
    .single()

  await supabase
    .from('guest_threads')
    .update({
      last_message: body.trim(),
      last_sender: sender,
      last_created_at: new Date().toISOString(),
      [unreadField]: (current?.[unreadField] || 0) + 1,
    })
    .eq('id', threadId)

  return Response.json({ message })
}