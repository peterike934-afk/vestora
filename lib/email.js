import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'

const resend = new Resend(process.env.RESEND_API_KEY)

// Sending "from" address — with a verified custom domain on Resend
// you'd change this to something like notifications@vestoral.com.
// Their default onboarding domain works for testing without one.
const FROM_ADDRESS = 'Vestoral <onboarding@resend.dev>'

function formatUsd(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Reads the logo URL fresh each time rather than caching it, so
// changing it in Platform Settings takes effect on the very next
// email sent — no redeploy needed.
async function getLogoUrl() {
  try {
    const supabaseAdmin = createAdminClient()
    const { data } = await supabaseAdmin
      .from('settings')
      .select('company_logo_url')
      .eq('id', true)
      .single()
    return data?.company_logo_url || null
  } catch (err) {
    console.error('Failed to load logo URL for email template:', err)
    return null
  }
}

async function wrapTemplate(title, bodyHtml) {
  const logoUrl = await getLogoUrl()

  const header = logoUrl
    ? `<img src="${logoUrl}" alt="Vestoral" style="height: 32px; margin-bottom: 4px; display: block;" />`
    : `<div style="font-size: 20px; font-weight: 700; color: #111; margin-bottom: 4px;">Vestoral</div>`

  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      ${header}
      <h2 style="font-size: 18px; color: #111; margin: 24px 0 12px;">${title}</h2>
      ${bodyHtml}
      <p style="font-size: 12px; color: #999; margin-top: 32px;">
        You're receiving this because email notifications are enabled on your account.
        You can turn these off anytime in Settings.
      </p>
    </div>
  `
}

/**
 * Sends a notification email. Silently no-ops (doesn't throw) if the
 * user has email notifications disabled or if RESEND_API_KEY isn't
 * configured — a missing/disabled notification should never break
 * the actual admin action that triggered it.
 */
export async function sendNotificationEmail({ to, notificationsEnabled, subject, title, bodyHtml }) {
  if (!notificationsEnabled) return
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping email send')
    return
  }

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html: await wrapTemplate(title, bodyHtml),
    })
  } catch (err) {
    // Same principle as audit logging: don't let a failed email
    // break the transaction/action that triggered it.
    console.error('Failed to send notification email:', err)
  }
}

export function depositVerifiedEmail(amountUsd) {
  return {
    subject: 'Your deposit has been verified',
    title: 'Deposit verified ✓',
    bodyHtml: `<p style="color: #333; line-height: 1.6;">Your deposit of <strong>${formatUsd(amountUsd)}</strong> has been verified and credited to your wallet.</p>`,
  }
}

export function depositRejectedEmail(amountUsd, reason) {
  return {
    subject: 'Your deposit could not be verified',
    title: 'Deposit rejected',
    bodyHtml: `
      <p style="color: #333; line-height: 1.6;">Your deposit of <strong>${formatUsd(amountUsd)}</strong> could not be verified.</p>
      ${reason ? `<p style="color: #666; line-height: 1.6;">Reason: ${reason}</p>` : ''}
      <p style="color: #666; line-height: 1.6;">If you believe this is a mistake, please contact support.</p>
    `,
  }
}

export function withdrawalVerifiedEmail(amountUsd) {
  return {
    subject: 'Your withdrawal has been processed',
    title: 'Withdrawal processed ✓',
    bodyHtml: `<p style="color: #333; line-height: 1.6;">Your withdrawal of <strong>${formatUsd(amountUsd)}</strong> has been approved and processed.</p>`,
  }
}

export function withdrawalRejectedEmail(amountUsd, reason) {
  return {
    subject: 'Your withdrawal request was declined',
    title: 'Withdrawal declined',
    bodyHtml: `
      <p style="color: #333; line-height: 1.6;">Your withdrawal request of <strong>${formatUsd(amountUsd)}</strong> was declined.</p>
      ${reason ? `<p style="color: #666; line-height: 1.6;">Reason: ${reason}</p>` : ''}
    `,
  }
}

export function walletAdjustedEmail(type, amountUsd, reason) {
  const isCredit = type === 'credit'
  return {
    subject: isCredit ? 'Your account has been credited' : 'Your account has been adjusted',
    title: isCredit ? `Account credited: ${formatUsd(amountUsd)}` : `Account adjusted: -${formatUsd(amountUsd)}`,
    bodyHtml: `
      <p style="color: #333; line-height: 1.6;">Your wallet has been ${isCredit ? 'credited' : 'debited'} by <strong>${formatUsd(amountUsd)}</strong>.</p>
      <p style="color: #666; line-height: 1.6;">Reason: ${reason}</p>
    `,
  }
}

/**
 * Unlike withdrawalVerifiedEmail (crypto/bank withdrawals — a plain
 * amount), this shows the actual principal/interest/fee breakdown so
 * someone withdrawing early can see exactly why their payout is less
 * than their principal, instead of just a number with no explanation.
 */
export function investmentWithdrawalVerifiedEmail(payoutUsd, principalUsd, forfeitedInterestUsd, feeUsd) {
  const wasEarly = Number(feeUsd) > 0 || Number(forfeitedInterestUsd) > 0

  const breakdownRows = wasEarly
    ? `
      <tr><td style="padding: 4px 0; color: #666;">Principal</td><td style="padding: 4px 0; text-align: right; color: #333;">${formatUsd(principalUsd)}</td></tr>
      <tr><td style="padding: 4px 0; color: #666;">Interest forfeited (early withdrawal)</td><td style="padding: 4px 0; text-align: right; color: #c0392b;">−${formatUsd(0)}</td></tr>
      <tr><td style="padding: 4px 0; color: #666;">Early withdrawal fee</td><td style="padding: 4px 0; text-align: right; color: #c0392b;">−${formatUsd(feeUsd)}</td></tr>
    `
    : `
      <tr><td style="padding: 4px 0; color: #666;">Principal</td><td style="padding: 4px 0; text-align: right; color: #333;">${formatUsd(principalUsd)}</td></tr>
      <tr><td style="padding: 4px 0; color: #666;">Interest earned (full term)</td><td style="padding: 4px 0; text-align: right; color: #2e7d32;">+${formatUsd(Number(payoutUsd) - Number(principalUsd))}</td></tr>
    `

  return {
    subject: 'Your investment withdrawal has been processed',
    title: 'Investment withdrawal processed ✓',
    bodyHtml: `
      <p style="color: #333; line-height: 1.6;">Your withdrawal request has been approved. Here's the breakdown:</p>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin: 16px 0;">
        ${breakdownRows}
        <tr style="border-top: 1px solid #eee;">
          <td style="padding: 8px 0 4px; font-weight: 700; color: #111;">You received</td>
          <td style="padding: 8px 0 4px; text-align: right; font-weight: 700; color: #111;">${formatUsd(payoutUsd)}</td>
        </tr>
      </table>
      <p style="color: #333; line-height: 1.6;">${formatUsd(payoutUsd)} has been credited to your wallet.</p>
      ${wasEarly ? '<p style="color: #666; line-height: 1.6; font-size: 13px;">This was an early withdrawal, made before the investment reached full maturity.</p>' : ''}
    `,
  }
}

export function investmentWithdrawalRejectedEmail(amountUsd, reason) {
  return {
    subject: 'Your investment withdrawal request was declined',
    title: 'Investment withdrawal declined',
    bodyHtml: `
      <p style="color: #333; line-height: 1.6;">Your investment withdrawal request (estimated payout: <strong>${formatUsd(amountUsd)}</strong>) was declined.</p>
      ${reason ? `<p style="color: #666; line-height: 1.6;">Reason: ${reason}</p>` : ''}
      <p style="color: #666; line-height: 1.6;">Your investment remains active and untouched. If you believe this is a mistake, please contact support.</p>
    `,
  }
}