// Testar riktig IMAP-inloggning med lösenordet från Vault.
// Lösenordet lämnar aldrig servern och returneras aldrig till klienten.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

async function readUntil(conn: Deno.TlsConn, tag: string, timeoutMs = 15000): Promise<string> {
  const dec = new TextDecoder();
  const buf = new Uint8Array(65536);
  let ut = "";
  const slut = Date.now() + timeoutMs;
  const klar = new RegExp("^" + tag + " (OK|NO|BAD)", "mi");
  while (Date.now() < slut) {
    let timer: number | undefined;
    const n = await Promise.race([
      conn.read(buf),
      new Promise<null>((r) => { timer = setTimeout(() => r(null), Math.max(500, slut - Date.now())); }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (n === null || n === 0) break;
    ut += dec.decode(buf.subarray(0, n as number));
    if (klar.test(ut)) break;
  }
  return ut;
}

async function kommando(conn: Deno.TlsConn, tag: string, cmd: string) {
  await conn.write(new TextEncoder().encode(`${tag} ${cmd}\r\n`));
  return await readUntil(conn, tag);
}

function plockUt(text: string, nyckel: string): string | null {
  const m = text.match(new RegExp(`\\[${nyckel} ([^\\]]+)\\]`, "i"));
  return m ? m[1].trim() : null;
}

async function testa(host: string, port: number, anvandare: string, losen: string) {
  const res: Record<string, unknown> = {};
  let conn: Deno.TlsConn | null = null;
  const t0 = Date.now();
  try {
    conn = await Deno.connectTls({ hostname: host, port });
    await readUntil(conn, "\\*", 5000);

    const payload = btoa(`\0${anvandare}\0${losen}`);
    const svar = await kommando(conn, "a1", `AUTHENTICATE PLAIN ${payload}`);
    res.inloggad = /^a1 OK/mi.test(svar);
    if (!res.inloggad) {
      res.serversvar = svar.split(/\r?\n/).filter((l) => /^a1 (NO|BAD)/i.test(l)).join(" ").slice(0, 200);
      return res;
    }

    const kap = await kommando(conn, "a2", "CAPABILITY");
    res.harCONDSTORE = /CONDSTORE/i.test(kap);
    res.harQRESYNC = /QRESYNC/i.test(kap);
    res.harIDLE = /IDLE/i.test(kap);
    res.harMOVE = /\bMOVE\b/i.test(kap);
    res.harSORT = /\bSORT\b/i.test(kap);

    const sel = await kommando(conn, "a3", "SELECT INBOX");
    const exists = sel.match(/^\* (\d+) EXISTS/mi);
    res.antalIInkorgen = exists ? Number(exists[1]) : null;
    res.uidvalidity = plockUt(sel, "UIDVALIDITY");
    res.uidnext = plockUt(sel, "UIDNEXT");
    res.highestmodseq = plockUt(sel, "HIGHESTMODSEQ");

    const lista = await kommando(conn, "a4", 'LIST "" "*"');
    res.antalMappar = (lista.match(/^\* LIST/gmi) || []).length;

    res.totaltMs = Date.now() - t0;
    await kommando(conn, "a5", "LOGOUT");
  } catch (e) {
    res.fel = String(e).slice(0, 250);
  } finally {
    try { conn?.close(); } catch { /* redan stängd */ }
  }
  return res;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const auth = req.headers.get("Authorization") ?? "";
  const somAnvandare = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
  const { data: { user } } = await somAnvandare.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ fel: "Inte inloggad" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(URL_, SERVICE);
  const { data: konton, error: kontoFel } = await admin
    .from("hub_mail_accounts")
    .select("id, email, label, imap_host, imap_port, secret_id")
    .eq("user_id", user.id)
    .eq("provider", "imap")
    .not("secret_id", "is", null)
    .order("sort_order");

  if (kontoFel) {
    return new Response(JSON.stringify({ fel: kontoFel.message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const resultat = [];
  for (const k of konton ?? []) {
    const { data: losen, error: hemlFel } = await admin.rpc("hub_get_mail_secret", { p_account_id: k.id });
    if (hemlFel || !losen) {
      resultat.push({ label: k.label, epost: k.email, fel: hemlFel?.message ?? "Hittade ingen hemlighet" });
      continue;
    }

    let r = await testa(k.imap_host, k.imap_port ?? 993, k.email, losen);
    if (r.inloggad === false && /\s/.test(losen)) {
      const r2 = await testa(k.imap_host, k.imap_port ?? 993, k.email, losen.replace(/\s+/g, ""));
      if (r2.inloggad) r = { ...r2, notering: "Fungerade först när mellanslagen togs bort" };
    }
    resultat.push({ label: k.label, epost: k.email, ...r });

    await admin.from("hub_mail_accounts").update({
      last_checked_at: new Date().toISOString(),
      last_error: r.inloggad ? null : String(r.serversvar ?? r.fel ?? "Inloggning misslyckades").slice(0, 300),
    }).eq("id", k.id);
  }

  return new Response(JSON.stringify({ resultat }, null, 2), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
