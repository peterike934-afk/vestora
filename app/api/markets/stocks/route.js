import { NextResponse } from "next/server";

// A curated list of well-known large-cap stocks — Finnhub's free tier
// doesn't offer a "top movers" or screener endpoint, so we fetch quotes
// for a fixed set of symbols rather than discovering them dynamically.
// `domain` is used client-side to pull a free logo from Clearbit's
// public logo API — no extra Finnhub calls needed for that.
const SYMBOLS = [
  { symbol: "AAPL", name: "Apple", domain: "apple.com" },
  { symbol: "MSFT", name: "Microsoft", domain: "microsoft.com" },
  { symbol: "GOOGL", name: "Alphabet", domain: "abc.xyz" },
  { symbol: "AMZN", name: "Amazon", domain: "amazon.com" },
  { symbol: "NVDA", name: "NVIDIA", domain: "nvidia.com" },
  { symbol: "META", name: "Meta Platforms", domain: "meta.com" },
  { symbol: "TSLA", name: "Tesla", domain: "tesla.com" },
  { symbol: "JPM", name: "JPMorgan Chase", domain: "jpmorganchase.com" },
  { symbol: "V", name: "Visa", domain: "visa.com" },
  { symbol: "WMT", name: "Walmart", domain: "walmart.com" },
];

export async function GET() {
  const apiKey = process.env.FINNHUB_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Stock data isn't configured yet — add FINNHUB_API_KEY to your environment variables." },
      { status: 500 }
    );
  }

  try {
    const results = await Promise.all(
      SYMBOLS.map(async ({ symbol, name, domain }) => {
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`,
          { next: { revalidate: 0 } }
        );
        if (!res.ok) throw new Error(`Finnhub request failed for ${symbol}`);
        const data = await res.json();
        return {
          symbol,
          name,
          domain,
          price: data.c,
          change: data.d,
          changePercent: data.dp,
          high: data.h,
          low: data.l,
          open: data.o,
          previousClose: data.pc,
        };
      })
    );
    return NextResponse.json({ stocks: results });
  } catch (err) {
    console.error("Failed to fetch stock quotes:", err);
    return NextResponse.json({ error: "Could not load live stock data — will retry shortly." }, { status: 502 });
  }
}