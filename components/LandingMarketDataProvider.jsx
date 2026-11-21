"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const REFRESH_INTERVAL = 60_000;
const LandingMarketDataContext = createContext(null);

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || `Market request failed (${response.status})`);
  }
  return data;
}

export function LandingMarketDataProvider({ children }) {
  const [data, setData] = useState({
    stocks: [],
    gold: null,
    bonds: null,
    updatedAt: null,
    loading: true,
    error: "",
  });

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      getJson("/api/markets/stocks"),
      getJson("/api/markets/gold"),
      getJson("/api/markets/bonds"),
    ]);

    const [stocksResult, goldResult, bondsResult] = results;
    const stocks = stocksResult.status === "fulfilled" && Array.isArray(stocksResult.value.stocks)
      ? stocksResult.value.stocks.filter((item) => Number.isFinite(Number(item.price)))
      : [];
    const gold = goldResult.status === "fulfilled" && Number.isFinite(Number(goldResult.value.price))
      ? goldResult.value
      : null;
    const bonds = bondsResult.status === "fulfilled" && Array.isArray(bondsResult.value.yields)
      ? bondsResult.value
      : null;
    const errors = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason.message);

    if (errors.length) {
      console.error("Some landing-page market data could not be refreshed:", errors);
    }

    setData((current) => ({
      stocks,
      gold,
      bonds,
      updatedAt: stocks.length || gold || bonds ? new Date() : current.updatedAt,
      loading: false,
      error: errors.length === results.length ? "Market data is temporarily unavailable." : "",
    }));
  }, []);

  useEffect(() => {
    refresh();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_INTERVAL);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  return (
    <LandingMarketDataContext.Provider value={data}>
      {children}
    </LandingMarketDataContext.Provider>
  );
}

export function useLandingMarketData() {
  const data = useContext(LandingMarketDataContext);
  if (!data) {
    throw new Error("useLandingMarketData must be used within LandingMarketDataProvider");
  }
  return data;
}
