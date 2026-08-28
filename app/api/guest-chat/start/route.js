import { createClient } from '@supabase/supabase-js'

export async function POST(request) {
  const { name, email } = await request.json()

  if (!name?.trim() || !email?.trim()) {
    return Response.json({ error: 'Name and email are required.' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: thread, error } = await supabase
    .from('guest_threads')
    .insert({
      name: name.trim(),
      email: email.trim(),
      last_message: 'Started a conversation',
      last_sender: 'guest',
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ threadId: thread.id })
}