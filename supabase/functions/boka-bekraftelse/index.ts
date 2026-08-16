// Skickar besked till den som bokat en tid: bekraftelse eller avbokning.
//
// TVA sorters mejl, till adressen i en bokning som redan finns, med text som
// funktionen bygger sjalv. Det ar hela poangen med att den finns: mail-send
// tar godtycklig mottagare och godtycklig text, sa att oppna DEN for
// cron-nyckeln hade betytt att nyckeln kan skicka vad som helst i Pers namn.
// Har kan en lackt nyckel i varsta fall skicka om ett besked som redan gatt.
//
// Anledningen till avbokningen kommer fran databasen, inte fran anropet.
// Annars hade nyckeln kunnat lagga godtycklig text i Pers namn i mejlet, och
// da vore avgransningen ovan bortkastad.
//
// verify_jwt ar avstangd for att anroparen ar databasen via net.http_post, som
// inte har nagon inloggad anvandare att lana en token av. Kontrollen sker har
// nere med samma cron-nyckel som mejlsynken.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const U = Deno.env.get("SUPABASE_URL")!;
const S = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const dec = new TextDecoder();
const enc = new TextEncoder();
const admin = createClient(U, S);

const MS_TOKEN = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const MS_SCOPE = "https://outlook.office.com/SMTP.Send offline_access";

async function arBakgrundsjobb(req: Request) {
  const given = req.headers.get("x-hub-cron");
  if (!given) return false;
  const { data } = await admin.from("hub_cron_nyckel").select("nyckel").maybeSingle();
  const ratt = data?.nyckel as string | undefined;
  if (!ratt || given.length !== ratt.length) return false;
  let diff = 0;
  for (let i = 0; i < ratt.length; i++) diff |= given.charCodeAt(i) ^ ratt.charCodeAt(i);
  return diff === 0;
}

async function msAccessToken(userId: string): Promise<string> {
  const { data: rader } = await admin.rpc("hub_hamta_oauth", { p_user: userId, p_provider: "microsoft" });
  const k = Array.isArray(rader) ? rader[0] : rader;
  if (!k?.refresh_token) throw new Error("Outlook ar inte anslutet an");
  const r = await fetch(MS_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: k.client_id, client_secret: k.hemlighet,
      refresh_token: k.refresh_token, grant_type: "refresh_token", scope: MS_SCOPE,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(String(j.error_description ?? j.error ?? "Kunde inte fornya Outlook-atkomsten").slice(0, 200));
  }
  return j.access_token as string;
}

/** Deno.Conn.write() lovar inte att skriva allt - se mail-send. */
async function skrivAllt(c: Deno.Conn, data: Uint8Array) {
  let skrivet = 0;
  while (skrivet < data.length) {
    const n = await c.write(data.subarray(skrivet));
    if (n <= 0) throw new Error("Anslutningen tog inte emot mer data");
    skrivet += n;
  }
}

async function lasSvar(c: Deno.Conn, ms = 15000) {
  const buf = new Uint8Array(8192);
  let ut = "";
  const slut = Date.now() + ms;
  while (Date.now() < slut) {
    let t: number | undefined;
    const n = await Promise.race([c.read(buf), new Promise<null>((r) => { t = setTimeout(() => r(null), Math.max(300, slut - Date.now())); })]);
    if (t !== undefined) clearTimeout(t);
    if (n === null || n === 0) break;
    ut += dec.decode(buf.subarray(0, n as number));
    const rader = ut.split(/\r?\n/).filter(Boolean);
    if (rader.length && /^\d{3} /.test(rader[rader.length - 1])) break;
  }
  return ut;
}
async function smtp(c: Deno.Conn, rad: string) {
  await skrivAllt(c, enc.encode(rad + "\r\n"));
  return await lasSvar(c);
}
const sista = (s: string) => { const r = s.split(/\r?\n/).filter(Boolean); return r.length ? r[r.length - 1] : ""; };
const ok2xx = (s: string) => /^2\d\d /.test(sista(s));

function kodaOrd(s: string) {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  let bin = "";
  for (const x of enc.encode(s)) bin += String.fromCharCode(x);
  return "=?UTF-8?B?" + btoa(bin) + "?=";
}
function tillBas64(text: string) {
  let bin = "";
  for (const x of enc.encode(text)) bin += String.fromCharCode(x);
  return (btoa(bin).match(/.{1,76}/g) ?? []).join("\r\n");
}

