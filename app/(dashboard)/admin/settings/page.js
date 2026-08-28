"use client";

import { useState, useEffect } from 'react'
import { getSettings, getAllPlansAdmin, createPlan, updatePlan } from '@/lib/queries'

const s = {
  page: { padding: '32px 36px', maxWidth: '900px' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)', marginBottom: '28px' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', marginBottom: '20px' },
  cardTitle: { fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '20px' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  label: { display: 'block', fontSize: '13px', color: 'var(--text2)', marginBottom: '6px', fontWeight: '500' },
  input: { width: '100%', padding: '11px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px' },
  toggleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0 16px' },
  toggleLabel: { fontSize: '14px', fontWeight: '500', color: 'var(--text)' },
  toggleDesc: { fontSize: '12px', color: 'var(--text3)', marginTop: '2px' },
  toggle: { width: '44px', height: '24px', borderRadius: '12px', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' },
  toggleKnob: { width: '18px', height: '18px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '3px', transition: 'left 0.2s' },
  btnGreen: { padding: '13px 28px', background: 'var(--green)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#000', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px' },
  success: { fontSize: '13px', color: 'var(--green)', background: 'var(--green-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px' },
  th: { fontSize: '11px', fontWeight: '500', color: 'var(--text3)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 8px 12px 0', textAlign: 'left' },
  td: { padding: '10px 8px 10px 0', borderTop: '1px solid var(--border)', fontSize: '13px', color: 'var(--text)' },
  tdInput: { width: '80px', padding: '6px 8px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '13px', outline: 'none' },
  badge: { fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px', cursor: 'pointer' },
  addPlanBtn: { marginTop: '16px', padding: '10px 18px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
}

const emptyPlan = { name: '', description: '', apyPercent: '', termDays: '', minAmount: '', maxAmount: '' }

export default function AdminSettingsPage() {
  const [form, setForm] = useState(null)
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [newPlan, setNewPlan] = useState(null)
  const [savingPlanId, setSavingPlanId] = useState(null)

  async function loadAll() {
    setLoading(true)
    try {
      const [settingsData, planData] = await Promise.all([getSettings(), getAllPlansAdmin()])
      setForm(settingsData)
      setPlans(planData)
    } catch (err) {
      setError(err.message || 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  async function handleSaveSettings() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch('/api/admin/update-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
  company_name: form.company_name,
  company_logo_url: form.company_logo_url,
  withdrawal_fee_percent: Number(form.withdrawal_fee_percent),
  min_deposit_usd: Number(form.min_deposit_usd),
  min_withdrawal_usd: Number(form.min_withdrawal_usd),
  daily_withdrawal_limit_usd: Number(form.daily_withdrawal_limit_usd),
  maintenance_mode: form.maintenance_mode,
  btc_deposit_address: form.btc_deposit_address,
  eth_deposit_address: form.eth_deposit_address,
  usdt_deposit_address: form.usdt_deposit_address,
  show_investor_activity: form.show_investor_activity,
  bank_transfer_enabled: form.bank_transfer_enabled,
  bank_wire_enabled: form.bank_wire_enabled,
  bank_name: form.bank_name,
  bank_account_name: form.bank_account_name,
  bank_routing_number: form.bank_routing_number,
  bank_account_number: form.bank_account_number,
}),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setForm(data.settings)
      setSuccess('Settings saved.')
    } catch (err) {
      setError(err.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleSavePlan(plan) {
    setSavingPlanId(plan.id)
    try {
      await updatePlan(plan.id, {
        name: plan.name,
        apy_percent: Number(plan.apy_percent),
        term_days: Number(plan.term_days),
        min_amount: Number(plan.min_amount),
        max_amount: plan.max_amount ? Number(plan.max_amount) : null,
      })
    } catch (err) {
      setError(err.message || 'Failed to update plan')
    } finally {
      setSavingPlanId(null)
    }
  }

  async function handleToggleActive(plan) {
    setSavingPlanId(plan.id)
    try {
      const updated = await updatePlan(plan.id, { is_active: !plan.is_active })
      setPlans(prev => prev.map(p => p.id === plan.id ? updated : p))
    } catch (err) {
      setError(err.message || 'Failed to update plan')
    } finally {
      setSavingPlanId(null)
    }
  }

  function updatePlanField(planId, field, value) {
    setPlans(prev => prev.map(p => p.id === planId ? { ...p, [field]: value } : p))
  }

  async function handleCreatePlan() {
    if (!newPlan.name || !newPlan.apyPercent || !newPlan.termDays || !newPlan.minAmount) {
      setError('Fill in all fields for the new plan.')
      return
    }
    try {
      const created = await createPlan({
        name: newPlan.name,
        description: newPlan.description,
        apyPercent: Number(newPlan.apyPercent),
        termDays: Number(newPlan.termDays),
        minAmount: Number(newPlan.minAmount),
        maxAmount: newPlan.maxAmount ? Number(newPlan.maxAmount) : null,
      })
      setPlans(prev => [...prev, created].sort((a, b) => a.min_amount - b.min_amount))
      setNewPlan(null)
    } catch (err) {
      setError(err.message || 'Failed to create plan')
    }
  }

  if (loading || !form) {
    return <div style={s.page}><h1 style={s.title}>Settings</h1><p style={s.sub}>Loading…</p></div>
  }

  return (
    <div style={s.page}>
      <h1 style={s.title}>Platform settings</h1>
      <p style={s.sub}>Company details, fees, limits, and investment plans</p>

      {error && <div style={s.error}>{error}</div>}
      {success && <div style={s.success}>{success}</div>}

      <div style={s.card}>
        <div style={s.cardTitle}>Company</div>
        <div className="responsive-grid-2" style={s.grid2}>
          <div>
            <label style={s.label}>Company name</label>
            <input style={s.input} value={form.company_name || ''} onChange={e => setForm({ ...form, company_name: e.target.value })} />
          </div>
          <div>
            <label style={s.label}>Logo URL</label>
            <input style={s.input} value={form.company_logo_url || ''} onChange={e => setForm({ ...form, company_logo_url: e.target.value })} placeholder="https://…" />
          </div>
        </div>
      </div>

      <div style={s.card}>
        <div style={s.cardTitle}>Fees &amp; limits</div>
        <div className="responsive-grid-2" style={s.grid2}>
          <div>
            <label style={s.label}>Withdrawal fee (%)</label>
            <input style={s.input} type="number" step="0.1" value={form.withdrawal_fee_percent} onChange={e => setForm({ ...form, withdrawal_fee_percent: e.target.value })} />
          </div>
          <div>
            <label style={s.label}>Minimum deposit (USD)</label>
            <input style={s.input} type="number" value={form.min_deposit_usd} onChange={e => setForm({ ...form, min_deposit_usd: e.target.value })} />
          </div>
          <div>
            <label style={s.label}>Minimum withdrawal (USD)</label>
            <input style={s.input} type="number" value={form.min_withdrawal_usd} onChange={e => setForm({ ...form, min_withdrawal_usd: e.target.value })} />
          </div>
          <div>
            <label style={s.label}>Daily withdrawal limit (USD)</label>
            <input style={s.input} type="number" value={form.daily_withdrawal_limit_usd} onChange={e => setForm({ ...form, daily_withdrawal_limit_usd: e.target.value })} />
          </div>
        </div>
      </div>

      <div style={s.card}>
        <div style={s.cardTitle}>Deposit addresses</div>
        <label style={s.label}>Bitcoin (BTC) address</label>
        <input style={s.input} value={form.btc_deposit_address || ''} onChange={e => setForm({ ...form, btc_deposit_address: e.target.value })} />
        <label style={s.label}>Ethereum (ETH) address</label>
        <input style={s.input} value={form.eth_deposit_address || ''} onChange={e => setForm({ ...form, eth_deposit_address: e.target.value })} />
        <label style={s.label}>USDT (ERC-20) address</label>
        <input style={s.input} value={form.usdt_deposit_address || ''} onChange={e => setForm({ ...form, usdt_deposit_address: e.target.value })} />
      </div>

      <div style={s.card}>
  <div style={s.cardTitle}>Bank transfer details</div>
  <label style={s.label}>Bank name</label>
  <input style={s.input} value={form.bank_name || ''} onChange={e => setForm({ ...form, bank_name: e.target.value })} />
  <label style={s.label}>Account holder name</label>
  <input style={s.input} value={form.bank_account_name || ''} onChange={e => setForm({ ...form, bank_account_name: e.target.value })} />
  <label style={s.label}>Routing number</label>
  <input style={s.input} value={form.bank_routing_number || ''} onChange={e => setForm({ ...form, bank_routing_number: e.target.value })} />
  <label style={s.label}>Account number</label>
  <input style={s.input} value={form.bank_account_number || ''} onChange={e => setForm({ ...form, bank_account_number: e.target.value })} />
</div>

      <div style={s.card}>
        <div style={s.toggleRow}>
          <div>
            <div style={s.toggleLabel}>Bank transfer (Stripe ACH)</div>
            <div style={s.toggleDesc}>When on, users can link a bank account and deposit/withdraw via bank transfer. Keep off while testing.</div>
          </div>
          <div
            onClick={() => setForm({ ...form, bank_transfer_enabled: !form.bank_transfer_enabled })}
            style={{ ...s.toggle, background: form.bank_transfer_enabled ? 'var(--green)' : 'var(--bg4)' }}
          >
            <div style={{ ...s.toggleKnob, left: form.bank_transfer_enabled ? '23px' : '3px' }} />
          </div>
        </div>
      </div>

      <div style={s.card}>
  <div style={s.toggleRow}>
    <div>
      <div style={s.toggleLabel}>Wire transfer (manual)</div>
      <div style={s.toggleDesc}>When on, investors see your bank details and can submit a manual wire confirmation for review — same flow as crypto deposits.</div>
    </div>
    <div
      onClick={() => setForm({ ...form, bank_wire_enabled: !form.bank_wire_enabled })}
      style={{ ...s.toggle, background: form.bank_wire_enabled ? 'var(--green)' : 'var(--bg4)' }}
    >
      <div style={{ ...s.toggleKnob, left: form.bank_wire_enabled ? '23px' : '3px' }} />
    </div>
  </div>
</div>

      <div style={s.card}>
        <div style={s.toggleRow}>
          <div>
            <div style={s.toggleLabel}>Maintenance mode</div>
            <div style={s.toggleDesc}>When on, only admins can access the app, everyone else sees a maintenance page.</div>
          </div>
          <div
            onClick={() => setForm({ ...form, maintenance_mode: !form.maintenance_mode })}
            style={{ ...s.toggle, background: form.maintenance_mode ? 'var(--red)' : 'var(--bg4)' }}
          >
            <div style={{ ...s.toggleKnob, left: form.maintenance_mode ? '23px' : '3px' }} />
          </div>
        </div>
      </div>

      <div style={s.card}>
        <div style={s.toggleRow}>
          <div>
            <div style={s.toggleLabel}>Investor activity feed</div>
            <div style={s.toggleDesc}>When on, investors see a live feed of anonymized recent deposits on their dashboard.</div>
          </div>
          <div
            onClick={() => setForm({ ...form, show_investor_activity: !form.show_investor_activity })}
            style={{ ...s.toggle, background: form.show_investor_activity ? 'var(--green)' : 'var(--bg4)' }}
          >
            <div style={{ ...s.toggleKnob, left: form.show_investor_activity ? '23px' : '3px' }} />
          </div>
        </div>
      </div>

      <button style={{ ...s.btnGreen, ...(saving ? s.btnDisabled : {}) }} disabled={saving} onClick={handleSaveSettings}>
        {saving ? 'Saving…' : 'Save settings'}
      </button>

      <div style={{ ...s.card, marginTop: '32px' }}>
        <div style={s.cardTitle}>Investment plans</div>
        <div className="responsive-table-wrap">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Name', 'APY %', 'Term (days)', 'Min ($)', 'Max ($)', 'Status', ''].map(h => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plans.map(plan => (
              <tr key={plan.id}>
                <td style={s.td}>
                  <input style={s.tdInput} value={plan.name} onChange={e => updatePlanField(plan.id, 'name', e.target.value)} />
                </td>
                <td style={s.td}>
                  <input style={s.tdInput} type="number" value={plan.apy_percent} onChange={e => updatePlanField(plan.id, 'apy_percent', e.target.value)} />
                </td>
                <td style={s.td}>
                  <input style={s.tdInput} type="number" value={plan.term_days} onChange={e => updatePlanField(plan.id, 'term_days', e.target.value)} />
                </td>
                <td style={s.td}>
                  <input style={s.tdInput} type="number" value={plan.min_amount} onChange={e => updatePlanField(plan.id, 'min_amount', e.target.value)} />
                </td>
                <td style={s.td}>
                  <input style={s.tdInput} type="number" placeholder="No cap" value={plan.max_amount ?? ''} onChange={e => updatePlanField(plan.id, 'max_amount', e.target.value)} />
                </td>
                <td style={s.td}>
                  <span
                    onClick={() => handleToggleActive(plan)}
                    style={{
                      ...s.badge,
                      background: plan.is_active ? 'var(--green-dim)' : 'var(--bg4)',
                      color: plan.is_active ? 'var(--green)' : 'var(--text3)',
                    }}
                  >
                    {plan.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={s.td}>
                  <button
                    style={{ ...s.badge, background: 'var(--blue-dim)', color: 'var(--blue)', border: 'none' }}
                    disabled={savingPlanId === plan.id}
                    onClick={() => handleSavePlan(plan)}
                  >
                    {savingPlanId === plan.id ? '…' : 'Save'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {newPlan ? (
          <div style={{ marginTop: '20px', padding: '16px', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)' }}>
            <div className="responsive-grid-2" style={s.grid2}>
              <div>
                <label style={s.label}>Name</label>
                <input style={s.input} value={newPlan.name} onChange={e => setNewPlan({ ...newPlan, name: e.target.value })} />
              </div>
              <div>
                <label style={s.label}>Description</label>
                <input style={s.input} value={newPlan.description} onChange={e => setNewPlan({ ...newPlan, description: e.target.value })} />
              </div>
              <div>
                <label style={s.label}>APY %</label>
                <input style={s.input} type="number" value={newPlan.apyPercent} onChange={e => setNewPlan({ ...newPlan, apyPercent: e.target.value })} />
              </div>
              <div>
                <label style={s.label}>Term (days)</label>
                <input style={s.input} type="number" value={newPlan.termDays} onChange={e => setNewPlan({ ...newPlan, termDays: e.target.value })} />
              </div>
              <div>
                <label style={s.label}>Minimum ($)</label>
                <input style={s.input} type="number" value={newPlan.minAmount} onChange={e => setNewPlan({ ...newPlan, minAmount: e.target.value })} />
              </div>
              <div>
                <label style={s.label}>Maximum ($, optional)</label>
                <input style={s.input} type="number" placeholder="No cap" value={newPlan.maxAmount} onChange={e => setNewPlan({ ...newPlan, maxAmount: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button style={s.btnGreen} onClick={handleCreatePlan}>Create plan</button>
              <button style={s.addPlanBtn} onClick={() => setNewPlan(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button style={s.addPlanBtn} onClick={() => setNewPlan(emptyPlan)}>+ Add plan</button>
        )}
      </div>
    </div>
  )
}