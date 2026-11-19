"use client";

import { useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  CircleDollarSign,
  Inbox,
  TrendingUp,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useUser } from "@/contexts/UserContext";
import { useUsdFormatter } from "@/lib/formatting";
import { getWallet, getTransactions } from "@/lib/queries";
import { Link } from "@/i18n/navigation";
import DashboardPageHeader from "@/components/dashboard/DashboardPageHeader";
import DashboardState from "@/components/dashboard/DashboardState";
import FinancialMetric from "@/components/dashboard/FinancialMetric";
import TransactionRow from "@/components/dashboard/TransactionRow";
import VestoraCardFeature from "@/components/dashboard/VestoraCardFeature";
import VestoraMark from "@/components/VestoraMark";
import RejectionReasonModal from "@/components/RejectionReasonModal";

function txnMeta(type, t) {
  switch (type) {
    case "deposit":
      return { icon: ArrowDownLeft, tone: "positive", label: t("txnTypes.deposit") };
    case "withdrawal":
      return { icon: ArrowUpRight, tone: "negative", label: t("txnTypes.withdrawal") };
    case "investment_withdrawal":
      return { icon: ArrowUpRight, tone: "negative", label: t("txnTypes.investmentWithdrawal") };
    case "investment_interest_claim":
      return { icon: TrendingUp, tone: "positive", label: t("txnTypes.gainsClaim") };
    case "admin_credit":
      return { icon: CircleDollarSign, tone: "positive", label: t("txnTypes.adminCredit") };
    case "admin_debit":
      return { icon: CircleDollarSign, tone: "negative", label: t("txnTypes.adminDebit") };
    default:
      return { icon: CircleDollarSign, tone: "neutral", label: type };
  }
}

export default function Wallet() {
  const t = useTranslations("Wallet");
  const tDeposit = useTranslations("Deposit");
  const tWithdraw = useTranslations("Withdraw");
  const formatUsd = useUsdFormatter();
  const formatter = useFormatter();
  const { user } = useUser();
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [viewingReasonTxn, setViewingReasonTxn] = useState(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([getWallet(user.id), getTransactions(user.id)])
      .then(([w, tx]) => {
        setWallet(w);
        setTransactions(tx || []);
      })
      .catch((err) => {
        console.error("Failed to load wallet:", err);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, [user]);

  const balance = wallet?.balance_usd ?? 0;
  const verified = transactions.filter((tx) => tx.status === "verified");
  const totalDeposited = verified
    .filter((tx) => tx.type === "deposit")
    .reduce((sum, tx) => sum + Number(tx.amount_usd), 0);
  const totalWithdrawn = verified
    .filter((tx) => tx.type === "withdrawal" || tx.type === "admin_debit")
    .reduce((sum, tx) => sum + Number(tx.amount_usd), 0);
  const displayedValue = loading || loadError ? "—" : null;

  function formatTransactionDate(date) {
    return formatter.dateTime(new Date(date), { dateStyle: "medium", timeStyle: "short" });
  }

  return (
    <div className="dashboard-money-page dashboard-wallet-page">
      <DashboardPageHeader title={t("title")} description={t("subtitle")} />

      <section className="dashboard-wallet-overview" aria-label={t("title")}>
        <div className="dashboard-wallet-card">
          <div className="dashboard-wallet-card__decoration" aria-hidden="true" />
          <div className="dashboard-wallet-card__top">
            <div className="dashboard-wallet-card__brand">
              <span className="dashboard-wallet-card__mark"><VestoraMark size={26} /></span>
              <span>Vestora</span>
            </div>
            <span className="dashboard-wallet-card__account">{t("availableBalance")}</span>
          </div>
          <div className="dashboard-wallet-card__balance-label">{t("availableBalance")}</div>
          <div className="dashboard-wallet-card__balance" aria-live="polite">
            {displayedValue || formatUsd(balance)}
          </div>
          <div className="dashboard-wallet-card__bottom">
            <div className="dashboard-wallet-card__currency">USD · {t("walletBalanceLabel")}</div>
            <div className="dashboard-wallet-card__actions">
              <Link className="dashboard-wallet-card__action dashboard-wallet-card__action--primary" href="/deposit">
                <ArrowDownLeft size={17} aria-hidden="true" />
                <span>{tDeposit("title")}</span>
              </Link>
              <Link className="dashboard-wallet-card__action" href="/withdraw">
                <ArrowUpRight size={17} aria-hidden="true" />
                <span>{tWithdraw("title")}</span>
              </Link>
            </div>
          </div>
          <span className="dashboard-wallet-card__watermark" aria-hidden="true">V</span>
        </div>

        <div className="dashboard-wallet-metrics">
          <FinancialMetric
            label={t("totalDeposited")}
            value={displayedValue || formatUsd(totalDeposited)}
            detail={t("verifiedActivity")}
          />
          <FinancialMetric
            label={t("totalWithdrawn")}
            value={displayedValue || formatUsd(totalWithdrawn)}
            detail={t("verifiedActivity")}
          />
          <FinancialMetric
            label={t("netBalance")}
            value={displayedValue || formatUsd(balance)}
            detail={t("walletBalanceLabel")}
            tone="positive"
          />
        </div>
      </section>

      <VestoraCardFeature
        t={t}
        cardholder={user?.user_metadata?.full_name || user?.user_metadata?.name}
      />

      <section className="dashboard-wallet-history" aria-labelledby="dashboard-wallet-history-title">
        <div className="dashboard-wallet-history__header">
          <div>
            <h2 className="dashboard-wallet-history__title" id="dashboard-wallet-history-title">{t("history")}</h2>
          </div>
        </div>

        {loading ? (
          <DashboardState title={t("loading")} />
        ) : loadError ? (
          <DashboardState variant="error" title={t("loadError")} />
        ) : transactions.length === 0 ? (
          <DashboardState
            title={t("noTransactions")}
            description={t("noTransactionsSub")}
            action={
              <Link className="dashboard-wallet-empty-link" href="/deposit">
                {tDeposit("title")}
              </Link>
            }
          />
        ) : (
          <div className="dashboard-wallet-transaction-list">
            {transactions.map((tx) => {
              const meta = txnMeta(tx.type, t);
              const isNegative =
                tx.type === "withdrawal" ||
                tx.type === "admin_debit" ||
                tx.type === "investment_withdrawal";
              const isRejected = tx.status === "rejected";
              const statusLabel =
                tx.status === "pending"
                  ? t("pendingVerification")
                  : tx.status === "verified"
                    ? t("statuses.verified")
                    : tx.status === "rejected"
                      ? t("statuses.rejected")
                      : tx.status;

              return (
                <div className="dashboard-wallet-transaction" key={tx.id}>
                  <TransactionRow
                    icon={meta.icon}
                    iconTone={meta.tone}
                    title={meta.label}
                    description={formatTransactionDate(tx.created_at)}
                    amount={`${isNegative ? "−" : "+"}${formatUsd(tx.amount_usd)}`}
                    positive={!isNegative && !isRejected}
                    negative={isNegative && !isRejected}
                    status={tx.status}
                    statusLabel={statusLabel}
                    action={isRejected ? (
                      <button
                        type="button"
                        className="dashboard-wallet-transaction__details"
                        aria-label={t("rejectedHint")}
                        onClick={() => setViewingReasonTxn(tx)}
                      >
                        <ChevronRight size={17} aria-hidden="true" />
                      </button>
                    ) : null}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {viewingReasonTxn && (
        <RejectionReasonModal
          txn={viewingReasonTxn}
          onClose={() => setViewingReasonTxn(null)}
        />
      )}
    </div>
  );
}
