"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/contexts/UserContext";
import { createIncident, postIncidentUpdate, getActiveIncidents } from "@/lib/queries";

const SERVICES = [
  { id: "web", name: "Web application" },
  { id: "auth", name: "Authentication" },
  { id: "wallet", name: "Deposits & withdrawals" },
  { id: "sync", name: "Wallet sync" },
];

const s = {
  page: { padding: '32px 36px' },
  title: { fontSize: '26px', fontWeight: '700', color: 'var(--text)', marginBottom: '4px' },
  sub: { fontSize: '14px', color: 'var(--text2)', marginBottom: '28px' },
  card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', marginBottom: '20px' },
  cardTitle: { fontSize: '15px', fontWeight: '600', color: 'var(--text)', marginBottom: '20px' },
  label: { display: 'block', fontSize: '13px', color: 'var(--text2)', marginBottom: '6px', fontWeight: '500' },
  input: { width: '100%', padding: '11px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px' },
  select: { width: '100%', padding: '11px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px' },
  textarea: { width: '100%', padding: '11px 14px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: '14px', outline: 'none', marginBottom: '16px', minHeight: '70px', resize: 'vertical', fontFamily: 'inherit' },
  checkRow: { display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' },
  checkLabel: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text2)' },
  btnGreen: { padding: '12px 22px', background: 'var(--green)', border: 'none', borderRadius: 'var(--radius-sm)', color: '#000', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  btnSmall: { fontSize: '12px', padding: '6px 14px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' },
  empty: { textAlign: 'center', padding: '40px', color: 'var(--text3)', fontSize: '14px' },
  incidentCard: { padding: '18px 0', borderTop: '1px solid var(--border)' },
  incidentTop: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' },
  incidentTitle: { fontSize: '14px', fontWeight: '600', color: 'var(--text)' },
  pill: { fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: '999px', textTransform: 'capitalize' },
  incidentActions: { display: 'flex', gap: '8px', marginTop: '12px' },
  error: { fontSize: '13px', color: 'var(--red)', background: 'var(--red-dim)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', marginBottom: '16px' },
}

const IMPACT_COLORS = {
  minor: { bg: 'var(--gold-dim)', color: 'var(--gold)' },
  major: { bg: 'var(--red-dim)', color: 'var(--red)' },
  critical: { bg: 'var(--red)', color: '#fff' },
}

const STATUS_COLORS = {
  investigating: { bg: 'var(--red-dim)', color: 'var(--red)' },
  identified: { bg: 'var(--gold-dim)', color: 'var(--gold)' },
  monitoring: { bg: 'var(--blue-dim)', color: 'var(--blue)' },
  resolved: { bg: 'var(--green-dim)', color: 'var(--green)' },
}

export default function AdminStatus() {
  const { isAdmin, loading: userLoading } = useUser();
  const router = useRouter();

  const [active, setActive] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: "", impact: "minor", serviceIds: [], initialUpdate: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userLoading && !isAdmin) router.push("/dashboard");
  }, [userLoading, isAdmin, router]);

  async function load() {
    setLoading(true);
    try {
      setActive(await getActiveIncidents());
    } catch (err) {
      setError(err.message || "Failed to load incidents");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  async function handleCreate() {
    setError("");
    if (!form.title.trim() || !form.initialUpdate.trim()) {
      setError("Title and an initial update message are required.");
      return;
    }
    setSubmitting(true);
    try {
      await createIncident(form);
      setForm({ title: "", impact: "minor", serviceIds: [], initialUpdate: "" });
      await load();
    } catch (err) {
      setError(err.message || "Failed to post incident");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(incidentId, status) {
    const body = prompt(`Update message for status "${status}":`);
    if (!body) return;
    try {
      await postIncidentUpdate(incidentId, { status, body });
      await load();
    } catch (err) {
      setError(err.message || "Failed to post update");
    }
  }

  if (userLoading || !isAdmin) return null;

  return (
    <div style={s.page}>
      <h1 style={s.title}>Status page</h1>
      <p style={s.sub}>Post and manage incidents shown on the public status page</p>

      {error && <div style={s.error}>{error}</div>}

      <div style={s.card}>
        <div style={s.cardTitle}>New incident</div>

        <label style={s.label}>Title</label>
        <input
          style={s.input}
          placeholder="e.g. Deposits are experiencing delays"
          value={form.title}
          onChange={e => setForm({ ...form, title: e.target.value })}
        />

        <label style={s.label}>Impact</label>
        <select style={s.select} value={form.impact} onChange={e => setForm({ ...form, impact: e.target.value })}>
          <option value="minor">Minor</option>
          <option value="major">Major</option>
          <option value="critical">Critical</option>
        </select>

        <label style={s.label}>Affected services</label>
        <div style={s.checkRow}>
          {SERVICES.map(svc => (
            <label key={svc.id} style={s.checkLabel}>
              <input
                type="checkbox"
                checked={form.serviceIds.includes(svc.id)}
                onChange={e => setForm({
                  ...form,
                  serviceIds: e.target.checked
                    ? [...form.serviceIds, svc.id]
                    : form.serviceIds.filter(id => id !== svc.id),
                })}
              />
              {svc.name}
            </label>
          ))}
        </div>

        <label style={s.label}>Initial update message</label>
        <textarea
          style={s.textarea}
          placeholder="What are users seeing? What are you doing about it?"
          value={form.initialUpdate}
          onChange={e => setForm({ ...form, initialUpdate: e.target.value })}
        />

        <button
          style={{ ...s.btnGreen, ...(submitting ? s.btnDisabled : {}) }}
          disabled={submitting}
          onClick={handleCreate}
        >
          {submitting ? "Posting…" : "Post incident"}
        </button>
      </div>

      <div style={s.card}>
        <div style={s.cardTitle}>Active incidents</div>
        {loading ? (
          <div style={s.empty}>Loading…</div>
        ) : active.length === 0 ? (
          <div style={s.empty}>No active incidents.</div>
        ) : (
          active.map(inc => (
            <div key={inc.id} style={s.incidentCard}>
              <div style={s.incidentTop}>
                <span style={{ ...s.pill, ...IMPACT_COLORS[inc.impact] }}>{inc.impact}</span>
                <span style={s.incidentTitle}>{inc.title}</span>
                <span style={{ ...s.pill, ...STATUS_COLORS[inc.status] }}>{inc.status}</span>
              </div>
              {inc.affected.length > 0 && (
                <div style={{ fontSize: '12px', color: 'var(--text3)' }}>Affecting: {inc.affected.join(", ")}</div>
              )}
              <div style={s.incidentActions}>
                {["identified", "monitoring", "resolved"].map(st => (
                  <button
                    key={st}
                    style={{ ...s.btnSmall, ...STATUS_COLORS[st] === undefined ? {} : { background: STATUS_COLORS[st].bg, color: STATUS_COLORS[st].color } }}
                    onClick={() => handleUpdate(inc.id, st)}
                  >
                    Mark {st}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}