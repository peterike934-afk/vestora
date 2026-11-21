"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, X, Send, RefreshCw, LifeBuoy } from "lucide-react";
import { useUser } from "@/contexts/UserContext";
import { useMoneyFormatter, useDateFormatter } from "@/lib/formatting";
import { buildReply, detectIntent, QUICK_ACTIONS } from "@/lib/assistant";
import StatusBadge from "@/components/dashboard/StatusBadge";
import PortfolioPerformanceChart from "@/components/dashboard/PortfolioPerformanceChart";

const STALE_MS = 60 * 1000;
let nextId = 0;
const newId = () => `m${++nextId}`;

export const OPEN_SUPPORT_EVENT = "vestora:open-support";

function TransactionList({ items, showReasons, t, formatMoney, formatDate }) {
  return (
    <ul className="investment-assistant__list">
      {items.map((tx) => (
        <li key={tx.id} className="investment-assistant__txn">
          <div className="investment-assistant__txn-main">
            <span className="investment-assistant__txn-type">{t.has(`type.${tx.type}`) ? t(`type.${tx.type}`) : tx.type}</span>
            <span className="investment-assistant__txn-amount">{formatMoney(tx.amount_usd)}</span>
          </div>
          <div className="investment-assistant__txn-meta">
            <span>{formatDate(tx.created_at)}</span>
            <StatusBadge status={tx.status}>{t.has(`status.${tx.status}`) ? t(`status.${tx.status}`) : tx.status}</StatusBadge>
          </div>
          {(showReasons || tx.status === "rejected") && tx.status === "rejected" && (
            <div className="investment-assistant__txn-reason">
              {t("rejectionReason")}: {tx.rejection_reason || t("noReasonGiven")}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Block({ block, data, t, formatMoney, formatDate, onSupport }) {
  switch (block.type) {
    case "metrics":
      return (
        <dl className="investment-assistant__metrics">
          {block.items.map((m) => (
            <div key={m.label} className="investment-assistant__metric">
              <dt>{t(m.label)}</dt>
              <dd>{formatMoney(m.usd)}</dd>
            </div>
          ))}
        </dl>
      );
    case "investments":
      return (
        <ul className="investment-assistant__list">
          {block.items.map((inv) => (
            <li key={inv.id} className="investment-assistant__txn">
              <div className="investment-assistant__txn-main">
                <span className="investment-assistant__txn-type">{inv.plan_name}</span>
                <span className="investment-assistant__txn-amount">{formatMoney(inv.current_value)}</span>
              </div>
              <div className="investment-assistant__txn-meta">
                <span>{t("investmentMeta", { apy: inv.apy_percent, principal: formatMoney(Number(inv.amount_usd) - Number(inv.withdrawn_principal || 0)) })}</span>
                {Number.isFinite(Number(inv.days_remaining)) && (
                  <span>{t("daysLeft", { days: Math.max(0, Math.ceil(Number(inv.days_remaining))) })}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      );
    case "transactions":
      return <TransactionList items={block.items} showReasons={block.showReasons} t={t} formatMoney={formatMoney} formatDate={formatDate} />;
    case "chart":
      return (
        <div className="investment-assistant__chart">
          <PortfolioPerformanceChart compact investments={data.investments} transactions={data.transactions} />
        </div>
      );
    case "support":
      return (
        <button type="button" className="investment-assistant__support" onClick={onSupport}>
          <LifeBuoy size={16} aria-hidden="true" /> {t("openSupport")}
        </button>
      );
    default:
      return null;
  }
}

/**
 * Floating Investment Chat. Answers come from the signed-in user's own
 * account data (GET /api/assistant/overview) via lib/assistant.js; it
 * never sees another user's records and never estimates figures.
 */
export default function InvestmentAssistant() {
  const t = useTranslations("InvestmentAssistant");
  const formatMoney = useMoneyFormatter();
  const formatDate = useDateFormatter();
  const { user, isAdmin } = useUser();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const fetchedAt = useRef(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/assistant/overview", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      fetchedAt.current = Date.now();
      return json;
    } catch (err) {
      console.error("Investment Chat could not load account data.", err?.message);
      setLoadError(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const respond = useCallback((intent, overview) => {
    const reply = buildReply(intent, overview, { firstName: overview?.firstName });
    setMessages((prev) => [...prev, { id: newId(), from: "bot", reply }]);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!data) {
      load().then((overview) => {
        if (overview) respond("greeting", overview);
      });
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, data, load, respond]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  async function ask(text, intentOverride) {
    const question = text.trim();
    if (!question || loading) return;
    setMessages((prev) => [...prev, { id: newId(), from: "user", text: question }]);
    setInput("");
    const overview = !data || Date.now() - fetchedAt.current > STALE_MS ? await load() : data;
    if (!overview) {
      setMessages((prev) => [...prev, { id: newId(), from: "bot", reply: { key: "reply.loadFailed", params: {}, blocks: [{ type: "support" }], actions: [] } }]);
      return;
    }
    respond(intentOverride || detectIntent(question), overview);
  }

  function openSupport() {
    setOpen(false);
    window.dispatchEvent(new CustomEvent(OPEN_SUPPORT_EVENT));
  }

  function renderText(reply) {
    const params = {};
    for (const [k, v] of Object.entries(reply.params || {})) params[k] = k.endsWith("Usd") ? formatMoney(v) : v;
    return t(reply.key, params);
  }

  if (!user || isAdmin) return null;

  return (
    <>
      {open && (
        <section className="investment-assistant" role="dialog" aria-modal="false" aria-labelledby="investment-assistant-title">
          <header className="investment-assistant__header">
            <div className="investment-assistant__identity">
              <span className="investment-assistant__avatar" aria-hidden="true"><Sparkles size={16} /></span>
              <div>
                <h2 id="investment-assistant-title" className="investment-assistant__title">{t("title")}</h2>
                <p className="investment-assistant__subtitle">{t("subtitle")}</p>
              </div>
            </div>
            <div className="investment-assistant__header-actions">
              <button type="button" className="investment-assistant__icon-btn" onClick={load} disabled={loading} aria-label={t("refresh")}>
                <RefreshCw size={16} className={loading ? "is-spinning" : ""} />
              </button>
              <button type="button" className="investment-assistant__icon-btn" onClick={() => setOpen(false)} aria-label={t("close")}>
                <X size={18} />
              </button>
            </div>
          </header>

          <div className="investment-assistant__messages" ref={listRef} aria-live="polite">
            {messages.length === 0 && (loading ? (
              <div className="investment-assistant__status">{t("loading")}</div>
            ) : loadError ? (
              <div className="investment-assistant__status">
                {t("reply.loadFailed")}
                <button type="button" className="investment-assistant__chip" onClick={load}>{t("retry")}</button>
              </div>
            ) : null)}

            {messages.map((m) => m.from === "user" ? (
              <div key={m.id} className="investment-assistant__bubble investment-assistant__bubble--user">{m.text}</div>
            ) : (
              <div key={m.id} className="investment-assistant__bubble investment-assistant__bubble--bot">
                <p>{renderText(m.reply)}</p>
                {m.reply.blocks.map((b, i) => (
                  <Block key={i} block={b} data={data} t={t} formatMoney={formatMoney} formatDate={formatDate} onSupport={openSupport} />
                ))}
                {m.reply.actions.length > 0 && (
                  <div className="investment-assistant__chips">
                    {m.reply.actions.map((a) => (
                      <button key={a} type="button" className="investment-assistant__chip" onClick={() => a === "support" ? openSupport() : ask(t(`action.${a}`), a)}>
                        {t(`action.${a}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <form className="investment-assistant__composer" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <input
              ref={inputRef}
              className="investment-assistant__input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("placeholder")}
              aria-label={t("placeholder")}
              maxLength={300}
            />
            <button type="submit" className="investment-assistant__send" disabled={!input.trim() || loading} aria-label={t("send")}>
              <Send size={16} />
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        className={`investment-assistant__launcher${open ? " is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? t("close") : t("open")}
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
        {!open && <span className="investment-assistant__launcher-label">{t("launcher")}</span>}
      </button>
    </>
  );
}

export { QUICK_ACTIONS };
