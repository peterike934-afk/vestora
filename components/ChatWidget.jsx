import { useState, useEffect, useRef } from 'react'
import { MessageCircle, X, Send } from 'lucide-react'
import { useUser } from '@/contexts/UserContext'
import { getMessages, sendMessage, subscribeToMessages, getUnreadAdminMessageCount, markAdminMessagesRead } from '@/lib/queries'

const s = {
  bubble: {
    position: 'fixed', bottom: '24px', right: '24px', width: '56px', height: '56px',
    borderRadius: '50%', background: 'var(--green)', color: '#000', border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(0,0,0,0.3)', zIndex: 200,
  },
  unreadBadge: {
    position: 'absolute', top: '-4px', right: '-4px', minWidth: '20px', height: '20px',
    borderRadius: '999px', background: 'var(--red)', color: '#fff', fontSize: '11px', fontWeight: '700',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
    border: '2px solid var(--bg)', boxSizing: 'content-box',
  },
  panel: {
    position: 'fixed', bottom: '92px', right: '24px', width: '340px', height: '460px',
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '16px',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 200,
    boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
  },
  header: {
    padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex',
    alignItems: 'center', justifyContent: 'space-between',
  },
  headerTitle: { fontSize: '14px', fontWeight: '600', color: 'var(--text)' },
  headerSub: { fontSize: '11px', color: 'var(--text3)' },
  closeBtn: { background: 'transparent', border: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex' },
  messages: { flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' },
  bubbleUser: {
    alignSelf: 'flex-end', background: 'var(--green)', color: '#000',
    padding: '9px 13px', borderRadius: '14px 14px 2px 14px', fontSize: '13px', maxWidth: '80%',
  },
  bubbleAdmin: {
    alignSelf: 'flex-start', background: 'var(--bg3)', color: 'var(--text)',
    padding: '9px 13px', borderRadius: '14px 14px 14px 2px', fontSize: '13px', maxWidth: '80%',
  },
  empty: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: '13px', textAlign: 'center', padding: '20px' },
  inputRow: { display: 'flex', gap: '8px', padding: '12px', borderTop: '1px solid var(--border)' },
  input: {
    flex: 1, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '999px',
    padding: '10px 14px', color: 'var(--text)', fontSize: '13px', outline: 'none',
  },
  sendBtn: {
    width: '38px', height: '38px', borderRadius: '50%', background: 'var(--green)', color: '#000',
    border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
  },
}

export default function ChatWidget() {
  const { user, isAdmin } = useUser()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const bottomRef = useRef(null)

  useEffect(() => {
    if (!user || isAdmin) return

    getMessages(user.id).then(setMessages).catch(err => console.error('Failed to load messages:', err))
    getUnreadAdminMessageCount(user.id).then(setUnreadCount).catch(err => console.error('Failed to load unread count:', err))

    const unsubscribe = subscribeToMessages(user.id, (newMsg) => {
      setMessages((prev) => (prev.some(m => m.id === newMsg.id) ? prev : [...prev, newMsg]))

      // Only admin replies count toward the badge — and only bump it
      // if the panel isn't already open (if it's open, the user is
      // actively looking at it, so it gets marked read immediately below instead).
      if (newMsg.sender === 'admin' && !open) {
        setUnreadCount((c) => c + 1)
      }
    })
    return unsubscribe
  }, [user, isAdmin, open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  async function handleOpen() {
    const next = !open
    setOpen(next)
    if (next && user && unreadCount > 0) {
      try {
        await markAdminMessagesRead(user.id)
        setUnreadCount(0)
      } catch (err) {
        console.error('Failed to mark messages read:', err)
      }
    }
  }

  async function handleSend() {
    if (!text.trim() || !user || sending) return
    setSending(true)
    const body = text.trim()
    setText('')
    try {
      const msg = await sendMessage({ userId: user.id, sender: 'user', body })
      setMessages((prev) => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]))
    } catch (err) {
      console.error('Failed to send message:', err)
    } finally {
      setSending(false)
    }
  }

  // Support chat is for users contacting the team — admins reply
  // through the dedicated inbox at /admin/messages instead.
  if (!user || isAdmin) return null

  return (
    <>
      {open && (
        <div style={s.panel}>
          <div style={s.header}>
            <div>
              <div style={s.headerTitle}>Support</div>
              <div style={s.headerSub}>We usually reply within a few hours</div>
            </div>
            <button style={s.closeBtn} onClick={() => setOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div style={s.messages}>
            {messages.length === 0 ? (
              <div style={s.empty}>No messages yet — say hello, and we'll get back to you.</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} style={m.sender === 'user' ? s.bubbleUser : s.bubbleAdmin}>
                  {m.body}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <div style={s.inputRow}>
            <input
              style={s.input}
              placeholder="Type a message…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            />
            <button style={s.sendBtn} onClick={handleSend} disabled={sending}>
              <Send size={16} />
            </button>
          </div>
        </div>
      )}

      <button style={{ ...s.bubble, position: 'fixed' }} onClick={handleOpen} aria-label="Open chat">
        {open ? <X size={22} /> : <MessageCircle size={22} />}
        {!open && unreadCount > 0 && (
          <span style={s.unreadBadge}>{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>
    </>
  )
}