/** Svensk datumrad i Stockholmstid. Bokaren bryr sig om nar motet ar, inte om
 *  vilken tidszon servern rakar sta i - och Deno kor i UTC. */
function svenskTid(iso: string) {
  const d = new Date(iso);
  const del = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const p = (t: string) => del.find((x) => x.type === t)?.value ?? "";
  return {
    dag: `${p("weekday")} ${p("day")} ${p("month")}`,
    tid: `${p("hour")}:${p("minute")}`,
  };
}

Deno.serve(async (req: Request) => {
  const svar = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

  if (!(await arBakgrundsjobb(req))) return svar({ fel: "Nekad" }, 401);

  const { bokning, typ } = await req.json().catch(() => ({}));
  if (!bokning) return svar({ fel: "bokning saknas" }, 400);
  const arAvbokning = typ === "avbokning";

  const { data: b } = await admin.from("hub_bokningar")
    .select("id, namn, epost, meddelande, starts_at, ends_at, bekraftelse_at, avbokad_at, avbokad_anledning, avbokning_mejl_at, lank_id, user_id")
    .eq("id", bokning).single();
  if (!b) return svar({ fel: "Bokningen hittades inte" }, 404);
  // Skicka aldrig om. En koad http_post som korts igen ska inte ge bokaren
  // ett andra mejl.
  if (arAvbokning ? b.avbokning_mejl_at : b.bekraftelse_at) return svar({ ok: true, redanSkickad: true });
  if (arAvbokning && !b.avbokad_at) return svar({ fel: "Bokningen ar inte avbokad" }, 400);

  const { data: l } = await admin.from("hub_bokningslankar")
    .select("namn, plats, langd_min, konto_id, skicka_bekraftelse").eq("id", b.lank_id).single();
  // skicka_bekraftelse styr bara bekraftelsen. Ett installt mote ska den som
  // bokat fa veta aven om Per stangt av kvittot pa sjalva bokningen.
  if (!l?.konto_id || (!arAvbokning && !l.skicka_bekraftelse)) return svar({ ok: true, avstangd: true });

  const { data: k } = await admin.from("hub_mail_accounts")
    .select("id, user_id, email, label, provider, smtp_host, smtp_port, signature")
    .eq("id", l.konto_id).single();
  if (!k?.smtp_host) return svar({ fel: "Kontot saknar utgaende server" }, 400);

  const nar = svenskTid(b.starts_at as string);
  const slut = svenskTid(b.ends_at as string);
  const avslutning = k.signature
    ? [`-- `, String(k.signature).trim()]
    : [`Hälsningar`, k.label ?? k.email];

  const amne = arAvbokning
    ? `Inställt: ${l.namn} — ${nar.dag} kl. ${nar.tid}`
    : `Bekräftelse: ${l.namn} — ${nar.dag} kl. ${nar.tid}`;

  const text = (arAvbokning ? [
    `Hej ${b.namn},`,
    ``,
    `Jag måste tyvärr ställa in vår tid.`,
    ``,
    `   ${l.namn}`,
    `   ${nar.dag} kl. ${nar.tid}–${slut.tid}`,
    ...(l.plats ? [`   ${l.plats}`] : []),
    ``,
    `Anledning: ${b.avbokad_anledning}`,
    ``,
    `Svara på det här mejlet så hittar vi en ny tid.`,
    ``,
    ...avslutning,
  ] : [
    `Hej ${b.namn},`,
    ``,
    `Din tid är bokad.`,
    ``,
    `   ${l.namn}`,
    `   ${nar.dag} kl. ${nar.tid}–${slut.tid}`,
    ...(l.plats ? [`   ${l.plats}`] : []),
    ...(b.meddelande ? [``, `Du skrev: ${b.meddelande}`] : []),
    ``,
    `Behöver du ändra eller avboka, svara på det här mejlet.`,
    ``,
    ...avslutning,
  ]).join("\n");

  const brev = [
    "From: " + k.email,
    "To: " + b.epost,
    "Subject: " + kodaOrd(amne),
    "Date: " + new Date().toUTCString().replace("GMT", "+0000"),
    "Message-ID: <" + crypto.randomUUID() + "@hubben.local>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ].join("\r\n") + "\r\n\r\n" + tillBas64(text) + "\r\n";

  let losen: string | null = null;
  let token: string | null = null;
  const arOutlook = k.provider === "outlook";
  try {
    if (arOutlook) token = await msAccessToken(k.user_id as string);
    else {
      const { data: p } = await admin.rpc("hub_get_mail_secret", { p_account_id: k.id });
      if (!p) throw new Error("Inget losenord");
      losen = String(p).trim();
    }
  } catch (e) {
    const fel = String(e instanceof Error ? e.message : e).slice(0, 200);
    await admin.from("hub_bokningar").update({ bekraftelse_fel: fel }).eq("id", b.id);
    return svar({ fel }, 400);
  }

  let c: Deno.Conn | null = null;
  try {
    const port = k.smtp_port ?? 465;
    if (port === 465) {
      c = await Deno.connectTls({ hostname: k.smtp_host, port });
      const hej = await lasSvar(c);
      if (!hej.startsWith("220")) throw new Error("Servern svarade inte: " + hej.slice(0, 120));
      await smtp(c, "EHLO hubben");
    } else {
      // STARTTLS: oppen anslutning som uppgraderas. Outlook tar inte emot annars.
      const oppen = await Deno.connect({ hostname: k.smtp_host, port });
      const hej = await lasSvar(oppen);
      if (!hej.startsWith("220")) { try { oppen.close(); } catch { /* */ } throw new Error("Servern svarade inte"); }
      await smtp(oppen, "EHLO hubben");
      const st = await smtp(oppen, "STARTTLS");
      if (!ok2xx(st)) { try { oppen.close(); } catch { /* */ } throw new Error("Servern ville inte kryptera"); }
      c = await Deno.startTls(oppen, { hostname: k.smtp_host });
      // EHLO maste goras om efter uppgraderingen
      await smtp(c, "EHLO hubben");
    }

    if (arOutlook) {
      const xo = btoa(`user=${k.email}\x01auth=Bearer ${token}\x01\x01`);
      const r = await smtp(c, "AUTH XOAUTH2 " + xo);
      if (!sista(r).startsWith("235")) throw new Error("Microsoft nekade inloggningen");
    } else {
      const auth = await smtp(c, "AUTH LOGIN");
      if (!sista(auth).startsWith("334")) throw new Error("AUTH nekades");
      if (!sista(await smtp(c, btoa(k.email as string))).startsWith("334")) throw new Error("Anvandarnamn nekades");
      if (!sista(await smtp(c, btoa(losen!))).startsWith("235")) throw new Error("Inloggning nekad av SMTP-servern");
    }

    if (!ok2xx(await smtp(c, "MAIL FROM:<" + k.email + ">"))) throw new Error("MAIL FROM nekades");
    if (!ok2xx(await smtp(c, "RCPT TO:<" + b.epost + ">"))) throw new Error("Mottagaren nekades");
    if (!sista(await smtp(c, "DATA")).startsWith("354")) throw new Error("DATA nekades");

    await skrivAllt(c, enc.encode(brev.replace(/\r\n\./g, "\r\n..") + "\r\n.\r\n"));
    const slutSvar = await lasSvar(c, 60000);
    if (!ok2xx(slutSvar)) throw new Error("Servern avvisade mejlet: " + slutSvar.trim().slice(0, 150));
    await smtp(c, "QUIT");

    const nu = new Date().toISOString();
    await admin.from("hub_bokningar")
      .update(arAvbokning
        ? { avbokning_mejl_at: nu, bekraftelse_fel: null }
        : { bekraftelse_at: nu, bekraftelse_fel: null })
      .eq("id", b.id);
    return svar({ ok: true, till: b.epost });
  } catch (e) {
    const fel = String(e instanceof Error ? e.message : e).slice(0, 200);
    // Felet sparas pa bokningsraden, som ar enda stallet det syns - mejlet gar
    // i bakgrunden och ingen sitter och vantar pa svaret. Bokningen respektive
    // avbokningen star kvar oavsett; en trasig SMTP far aldrig andra vad som
    // galler i kalendern.
    await admin.from("hub_bokningar").update({ bekraftelse_fel: fel }).eq("id", b.id);
    return svar({ fel }, 500);
  } finally {
    try { c?.close(); } catch { /* */ }
  }
});
