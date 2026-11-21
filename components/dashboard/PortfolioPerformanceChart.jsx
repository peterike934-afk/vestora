"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceDot } from "recharts";
import { useMoneyFormatter, useDateFormatter } from "@/lib/formatting";
import { buildPortfolioHistory, availableRanges, sliceHistory } from "@/lib/portfolioHistory";
import DashboardState from "@/components/dashboard/DashboardState";

function ChartTooltip({ active, payload, formatMoney, formatDate, t }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="performance-chart__tooltip">
      <div className="performance-chart__tooltip-date">{formatDate(p.t)}</div>
      <div>{t("invested")}: <strong>{formatMoney(p.invested)}</strong></div>
      {p.earnings > 0 && <div>{t("earningsCredited")}: <strong>{formatMoney(p.earnings)}</strong></div>}
      {p.value !== null && <div>{t("valueToday")}: <strong>{formatMoney(p.value)}</strong></div>}
    </div>
  );
}

/**
 * Investment rise-and-fall chart built only from recorded data (see
 * lib/portfolioHistory.js). `compact` renders a smaller version for the
 * Investment Chat.
 */
export default function PortfolioPerformanceChart({ investments, transactions, compact = false, now }) {
  const t = useTranslations("PerformanceChart");
  const formatMoney = useMoneyFormatter();
  const formatDate = useDateFormatter();
  const nowMs = now ?? Date.now();

  const history = useMemo(
    () => buildPortfolioHistory(investments || [], transactions || [], nowMs),
    [investments, transactions, nowMs]
  );
  const ranges = useMemo(() => availableRanges(history.firstAt, nowMs), [history.firstAt, nowMs]);
  const [rangeKey, setRangeKey] = useState(null);
  const range = ranges.find((r) => r.key === rangeKey) || ranges[ranges.length - 1];
  const data = useMemo(
    () => (range ? sliceHistory(history.points, range.days, nowMs) : []),
    [history.points, range, nowMs]
  );

  if (!history.points.length) {
    return (
      <DashboardState
        title={t("emptyTitle")}
        description={history.excludedCount > 0 ? t("excluded", { count: history.excludedCount }) : t("emptyDescription")}
      />
    );
  }

  const last = data[data.length - 1];
  const first = data[0];
  const change = last.value !== null ? last.value - first.invested : null;
  const height = compact ? 150 : 230;
  const yMax = Math.max(...data.map((p) => Math.max(p.invested, p.earnings, p.value ?? 0)), 1) * 1.08;

  return (
    <div className={`performance-chart${compact ? " performance-chart--compact" : ""}`}>
      <div className="performance-chart__header">
        <div>
          <div className="performance-chart__value">{formatMoney(history.currentValue)}</div>
          <div className="performance-chart__caption">
            {t("valueToday")}
            {change !== null && first.t < last.t && (
              <span className={change >= 0 ? "performance-chart__change--up" : "performance-chart__change--down"}>
                {" · "}{change >= 0 ? "+" : "−"}{formatMoney(Math.abs(change))} {t("vsRangeStart")}
              </span>
            )}
          </div>
        </div>
        {ranges.length > 1 && (
          <div className="performance-chart__ranges" role="tablist" aria-label={t("rangeLabel")}>
            {ranges.map((r) => (
              <button
                key={r.key}
                type="button"
                role="tab"
                aria-selected={r.key === range.key}
                className={`performance-chart__range${r.key === range.key ? " is-active" : ""}`}
                onClick={() => setRangeKey(r.key)}
              >
                {r.key}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="performance-chart__plot" style={{ height }} aria-label={t("ariaSummary", { value: formatMoney(history.currentValue) })} role="img">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="perfInvested" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--green)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--green)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            {!compact && <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />}
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => formatDate(v)}
              tick={{ fontSize: 11, fill: "var(--text3)" }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
              hide={compact}
            />
            <YAxis
              width={compact ? 0 : 64}
              hide={compact}
              tick={{ fontSize: 11, fill: "var(--text3)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatMoney(v)}
              domain={[0, yMax]}
            />
            <Tooltip content={<ChartTooltip formatMoney={formatMoney} formatDate={formatDate} t={t} />} />
            <Area type="stepAfter" dataKey="invested" stroke="var(--green)" strokeWidth={2} fill="url(#perfInvested)" isAnimationActive={false} />
            {data.some((p) => p.earnings > 0) && (
              <Area type="stepAfter" dataKey="earnings" stroke="var(--gold)" strokeWidth={1.5} fill="none" isAnimationActive={false} />
            )}
            {last.value !== null && (
              <ReferenceDot x={last.t} y={last.value} r={5} fill="var(--green)" stroke="var(--bg2)" strokeWidth={2} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {!compact && (
        <p className="performance-chart__note">
          {t("note")}
          {history.excludedCount > 0 && ` ${t("excluded", { count: history.excludedCount })}`}
        </p>
      )}
    </div>
  );
}
