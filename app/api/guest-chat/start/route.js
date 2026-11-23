import { createAdminClient } from '@/lib/supabase/admin'
import {
  readJsonObject, validateStart, newGuestToken, guestCookie, clientAddress, withinLimits,
  LIMITS, json, genericError, rateLimited,
} from '@/lib/guest-chat'

// Starts a website-visitor chat, or lets a visitor continue a chat they
// started before ownership secrets existed (legacyThreadId + the same
// email, once). Responds with the thread ID and sets the HttpOnly
// ownership cookie; see lib/guest-chat.js.
export async function POST(request) {
  const parsed = await readJsonObject(request)
  if (parsed.error) return parsed.error

  const service = createAdminClient()
  const ip = clientAddress(request)
  if (!(await withinLimits(service, [
    [LIMITS.startPerIpHour, ip],
    [LIMITS.startPerIpDay, ip],
    [LIMITS.startAllHour, 'all'],
  ]))) return rateLimited()

  const input = validateStart(parsed.body)
  if (input.error) return json({ error: input.error }, 400)
  const { name, email, locale, legacyThreadId } = input.value
  const { token, hash } = newGuestToken()

  if (legacyThreadId) {
    const { data: claimed, error } = await service.rpc('guest_chat_claim_legacy_thread', {
      p_thread_id: legacyThreadId, p_email: email, p_token_hash: hash,
    })
    if (error) {
      console.error('guest chat legacy claim failed:', error.message)
      return genericError()
    }
    if (claimed === true) {
      return json({ threadId: legacyThreadId, continued: true }, 200, { 'set-cookie': guestCookie(legacyThreadId, token) })
    }
    // Not claimable (already claimed, unknown, or a different email): start
    // a new conversation instead. Nothing about the old thread is revealed.
  }

  const { data: thread, error } = await service
    .from('guest_threads')
    .insert({
      name,
      email,
      locale,
      last_message: 'Started a conversation',
      last_sender: 'guest',
      guest_token_hash: hash,
      token_issued_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error || !thread?.id) {
    console.error('guest chat start failed:', error?.message)
    return genericError()
  }
  return json({ threadId: thread.id, continued: false }, 200, { 'set-cookie': guestCookie(thread.id, token) })
}
