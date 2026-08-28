"use client";

import { useState, useEffect, useRef } from "react";
import { MessageCircle, X, Send } from "lucide-react";

const s = {
  bubble: {
    position: "fixed", bottom: "24px", right: "24px", width: "56px", height: "56px",
    borderRadius: "50%", background: "var(--green)", color: "#fff", border: "none",
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
    boxShadow: "0 8px 24px rgba(31,111,74,0.35)", zIndex: 400,
  },
  bubbleBadge: {
    position: "absolute", top: "-4px", right: "-4px",
    minWidth: "20px", height: "20px", borderRadius: "999px",
    background: "#c0392b", color: "#fff", fontSize: "11px", fontWeight: "700",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "0 5px", border: "2px solid var(--bg, #fff)",
  },
  window: {
    position: "fixed", bottom: "24px", right: "24px", width: "340px", maxWidth: "calc(100vw - 32px)",
    height: "460px", maxHeight: "calc(100vh - 100px)", background: "#fff", borderRadius: "16px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column",
    overflow: "hidden", zIndex: 400,
  },
  header: {
    background: "#0B0E0C", color: "#fff", padding: "16px 18px", display: "flex",
    alignItems: "center", justifyContent: "space-between",
  },
  headerLeft: { minWidth: 0 },
  headerTitle: { fontSize: "14px", fontWeight: "600" },
  headerSub: { fontSize: "11px", color: "rgba(255,255,255,0.5)", marginTop: "2px" },
  headerActions: { display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 },
  switchBtn: { background: "transparent", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: "11px", textDecoration: "underline", whiteSpace: "nowrap" },
  closeBtn: { background: "transparent", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", display: "flex" },
  form: { padding: "20px", display: "flex", flexDirection: "column", gap: "12px", flex: 1, justifyContent: "center" },
  label: { fontSize: "12px", fontWeight: "500", color: "#6B7570" },
  input: { padding: "11px 13px", border: "1px solid #D6DDD9", borderRadius: "10px", fontSize: "14px", outline: "none" },
  startBtn: { padding: "12px", background: "#1F6F4A", color: "#fff", border: "none", borderRadius: "10px", fontSize: "14px", fontWeight: "600", cursor: "pointer", marginTop: "4px" },
  formError: { fontSize: "12px", color: "#c0392b" },
  messages: { flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "8px" },
  bubbleGuest: { alignSelf: "flex-end", background: "#1F6F4A", color: "#fff", padding: "9px 13px", borderRadius: "14px 14px 2px 14px", fontSize: "13px", maxWidth: "78%" },
  bubbleAdmin: { alignSelf: "flex-start", background: "#F2F4F3", color: "#0B0E0C", padding: "9px 13px", borderRadius: "14px 14px 14px 2px", fontSize: "13px", maxWidth: "78%" },
  emptyState: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#6B7570", fontSize: "13px", textAlign: "center", padding: "20px" },
  inputRow: { display: "flex", gap: "8px", padding: "12px", borderTop: "1px solid #D6DDD9" },
  textInput: { flex: 1, padding: "10px 14px", border: "1px solid #D6DDD9", borderRadius: "999px", fontSize: "14px", outline: "none" },
  sendBtn: { width: "38px", height: "38px", borderRadius: "50%", background: "#1F6F4A", color: "#fff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 },
};

const THREAD_KEY = "vestora_guest_thread_id";
const NAME_KEY = "vestora_guest_name";

export default function GuestChatWidget() {
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState(null);
  const [savedName, setSavedName] = useState(""); // whose conversation is currently loaded
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState("");
  const [starting, setStarting] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const bottomRef = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem(THREAD_KEY);
    const savedNameVal = localStorage.getItem(NAME_KEY);
    if (saved) setThreadId(saved);
    if (savedNameVal) setSavedName(savedNameVal);
  }, []);

  async function loadMessages(id) {
    try {
      const res = await fetch(`/api/guest-chat/messages?threadId=${id}`);
      const data = await res.json();
      if (data.messages) setMessages(data.messages);
      setUnreadCount(0); // opening the chat marks it read server-side too
    } catch (err) {
      console.error("Failed to load guest chat messages:", err);
    }
  }

  async function checkUnread(id) {
    try {
      const res = await fetch(`/api/guest-chat/unread-count?threadId=${id}`);
      const data = await res.json();
      if (typeof data.unreadCount === "number") setUnreadCount(data.unreadCount);
    } catch (err) {
      console.error("Failed to check guest chat unread count:", err);
    }
  }

  useEffect(() => {
    if (open && threadId) loadMessages(threadId);
  }, [open, threadId]);

  // Poll for new admin replies while the window is open.
  useEffect(() => {
    if (!open || !threadId) return;
    const interval = setInterval(() => loadMessages(threadId), 4000);
    return () => clearInterval(interval);
  }, [open, threadId]);

  // Background check for a badge on the collapsed bubble, so the user
  // knows a reply came in even without the chat window open.
  useEffect(() => {
    if (!threadId) return;
    checkUnread(threadId);
    const interval = setInterval(() => {
      if (!open) checkUnread(threadId);
    }, 6000);
    return () => clearInterval(interval);
  }, [threadId, open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleStart() {
    setFormError("");
    if (!name.trim() || !email.trim()) {
      setFormError("Please enter your name and email.");
      return;
    }
    setStarting(true);
    try {
      const res = await fetch("/api/guest-chat/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      localStorage.setItem(THREAD_KEY, data.threadId);
      localStorage.setItem(NAME_KEY, name.trim());
      setThreadId(data.threadId);
      setSavedName(name.trim());
      setMessages([]);
    } catch (err) {
      setFormError(err.message || "Something went wrong — try again.");
    } finally {
      setStarting(false);
    }
  }

  async function handleSend() {
    if (!text.trim() || sending) return;
    setSending(true);
    const body = text.trim();
    setText("");
    try {
      const res = await fetch("/api/guest-chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, sender: "guest", body }),
      });
      const data = await res.json();
if (data.message) {
  setMessages((prev) => (prev.some(m => m.id === data.message.id) ? prev : [...prev, data.message]));
}
    } catch (err) {
      console.error("Failed to send guest message:", err);
    } finally {
      setSending(false);
    }
  }

  // Clears the saved thread entirely — the NEXT person on this browser
  // gets a fresh name/email form instead of silently inheriting
  // whoever chatted last. This is the fix for cross-person mixups on
  // a shared or reused browser.
  function handleStartNewChat() {
    localStorage.removeItem(THREAD_KEY);
    localStorage.removeItem(NAME_KEY);
    setThreadId(null);
    setSavedName("");
    setMessages([]);
    setName("");
    setEmail("");
    setUnreadCount(0);
  }

  if (!open) {
    return (
      <button style={s.bubble} onClick={() => setOpen(true)} aria-label="Open chat">
        <MessageCircle size={24} />
        {unreadCount > 0 && (
          <span style={s.bubbleBadge}>{unreadCount > 9 ? "9+" : unreadCount}</span>
        )}
      </button>
    );
  }

  return (
    <div style={s.window}>
      <div style={s.header}>
        <div style={s.headerLeft}>
          <div style={s.headerTitle}>Chat with Vestora</div>
          <div style={s.headerSub}>
            {threadId && savedName ? `Continuing as ${savedName}` : "We typically reply within a few hours"}
          </div>
        </div>
        <div style={s.headerActions}>
          {threadId && (
            <button style={s.switchBtn} onClick={handleStartNewChat}>
              Not you?
            </button>
          )}
          <button style={s.closeBtn} onClick={() => setOpen(false)} aria-label="Close chat">
            <X size={18} />
          </button>
        </div>
      </div>

      {!threadId ? (
        <div style={s.form}>
          <div>
            <label style={s.label}>Name</label>
            <input style={s.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>
          <div>
            <label style={s.label}>Email</label>
            <input style={s.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" />
          </div>
          {formError && <div style={s.formError}>{formError}</div>}
          <button style={s.startBtn} onClick={handleStart} disabled={starting}>
            {starting ? "Starting…" : "Start chat"}
          </button>
        </div>
      ) : (
        <>
          <div style={s.messages}>
            {messages.length === 0 ? (
              <div style={s.emptyState}>Say hello — a real person will get back to you.</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} style={m.sender === "guest" ? s.bubbleGuest : s.bubbleAdmin}>
                  {m.body}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
          <div style={s.inputRow}>
            <input
              style={s.textInput}
              placeholder="Type a message…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
            />
            <button style={s.sendBtn} onClick={handleSend} disabled={sending}>
              <Send size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
