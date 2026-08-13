// Hubben: proxy för marknadsdata (Yahoo Finance) — statiska sajter kan inte anropa Yahoo direkt (CORS).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Quote {
  symbol: string;
  name?: string;
  currency?: string;
  price?: number;
  prevClose?: number;
  spark?: number[];
  error?: boolean;
}

async function fetchQuote(symbol: string): Promise<Quote> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`;
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!r.ok) return { symbol, error: true };
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res?.meta) return { symbol, error: true };
    const meta = res.meta;
    const closes: number[] = (res.indicators?.quote?.[0]?.close ?? []).filter(
      (x: number | null) => x != null,
    );
    const price: number | undefined = meta.regularMarketPrice ?? closes.at(-1);
    const prevClose: number | undefined =
      meta.regularMarketPreviousClose ?? meta.previousClose ?? closes.at(-2);
    return {
      symbol,
      name: meta.shortName ?? meta.longName ?? symbol,
      currency: meta.currency,
      price,
      prevClose,
      spark: closes.slice(-22),
    };
  } catch {
    return { symbol, error: true };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const symbols = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  const quotes = await Promise.all(symbols.map(fetchQuote));
  return new Response(JSON.stringify({ quotes }), {
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=120",
    },
  });
});
