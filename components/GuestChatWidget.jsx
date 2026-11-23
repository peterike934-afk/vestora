"use client";

import { useState, useEffect, useRef } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";

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

// The conversation is identified by an HttpOnly cookie set by
// /api/guest-chat/start (see lib/guest-chat.js); this page never sees the
// secret. THREAD_KEY only remembers that this browser has a conversation,
// and lets a visitor whose chat started before the cookie existed continue
// it once by confirming the email address they gave.
const THREAD_KEY = "vestora_guest_thread_id";
const NAME_KEY = "vestora_guest_name";
const SESSION_REQUIRED = "GUEST_SESSION_REQUIRED";

export default function GuestChatWidget() {
  const t = useTranslations("GuestChat");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState(null);
  const [savedName, setSavedName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState("");
  const [starting, setStarting] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const bottomRef = useRef(null);
  const legacyThreadRef = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem(THREAD_KEY);
    const savedNameVal = localStorage.getItem(NAME_KEY);
    if (saved) setThreadId(saved);
    if (savedNameVal) setSavedName(savedNameVal);
  }, []);

  // This browser no longer holds (or never held) the conversation's cookie:
  // show the start form. A thread remembered from before the cookie existed
  // can be continued by confirming the same email (one time only).
  function sessionLost(id) {
    if (id) legacyThreadRef.current = id;
    setThreadId(null);
    setMessages([]);
    setUnreadCount(0);
    setName((current) => current || localStorage.getItem(NAME_KEY) || "");
  }

  async function loadMessages(id) {
    try {
      const res = await fetch("/api/guest-chat/messages", { cache: "no-store" });
      const data = await res.json();
      if (data.code === SESSION_REQUIRED) return sessionLost(id);
      if (data.messages) setMessages(data.messages);
      setUnreadCount(0);
    } catch (err) {
      console.error("Failed to load guest chat messages:", err);
    }
  }

  async function checkUnread(id) {
    try {
      const res = await fetch("/api/guest-chat/unread-count", { cache: "no-store" });
      const data = await res.json();
      if (data.code === SESSION_REQUIRED) return sessionLost(id);
      if (typeof data.unreadCount === "number") setUnreadCount(data.unreadCount);
    } catch (err) {
      console.error("Failed to check guest chat unread count:", err);
    }
  }

  useEffect(() => {
    if (open && threadId) loadMessages(threadId);
  }, [open, threadId]);

  useEffect(() => {
    if (!open || !threadId) return;
    const interval = setInterval(() => loadMessages(threadId), 4000);
    return () => clearInterval(interval);
  }, [open, threadId]);

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
      setFormError(t("form.missingFields"));
      return;
    }
    setStarting(true);
    try {
      const res = await fetch("/api/guest-chat/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, locale, legacyThreadId: legacyThreadRef.current || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.error || !data.threadId) throw new Error(res.status === 400 && data.error ? data.error : "");
      legacyThreadRef.current = null;
      localStorage.setItem(THREAD_KEY, data.threadId);
      localStorage.setItem(NAME_KEY, name.trim());
      setThreadId(data.threadId);
      setSavedName(name.trim());
      setMessages([]);
    } catch (err) {
      setFormError(err.message || t("form.genericError"));
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
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (data.code === SESSION_REQUIRED) {
        sessionLost(threadId);
      } else if (data.message) {
        setMessages((prev) => (prev.some(m => m.id === data.message.id) ? prev : [...prev, data.message]));
      } else {
        // Not sent (too long, too many messages, server error): give the
        // text back so the visitor can try again.
        setText((current) => current || body);
        console.error("Guest message not sent:", data.error);
      }
    } catch (err) {
      setText((current) => current || body);
      console.error("Failed to send guest message:", err);
    } finally {
      setSending(false);
    }
  }

  function handleStartNewChat() {
    fetch("/api/guest-chat/session", { method: "DELETE", headers: { "Content-Type": "application/json" } })
      .catch((err) => console.error("Failed to end guest chat session:", err));
    legacyThreadRef.current = null;
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
      <button style={s.bubble} onClick={() => setOpen(true)} aria-label={t("openChat")}>
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
          <div style={s.headerTitle}>{t("title")}</div>
          <div style={s.headerSub}>
            {threadId && savedName ? t("continuingAs", { name: savedName }) : t("replyTime")}
          </div>
        </div>
        <div style={s.headerActions}>
          {threadId && (
            <button style={s.switchBtn} onClick={handleStartNewChat}>
              {t("notYou")}
            </button>
          )}
          <button style={s.closeBtn} onClick={() => setOpen(false)} aria-label={t("closeChat")}>
            <X size={18} />
          </button>
        </div>
      </div>

      {!threadId ? (
        <div style={s.form}>
          <div>
            <label style={s.label}>{t("form.name")}</label>
            <input style={s.input} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={t("form.namePlaceholder")} />
          </div>
          <div>
            <label style={s.label}>{t("form.email")}</label>
            <input style={s.input} type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} placeholder={t("form.emailPlaceholder")} />
          </div>
          {formError && <div style={s.formError}>{formError}</div>}
          <button style={s.startBtn} onClick={handleStart} disabled={starting}>
            {starting ? t("form.starting") : t("form.startChat")}
          </button>
        </div>
      ) : (
        <>
          <div style={s.messages}>
            {messages.length === 0 ? (
              <div style={s.emptyState}>{t("emptyState")}</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} style={m.sender === "guest" ? s.bubbleGuest : s.bubbleAdmin}>
                  {m.sender === "admin" ? (m.translated_body || m.body) : m.body}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
          <div style={s.inputRow}>
            <input
              style={s.textInput}
              placeholder={t("typeMessage")}
              value={text}
              maxLength={2000}
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