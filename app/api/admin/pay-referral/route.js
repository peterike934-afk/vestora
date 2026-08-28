import { createClient } from '@supabase/supabase-js'
import { logAdminAction } from '@/lib/audit'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request) {
  const authClient = await createServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: profile } = await authClient.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { referralId } = await request.json()
  if (!referralId) return NextResponse.json({ error: 'referralId is required' }, { status: 400 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: referral, error: refError } = await supabase
    .from('referrals')
    .select('*')
    .eq('id', referralId)
    .single()

  if (refError || !referral) return NextResponse.json({ error: 'Referral not found' }, { status: 404 })
  if (referral.status === 'paid') return NextResponse.json({ error: 'Already paid' }, { status: 400 })

  // Credit both wallets and log both as real transactions, same pattern
  // as a manual admin credit — so this shows up in each user's history.
  for (const [walletUserId, amount, label] of [
    [referral.referrer_id, referral.referrer_bonus_usd, 'Referral bonus (you referred someone)'],
    [referral.referred_id, referral.referred_bonus_usd, 'Referral bonus (you signed up with a code)'],
  ]) {
    const { data: wallet } = await supabase.from('wallets').select('balance_usd').eq('user_id', walletUserId).single()
    await supabase.from('wallets').update({ balance_usd: Number(wallet.balance_usd) + Number(amount) }).eq('user_id', walletUserId)
    await supabase.from('transactions').insert({
      user_id: walletUserId,
      type: 'admin_credit',
      amount_usd: amount,
      admin_note: label,
      status: 'verified',
    })
  }

  const { data: updated, error } = await supabase
    .from('referrals')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', referralId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  try {
    await logAdminAction(authClient, {
      action: 'referral_paid',
      p_target_user_id: referral.referrer_id,
      p_amount_usd: Number(referral.referrer_bonus_usd) + Number(referral.referred_bonus_usd),
      reason: `Paid referral #${referralId}: ${formatCurrency(referral.referrer_bonus_usd)} to referrer, ${formatCurrency(referral.referred_bonus_usd)} to referred`,
    })
  } catch (auditError) {
    console.error('Audit log failed:', auditError)
  }

  return NextResponse.json({ success: true, referral: updated })
}

function formatCurrency(n) { return `$${Number(n).toFixed(2)}` }