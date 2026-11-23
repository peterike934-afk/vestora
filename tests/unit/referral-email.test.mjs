// Referral email content, unsubscribe tokens, the app-URL allowlist and the
// campaign gate. Pure functions; no database, no network, no email provider.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('../helpers/alias-hooks.mjs', import.meta.url)
const { renderReferralEmail, renderReferralCampaignEmail, REFERRAL_EVENT_TYPES, formatUsd } = await import('@/lib/referral-email')
const { signUnsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl } = await import('@/lib/unsubscribe-token')
const { getReferralAppUrl, referralLink } = await import('@/lib/referral-app-url')
const { getCampaignGate, maskEmail, ENQUEUE_CONFIRMATION, CAMPAIGN_KEY, MAX_BATCH_SIZE } = await import('@/lib/referral-campaign')
const { REFERRAL_REJECTION_REASONS, referralReasonText } = await import('@/lib/referral-reasons')

const APP = 'https://vestoras.vercel.app'
const SECRET = 'x'.repeat(40)
const env = { MARKETING_UNSUBSCRIBE_SECRET: SECRET }
const USER = '0b8f2a8e-4c1d-4f7a-9a51-1f0e9d1c2b3a'
const visible = (m) => `${m.subject}\n${m.html}\n${m.text}`

test('every ledger event type except the campaign has a template', () => {
  assert.deepEqual(REFERRAL_EVENT_TYPES.sort(), [
    'referral_admin_attention',
    'referral_paid_referred', 'referral_paid_referrer',
    'referral_registered_referred', 'referral_registered_referrer',
    'referral_rejected_referred', 'referral_rejected_referrer',
  ])
  assert.throws(() => renderReferralEmail('campaign_referral_launch', { appUrl: APP }), /Unknown referral email/)
})

test('"registered" emails promise no reward and state that payment needs review', () => {
  for (const type of ['referral_registered_referrer', 'referral_registered_referred']) {
    // Even if a payload ever carried an amount, it must not be shown.
    const m = renderReferralEmail(type, { appUrl: APP, recipientName: 'Rita Smith', amountUsd: 30 })
    const all = visible(m)
    assert.doesNotMatch(all, /\$\s?\d/, `${type}: no amount`)
    assert.match(all, /pending review/i)
    assert.match(all, /only after Vestora has reviewed and approved/i)
    assert.doesNotMatch(all, /you (will|have) (earn|receive)/i)
    assert.match(m.html, /Hello Rita,/)
    assert.match(m.html, new RegExp(`${APP}/referrals`))
  }
})

test('"paid" emails show exactly the amount from the ledger payload', () => {
  const m = renderReferralEmail('referral_paid_referrer', { appUrl: APP, recipientName: 'Rita', amountUsd: 12.5 })
  assert.match(m.html, /\$12\.50/)
  assert.match(m.text, /\$12\.50/)
  assert.throws(() => renderReferralEmail('referral_paid_referred', { appUrl: APP, amountUsd: null }), /Invalid amount/)
  for (const bad of [-1, 0, '0', '', undefined, 'abc', NaN, Infinity, true]) {
    assert.throws(() => renderReferralEmail('referral_paid_referred', { appUrl: APP, amountUsd: bad }), /Invalid amount/, String(bad))
  }
  assert.match(renderReferralEmail('referral_paid_referred', { appUrl: APP, amountUsd: '7.5' }).html, /\$7\.50/)
})

test('rejection emails show only the neutral public reason', () => {
  for (const reason of REFERRAL_REJECTION_REASONS) {
    for (const type of ['referral_rejected_referrer', 'referral_rejected_referred']) {
      const m = renderReferralEmail(type, { appUrl: APP, recipientName: 'Ben', reason, privateNote: 'FRAUD: same device as 3 accounts' })
      assert.ok(m.text.includes(referralReasonText(reason)), `${type}/${reason}`)
      assert.doesNotMatch(visible(m), /FRAUD|same device|privateNote/i)
      assert.doesNotMatch(visible(m), /\$\s?\d/)
    }
  }
  // Unknown codes fall back to the generic neutral wording, never echo input.
  const m = renderReferralEmail('referral_rejected_referred', { appUrl: APP, reason: '<script>x</script>' })
  assert.ok(m.text.includes(referralReasonText('other')))
  assert.doesNotMatch(m.html, /<script>/)
})

