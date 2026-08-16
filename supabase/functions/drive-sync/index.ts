// Hamtar hem registret over Pers Drive-filer.
//
// Bara metadata: namn, typ, agare, lank. Aldrig innehallet. Det som ska
// oppnas eller bifogas hamtas farskt av drive-fil i det ogonblicket, sa
// Hubben aldrig blir en andra kopia av Drive.
//
// Forsta gangen listas allt. Google lamnar samtidigt ett startPageToken, och
// darefter fragas bara det som andrats via changes-API:t. Gar tokenet ut
// svarar Google 410, och da borjar vi om fran borjan - samma monster som
// kalendersynken.
//
// Tva sorters anropare slapps in: en inloggad anvandare, eller schemalaggaren
// med cron-nyckeln. Darfor ar verify_jwt avstangd.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-cron",
};
const U = Deno.env.get("SUPABASE_URL")!;
const S = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const A = Deno.env.get("SUPABASE_ANON_KEY")!;
const API = "https://www.googleapis.com/drive/v3";
const admin = createClient(U, S);

// Falten vi ber om. Att rakna upp dem i stallet for att ta emot allt gor
// svaren markbart mindre - ett Drive med tusentals filer hamtas i ett par
// sekunder i stallet for tiotals.
const FALT = "id,name,mimeType,modifiedTime,size,webViewLink,iconLink,owners(displayName),parents,starred,shared,trashed";

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

async function nyttAccessToken(clientId: string, hemlighet: string, refresh: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: hemlighet,
      refresh_token: refresh, grant_type: "refresh_token",
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(String(j.error_description ?? j.error ?? "Kunde inte fornya atkomsten").slice(0, 200));
  }
  return j.access_token as string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tillRad(userId: string, f: any) {
  return {
    user_id: userId,
    file_id: f.id as string,
    namn: (f.name ?? "(utan namn)") as string,
    mime: f.mimeType ?? null,
    // Google lamnar storleken som strang, och utelamnar den helt for sina egna
    // dokumentformat - de har ingen storlek forran de exporteras.
    storlek: f.size ? Number(f.size) : null,
    andrad: f.modifiedTime ?? null,
    webblank: f.webViewLink ?? null,
    ikon: f.iconLink ?? null,
    agare: f.owners?.[0]?.displayName ?? null,
    foraldrar: f.parents ?? null,
    stjarnmarkt: !!f.starred,
    delad: !!f.shared,
    papperskorg: !!f.trashed,
    hamtad: new Date().toISOString(),
  };
}

