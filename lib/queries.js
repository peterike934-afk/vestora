import { createClient } from '@/lib/supabase/client'


export async function getWallet(userId) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('wallets')
    .select('balance_usd, updated_at')
    .eq('user_id', userId)
    .single()

  if (error) throw error
  return data
}

export async function getTransactions(userId) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getLinkedBankAccounts(userId) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('linked_bank_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getConnectOnboardingStatus(userId) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('stripe_connect_onboarded')
    .eq('id', userId)
    .single()

  if (error) throw error
  return data?.stripe_connect_onboarded ?? false
}

export async function disconnectBankAccount(linkedAccountId) {
  const res = await fetch('/api/stripe/disconnect-bank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkedAccountId }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}

export async function createTransaction({ userId, type, amountUsd, note, cryptoCurrency, cryptoAmount, txHash, destinationAddress, paymentMethod, linkedBankAccountId }) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      type,
      amount_usd: amountUsd,
      admin_note: note || null,
      crypto_currency: cryptoCurrency || null,
      crypto_amount: cryptoAmount || null,
      tx_hash: txHash || null,
      destination_address: destinationAddress || null,
      payment_method: paymentMethod || 'crypto',
      linked_bank_account_id: linkedBankAccountId || null,
      status: 'pending',
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// ─── Chat ─────────────────────────────────────────

export async function getMessages(userId) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data
}

export async function sendMessage({ userId, sender, body }) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('messages')
    .insert({ user_id: userId, sender, body })
    .select()
    .single()

  if (error) throw error
  return data
}

// Subscribes to new messages for a given user's thread in real time.
// Call the returned function to unsubscribe (e.g. in a useEffect cleanup).
export function subscribeToMessages(userId, onNewMessage) {
  const supabase = createClient()
  const channel = supabase
    .channel(`messages:${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `user_id=eq.${userId}` },
      (payload) => onNewMessage(payload.new)
    )
    .subscribe()

  return () => supabase.removeChannel(channel)
}

export async function getUnreadAdminMessageCount(userId) {
  const supabase = createClient()
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('sender', 'admin')
    .eq('read', false)

  if (error) throw error
  return count ?? 0
}

export async function markAdminMessagesRead(userId) {
  const supabase = createClient()
  const { error } = await supabase
    .from('messages')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('sender', 'admin')
    .eq('read', false)

  if (error) throw error
}

// ─── Investments ──────────────────────────────────

export async function getInvestmentPlans() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('investment_plans')
    .select('*')
    .eq('is_active', true)
    .order('min_amount', { ascending: true })

  if (error) throw error
  return data
}

export async function getUserInvestments(userId) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('investments_with_value')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })

  if (error) throw error
  return data
}

export async function createInvestment({ planId, amountUsd }) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('create_investment', {
    p_plan_id: planId,
    p_amount_usd: amountUsd,
  })

  if (error) throw error
  return data // the new investment's id
}

// Requests a withdrawal against a specific investment. The payout
// (principal ± interest ± fee) is calculated and locked in server-side
// at request time — see request_investment_withdrawal in Supabase.
// Returns the new pending transaction's id.
export async function requestInvestmentWithdrawal({ investmentId, principalAmount }) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('request_investment_withdrawal', {
    p_investment_id: investmentId,
    p_principal_amount: principalAmount,
  })

  if (error) throw error
  return data
}

// ─── Admin messaging ──────────────────────────────

export async function getMessageThreads() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('message_threads')
    .select('*')
    .order('last_created_at', { ascending: false })

  if (error) throw error
  return data
}

// Total pending transactions across every type (deposits, withdrawals,
// investment withdrawals) — what the admin sidebar badge shows, so an
// admin knows something needs review without having to open the panel.
export async function getPendingTransactionCount() {
  const supabase = createClient()
  const { count, error } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  if (error) throw error
  return count ?? 0
}

// Fires on any insert OR status update on transactions — used to keep
// the admin sidebar's pending-review badge live, same pattern as
// subscribeToMessageCountChanges.
export function subscribeToPendingTransactionChanges(onChange) {
  const supabase = createClient()
  const channel = supabase
    .channel(`transactions:pending-count:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'transactions' },
      onChange
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'transactions' },
      onChange
    )
    .subscribe()

  return () => supabase.removeChannel(channel)
}