test('customer-controlled names are HTML-escaped', () => {
  const m = renderReferralEmail('referral_registered_referred', { appUrl: APP, recipientName: '<img src=x onerror=alert(1)> Evil' })
  assert.doesNotMatch(m.html, /<img src=x/)
  assert.match(m.html, /&lt;img/)
})

const POSTAL = '100 Example Street, Suite 1, Example City, EX 00000, USA'

test('campaign email: live amounts, referral link, terms link, unsubscribe link and headers', () => {
  const unsub = unsubscribeUrl(APP, USER, env)
  const m = renderReferralCampaignEmail({
    appUrl: APP, recipientName: 'Ana', referrerBonusUsd: 25, referredBonusUsd: 10,
    referralLink: referralLink(APP, 'ABCD1234'), unsubscribeUrl: unsub, postalAddress: POSTAL,
  })
  assert.match(m.html, /\$25\.00/)
  assert.match(m.html, /\$10\.00/)
  assert.match(m.html, /https:\/\/vestoras\.vercel\.app\/signup\?ref=ABCD1234/)
  assert.match(m.html, /https:\/\/vestoras\.vercel\.app\/legal\/referral-terms/)
  assert.ok(m.html.includes(unsub.replace(/&/g, '&amp;')))
  assert.ok(m.text.includes(unsub))
  assert.equal(m.headers['List-Unsubscribe'], `<${unsub}>`)
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
  assert.match(m.html, /reviewed and approved/)
  assert.doesNotMatch(visible(m), /vestorainvestment\.com/)
  assert.ok(m.html.includes(POSTAL) && m.text.includes(POSTAL), 'sender postal address in HTML and text (CAN-SPAM)')
})

test('campaign email cannot be rendered without a postal address; the address is escaped', () => {
  const base = { appUrl: APP, referrerBonusUsd: 1, referredBonusUsd: 2, referralLink: referralLink(APP, 'ABCD1234'), unsubscribeUrl: unsubscribeUrl(APP, USER, env) }
  for (const postalAddress of [undefined, null, '', '   ', 42]) {
    assert.throws(() => renderReferralCampaignEmail({ ...base, postalAddress }), /Postal address required/, String(postalAddress))
  }
  const m = renderReferralCampaignEmail({ ...base, postalAddress: '1 Main St & Co, "Town"' })
  assert.ok(m.html.includes('1 Main St &amp; Co, &quot;Town&quot;'))
})

test('campaign amounts change with settings (nothing hardcoded)', () => {
  const base = { appUrl: APP, referralLink: referralLink(APP, 'ABCD1234'), unsubscribeUrl: unsubscribeUrl(APP, USER, env), postalAddress: POSTAL }
  const a = renderReferralCampaignEmail({ ...base, referrerBonusUsd: 1, referredBonusUsd: 2 })
  const b = renderReferralCampaignEmail({ ...base, referrerBonusUsd: 99.99, referredBonusUsd: 0 })
  assert.match(a.html, /\$1\.00[\s\S]*\$2\.00/)
  assert.match(b.html, /\$99\.99[\s\S]*\$0\.00/)
  assert.equal(formatUsd(1234.5), '$1,234.50')
})

test('unsubscribe tokens: valid only for the same user and secret', () => {
  const token = signUnsubscribeToken(USER, env)
  assert.equal(token.length, 43)
  assert.equal(verifyUnsubscribeToken(USER, token, env), true)
  assert.equal(verifyUnsubscribeToken(USER.toUpperCase(), token, env), true, 'case-insensitive user id')
  assert.equal(verifyUnsubscribeToken('1b8f2a8e-4c1d-4f7a-9a51-1f0e9d1c2b3a', token, env), false, 'other user')
  assert.equal(verifyUnsubscribeToken(USER, token, { MARKETING_UNSUBSCRIBE_SECRET: 'y'.repeat(40) }), false, 'other secret')
  assert.equal(verifyUnsubscribeToken(USER, token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), env), false, 'tampered')
  for (const bad of ['', null, undefined, 'x', token + 'A', 42]) assert.equal(verifyUnsubscribeToken(USER, bad, env), false)
  assert.equal(verifyUnsubscribeToken('not-a-uuid', token, env), false)
  assert.throws(() => signUnsubscribeToken(USER, { MARKETING_UNSUBSCRIBE_SECRET: 'short' }), /at least 32/)
  assert.throws(() => signUnsubscribeToken(USER, {}), /at least 32/)
})

