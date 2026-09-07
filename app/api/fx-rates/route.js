import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      next: { revalidate: 3600 },
    });
    const data = await res.json();

    if (data.result !== "success") {
      throw new Error("FX provider returned an error");
    }

    return NextResponse.json({ rates: data.rates, updatedAt: data.time_last_update_utc });
  } catch (err) {
    console.error("Failed to fetch FX rates:", err);
    return NextResponse.json({ error: "Failed to fetch exchange rates" }, { status: 500 });
  }
}