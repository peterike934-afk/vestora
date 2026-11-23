import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateGuest, json, genericError, sessionRequired } from '@/lib/guest-chat'

// Unread admin replies in the visitor's own thread (from the HttpOnly
// ownership cookie; a threadId query parameter is ignored).
export async function GET(request) {
  const service = createAdminClient()
  const guest = await authenticateGuest(request, service)
  if (!guest) return sessionRequired()

  const { data, error } = await service
    .from('guest_threads')
    .select('guest_unread_count')
    .eq('id', guest.threadId)
    .single()
  if (error) {
    console.error('guest chat unread count failed:', error.message)
    return genericError()
  }
  return json({ unreadCount: data?.guest_unread_count || 0 })
}
