"use client";

import { motion } from "framer-motion";
import { useRef } from "react";
import { useReveal } from "@/hooks/useReveal";
import { useLandingMarketData } from "@/components/LandingMarketDataProvider";

export default function TradingSection() {
  const ref = useRef(null);
  const { fadeUp } = useReveal(ref);
  const { stocks, gold, bonds, loading, error, updatedAt } = useLandingMarketData();
  const hasError = Boolean(error);

  const formatPrice = (value) => {
    const number = Number(value);
    return Number.isFinite(number)
      ? number.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 })
      : "Unavailable";
  };

  return (
    <section className="trading-section" id="markets" ref={ref}>
      <div className="trading-section__inner">
        <motion.div className="trading-section__copy" animate={fadeUp(0)}>
          <p className="section-eyebrow">Market access</p>
          <h2>Follow the market.<br />Keep the context.</h2>
          <p>
            Vestora provides a dedicated market view for available stocks, gold, bonds,
            and cryptocurrency information, presented alongside your account workspace.
          </p>
          <a className="text-link" href="/markets">Explore markets <span aria-hidden="true">→</span></a>
        </motion.div>

        <motion.div className="market-preview" animate={fadeUp(1)}>
          <div className="market-preview__top">
            <div>
              <span>Market workspace</span>
              <strong>Market overview</strong>
            </div>
            <span className={`market-preview__status${!loading && !hasError ? " is-live" : ""}`}>
              {loading ? "Loading" : hasError ? "Unavailable" : "Live data"}
            </span>
          </div>
          <div className="market-preview__table">
            <div className="market-preview__table-head">
              <span>Asset</span>
              <span>Price</span>
              <span>Move</span>
            </div>
            {loading ? (
              <div className="market-preview__empty">Loading live market data…</div>
            ) : stocks.length ? (
              stocks.slice(0, 5).map((stock) => {
                const positive = Number(stock.changePercent) >= 0;
                return (
                  <div className="market-preview__row" key={stock.symbol}>
                    <div className="market-preview__asset">
                      <span>{stock.symbol.slice(0, 1)}</span>
                      <div><strong>{stock.name}</strong><small>{stock.symbol}</small></div>
                    </div>
                    <strong>{formatPrice(stock.price)}</strong>
                    <b className={positive ? "is-up" : "is-down"}>
                      {Number.isFinite(Number(stock.changePercent))
                        ? `${positive ? "+" : ""}${Number(stock.changePercent).toFixed(2)}%`
                        : "—"}
                    </b>
                  </div>
                );
              })
            ) : (
              <div className="market-preview__empty">{error || "Stock market data is temporarily unavailable."}</div>
            )}
          </div>
          <div className="market-preview__assets">
            <div><span>Gold</span><strong>{gold ? formatPrice(gold.price) : "Unavailable"}</strong></div>
            <div><span>10-year Treasury</span><strong>{bonds?.yields?.find((item) => item.label === "10 Yr")?.yield != null ? `${bonds.yields.find((item) => item.label === "10 Yr").yield}%` : "Unavailable"}</strong></div>
            <div><span>Updated</span><strong>{updatedAt ? updatedAt.toLocaleTimeString() : "—"}</strong></div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