async function synkaAnvandare(userId: string, tvingaFull = false) {
  const { data: rader } = await admin.rpc("hub_hamta_oauth", { p_user: userId, p_provider: "google" });
  const klient = Array.isArray(rader) ? rader[0] : rader;
  if (!klient?.refresh_token) return { fel: "Google ar inte anslutet an", status: 400 };

  let token: string;
  try {
    token = await nyttAccessToken(klient.client_id, klient.hemlighet, klient.refresh_token);
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    await admin.from("hub_oauth_klienter").update({ sista_fel: text })
      .eq("user_id", userId).eq("provider", "google");
    return { fel: text, behoverAnslutaOm: true, status: 400 };
  }
  const huvud = { Authorization: "Bearer " + token };

  const { data: synk } = await admin.from("hub_drive_synk")
    .select("page_token").eq("user_id", userId).maybeSingle();
  let sida: string | null = tvingaFull ? null : (synk?.page_token ?? null);

  let nya = 0, borttagna = 0;
  const skriv = async (rows: ReturnType<typeof tillRad>[]) => {
    if (!rows.length) return;
    const { error } = await admin.from("hub_drive_filer")
      .upsert(rows, { onConflict: "user_id,file_id" });
    if (error) throw new Error("Kunde inte spara: " + error.message);
    nya += rows.length;
  };

  try {
    if (!sida) {
      // ---- Full hamtning ----
      // startPageToken hamtas FORE listningen. Tar vi det efterat missar vi
      // allt som andras medan vi listar.
      const st = await fetch(API + "/changes/startPageToken", { headers: huvud });
      const stJson = await st.json().catch(() => ({}));
      if (!st.ok) return { fel: "Drive nekade: " + JSON.stringify(stJson).slice(0, 200), status: 502 };
      const startToken = stJson.startPageToken as string;

      let pageToken: string | undefined;
      let varv = 0;
      do {
        const u = new URL(API + "/files");
        u.searchParams.set("fields", `nextPageToken,files(${FALT})`);
        u.searchParams.set("pageSize", "1000");
        u.searchParams.set("q", "trashed = false");
        u.searchParams.set("orderBy", "modifiedTime desc");
        u.searchParams.set("supportsAllDrives", "true");
        u.searchParams.set("includeItemsFromAllDrives", "true");
        if (pageToken) u.searchParams.set("pageToken", pageToken);

        const r = await fetch(u, { headers: huvud });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return { fel: "Drive nekade: " + JSON.stringify(j).slice(0, 200), status: 502 };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await skriv((j.files ?? []).map((f: any) => tillRad(userId, f)));
        pageToken = j.nextPageToken;
        varv++;
        // Ett tak sa en funktion aldrig kan bli hangande. 50 000 filer racker
        // langt, och nasta korning fortsatter dar den slutade via changes.
      } while (pageToken && varv < 50);

      await admin.from("hub_drive_synk").upsert({
        user_id: userId, page_token: startToken,
        senast_synkad: new Date().toISOString(), sista_fel: null, antal: nya,
      });
      return { ok: true, full: true, filer: nya };
    }

    // ---- Bara det som andrats ----
    let varv = 0;
    while (sida && varv < 50) {
      const u = new URL(API + "/changes");
      u.searchParams.set("pageToken", sida);
      u.searchParams.set("fields", `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FALT}))`);
      u.searchParams.set("pageSize", "1000");
      u.searchParams.set("supportsAllDrives", "true");
      u.searchParams.set("includeItemsFromAllDrives", "true");

      const r = await fetch(u, { headers: huvud });
      const j = await r.json().catch(() => ({}));
      // 410: tokenet ar for gammalt. Da gors en full hamtning i stallet.
      if (r.status === 410) return await synkaAnvandare(userId, true);
      if (!r.ok) return { fel: "Drive nekade: " + JSON.stringify(j).slice(0, 200), status: 502 };

      const rows: ReturnType<typeof tillRad>[] = [];
      const bort: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const c of (j.changes ?? []) as any[]) {
        if (c.removed || !c.file || c.file.trashed) bort.push(c.fileId);
        else rows.push(tillRad(userId, c.file));
      }
      await skriv(rows);
      if (bort.length) {
        const { error } = await admin.from("hub_drive_filer")
          .delete().eq("user_id", userId).in("file_id", bort);
        if (error) throw new Error("Kunde inte rensa: " + error.message);
        borttagna += bort.length;
      }

      if (j.newStartPageToken) {
        await admin.from("hub_drive_synk").upsert({
          user_id: userId, page_token: j.newStartPageToken,
          senast_synkad: new Date().toISOString(), sista_fel: null,
        });
        sida = null;
      } else {
        sida = j.nextPageToken ?? null;
      }
      varv++;
    }
    return { ok: true, full: false, andrade: nya, borttagna };
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    await admin.from("hub_drive_synk").upsert({ user_id: userId, sista_fel: text });
    return { fel: text, status: 500 };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const svar = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const kropp = await req.json().catch(() => ({}));

  if (await arBakgrundsjobb(req)) {
    const { data: klienter } = await admin.from("hub_oauth_klienter")
      .select("user_id").eq("provider", "google");
    const ut = [];
    for (const k of klienter ?? []) ut.push(await synkaAnvandare(k.user_id as string));
    return svar({ ok: true, korda: ut.length, resultat: ut });
  }

  const anv = createClient(U, A, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await anv.auth.getUser();
  if (!user) return svar({ fel: "Inte inloggad" }, 401);

  const r = await synkaAnvandare(user.id, !!kropp.full);
  return svar(r, "status" in r ? (r.status as number) : 200);
});
