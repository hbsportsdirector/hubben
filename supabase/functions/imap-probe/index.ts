// DIAGNOSTIK: kan en Supabase Edge Function alls prata IMAP?
// Testar rå TLS-socket + CAPABILITY (kräver inget lösenord).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function probe(hostname: string, port = 993) {
  const t0 = Date.now();
  const steg: Record<string, unknown> = { hostname, port };
  let conn: Deno.TlsConn | null = null;
  try {
    conn = await Deno.connectTls({ hostname, port });
    steg.tlsAnslutenMs = Date.now() - t0;

    const dec = new TextDecoder();
    const enc = new TextEncoder();
    const buf = new Uint8Array(8192);

    // Serverns hälsning
    const n1 = await conn.read(buf);
    steg.halsning = dec.decode(buf.subarray(0, n1 ?? 0)).trim().slice(0, 200);
    steg.halsningMs = Date.now() - t0;

    // CAPABILITY — visar vilka tillägg servern stödjer
    await conn.write(enc.encode("a1 CAPABILITY\r\n"));
    const n2 = await conn.read(buf);
    const kapabiliteter = dec.decode(buf.subarray(0, n2 ?? 0)).trim();
    steg.kapabiliteter = kapabiliteter.slice(0, 700);
    steg.harCONDSTORE = /CONDSTORE/i.test(kapabiliteter);
    steg.harQRESYNC = /QRESYNC/i.test(kapabiliteter);
    steg.harIDLE = /IDLE/i.test(kapabiliteter);
    steg.harOAUTH2 = /XOAUTH2|AUTH=XOAUTH2/i.test(kapabiliteter);
    steg.totaltMs = Date.now() - t0;
    steg.resultat = "OK";

    await conn.write(enc.encode("a2 LOGOUT\r\n"));
  } catch (e) {
    steg.resultat = "MISSLYCKADES";
    steg.fel = String(e).slice(0, 300);
    steg.totaltMs = Date.now() - t0;
  } finally {
    try { conn?.close(); } catch { /* redan stängd */ }
  }
  return steg;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const resultat = {
    denoVersion: Deno.version?.deno ?? "okänd",
    harConnectTls: typeof Deno.connectTls === "function",
    harConnect: typeof Deno.connect === "function",
    servrar: await Promise.all([
      probe("imap.one.com"),
      probe("imap.gmail.com"),
      probe("outlook.office365.com"),
    ]),
  };

  return new Response(JSON.stringify(resultat, null, 2), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
