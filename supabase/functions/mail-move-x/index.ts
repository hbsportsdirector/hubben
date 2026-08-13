// Flyttar ett mejl MELLAN konton: ner fran kallan, upp till malet, och forst
// darefter originalet till papperskorgen. Metoden valjs efter vad kallservern
// faktiskt stodjer - inte efter antaganden.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const U = Deno.env.get("SUPABASE_URL")!;
const S = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const A = Deno.env.get("SUPABASE_ANON_KEY")!;
const MAX = 30 * 1024 * 1024;
const dec = new TextDecoder();
const enc = new TextEncoder();

function eol(b: Uint8Array, f: number) {
  for (let i = f; i < b.length - 1; i++) if (b[i] === 13 && b[i + 1] === 10) return i;
  return -1;
}
function klart(b: Uint8Array, tag: string) {
  const re = new RegExp("^" + tag + " (OK|NO|BAD)", "i");
  let i = 0;
  while (i < b.length) {
    const e = eol(b, i);
    if (e < 0) return false;
    const rad = dec.decode(b.subarray(i, e));
    const lit = rad.match(/\{(\d+)\}$/);
    if (lit) { i = e + 2 + Number(lit[1]); continue; }
    if (re.test(rad)) return true;
    i = e + 2;
  }
  return false;
}
async function las(c: Deno.TlsConn, tag: string, ms = 40000): Promise<Uint8Array> {
  const bitar: Uint8Array[] = []; let total = 0;
  const slut = Date.now() + ms; const buf = new Uint8Array(65536);
  const hop = () => { const h = new Uint8Array(total); let o = 0; for (const b of bitar) { h.set(b, o); o += b.length; } return h; };
  while (Date.now() < slut) {
    let t: number | undefined;
    const n = await Promise.race([c.read(buf), new Promise<null>((r) => { t = setTimeout(() => r(null), Math.max(400, slut - Date.now())); })]);
    if (t !== undefined) clearTimeout(t);
    if (n === null || n === 0) break;
    bitar.push(buf.slice(0, n as number)); total += n as number;
    if (total > MAX) break;
    if (tag === "+") { if (/^\+/m.test(dec.decode(hop().subarray(0, 200)))) break; }
    else if (klart(hop(), tag)) break;
  }
  return hop();
}
async function cmd(c: Deno.TlsConn, tag: string, k: string) {
  await c.write(enc.encode(tag + " " + k + "\r\n"));
  const b = await las(c, tag);
  const s = dec.decode(b);
  return { bytes: b, text: s, ok: new RegExp("^" + tag + " OK", "mi").test(s) };
}
function utf7(s: string) {
  return s.replace(/&/g, "&-").replace(/[^\x20-\x7e]+/g, (bit) => {
    let bin = "";
    for (const t of bit) { const k = t.charCodeAt(0); bin += String.fromCharCode(k >> 8, k & 255); }
    return "&" + btoa(bin).replace(/=+$/, "").replace(/\//g, ",") + "-";
  });
}
const cit = (s: string) => '"' + utf7(s).replace(/"/g, '\\"') + '"';
const sistaRad = (s: string) => s.split(/\r?\n/).filter(Boolean).pop()?.slice(0, 120) ?? "";

async function loggaIn(host: string, port: number, epost: string, losen: string) {
  const c = await Deno.connectTls({ hostname: host, port });
  await las(c, "\\*", 5000);
  const r = await cmd(c, "x1", "AUTHENTICATE PLAIN " + btoa("\0" + epost + "\0" + losen));
  if (!r.ok) { try { c.close(); } catch { /* */ } return null; }
  return c;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svar = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const anv = createClient(U, A, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await anv.auth.getUser();
  if (!user) return svar({ fel: "Inte inloggad" }, 401);

  const { messageId, targetFolderId } = await req.json().catch(() => ({}));
  if (!messageId || !targetFolderId) return svar({ fel: "messageId och targetFolderId kravs" }, 400);

  const admin = createClient(U, S);
  const { data: m } = await admin.from("hub_messages").select("id, uid, account_id, folder_id, seen, flagged")
    .eq("id", messageId).eq("user_id", user.id).single();
  if (!m) return svar({ fel: "Mejlet hittades inte" }, 404);

  const { data: kallMapp } = await admin.from("hub_folders").select("path").eq("id", m.folder_id).single();
  const { data: mal } = await admin.from("hub_folders").select("id, path, account_id").eq("id", targetFolderId).eq("user_id", user.id).single();
  if (!mal) return svar({ fel: "Malmappen hittades inte" }, 404);

  const { data: kallKonto } = await admin.from("hub_mail_accounts").select("label, email, imap_host, imap_port").eq("id", m.account_id).single();
  const { data: malKonto } = await admin.from("hub_mail_accounts").select("label, email, imap_host, imap_port").eq("id", mal.account_id).single();
  const { data: kallLosen } = await admin.rpc("hub_get_mail_secret", { p_account_id: m.account_id });
  const { data: malLosen } = await admin.rpc("hub_get_mail_secret", { p_account_id: mal.account_id });
  if (!kallLosen || !malLosen) return svar({ fel: "Losenord saknas for ett av kontona" }, 400);

  const { data: papper } = await admin.from("hub_folders").select("path").eq("account_id", m.account_id).eq("role", "trash").limit(1);
  const papperPath = papper?.[0]?.path as string | undefined;

  let kc: Deno.TlsConn | null = null, mc: Deno.TlsConn | null = null;
  try {
    kc = await loggaIn(kallKonto!.imap_host, kallKonto!.imap_port ?? 993, kallKonto!.email, String(kallLosen).trim());
    if (!kc) return svar({ fel: "Kunde inte logga in pa " + kallKonto!.label }, 502);

    const kap = await cmd(kc, "x2", "CAPABILITY");
    const harMove = /\bMOVE\b/i.test(kap.text);
    const harUidplus = /UIDPLUS/i.test(kap.text);

    const sel = await cmd(kc, "x3", "SELECT " + cit(String(kallMapp?.path ?? "INBOX")));
    if (!sel.ok) return svar({ fel: "Kunde inte oppna " + kallMapp?.path }, 502);

    const raatt = await cmd(kc, "x4", "UID FETCH " + m.uid + " (BODY.PEEK[])");
    const slutRad = eol(raatt.bytes, 0);
    const forsta = dec.decode(raatt.bytes.subarray(0, slutRad < 0 ? 200 : slutRad));
    const lit = forsta.match(/\{(\d+)\}$/);
    if (!lit) return svar({ fel: "Servern gav inget meddelandeinnehall" }, 502);
    const langd = Number(lit[1]);
    if (langd > MAX) return svar({ fel: "Mejlet ar for stort (" + Math.round(langd / 1048576) + " MB)" }, 413);
    const kropp = raatt.bytes.subarray(slutRad + 2, slutRad + 2 + langd);
    if (kropp.length < langd) return svar({ fel: "Ofullstandig nerladdning" }, 502);

    mc = await loggaIn(malKonto!.imap_host, malKonto!.imap_port ?? 993, malKonto!.email, String(malLosen).trim());
    if (!mc) return svar({ fel: "Kunde inte logga in pa " + malKonto!.label }, 502);

    const flaggor = [m.seen ? "\\Seen" : "", m.flagged ? "\\Flagged" : ""].filter(Boolean).join(" ");
    await mc.write(enc.encode("y1 APPEND " + cit(mal.path as string) + " (" + flaggor + ") {" + langd + "}\r\n"));
    const fortsatt = dec.decode(await las(mc, "+", 15000));
    if (!/^\+/m.test(fortsatt)) return svar({ fel: malKonto!.label + " nekade uppladdning till " + mal.path + ": " + sistaRad(fortsatt) }, 502);
    await mc.write(kropp);
    await mc.write(enc.encode("\r\n"));
    const app = dec.decode(await las(mc, "y1", 40000));
    if (!/^y1 OK/mi.test(app)) return svar({ fel: "Uppladdning misslyckades: " + sistaRad(app) }, 502);

    // Kopian ar pa plats. Nu - och forst nu - originalet till papperskorgen.
    let originalet = "kvar i " + (kallMapp?.path ?? "kallmappen");
    if (papperPath) {
      let klar = false;
      if (harMove) klar = (await cmd(kc, "x5", "UID MOVE " + m.uid + " " + cit(papperPath))).ok;
      if (!klar) {
        const kop = await cmd(kc, "x6", "UID COPY " + m.uid + " " + cit(papperPath));
        if (kop.ok) {
          await cmd(kc, "x7", "UID STORE " + m.uid + " +FLAGS (\\Deleted)");
          if (harUidplus) klar = (await cmd(kc, "x8", "UID EXPUNGE " + m.uid)).ok;
          if (!klar) klar = (await cmd(kc, "x9", "EXPUNGE")).ok;
        }
      }
      if (klar) originalet = "papperskorgen";
    }

    if (originalet !== "papperskorgen") {
      // Kopian finns pa malkontot men originalet gick inte att flytta undan.
      // Sag det rakt ut i stallet for att lata mejlet dyka upp igen vid nasta synk.
      return svar({
        fel: "Mejlet kopierades till " + mal.path + " pa " + malKonto!.label +
             " men originalet kunde inte tas bort fran " + kallKonto!.label +
             " - det finns nu pa bada stallen",
      }, 502);
    }

    const nyttUid = app.match(/APPENDUID (\d+) (\d+)/i);
    if (nyttUid) {
      await admin.from("hub_messages").update({ folder_id: mal.id, account_id: mal.account_id, uid: Number(nyttUid[2]) }).eq("id", messageId);
    } else {
      await admin.from("hub_messages").delete().eq("id", messageId);
    }

    await cmd(kc, "x99", "LOGOUT");
    await cmd(mc, "y99", "LOGOUT");
    return svar({ ok: true, mapp: mal.path, storlek: langd, originalet, harMove, harUidplus });
  } catch (e) {
    return svar({ fel: String(e).slice(0, 200) }, 500);
  } finally {
    try { kc?.close(); } catch { /* */ }
    try { mc?.close(); } catch { /* */ }
  }
});
