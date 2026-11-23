// Stand-in for next/server. after() callbacks are collected so a test can
// run them (as Next does after the response) and check they never throw.
export const NextResponse = {
  json: (body, init = {}) => ({ status: init.status ?? 200, body, headers: init.headers ?? {} }),
}
export function after(fn) {
  const t = globalThis.__t ?? (globalThis.__t = {})
  ;(t.afterCallbacks ??= []).push(fn)
}
