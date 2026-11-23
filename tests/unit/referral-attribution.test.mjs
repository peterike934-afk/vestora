// Referral attribution is server-side only (20261125000000_referral_programme).
// These checks pin the application side: the signup sends the code in the
// signup metadata, and nothing calls the withdrawn apply_referral_code.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...p) => readFileSync(join(root, ...p), 'utf8')
const code = (src) => src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

function sourceFiles(dir) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const rel = join(dir, name)
    if (statSync(join(root, rel)).isDirectory()) return sourceFiles(rel)
    return /\.(js|jsx|mjs)$/.test(name) ? [rel] : []
  })
}

test('no application code calls the withdrawn apply_referral_code', () => {
  for (const file of [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('components')]) {
    const src = code(readFileSync(join(root, file), 'utf8'))
    assert.doesNotMatch(src, /apply_referral_code|applyReferralCode/, file)
  }
})

test('signup sends the referral code in the signup metadata, normalised', () => {
  const src = code(read('components', 'Auth.jsx'))
  assert.match(src, /referralCode = form\.referralCode\.trim\(\)\.toUpperCase\(\)/)
  assert.match(src, /referral_code: referralCode/)
  assert.match(src, /supabase\.auth\.signUp\(/)
})

test('no referral code is stored in the browser any more (only an old key is cleared)', () => {
  for (const file of ['components/Auth.jsx', 'app/(auth)/login/page.js', 'components/DashboardShell.jsx']) {
    const src = code(read(file))
    assert.doesNotMatch(src, /localStorage\.setItem\(\s*['"]vestora_referral_code/, file)
    assert.doesNotMatch(src, /localStorage\.getItem\(\s*['"]vestora_referral_code/, file)
  }
})
