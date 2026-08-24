// Skickar mejl via kontots egen SMTP-server, med bilagor.
//
// Svaret gar tillbaka sa fort mejlet ar levererat. Kopian till Skickat laggs
// undan EFTERAT, i bakgrunden, for den ar bokforing och inte nagot mottagaren
// vantar pa. Gar den fel skrivs det i hub_mail_accounts.sent_kopia_fel.
//
// Tva sorters uppkoppling: direkt TLS pa 465 som one.com och Gmail vill ha,
// och STARTTLS pa 587 som Outlook kraver. Och tva sorters inloggning:
// AUTH LOGIN med losenord, eller AUTH XOAUTH2 med ett Microsoft-token.
//
// Gar sandningen fel skrivs det bade i loggen och i
// hub_mail_accounts.sandning_fel. Bada behovs: svaret pa anropet syns bara
// for den som rakar ha rutan kvar oppen nar det kommer, och en stangd ruta
// gjorde forr att ett mejl som aldrig gick ivag sag skickat ut.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const U = Deno.env.get("SUPABASE_URL")!;
const S = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const A = Deno.env.get("SUPABASE_ANON_KEY")!;
const MAX_BILAGOR = 15 * 1024 * 1024;
const dec = new TextDecoder();
const enc = new TextEncoder();
const admin = createClient(U, S);

const MS_TOKEN = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
// Bada behorigheterna hor till samma resurs, sa ett token racker for bade
// sandningen och kopian till Skickat.
const MS_SCOPE = "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access";

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
  if (j.refresh_token && j.refresh_token !== k.refresh_token) {
    await admin.rpc("hub_spara_oauth_token", {
      p_user: userId, p_provider: "microsoft", p_token: j.refresh_token, p_konto: null,
    });
  }
  return j.access_token as string;
}

const xoauth2 = (epost: string, token: string) =>
  btoa(`user=${epost}\x01auth=Bearer ${token}\x01\x01`);

function iBakgrunden(p: Promise<unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p); else void p;
}

/** Deno.Conn.write() lovar INTE att skriva allt. Ett mejl med bilaga ryms
 *  sallan i ett svep, och da vantar servern i evighet pa resten. */
async function skrivAllt(c: Deno.Conn, data: Uint8Array) {
  let skrivet = 0;
  while (skrivet < data.length) {
    const n = await c.write(data.subarray(skrivet));
    if (n <= 0) throw new Error("Anslutningen tog inte emot mer data");
    skrivet += n;
  }
}

/* ---- SMTP ---- */
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
function sista(s: string) {
  const r = s.split(/\r?\n/).filter(Boolean);
  return r.length ? r[r.length - 1] : "";
}
const ok2xx = (s: string) => /^2\d\d /.test(sista(s));