// Total unread messages FROM users TO admin, across every thread — this is
// what the sidebar badge shows. Distinct from getUnreadAdminMessageCount(),
// which is the reverse (a single user checking for unread admin replies).
export async function getUnreadUserMessageCount() {
  const supabase = createClient()
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('sender', 'user')
    .eq('read', false)

  if (error) throw error
  return count ?? 0
}

// Fires on any insert OR read-status update across the whole messages
// table — used to keep the admin sidebar badge live without manually
// tracking increments/decrements. The caller just re-fetches the count
// whenever this fires.
export function subscribeToMessageCountChanges(onChange) {
  const supabase = createClient()
  const channel = supabase
    .channel(`messages:count:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      onChange
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages' },
      onChange
    )
    .subscribe()

  return () => supabase.removeChannel(channel)
}

export async function markThreadRead(userId) {
  const supabase = createClient()
  const { error } = await supabase
    .from('messages')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('sender', 'user')
    .eq('read', false)

  if (error) throw error
}

// Unlike subscribeToMessages (scoped to one user's thread), this is
// for the admin inbox — no filter, so it fires for every new message
// across every user. RLS still applies: a non-admin subscribing to
// this would only receive their own thread's inserts anyway.
export function subscribeToAllMessages(onNewMessage) {
  const supabase = createClient()
  const channel = supabase
    .channel(`messages:all:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => onNewMessage(payload.new)
    )
    .subscribe()

  return () => supabase.removeChannel(channel)
}

// ─── Settings (public read) ───────────────────────

export async function getSettings() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .eq('id', true)
    .single()

  if (error) throw error
  return data
}

// ─── Investment plan management (admin) ───────────

// Unlike getInvestmentPlans() (active plans only, for the Portfolio
// page), this returns everything — inactive plans included — since
// an admin managing plans needs to see and re-enable them too.
export async function getAllPlansAdmin() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('investment_plans')
    .select('*')
    .order('min_amount', { ascending: true })

  if (error) throw error
  return data
}

export async function createPlan({ name, description, apyPercent, termDays, minAmount, maxAmount }) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('investment_plans')
    .insert({
      name,
      description,
      apy_percent: apyPercent,
      term_days: termDays,
      min_amount: minAmount,
      max_amount: maxAmount || null,
    })
    .select()
    .single()

  if (error) throw error

  try {
    await supabase.rpc('log_admin_action', {
      p_action: 'plan_created',
      p_target_user_id: null,
      p_amount_usd: null,
      p_reason: `Created plan "${name}" (${apyPercent}% APY, ${termDays}d)`,
      p_ip_address: null,
    })
  } catch (auditError) {
    console.error('Audit log failed:', auditError)
  }

  return data
}

export async function updatePlan(planId, fields) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('investment_plans')
    .update(fields)
    .eq('id', planId)
    .select()
    .single()

  if (error) throw error

  try {
    await supabase.rpc('log_admin_action', {
      p_action: 'plan_updated',
      p_target_user_id: null,
      p_amount_usd: null,
      p_reason: `Updated plan "${data.name}": ${JSON.stringify(fields)}`,
      p_ip_address: null,
    })
  } catch (auditError) {
    console.error('Audit log failed:', auditError)
  }

  return data
}

// Add to lib/queries.js

export async function getAllInvestmentsAdmin() {
  const supabase = createClient()

  const { data: investments, error: invError } = await supabase
    .from('investments_with_value')
    .select('*')
    .order('started_at', { ascending: false })

  if (invError) throw invError
  if (!investments.length) return []

  // investments_with_value is a view, so PostgREST can't auto-join it
  // to profiles the way it can with a real foreign-keyed table —
  // fetch profiles separately and merge client-side instead.
  const userIds = [...new Set(investments.map(i => i.user_id))]
  const { data: profiles, error: profError } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', userIds)

  if (profError) throw profError
  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]))

  return investments.map(inv => ({
    ...inv,
    full_name: profileMap[inv.user_id]?.full_name,
    email: profileMap[inv.user_id]?.email,
  }))
}

