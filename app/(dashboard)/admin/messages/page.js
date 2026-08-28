"use client";

import { useState, useEffect, useRef } from 'react'
import { Send } from 'lucide-react'
import { useUser } from '@/contexts/UserContext'
import { getMessageThreads, getMessages, sendMessage, markThreadRead, subscribeToAllMessages, getGuestThreads, getGuestMessages, sendGuestMessageAsAdmin, markGuestThreadRead, subscribeToAllGuestMessages } from '@/lib/queries'

const s = {
  page: { display: 'flex', height: 'calc(100vh - 0px)' },
  threadList: { width: '300px', borderRight: '1px solid var(--border)', overflowY: 'auto', flexShrink: 0 },
  threadHeader: { padding: '20px 20px 16px', fontSize: '18px', fontWeight: '700', color: 'var(--text)' },
  threadItem: { padding: '14px 20px', borderBottom: '1px solid var(--border)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '4px' },
  threadItemActive: { background: 'var(--bg2)' },
  threadTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  threadName: { fontSize: '14px', fontWeight: '600', color: 'var(--text)' },
  threadPreview: { fontSize: '12px', color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  unreadBadgeUser: { fontSize: '11px', fontWeight: '700', background: 'var(--red)', color: '#fff', borderRadius: '999px', padding: '1px 7px' },
  unreadBadgeGuest: { fontSize: '11px', fontWeight: '700', background: 'var(--blue)', color: '#fff', borderRadius: '999px', padding: '1px 7px' },
  empty: { padding: '40px 20px', color: 'var(--text3)', fontSize: '13px', textAlign: 'center' },
  convo: { flex: 1, display: 'flex', flexDirection: 'column' },
  convoHeader: { padding: '18px 24px', borderBottom: '1px solid var(--border)' },
  convoName: { fontSize: '15px', fontWeight: '600', color: 'var(--text)' },
  convoEmail: { fontSize: '12px', color: 'var(--text3)' },
  messages: { flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' },
  bubbleUser: { alignSelf: 'flex-start', background: 'var(--bg3)', color: 'var(--text)', padding: '9px 13px', borderRadius: '14px 14px 14px 2px', fontSize: '13px', maxWidth: '60%' },
  bubbleAdmin: { alignSelf: 'flex-end', background: 'var(--green)', color: '#000', padding: '9px 13px', borderRadius: '14px 14px 2px 14px', fontSize: '13px', maxWidth: '60%' },
  inputRow: { display: 'flex', gap: '10px', padding: '16px 24px', borderTop: '1px solid var(--border)' },
  input: { flex: 1, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '999px', padding: '12px 16px', color: 'var(--text)', fontSize: '14px', outline: 'none' },
  sendBtn: { width: '42px', height: '42px', borderRadius: '50%', background: 'var(--green)', color: '#000', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
  noSelection: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: '14px' },
  guestBadge: { fontSize: '10px', fontWeight: '700', color: 'var(--blue)', background: 'var(--blue-dim)', borderRadius: '999px', padding: '1px 7px', marginLeft: '6px' },
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export default function AdminMessages() {
  const { user: admin } = useUser()
  const [threads, setThreads] = useState([])
  const [selected, setSelected] = useState(null) // thread object, tagged with isGuest
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingThreads, setLoadingThreads] = useState(true)
  const bottomRef = useRef(null)
  const selectedRef = useRef(null)

  useEffect(() => { selectedRef.current = selected }, [selected])

  // Combines real-user threads and guest threads into one list, tagging
  // each with isGuest so the rest of the component knows how to treat it.
  async function loadThreads() {
    try {
      const [userThreads, guestThreads] = await Promise.all([
        getMessageThreads(),
        getGuestThreads(),
      ])
      const normalizedUsers = userThreads.map(t => ({ ...t, isGuest: false }))
      const normalizedGuests = guestThreads.map(t => ({
        ...t,
        isGuest: true,
        full_name: t.name, // so the shared render code can just use full_name for both
      }))
      const combined = [...normalizedUsers, ...normalizedGuests]
        .sort((a, b) => new Date(b.last_created_at) - new Date(a.last_created_at))
      setThreads(combined)
    } catch (err) {
      console.error('Failed to load threads:', err)
    } finally {
      setLoadingThreads(false)
    }
  }

  useEffect(() => {
    loadThreads()

    const unsubUsers = subscribeToAllMessages((newMsg) => {
      if (!selectedRef.current?.isGuest && selectedRef.current?.user_id === newMsg.user_id) {
        setMessages((prev) => (prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg]))
      }
      loadThreads()
    })

    const unsubGuests = subscribeToAllGuestMessages((newMsg) => {
      if (selectedRef.current?.isGuest && selectedRef.current?.id === newMsg.thread_id) {
        setMessages((prev) => (prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg]))
      }
      loadThreads()
    })

    return () => { unsubUsers(); unsubGuests(); }
  }, [])

  async function openThread(thread) {
    setSelected(thread)
    try {
      if (thread.isGuest) {
        const data = await getGuestMessages(thread.id)
        setMessages(data)
        if (thread.unread_count > 0) {
          await markGuestThreadRead(thread.id)
          loadThreads()
        }
      } else {
        const data = await getMessages(thread.user_id)
        setMessages(data)
        if (thread.unread_count > 0) {
          await markThreadRead(thread.user_id)
          loadThreads()
        }
      }
    } catch (err) {
      console.error('Failed to load conversation:', err)
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    if (!text.trim() || !selected || sending) return
    setSending(true)
    const body = text.trim()
    setText('')
    try {
      if (selected.isGuest) {
        const msg = await sendGuestMessageAsAdmin(selected.id, body)
        setMessages((prev) => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]))
      } else {
        const msg = await sendMessage({ userId: selected.user_id, sender: 'admin', body })
        setMessages((prev) => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]))
      }
    } catch (err) {
      console.error('Failed to send reply:', err)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="responsive-messages" style={s.page}>
      <div className="responsive-messages-list" style={s.threadList}>
        <div style={s.threadHeader}>Messages</div>
        {loadingThreads ? (
          <div style={s.empty}>Loading…</div>
        ) : threads.length === 0 ? (
          <div style={s.empty}>No conversations yet.</div>
        ) : (
          threads.map(t => {
            const key = t.isGuest ? `guest:${t.id}` : `user:${t.user_id}`
            const isActive = selected && (t.isGuest ? selected.id === t.id : selected.user_id === t.user_id)
            return (
              <div
                key={key}
                style={{ ...s.threadItem, ...(isActive ? s.threadItemActive : {}) }}
                onClick={() => openThread(t)}
              >
                <div style={s.threadTop}>
                  <span style={s.threadName}>
                    {t.full_name || t.email}
                    {t.isGuest && <span style={s.guestBadge}>Website</span>}
                  </span>
                  {t.unread_count > 0 && (
                    <span style={t.isGuest ? s.unreadBadgeGuest : s.unreadBadgeUser}>{t.unread_count}</span>
                  )}
                </div>
                <div style={s.threadPreview}>
                  {t.last_sender === 'admin' ? 'You: ' : ''}{t.last_message}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text3)' }}>{timeAgo(t.last_created_at)}</div>
              </div>
            )
          })
        )}
      </div>

      {selected ? (
        <div style={s.convo}>
          <div style={s.convoHeader}>
            <div style={s.convoName}>
              {selected.full_name || selected.email}
              {selected.isGuest && <span style={s.guestBadge}>Website visitor</span>}
            </div>
            <div style={s.convoEmail}>{selected.email}</div>
          </div>
          <div style={s.messages}>
            {messages.map(m => (
              <div key={m.id} style={m.sender === 'admin' ? s.bubbleAdmin : s.bubbleUser}>
                {m.body}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div style={s.inputRow}>
            <input
              style={s.input}
              placeholder="Type a reply…"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
            />
            <button style={s.sendBtn} onClick={handleSend} disabled={sending}>
              <Send size={16} />
            </button>
          </div>
        </div>
      ) : (
        <div style={s.noSelection}>Select a conversation to view messages</div>
      )}
    </div>
  )
}