/* ---- IMAP, bara sa mycket som APPEND kraver ---- */
async function imapLas(c: Deno.Conn, tag: string, ms = 30000) {
  const buf = new Uint8Array(16384);
  let ut = "";
  const slut = Date.now() + ms;
  // "+" ar IMAP:s fortsatt-svar, inte en tagg. Monstret byggdes forr alltid,
  // aven da - och blev /^+ (OK|NO|BAD)/, som ar ogiltigt eftersom + inte har
  // nagot att upprepa. Det kastade innan en enda byte lasts, sa APPEND till
  // Skickat foll varje gang: mejlet gick ivag men kopian blev aldrig av.
  // mail-drain och mail-move-x undgick det genom att bygga monstret forst i
  // else-grenen; har lag det utanfor.
  const vantarFortsattning = tag === "+";
  const re = vantarFortsattning ? null : new RegExp("^" + tag + " (OK|NO|BAD)", "mi");
  while (Date.now() < slut) {
    let t: number | undefined;
    const n = await Promise.race([c.read(buf), new Promise<null>((r) => { t = setTimeout(() => r(null), Math.max(300, slut - Date.now())); })]);
    if (t !== undefined) clearTimeout(t);
    if (n === null || n === 0) break;
    ut += dec.decode(buf.subarray(0, n as number));
    if (vantarFortsattning) { if (/^\+/m.test(ut)) break; }
    else if (re!.test(ut)) break;
  }
  return ut;
}
async function imapCmd(c: Deno.Conn, tag: string, rad: string) {
  await skrivAllt(c, enc.encode(tag + " " + rad + "\r\n"));
  const s = await imapLas(c, tag);
  return { text: s, ok: new RegExp("^" + tag + " OK", "mi").test(s) };
}
function utf7(s: string) {
  return s.replace(/&/g, "&-").replace(/[^\x20-\x7e]+/g, (bit) => {
    let bin = "";
    for (const t of bit) { const k = t.charCodeAt(0); bin += String.fromCharCode(k >> 8, k & 255); }
    return "&" + btoa(bin).replace(/=+$/, "").replace(/\//g, ",") + "-";
  });
}
const cit = (s: string) => '"' + utf7(s).replace(/"/g, '\\"') + '"';

/* ---- MIME ---- */
function kodaOrd(s: string) {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const b = enc.encode(s);
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return "=?UTF-8?B?" + btoa(bin) + "?=";
}
function bryt(b64: string) {
  return (b64.replace(/\s+/g, "").match(/.{1,76}/g) ?? []).join("\r\n");
}
function textTillBas64(text: string) {
  const b = enc.encode(text);
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return bryt(btoa(bin));
}
function filnamnsHuvud(namn: string) {
  const rent = namn.replace(/[\r\n"]/g, "").slice(0, 200) || "bilaga";
  if (/^[\x20-\x7e]*$/.test(rent)) {
    return { ct: 'name="' + rent + '"', cd: 'attachment; filename="' + rent + '"' };
  }
  return { ct: "name=" + kodaOrd(rent), cd: "attachment; filename*=UTF-8''" + encodeURIComponent(rent) };
}

/* ---- Adresser ---- */
/** "Anna Andersson <a@x.se>, b@y.se; c@z.se" blir tre poster. Komma och
 *  semikolon inuti citat eller vinkelparenteser hor till namnet och delar
 *  darfor ingenting. */
function delaAdresser(v: unknown): string[] {
  const rader = (Array.isArray(v) ? v : [v]).filter((x) => x !== null && x !== undefined).map(String);
  const ut: string[] = [];
  for (const rad of rader) {
    let nu = "", citat = false, vinkel = false;
    for (const t of rad) {
      if (t === '"') citat = !citat;
      else if (!citat && t === "<") vinkel = true;
      else if (!citat && t === ">") vinkel = false;
      else if (!citat && !vinkel && (t === "," || t === ";")) { ut.push(nu); nu = ""; continue; }
      nu += t;
    }
    ut.push(nu);
  }
  return ut.map((s) => s.trim()).filter(Boolean);
}

/** Kuvertets adress: det som star mellan vinkelparenteserna, annars alltihop.
 *  RCPT TO vill ha adressen och ingenting annat - skickar man med
 *  visningsnamnet nekar servern hela mejlet. */
function baraAdress(s: string) {
  const m = s.match(/<([^>]*)>/);
  return (m ? m[1] : s).trim();
}

/** Adressen som den ska sta i To:- eller Cc-raden. Namnet kodas om det har
 *  a, a eller o i sig, och citeras om det innehaller tecken som annars skulle
 *  las som avdelare. Sjalva adressen ror vi inte. */
function adressHuvud(s: string) {
  const m = s.match(/^(.*?)<([^>]*)>\s*$/);
  if (!m) return s.trim();
  const namn = m[1].trim().replace(/^"(.*)"$/, "$1");
  const adress = "<" + m[2].trim() + ">";
  if (!namn) return adress;
  if (!/^[\x20-\x7e]*$/.test(namn)) return kodaOrd(namn) + " " + adress;
  return (/[",;:<>@[\]\\]/.test(namn) ? '"' + namn.replace(/(["\\])/g, "\\$1") + '"' : namn) + " " + adress;
}

/** Inte RFC 5322 - bara tillrackligt for att fanga det som annars blir ett
 *  nekat RCPT TO: tom adress, glomt @, en hel mening i faltet. */
const RIMLIG_ADRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

interface Bilaga { filename?: string; contentType?: string; dataBase64?: string }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svar = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const anv = createClient(U, A, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await anv.auth.getUser();
  if (!user) return svar({ fel: "Inte inloggad" }, 401);

  const { fromAccountId, to, cc, subject, body, inReplyToId, attachments } = await req.json().catch(() => ({}));
  if (!fromAccountId || !to || !body) return svar({ fel: "fromAccountId, to och body kravs" }, 400);

  const bilagor: Bilaga[] = Array.isArray(attachments) ? attachments : [];
  let summa = 0;
  for (const b of bilagor) {
    if (!b?.dataBase64) return svar({ fel: "En bilaga saknar innehall" }, 400);
    summa += Math.floor(b.dataBase64.replace(/\s+/g, "").length * 0.75);
  }
  if (summa > MAX_BILAGOR) {
    return svar({ fel: "Bilagorna ar for stora (" + Math.round(summa / 1048576) + " MB, hogst 15 MB)" }, 413);
  }

  const { data: k } = await admin.from("hub_mail_accounts")
    .select("id, user_id, email, label, provider, smtp_host, smtp_port, imap_host, imap_port, signature, sandning_fel")
    .eq("id", fromAccountId).eq("user_id", user.id).single();
  if (!k?.smtp_host) {
    console.error("mail-send 400 " + fromAccountId + ": kontot saknar utgaende server");
    return svar({ fel: "Kontot saknar utgaende server" }, 400);
  }

  /** Varje utgang som inte ar ett skickat mejl gar har. Felet hamnar i loggen
   *  och pa kontoraden - svaret pa anropet ar ingenting att lita pa, for
   *  rutan som fragade kan vara stangd innan det kommer fram. */
  const misslyckades = async (fel: string, status = 502) => {
    console.error("mail-send " + status + " " + k.email + ": " + fel);
    await admin.from("hub_mail_accounts")
      .update({ sandning_fel: '"' + (subject || "(inget amne)") + '": ' + fel })
      .eq("id", k.id);
    return svar({ fel }, status);
  };

  const arOutlook = k.provider === "outlook";
  let losen: string | null = null;
  let token: string | null = null;
  if (arOutlook) {
    try { token = await msAccessToken(k.user_id as string); }
    catch (e) { return await misslyckades(String(e instanceof Error ? e.message : e).slice(0, 200), 400); }
  } else {
    const { data: p } = await admin.rpc("hub_get_mail_secret", { p_account_id: k.id });
    if (!p) return svar({ fel: "Inget losenord" }, 400);
    losen = String(p).trim();
  }

  let inReplyTo: string | null = null, refs: string[] = [];
  if (inReplyToId) {
    const { data: orig } = await admin.from("hub_messages")
      .select("rfc_message_id, references_ids").eq("id", inReplyToId).eq("user_id", user.id).maybeSingle();
    inReplyTo = orig?.rfc_message_id ?? null;
    refs = [...(orig?.references_ids ?? []), ...(inReplyTo ? [inReplyTo] : [])];
  }

  const sign = (k.signature ?? "").trim();
  const helaTexten = sign ? String(body).replace(/\s+$/, "") + "\n\n-- \n" + sign : String(body);

  // Faltet kan innehalla flera adresser, med eller utan visningsnamn. Forr
  // gick hela stracken in i ett enda RCPT TO, och tva mottagare i samma falt
  // rackte for att servern skulle neka mejlet.
  const tillLista = delaAdresser(to);
  const ccLista = delaAdresser(cc);
  const mottagare: string[] = [...tillLista, ...ccLista].map(baraAdress);
  if (!mottagare.length) return await misslyckades("Ingen mottagare angiven", 400);
  const trasig = mottagare.find((a) => !RIMLIG_ADRESS.test(a));
  if (trasig) return await misslyckades('"' + trasig + '" ser inte ut som en mejladress', 400);

  // Egen doman i Message-ID. hubben.local finns inte, och ett Message-ID
  // vars doman inte gar att sla upp ar en av de saker skrapfiltren raknar
  // poang for.
  const messageId = "<" + crypto.randomUUID() + "@" + (String(k.email).split("@")[1] || "hubben.local") + ">";
  const grans = "=_hubben_" + crypto.randomUUID().replace(/-/g, "");

  const gemensamt = [
    "From: " + k.email,
    "To: " + tillLista.map(adressHuvud).join(", "),
    ...(ccLista.length ? ["Cc: " + ccLista.map(adressHuvud).join(", ")] : []),
    "Subject: " + kodaOrd(subject ?? ""),
    "Date: " + new Date().toUTCString().replace("GMT", "+0000"),
    "Message-ID: " + messageId,
    ...(inReplyTo ? ["In-Reply-To: " + inReplyTo] : []),
    ...(refs.length ? ["References: " + refs.join(" ")] : []),
    "MIME-Version: 1.0",
  ];

  let helaMejlet: string;
  if (bilagor.length === 0) {
    helaMejlet = [...gemensamt,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
    ].join("\r\n") + "\r\n\r\n" + textTillBas64(helaTexten) + "\r\n";
  } else {
    const delar = [
      "--" + grans,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      textTillBas64(helaTexten),
    ];
    for (const b of bilagor) {
      const typ = (b.contentType || "application/octet-stream").split(";")[0].trim();
      const h = filnamnsHuvud(b.filename || "bilaga");
      delar.push(
        "--" + grans,
        "Content-Type: " + typ + "; " + h.ct,
        "Content-Disposition: " + h.cd,
        "Content-Transfer-Encoding: base64",
        "",
        bryt(b.dataBase64!),
      );
    }
    delar.push("--" + grans + "--", "");
    helaMejlet = [...gemensamt,
      'Content-Type: multipart/mixed; boundary="' + grans + '"',
    ].join("\r\n") + "\r\n\r\n" + delar.join("\r\n");
  }

  /** Kopian till Skickat. Kors efter svaret - ingen vantar pa den. */
  const sparaKopia = async () => {
    let fel: string | null = null;
    const { data: sentMapp } = await admin.from("hub_folders")
      .select("path").eq("account_id", k.id).eq("role", "sent").limit(1);
    const sentPath = sentMapp?.[0]?.path as string | undefined;

    if (!sentPath) fel = "Kontot har ingen Skickat-mapp i Hubben";
    else if (!k.imap_host) fel = "Kontot saknar inkommande server";
    else {
      let ic: Deno.TlsConn | null = null;
      try {
        ic = await Deno.connectTls({ hostname: k.imap_host, port: k.imap_port ?? 993 });
        await imapLas(ic, "\\*", 5000);
        const authRad = arOutlook
          ? "AUTHENTICATE XOAUTH2 " + xoauth2(k.email as string, token!)
          : "AUTHENTICATE PLAIN " + btoa("\0" + k.email + "\0" + losen);
        const inl = await imapCmd(ic, "s1", authRad);
        if (!inl.ok) throw new Error("Inloggning nekad");
        const rader = enc.encode(helaMejlet);
        await skrivAllt(ic, enc.encode("s2 APPEND " + cit(sentPath) + " (\\Seen) {" + rader.length + "}\r\n"));
        const fortsatt = await imapLas(ic, "+", 15000);
        if (!/^\+/m.test(fortsatt)) throw new Error("Servern nekade APPEND: " + (fortsatt.split(/\r?\n/).filter(Boolean).pop() ?? "inget svar").slice(0, 120));
        await skrivAllt(ic, rader);
        await skrivAllt(ic, enc.encode("\r\n"));
        const app = await imapLas(ic, "s2", 120000);
        if (!/^s2 OK/mi.test(app)) throw new Error("APPEND misslyckades: " + (app.split(/\r?\n/).filter(Boolean).pop() ?? "inget svar").slice(0, 120));
        await imapCmd(ic, "s9", "LOGOUT");
      } catch (e) {
        fel = String(e instanceof Error ? e.message : e).slice(0, 200);
      } finally {
        try { ic?.close(); } catch { /* */ }
      }
    }
    await admin.from("hub_mail_accounts")
      .update({ sent_kopia_fel: fel ? "\"" + (subject || "(inget amne)") + "\": " + fel : null })
      .eq("id", k.id);
  };

  let c: Deno.Conn | null = null;
  try {
    const port = k.smtp_port ?? 465;
    if (port === 465) {
      // Direkt TLS: krypterat fran forsta byten.
      c = await Deno.connectTls({ hostname: k.smtp_host, port });
      const hej = await lasSvar(c);
      if (!hej.startsWith("220")) return await misslyckades("Servern svarade inte: " + hej.slice(0, 120));
      await smtp(c, "EHLO hubben");
    } else {
      // STARTTLS: oppen anslutning som uppgraderas. Outlook tar inte emot
      // pa nagot annat satt.
      const oppen = await Deno.connect({ hostname: k.smtp_host, port });
      const hej = await lasSvar(oppen);
      if (!hej.startsWith("220")) {
        try { oppen.close(); } catch { /* */ }
        return await misslyckades("Servern svarade inte: " + hej.slice(0, 120));
      }
      await smtp(oppen, "EHLO hubben");
      const st = await smtp(oppen, "STARTTLS");
      if (!ok2xx(st)) {
        try { oppen.close(); } catch { /* */ }
        return await misslyckades("Servern ville inte kryptera anslutningen: " + st.slice(0, 120));
      }
      c = await Deno.startTls(oppen, { hostname: k.smtp_host });
      // EHLO maste goras om efter uppgraderingen - allt fore den raknas inte.
      await smtp(c, "EHLO hubben");
    }

    if (arOutlook) {
      const r = await smtp(c, "AUTH XOAUTH2 " + xoauth2(k.email as string, token!));
      if (!sista(r).startsWith("235")) {
        return await misslyckades("Microsoft nekade inloggningen: " + sista(r).slice(0, 140));
      }
    } else {
      const auth = await smtp(c, "AUTH LOGIN");
      if (!sista(auth).startsWith("334")) return await misslyckades("AUTH nekades: " + auth.slice(0, 120));
      const anvSvar = await smtp(c, btoa(k.email as string));
      if (!sista(anvSvar).startsWith("334")) return await misslyckades("Anvandarnamn nekades");
      const losSvar = await smtp(c, btoa(losen!));
      if (!sista(losSvar).startsWith("235")) return await misslyckades("Inloggning nekad av SMTP-servern: " + sista(losSvar).slice(0, 120));
    }

    const mf = await smtp(c, "MAIL FROM:<" + k.email + ">");
    if (!ok2xx(mf)) return await misslyckades("MAIL FROM nekades: " + mf.slice(0, 120));
    for (const r of mottagare) {
      const rc = await smtp(c, "RCPT TO:<" + r.trim() + ">");
      if (!ok2xx(rc)) return await misslyckades("Mottagaren nekades (" + r + "): " + sista(rc).slice(0, 100));
    }
    const data = await smtp(c, "DATA");
    if (!sista(data).startsWith("354")) return await misslyckades("DATA nekades: " + sista(data).slice(0, 120));

    const kropp = enc.encode(helaMejlet.replace(/\r\n\./g, "\r\n..") + "\r\n.\r\n");
    await skrivAllt(c, kropp);
    const slutSvar = await lasSvar(c, 120000);
    if (!slutSvar.trim()) {
      return await misslyckades(
        "Servern svarade inte inom tidsgransen efter att mejlet skickats (" +
        Math.round(kropp.length / 1024) + " kB). Det kan ha kommit fram anda - kolla Skickat innan du provar igen.",
        504,
      );
    }
    if (!ok2xx(slutSvar)) return await misslyckades("Servern avvisade mejlet: " + slutSvar.trim().slice(0, 150));
    await smtp(c, "QUIT");
    try { c.close(); } catch { /* */ }
    c = null;

    if (inReplyToId) {
      await admin.from("hub_messages").update({ answered: true, reply_later: false }).eq("id", inReplyToId);
    }
    // Bara nar det finns nagot att stada. Ett extra anrop i vanliga fallet
    // ar en fordrojning mellan att mejlet ar ivag och att rutan sager det.
    if (k.sandning_fel) {
      await admin.from("hub_mail_accounts").update({ sandning_fel: null }).eq("id", k.id);
    }

    iBakgrunden(sparaKopia());

    return svar({
      ok: true,
      messageId,
      skickatFran: k.email,
      mottagare,
      signaturLades: !!sign,
      bilagor: bilagor.length,
      storlekKb: Math.round(enc.encode(helaMejlet).length / 1024),
      sparasIBakgrunden: true,
    });
  } catch (e) {
    return await misslyckades(String(e instanceof Error ? e.message : e).slice(0, 200), 500);
  } finally {
    try { c?.close(); } catch { /* */ }
  }
});
