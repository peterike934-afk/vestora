import { NextResponse } from "next/server";

// US Treasury's public daily par yield curve feed — no API key needed,
// published directly by the government. Updates once per business day,
// so an hourly cache is more than sufficient and keeps this fast.
const MATURITIES = [
  { field: "BC_1MONTH", label: "1 Mo" },
  { field: "BC_2MONTH", label: "2 Mo" },
  { field: "BC_3MONTH", label: "3 Mo" },
  { field: "BC_6MONTH", label: "6 Mo" },
  { field: "BC_1YEAR", label: "1 Yr" },
  { field: "BC_2YEAR", label: "2 Yr" },
  { field: "BC_3YEAR", label: "3 Yr" },
  { field: "BC_5YEAR", label: "5 Yr" },
  { field: "BC_7YEAR", label: "7 Yr" },
  { field: "BC_10YEAR", label: "10 Yr" },
  { field: "BC_20YEAR", label: "20 Yr" },
  { field: "BC_30YEAR", label: "30 Yr" },
];

export async function GET() {
  try {
    const year = new Date().getFullYear();
    const res = await fetch(
      `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`,
      {
        next: { revalidate: 3600 },
        headers: {
          // Some government endpoints behave differently (or reject the
          // request) without a browser-like User-Agent — this fixes
          // that class of issue if it's what's happening here.
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "application/xml,text/xml,*/*",
        },
      }
    );

    if (!res.ok) {
      throw new Error(`Treasury data request failed with status ${res.status}`);
    }

    const xml = await res.text();

    const entries = xml.split("<entry>");
    const lastEntry = entries[entries.length - 1];

    function extract(source, field) {
      // Opening tags include an m:type attribute (e.g. m:type="Edm.Double"),
      // so the pattern needs to allow anything between the tag name and
      // its closing `>` rather than expecting `<d:FIELD>` immediately.
      const match = source.match(new RegExp(`<d:${field}[^>]*>([^<]+)</d:${field}>`));
      return match ? Number(match[1]) : null;
    }

    const dateMatch = lastEntry ? lastEntry.match(/<d:NEW_DATE[^>]*>([^<]+)<\/d:NEW_DATE>/) : null;

    const yields = lastEntry
      ? MATURITIES.map(m => ({
          label: m.label,
          yield: extract(lastEntry, m.field),
        })).filter(y => y.yield !== null)
      : [];

    if (yields.length === 0) {
      // Diagnostic only — prints to your server terminal, never the
      // browser. This time showing the LAST entry itself (the one we
      // actually try to parse), not just the document's opening tags,
      // so we can see the real field names present.
      console.error(
        "Treasury feed parse failed. entries found:", entries.length,
        "\nlastEntry length:", lastEntry ? lastEntry.length : 0,
        "\nFirst 2000 chars of lastEntry:\n", lastEntry ? lastEntry.slice(0, 2000) : "(no lastEntry)"
      );
      throw new Error("Could not parse any yield values from feed");
    }

    return NextResponse.json({
      asOf: dateMatch ? dateMatch[1] : null,
      yields,
    });
  } catch (err) {
    console.error("Failed to fetch treasury yields:", err);
    return NextResponse.json({ error: "Could not load live bond yield data — will retry shortly." }, { status: 502 });
  }
}