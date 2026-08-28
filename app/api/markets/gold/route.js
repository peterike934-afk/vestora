import { NextResponse } from "next/server";

// Gold (XAU/USD) via Twelve Data's quote endpoint. Cached server-side
// for 2 minutes via Next's fetch revalidate — this means actual upstream
// requests are capped at roughly 1 every 2 minutes total, no matter how
// many users have the Markets page open. That keeps us comfortably
// within Twelve Data's free daily quota regardless of traffic.
export async function GET() {
  const apiKey = process.env.TWELVEDATA_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Gold data isn't configured yet — add TWELVEDATA_API_KEY to your environment variables." },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://api.twelvedata.com/quote?symbol=XAU/USD&apikey=${apiKey}`,
      { next: { revalidate: 120 } }
    );
    if (!res.ok) throw new Error("Twelve Data request failed");
    const data = await res.json();

    if (data.status === "error" || data.code) {
      throw new Error(data.message || "Twelve Data returned an error");
    }

    return NextResponse.json({
      price: Number(data.close),
      open: Number(data.open),
      high: Number(data.high),
      low: Number(data.low),
      previousClose: Number(data.previous_close),
      change: Number(data.change),
      changePercent: Number(data.percent_change),
      fiftyTwoWeekLow: data.fifty_two_week?.low != null ? Number(data.fifty_two_week.low) : null,
      fiftyTwoWeekHigh: data.fifty_two_week?.high != null ? Number(data.fifty_two_week.high) : null,
      datetime: data.datetime,
    });
  } catch (err) {
    console.error("Failed to fetch gold price:", err);
    return NextResponse.json({ error: "Could not load live gold price — will retry shortly." }, { status: 502 });
  }
}