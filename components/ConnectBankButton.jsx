"use client";

import { useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'

let stripePromise = null
function getStripeClient() {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  }
  return stripePromise
}

const s = {
  btn: { width: '100%', padding: '12px', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', marginBottom: '16px' },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  linkedCard: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--green-dim)', border: '1px solid var(--green)', borderRadius: 'var(--radius-sm)', marginBottom: '16px' },
  linkedText: { fontSize: '14px', color: 'var(--text)', fontWeight: '500' },
  linkedSub: { fontSize: '12px', color: 'var(--text2)' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px' },
}

/**
 * Shows a "Connect your bank" button. Once linked, shows the linked
 * account instead and calls onLinked(account) so the parent page knows
 * a real, verified bank account is now available to use.
 */
export default function ConnectBankButton({ linkedAccount, onLinked }) {
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')

  async function handleConnect() {
    setError('')
    setConnecting(true)
    try {
      // Step 1: ask our server to prep a linking session for this user
      const sessionRes = await fetch('/api/stripe/create-fc-session', { method: 'POST' })
      const sessionData = await sessionRes.json()
      if (sessionData.error) throw new Error(sessionData.error)

      // Step 2: open Stripe's own secure popup — the user logs into their
      // real bank INSIDE this popup. We never see their bank credentials.
      const stripe = await getStripeClient()
      const result = await stripe.collectFinancialConnectionsAccounts({
        clientSecret: sessionData.clientSecret,
      })

      if (result.error) throw new Error(result.error.message)

      const linkedFcAccounts = result.financialConnectionsSession?.accounts
      if (!linkedFcAccounts || linkedFcAccounts.length === 0) {
        throw new Error('No bank account was linked.')
      }

      // Step 3: turn the linked account into something we can actually
      // charge, and remember it for this user.
      const finalizeRes = await fetch('/api/stripe/finalize-bank-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ financialConnectionsAccountId: linkedFcAccounts[0].id }),
      })
      const finalizeData = await finalizeRes.json()
      if (finalizeData.error) throw new Error(finalizeData.error)

      onLinked(finalizeData.linkedAccount)
    } catch (err) {
      setError(err.message || 'Failed to connect bank account.')
    } finally {
      setConnecting(false)
    }
  }

  if (linkedAccount) {
    return (
      <div style={s.linkedCard}>
        <div>
          <div style={s.linkedText}>{linkedAccount.bank_name} •••• {linkedAccount.last4}</div>
          <div style={s.linkedSub}>Connected and ready to use</div>
        </div>
        <span style={{ fontSize: '18px' }}>✓</span>
      </div>
    )
  }

  return (
    <>
      {error && <div style={s.error}>{error}</div>}
      <button
        type="button"
        style={{ ...s.btn, ...(connecting ? s.btnDisabled : {}) }}
        disabled={connecting}
        onClick={handleConnect}
      >
        🏦 {connecting ? 'Opening secure connection…' : 'Connect your bank'}
      </button>
    </>
  )
}