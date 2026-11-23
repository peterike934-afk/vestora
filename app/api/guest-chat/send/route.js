import { createAdminClient } from '@/lib/supabase/admin'
import {
  readJsonObject, authenticateGuest, validateMessage, clientAddress, withinLimits,
  LIMITS, json, genericError, rateLimited, sessionRequired,
} from '@/lib/guest-chat'

// A website visitor sends a message in THEIR OWN thread (found from the
// HttpOnly ownership cookie, never from the request body). Messages written
// here are always sender 'guest': the admin replies from the admin
// dashboard, where the database only accepts a signed-in admin.
export async function POST(request) {
  const parsed = await readJsonObject(request)
  if (parsed.error) return parsed.error
  const { body: payload } = parsed

  // Older widgets send sender: 'guest'. Anything else is an attempt to
  // write as someone else and is refused outright.
  if (payload.sender !== undefined && payload.sender !== 'guest') {
    return json({ error: 'Visitors can only send visitor messages.' }, 403)
  }

  const service = createAdminClient()
  const ip = clientAddress(request)
  if (!(await withinLimits(service, [[LIMITS.sendPerIpMinute, ip]]))) return rateLimited()

  const guest = await authenticateGuest(request, service)
  if (!guest) return sessionRequired()
  // A thread ID in the body (older widgets) must be the visitor's own.
  if (payload.threadId !== undefined && String(payload.threadId).toLowerCase() !== guest.threadId) {
    return json({ error: 'You can only send messages in your own conversation.' }, 403)
  }

  // Invalid messages count against the network limit above, but not
  // against the visitor's own conversation allowance below.
  const message = validateMessage(payload.body)
  if (message.error) return json({ error: message.error }, 400)

  if (!(await withinLimits(service, [
    [LIMITS.sendPerThreadMinute, guest.threadId],
    [LIMITS.sendPerThreadDay, guest.threadId],
  ]))) return rateLimited()

  // The thread summary and the admin's unread counter are updated by the
  // database trigger in the same transaction (20261128000000).
  const { data, error } = await service
    .from('guest_messages')
    .insert({ thread_id: guest.threadId, sender: 'guest', body: message.value })
    .select('id, sender, body, translated_body, created_at')
    .single()
  if (error) {
    console.error('guest chat send failed:', error.message)
    return genericError()
  }
  return json({ message: data })
}
