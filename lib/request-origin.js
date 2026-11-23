// Cross-site request (CSRF) protection for state-changing admin API routes
// that rely on the Supabase session cookie.
//
// Supabase's cookies are SameSite=Lax, so browsers already leave them off
// cross-site POSTs. This is the second, explicit layer:
//   1. The body must be declared application/json. HTML forms can't send
//      that, and a cross-origin fetch that sets it triggers a CORS preflight,
//      which these routes never approve.
//   2. If the browser says where the request came from (Sec-Fetch-Site or
//      Origin), it must be this same site.
// Requests from non-browser clients carry neither header and also carry no
// victim's cookies; they still need a valid admin session to do anything.

export function checkSameOriginJson(request) {
  const headers = request?.headers
  if (!headers || typeof headers.get !== 'function') {
    return { ok: false, status: 400, error: 'Invalid request' }
  }

  const contentType = (headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    return { ok: false, status: 415, error: 'Requests must be sent as application/json' }
  }

  const fetchSite = headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin') {
    return { ok: false, status: 403, error: 'Cross-site requests are not allowed' }
  }

  const origin = headers.get('origin')
  if (origin) {
    const allowed = new Set()
    try { allowed.add(new URL(request.url).origin) } catch { /* no usable request URL */ }
    for (const host of [headers.get('x-forwarded-host'), headers.get('host')]) {
      if (!host) continue
      const proto = (headers.get('x-forwarded-proto') || 'https').split(',')[0].trim()
      allowed.add(`${proto}://${host.split(',')[0].trim()}`)
    }
    if (!allowed.has(origin)) {
      return { ok: false, status: 403, error: 'Cross-site requests are not allowed' }
    }
  }

  return { ok: true }
}
