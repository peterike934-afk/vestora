import { checkSameOriginJson } from '@/lib/request-origin'
import { json, clearGuestCookie } from '@/lib/guest-chat'

// "Not you?" in the chat widget: this browser forgets the conversation (the
// HttpOnly ownership cookie is removed). The conversation itself is kept
// for the admin.
export async function DELETE(request) {
  const origin = checkSameOriginJson(request)
  if (!origin.ok) return json({ error: origin.error }, origin.status)
  return json({ ok: true }, 200, { 'set-cookie': clearGuestCookie() })
}
