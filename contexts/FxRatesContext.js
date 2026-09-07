"use client";

import { createContext, useContext, useEffect, useState } from "react";

const FxRatesContext = createContext({ rates: null, loading: true });

export function FxRatesProvider({ children }) {
  const [rates, setRates] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/fx-rates")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.rates) setRates(data.rates);
      })
      .catch((err) => console.error("FX rate fetch failed:", err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <FxRatesContext.Provider value={{ rates, loading }}>
      {children}
    </FxRatesContext.Provider>
  );
}

export function useFxRates() {
  return useContext(FxRatesContext);
}