// ─── User settings ─────────────────────────────────

export async function updateEmailNotificationPref(userId, enabled) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('profiles')
    .update({ email_notifications: enabled })
    .eq('id', userId)
    .select()
    .single()

  if (error) throw error
  return data
}

// ─── Status page (public) ─────────────────────────

export async function getServiceStatuses() {
  const supabase = createClient()
  const { data: services, error: svcError } = await supabase
    .from('services').select('*').order('sort_order', { ascending: true })
  if (svcError) throw svcError

  const { data: latest, error: latestError } = await supabase
    .from('status_checks')
    .select('service_id, status, checked_at')
    .order('checked_at', { ascending: false })
  if (latestError) throw latestError

  const latestByService = {}
  for (const row of latest) {
    if (!latestByService[row.service_id]) latestByService[row.service_id] = row
  }

  return services.map((s) => ({ ...s, currentStatus: latestByService[s.id]?.status || 'unknown' }))
}

export async function getUptimeHistory(serviceId, days = 90) {
  const supabase = createClient()
  const since = new Date(Date.now() - days * 86400000).toISOString()

  const { data, error } = await supabase
    .from('status_checks')
    .select('status, checked_at')
    .eq('service_id', serviceId)
    .gte('checked_at', since)
    .order('checked_at', { ascending: true })
  if (error) throw error

  const rank = { down: 2, degraded: 1, up: 0 }
  const dayMap = {}
  for (const row of data) {
    const day = row.checked_at.slice(0, 10)
    if (!dayMap[day] || rank[row.status] > rank[dayMap[day]]) dayMap[day] = row.status
  }

  return Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.now() - (days - 1 - i) * 86400000).toISOString().slice(0, 10)
    return dayMap[date] || 'up'
  })
}

export async function getActiveIncidents() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('incidents')
    .select('*, incident_services(service_id, services(name)), incident_updates(*)')
    .neq('status', 'resolved')
    .order('started_at', { ascending: false })
  if (error) throw error

  return data.map(inc => ({
    ...inc,
    updates: inc.incident_updates.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    affected: inc.incident_services.map(s => s.services?.name).filter(Boolean),
  }))
}

export async function getIncidentHistory(days = 90) {
  const supabase = createClient()
  const since = new Date(Date.now() - days * 86400000).toISOString()

  const { data, error } = await supabase
    .from('incidents')
    .select('*, incident_services(service_id, services(name)), incident_updates(*)')
    .eq('status', 'resolved')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
  if (error) throw error

  return data.map(inc => ({
    ...inc,
    updates: inc.incident_updates.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    affected: inc.incident_services.map(s => s.services?.name).filter(Boolean),
  }))
}