test('only the verified Production origin is accepted for email links', () => {
  assert.equal(getReferralAppUrl({ VESTORA_APP_URL: 'https://vestoras.vercel.app' }), APP)
  assert.equal(getReferralAppUrl({ VESTORA_APP_URL: 'https://vestoras.vercel.app/' }), APP)
  for (const bad of [undefined, '', 'http://vestoras.vercel.app', 'https://vestorainvestment.com', 'https://www.vestorainvestment.com',
    'https://vestoras.vercel.app.evil.com', 'https://vestoras-git-x.vercel.app', 'https://vestoras.vercel.app/path',
    'https://vestoras.vercel.app?x=1', 'https://user:pw@vestoras.vercel.app']) {
    assert.throws(() => getReferralAppUrl({ VESTORA_APP_URL: bad }), undefined, String(bad))
  }
  assert.throws(() => referralLink(APP, 'abc"><script>'), /Invalid referral code/)
  assert.throws(() => referralLink(APP, null), /Invalid referral code/)
})

test('campaign gate is closed unless terms are published and every setting is present', async () => {
  const ok = { VESTORA_APP_URL: APP, REFERRAL_CAMPAIGN_ENABLED: 'true', RESEND_API_KEY: 're_test', MARKETING_UNSUBSCRIBE_SECRET: SECRET, MARKETING_POSTAL_ADDRESS: POSTAL }
  const fetched = []
  const published = async (url, init) => { fetched.push([url, init.method]); return { ok: true } }
  const missing = async () => ({ ok: false, status: 404 })
  const offline = async () => { throw new Error('network') }

  const open = await getCampaignGate({ env: ok, fetchImpl: published })
  assert.equal(open.allowed, true)
  assert.deepEqual(fetched, [[`${APP}/legal/referral-terms`, 'GET']])

  const noTerms = await getCampaignGate({ env: ok, fetchImpl: missing })
  assert.equal(noTerms.allowed, false)
  assert.match(noTerms.blockers.join(' '), /referral terms/)
  assert.equal((await getCampaignGate({ env: ok, fetchImpl: offline })).allowed, false)

  for (const [key, value] of [['REFERRAL_CAMPAIGN_ENABLED', undefined], ['REFERRAL_CAMPAIGN_ENABLED', 'TRUE'], ['REFERRAL_CAMPAIGN_ENABLED', '1'],
    ['RESEND_API_KEY', undefined], ['MARKETING_UNSUBSCRIBE_SECRET', 'short'], ['VESTORA_APP_URL', 'https://vestorainvestment.com'],
    ['MARKETING_POSTAL_ADDRESS', undefined], ['MARKETING_POSTAL_ADDRESS', '  '], ['MARKETING_POSTAL_ADDRESS', 'PO Box'], ['MARKETING_POSTAL_ADDRESS', '<script>1 Main St</script>']]) {
    const gate = await getCampaignGate({ env: { ...ok, [key]: value }, fetchImpl: published })
    assert.equal(gate.allowed, false, `${key}=${value}`)
  }
  assert.equal(CAMPAIGN_KEY, 'referral-launch')
  assert.equal(ENQUEUE_CONFIRMATION, 'QUEUE referral-launch')
  assert.equal(MAX_BATCH_SIZE, 50)
})

test('recipient samples are masked', () => {
  assert.equal(maskEmail('jane.doe@example.com'), 'j*******@example.com')
  assert.equal(maskEmail('a@b.co'), 'a*@b.co')
  assert.equal(maskEmail(null), '(no email)')
})
