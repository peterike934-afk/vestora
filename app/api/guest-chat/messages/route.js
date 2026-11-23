import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateGuest, json, genericError, sessionRequired } from '@/lib/guest-chat'

// The visitor's own conversation, found from the HttpOnly ownership cookie.
// A threadId query parameter (older widgets) is ignored: it is never proof
// of ownership. Returns only the fields the widget displays.
export async function GET(request) {
  const service = createAdminClient()
  const guest = await authenticateGuest(request, service)
  if (!guest) return sessionRequired()

  const { data: messages, error } = await service
    .from('guest_messages')
    .select('id, sender, body, translated_body, created_at')
    .eq('thread_id', guest.threadId)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('guest chat messages failed:', error.message)
    return genericError()
  }

  // The visitor is looking at the thread now: the admin's replies are seen.
  await service.from('guest_threads').update({ guest_unread_count: 0 }).eq('id', guest.threadId)

  return json({ threadId: guest.threadId, messages })
}