// Keeps the public status page live — fires automatically when incidents,
// their updates, or new status checks come in, so visitors see changes
// without needing to refresh the page.
export function subscribeToStatusChanges(onChange) {
  const supabase = createClient()
  const channel = supabase
    .channel('status:public')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'incident_updates' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'status_checks' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// ─── Status page (admin) ──────────────────────────

export async function createIncident({ title, impact, serviceIds, initialUpdate }) {
  const supabase = createClient()
  const { data: incident, error } = await supabase
    .from('incidents')
    .insert({ title, impact, status: 'investigating', auto_created: false })
    .select().single()
  if (error) throw error

  if (serviceIds?.length) {
    await supabase.from('incident_services').insert(
      serviceIds.map(id => ({ incident_id: incident.id, service_id: id }))
    )
  }

  await supabase.from('incident_updates').insert({
    incident_id: incident.id, status: 'investigating', body: initialUpdate,
  })

  return incident
}

export async function postIncidentUpdate(incidentId, { status, body }) {
  const supabase = createClient()
  const { error: updateError } = await supabase
    .from('incident_updates').insert({ incident_id: incidentId, status, body })
  if (updateError) throw updateError

  const patch = { status }
  if (status === 'resolved') patch.resolved_at = new Date().toISOString()

  const { error } = await supabase.from('incidents').update(patch).eq('id', incidentId)
  if (error) throw error
}

// ─── Investor activity (public/investor-facing) ───

export async function getPublicInvestmentActivity() {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('get_public_investment_activity')
  if (error) throw error
  return data
}

export async function getMonthlyInvestmentTotal() {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('get_monthly_investment_total')
  if (error) throw error
  return data
}

export async function updateInvestorActivitySetting(enabled) {
  const supabase = createClient()
  const { error } = await supabase
    .from('settings')
    .update({ show_investor_activity: enabled })
    .eq('id', true)
  if (error) throw error
}

// ─── Guest chat (admin side) ───────────────────────

export async function getGuestThreads() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('guest_threads')
    .select('*')
    .order('last_created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getGuestMessages(threadId) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('guest_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data
}



export async function markGuestThreadRead(threadId) {
  const supabase = createClient()
  const { error } = await supabase
    .from('guest_threads')
    .update({ unread_count: 0 })
    .eq('id', threadId)

  if (error) throw error
}

export function subscribeToAllGuestMessages(onNewMessage) {
  const supabase = createClient()
  const channel = supabase
    .channel(`guest_messages:all:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'guest_messages' },
      (payload) => onNewMessage(payload.new)
    )
    .subscribe()

  return () => supabase.removeChannel(channel)
}

export async function getUnreadGuestMessageCount() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('guest_threads')
    .select('unread_count')

  if (error) throw error
  return data.reduce((sum, t) => sum + (t.unread_count || 0), 0)
}

export function subscribeToGuestMessageCountChanges(onChange) {
  const supabase = createClient()
  const channel = supabase
    .channel(`guest_threads:count:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'guest_messages' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'guest_threads' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// ─── Add to lib/queries.js ─────────────────────────────────────────
export async function claimInvestmentGains(investmentId) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('claim_investment_gains', {
    p_investment_id: investmentId,
  })
  if (error) throw error
  return data // the new pending transaction's id
}

// ─── Referrals ──────────────────────────────────────

export async function applyReferralCode(code) {
  const supabase = createClient()
  const { error } = await supabase.rpc('apply_referral_code', { p_referral_code: code })
  if (error) throw error
}

// ─── Referrals (investor-facing) ───────────────────

export async function getMyReferralCode(userId) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('referral_code')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data.referral_code
}

export async function getMyReferrals() {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('get_my_referrals')
  if (error) throw error
  return data
}

// ─── Referrals (admin) ──────────────────────────────

export async function getAllReferralsAdmin() {
  const supabase = createClient()
  const { data: referrals, error } = await supabase
    .from('referrals')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  if (!referrals.length) return []

  const userIds = [...new Set([...referrals.map(r => r.referrer_id), ...referrals.map(r => r.referred_id)])]
  const { data: profiles, error: profError } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', userIds)
  if (profError) throw profError

  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]))
  return referrals.map(r => ({
    ...r,
    referrer: profileMap[r.referrer_id],
    referred: profileMap[r.referred_id],
  }))
}

// ─── Replace ONLY this one function in lib/queries.js — everything
// else in the file stays exactly as it is. ─────────────────────────

export async function sendGuestMessageAsAdmin(threadId, body) {
  const supabase = createClient()
  const { data: message, error } = await supabase
    .from('guest_messages')
    .insert({ thread_id: threadId, sender: 'admin', body })
    .select()
    .single()

  if (error) throw error

  // Bumps guest_unread_count so the guest's own bubble can show a
  // "new reply" badge (see /api/guest-chat/unread-count) — this was
  // missing entirely before, so admin replies never surfaced there
  // regardless of how the widget itself checked for them.
  const { data: thread } = await supabase
    .from('guest_threads')
    .select('guest_unread_count')
    .eq('id', threadId)
    .single()

  await supabase
    .from('guest_threads')
    .update({
      last_message: body,
      last_sender: 'admin',
      last_created_at: new Date().toISOString(),
      guest_unread_count: (thread?.guest_unread_count || 0) + 1,
    })
    .eq('id', threadId)

  return message
}