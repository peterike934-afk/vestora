import 'server-only'

import { referralReasonText } from '@/lib/referral-reasons'

// Referral-programme email content. Pure functions: no database, no network.
// Rules: never promise a reward before it is paid; payment emails state only
// the amount actually paid (from the ledger payload); rejection emails use
// the neutral public reason only; the campaign states the CURRENT live
// settings amounts, read at send time, never hardcoded values.

const LOGO_PATH = '/images/vestora-logo.png'

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

export function formatUsd(amount) {
  // null/'' would otherwise become 0 and render as "$0.00".
  if (amount === null || amount === undefined || amount === '' || typeof amount === 'boolean') throw new Error('Invalid amount')
  const n = Number(amount)
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid amount')
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// A "paid" email must state a real, positive amount actually credited.
function paidAmount(amount) {
  const formatted = formatUsd(amount)
  if (!(Number(amount) > 0)) throw new Error('Invalid amount')
  return formatted
}

function firstNameOf(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || 'there'
}

function layout({ appUrl, title, paragraphs, button, footerNote }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#53665c;">${p}</p>`).join('')
  const cta = button
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;"><tr><td bgcolor="#1f6f4a" style="border-radius:8px;">
         <a href="${escapeHtml(button.url)}" style="display:inline-block;padding:13px 26px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">${escapeHtml(button.label)}</a>
       </td></tr></table>`
    : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f3f6f3;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e1e9e3;border-radius:14px;">
<tr><td style="padding:28px 32px;">
<img src="${escapeHtml(appUrl + LOGO_PATH)}" width="120" alt="Vestora" style="display:block;width:120px;height:auto;border:0;margin-bottom:20px;">
<h1 style="margin:0 0 16px;font-size:20px;line-height:28px;color:#173b2c;">${escapeHtml(title)}</h1>
${body}${cta}
<p style="margin:20px 0 0;font-size:12px;line-height:18px;color:#829087;">${footerNote}</p>
</td></tr></table></body></html>`
}

const ACCOUNT_FOOTER = 'You are receiving this because it concerns your Vestora account. You can turn off account emails in Settings.'

// One function per ledger event type. ctx.recipientName is the recipient's
// own name; no email ever names or describes the other customer.
const TEMPLATES = {
  referral_registered_referrer: (ctx) => ({
    subject: 'Someone joined Vestora with your referral link',
    title: 'A new referral is pending review',
    paragraphs: [
      `Hello ${escapeHtml(firstNameOf(ctx.recipientName))},`,
      'Someone has created and verified a Vestora account using your referral link.',
      'The referral is now pending review. Any referral reward is paid only after Vestora has reviewed and approved the referral under the programme terms. We will email you when the review is complete.',
    ],
    button: { label: 'View your referrals', url: `${ctx.appUrl}/referrals` },
  }),
  referral_registered_referred: (ctx) => ({
    subject: 'Your Vestora referral has been recorded',
    title: 'Your referral has been recorded',
    paragraphs: [
      `Hello ${escapeHtml(firstNameOf(ctx.recipientName))},`,
      'Thank you for joining Vestora. Your account was created with a referral link, and the referral is now pending review.',
      'Any referral reward is paid only after Vestora has reviewed and approved the referral under the programme terms. We will email you when the review is complete.',
    ],
    button: { label: 'View your referral status', url: `${ctx.appUrl}/referrals` },
  }),
  referral_paid_referrer: (ctx) => ({
    subject: 'Your referral reward has been paid',
    title: 'Referral reward paid',
    paragraphs: [
      `Hello ${escapeHtml(firstNameOf(ctx.recipientName))},`,
      `Your referral has been approved and a referral reward of <strong>${escapeHtml(paidAmount(ctx.amountUsd))}</strong> has been credited to your Vestora wallet.`,
    ],
    button: { label: 'View your wallet', url: `${ctx.appUrl}/wallet` },
  }),
  referral_paid_referred: (ctx) => ({
    subject: 'Your referral reward has been paid',
    title: 'Referral reward paid',
    paragraphs: [
      `Hello ${escapeHtml(firstNameOf(ctx.recipientName))},`,
      `The referral for your account has been approved and a reward of <strong>${escapeHtml(paidAmount(ctx.amountUsd))}</strong> has been credited to your Vestora wallet.`,
    ],
    button: { label: 'View your wallet', url: `${ctx.appUrl}/wallet` },
  }),
  referral_rejected_referrer: (ctx) => ({
    subject: 'Update on your Vestora referral',
    title: 'Referral review completed',
    paragraphs: [
      `Hello ${escapeHtml(firstNameOf(ctx.recipientName))},`,
      'We have completed the review of a referral made with your referral link. Unfortunately it could not be approved, so no referral reward will be paid for it.',
      `Reason: ${escapeHtml(referralReasonText(ctx.reason))}`,
      'If you have questions, please contact Vestora support.',
    ],
    button: { label: 'View your referrals', url: `${ctx.appUrl}/referrals` },
  }),
  referral_rejected_referred: (ctx) => ({
    subject: 'Update on your Vestora referral',
    title: 'Referral review completed',
    paragraphs: [
      `Hello ${escapeHtml(firstNameOf(ctx.recipientName))},`,
      'We have completed the review of the referral linked to your account. Unfortunately it could not be approved, so no referral reward will be paid. Your Vestora account itself is not affected.',
      `Reason: ${escapeHtml(referralReasonText(ctx.reason))}`,
      'If you have questions, please contact Vestora support.',
    ],
    button: { label: 'View your referral status', url: `${ctx.appUrl}/referrals` },
  }),
  referral_admin_attention: (ctx) => ({
    subject: 'Referral programme: an item needs review',
    title: 'Referral item needs review',
    paragraphs: [
      'A referral could not be processed automatically and needs an administrator to review it.',
      'Open the admin referral review page to see the details.',
    ],
    button: { label: 'Open referral review', url: `${ctx.appUrl}/admin/referrals` },
  }),
}

export const REFERRAL_EVENT_TYPES = Object.keys(TEMPLATES)

export function renderReferralEmail(eventType, ctx) {
  const template = TEMPLATES[eventType]
  if (!template) throw new Error(`Unknown referral email: ${eventType}`)
  const t = template(ctx)
  return {
    subject: t.subject,
    html: layout({ appUrl: ctx.appUrl, title: t.title, paragraphs: t.paragraphs, button: t.button, footerNote: ACCOUNT_FOOTER }),
    text: htmlToText([t.title, ...t.paragraphs, t.button ? `${t.button.label}: ${t.button.url}` : ''].join('\n\n')),
  }
}

// Promotional announcement (marketing; only for customers with consent).
export function renderReferralCampaignEmail(ctx) {
  const paragraphs = [
    `Hello ${escapeHtml(firstNameOf(ctx.recipientName))},`,
    'Vestora now has a referral programme. Share your personal link with friends who are new to Vestora.',
    `When a new customer joins with your link, verifies their email, and the referral is reviewed and approved under the programme terms, you currently receive <strong>${escapeHtml(formatUsd(ctx.referrerBonusUsd))}</strong> and they receive <strong>${escapeHtml(formatUsd(ctx.referredBonusUsd))}</strong>. Amounts are those in effect when your friend joins.`,
    `Your personal referral link: <a href="${escapeHtml(ctx.referralLink)}" style="color:#1f6f4a;">${escapeHtml(ctx.referralLink)}</a>`,
    'To share it, copy the link from your Referrals page and send it directly to people you know. Please do not post it where it could be used by people you do not know.',
    `Full details: <a href="${escapeHtml(ctx.appUrl + '/legal/referral-terms')}" style="color:#1f6f4a;">referral programme terms</a>.`,
  ]
  // Commercial email must show the sender's valid physical postal address.
  if (typeof ctx.postalAddress !== 'string' || !ctx.postalAddress.trim()) throw new Error('Postal address required')
  const footerNote = `You are receiving this because you agreed to receive Vestora marketing emails. <a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:#829087;">Unsubscribe</a> at any time; account emails are not affected.<br>Vestora · ${escapeHtml(ctx.postalAddress.trim())}`
  return {
    subject: 'Invite friends to Vestora with your personal referral link',
    html: layout({ appUrl: ctx.appUrl, title: 'Introducing the Vestora referral programme', paragraphs, button: { label: 'Open your referral dashboard', url: `${ctx.appUrl}/referrals` }, footerNote }),
    text: htmlToText([
      'Introducing the Vestora referral programme', ...paragraphs,
      `Open your referral dashboard: ${ctx.appUrl}/referrals`,
      `Unsubscribe from marketing emails: ${ctx.unsubscribeUrl}`,
      `Vestora · ${escapeHtml(ctx.postalAddress.trim())}`,
    ].join('\n\n')),
    headers: {
      'List-Unsubscribe': `<${ctx.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  }
}

function htmlToText(value) {
  return value.replace(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g, '$2 ($1)').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}
