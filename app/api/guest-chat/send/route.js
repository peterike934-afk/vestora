import { createClient } from '@supabase/supabase-js'
import { translateText } from '@/lib/translate'

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

  let translatedBody = null
  let translatedLocale = null

  if (sender === 'admin') {
    const { data: thread } = await supabase
      .from('guest_threads')
      .select('locale')
      .eq('id', threadId)
      .single()

    const targetLocale = thread?.locale || 'en'
    const translated = await translateText(body.trim(), targetLocale)
    if (translated) {
      translatedBody = translated
      translatedLocale = targetLocale
    }
  }

  const { data: message, error } = await supabase
    .from('guest_messages')
    .insert({
      thread_id: threadId,
      sender,
      body: body.trim(),
      translated_body: translatedBody,
      translated_locale: translatedLocale,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

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