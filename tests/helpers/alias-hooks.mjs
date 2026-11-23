// Node module hooks for tests: loads the real app/lib source files while
//   - resolving the "@/..." path alias to the repository root,
//   - replacing framework / infrastructure modules with in-memory stand-ins
//     (tests/helpers/stubs): server-only, next/server, the Supabase client
//     factories, and the Resend SDK. No network, no real email provider.
// Register with: register('../helpers/alias-hooks.mjs', import.meta.url)
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const stubs = new URL('./stubs/', import.meta.url)
const OVERRIDES = {
  'server-only': 'server-only.mjs',
  'next/server': 'next-server.mjs',
  '@/lib/supabase/server': 'supabase-server.mjs',
  '@/lib/supabase/admin': 'supabase-admin.mjs',
  resend: 'resend.mjs',
}
const rootUrl = pathToFileURL(root).href

// Optional per-test overrides: VESTORA_TEST_MODULE_OVERRIDES is a JSON map of
// specifier -> file URL, set before register(). Used to replace payment
// modules (wallet, Stripe, prices) with recorders in integration tests.
let extraOverrides = null
function testOverrides() {
  if (extraOverrides === null) {
    try { extraOverrides = JSON.parse(process.env.VESTORA_TEST_MODULE_OVERRIDES || '{}') } catch { extraOverrides = {} }
  }
  return extraOverrides
}

export async function resolve(specifier, context, next) {
  const extra = testOverrides()[specifier]
  if (extra) return { url: extra, shortCircuit: true }
  if (OVERRIDES[specifier]) return { url: new URL(OVERRIDES[specifier], stubs).href, shortCircuit: true }
  if (specifier.startsWith('@/')) {
    const base = join(root, specifier.slice(2))
    for (const candidate of [base, `${base}.js`, `${base}.mjs`, `${base}.jsx`]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true }
    }
    throw new Error(`alias-hooks: cannot resolve ${specifier}`)
  }
  // Extension-less relative imports between the app's own files ("./wallet-btc"),
  // which Next resolves but Node's ESM loader does not.
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith(rootUrl)
      && !context.parentURL.includes('/node_modules/') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const base = fileURLToPath(new URL(specifier, context.parentURL))
    for (const candidate of [`${base}.js`, `${base}.mjs`, `${base}.jsx`]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true }
    }
  }
  return next(specifier, context)
}

// The app's .js files are ES modules compiled by Next; load them as such.
export async function load(url, context, next) {
  if (url.startsWith(rootUrl) && url.endsWith('.js') && !url.includes('/node_modules/')) {
    return { format: 'module', source: readFileSync(fileURLToPath(url)), shortCircuit: true }
  }
  return next(url, context)
}
