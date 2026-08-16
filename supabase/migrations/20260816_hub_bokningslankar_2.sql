-- Bokningslänkarna, andra omgången. Bygger på 20260816_hub_bokningslankar.
--
-- Tre saker Per bad om efter att ha använt den skarpt:
--   1. En avbokad tid ska inte automatiskt bli bokningsbar igen.
--   2. Enskilda dagar ska gå att stänga utan att länken slutar fungera.
--   3. Adressen ska gå att säga i telefon.

-- ── 1. Vad som händer med tiden när ett möte ställs in ────────────────────
-- Att avboka betyder inte att tiden är ledig. Oftast ställs mötet in för att
-- Per inte kan då, och då ska ingen annan kunna boka samma tid. Därför är
-- utgångsläget att tiden förblir upptagen, och att släppa den är ett aktivt
-- val vid avbokningen.
alter table public.hub_bokningar
  add column if not exists tiden_slappt boolean not null default false;

-- ── 2. Dagar Per inte kan ─────────────────────────────────────────────────
-- Gäller alla länkar, inte en i taget. "Jag kan inte den 24:e" handlar om
-- Per, inte om vilken sorts möte någon vill boka.
create table if not exists public.hub_bokningsstopp (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  datum date not null,
  anteckning text,
  skapad timestamptz not null default now(),
  unique (user_id, datum)
);
alter table public.hub_bokningsstopp enable row level security;
drop policy if exists owner_all on public.hub_bokningsstopp;
create policy owner_all on public.hub_bokningsstopp for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.hub_bokningsstopp to authenticated;

-- ── 3. Kortare adress ─────────────────────────────────────────────────────
-- token är 32 slumpade tecken och gjord för att inte kunna gissas. En adress
-- man ska kunna säga i telefon är något annat, så den får vara ett eget fält
-- som Per bestämmer själv. Båda fungerar; den gamla adressen slutar aldrig
-- gälla bara för att en kortare tillkommer — någon kan redan ha fått den.
alter table public.hub_bokningslankar
  add column if not exists slug text;

update public.hub_bokningslankar
   set slug = encode(gen_random_bytes(4), 'hex')
 where slug is null;

create unique index if not exists hub_bokningslankar_slug_idx
  on public.hub_bokningslankar (lower(slug)) where slug is not null;

-- Bara små bokstäver, siffror och bindestreck. Adressen ska gå att säga
-- högt utan att någon behöver fråga om det var stor eller liten bokstav.
alter table public.hub_bokningslankar drop constraint if exists hub_bokningslankar_slug_form;
alter table public.hub_bokningslankar add constraint hub_bokningslankar_slug_form
  check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,39}$');

-- ── Sidan ──────────────────────────────────────────────────────────────────
-- Returnerar mötets namn och de lediga tiderna. INGENTING annat.
--
-- p_token tar emot både den långa token och den korta adressen.
--
-- OBS tidszonen: generate_series(current_date, ...) löser ut till timestamptz.
-- Utan ::date blir `dag + fran_tid` en timestamptz och `at time zone`
-- konverterar FRÅN UTC i stället för TILL — en öppettid 13:00 hamnar då 15:00.
-- Det kostade en felsökning; rör inte kastet.
create or replace function public.hub_bokningssida(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  l public.hub_bokningslankar;
  v_tz text := 'Europe/Stockholm';
  v_tider jsonb;
begin
  select * into l from public.hub_bokningslankar
   where (token = p_token or lower(slug) = lower(p_token)) and aktiv;
  if not found then return jsonb_build_object('finns', false); end if;

  select coalesce(jsonb_agg(x.start_at order by x.start_at), '[]'::jsonb) into v_tider
  from (
    select s.start_at
    from (
      select d.dag::date as dag,
             ((d.dag::date + o.fran_tid) at time zone v_tz)
             + make_interval(mins => g.n * l.langd_min) as start_at
      from generate_series(current_date, current_date + l.framforhallning_dagar, interval '1 day') d(dag)
      join public.hub_oppettider o
        on o.lank_id = l.id and o.veckodag = extract(dow from d.dag::date)
      cross join lateral generate_series(
        0,
        greatest(0, (extract(epoch from (o.till_tid - o.fran_tid)) / 60 / l.langd_min)::int - 1)
      ) g(n)
    ) s
    where s.start_at > now() + make_interval(hours => l.varsel_timmar)
      -- Dagar Per stängt går bort helt, oavsett vad öppettiderna säger
      and not exists (
        select 1 from public.hub_bokningsstopp b
        where b.user_id = l.user_id and b.datum = s.dag
      )
      -- Krocka mot allt som redan står i Pers påslagna kalendrar. Händelser
      -- som står på tur att raderas räknas inte — de är på väg bort, och
      -- annars vore tiden blockerad ända tills kön hunnit köras.
      and not exists (
        select 1 from public.hub_events e
        join public.hub_calendars k on k.id = e.calendar_id
        where e.user_id = l.user_id and k.aktiv
          and coalesce(e.pending_op, '') <> 'radera'
          and e.starts_at < s.start_at + make_interval(mins => l.langd_min)
          and coalesce(e.ends_at, e.starts_at + interval '1 hour') > s.start_at
      )
      -- och mot bokningar. En avbokad tid fortsätter blockera om Per inte
      -- uttryckligen släppte den: han ställde oftast in för att han inte kan
      -- då, och då kan han inte då åt någon annan heller.
      and not exists (
        select 1 from public.hub_bokningar b
        where b.lank_id = l.id
          and (b.avbokad_at is null or not b.tiden_slappt)
          and b.starts_at < s.start_at + make_interval(mins => l.langd_min)
          and b.ends_at > s.start_at
      )
  ) x;

  return jsonb_build_object(
    'finns', true, 'namn', l.namn, 'langd_min', l.langd_min,
    'plats', l.plats, 'beskrivning', l.beskrivning, 'tider', v_tider
  );
end $function$;

-- ── Boka ───────────────────────────────────────────────────────────────────
-- Samma uppslag som sidan, så den korta adressen fungerar hela vägen fram
-- till bokningen.
create or replace function public.hub_boka(
  p_token text, p_start timestamptz, p_namn text, p_epost text, p_meddelande text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'net'
as $function$
declare
  l public.hub_bokningslankar;
  v_sida jsonb;
  v_slut timestamptz;
  v_event uuid;
  v_bokning uuid;
  v_nyckel text;
begin
  if coalesce(trim(p_namn), '') = '' or coalesce(trim(p_epost), '') = '' then
    return jsonb_build_object('ok', false, 'fel', 'Namn och mejladress behövs.');
  end if;
  if p_epost !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'fel', 'Mejladressen ser inte riktig ut.');
  end if;

  select * into l from public.hub_bokningslankar
   where (token = p_token or lower(slug) = lower(p_token)) and aktiv;
  if not found then return jsonb_build_object('ok', false, 'fel', 'Länken finns inte längre.'); end if;

  -- Broms mot missbruk: en publik sida utan inloggning ska inte kunna fyllas
  -- med tusen bokningar av någon som roar sig.
  if (select count(*) from public.hub_bokningar
      where lank_id = l.id and skapad > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('ok', false, 'fel', 'För många bokningar just nu. Försök om en stund.');
  end if;

  v_sida := public.hub_bokningssida(p_token);
  if not exists (
    select 1 from jsonb_array_elements_text(v_sida->'tider') t(v)
    where t.v::timestamptz = p_start
  ) then
    return jsonb_build_object('ok', false, 'fel', 'Tiden är inte längre ledig.');
  end if;

  v_slut := p_start + make_interval(mins => l.langd_min);

  insert into public.hub_events (
    user_id, calendar_id, title, description, location,
    starts_at, ends_at, all_day, color, pending_op, pending_nasta, pending_forsok
  ) values (
    l.user_id, l.kalender_id,
    l.namn || ' – ' || trim(p_namn),
    trim(coalesce(p_meddelande, '')) || case when coalesce(p_meddelande,'') <> '' then E'\n\n' else '' end
      || 'Bokad via Hubben av ' || trim(p_namn) || ' (' || trim(p_epost) || ')',
    l.plats, p_start, v_slut, false, '#039be5',
    case when l.kalender_id is not null then 'skapa' end,
    case when l.kalender_id is not null then now() end,
    0
  ) returning id into v_event;

  insert into public.hub_bokningar (lank_id, user_id, event_id, namn, epost, meddelande, starts_at, ends_at)
  values (l.id, l.user_id, v_event, trim(p_namn), trim(p_epost),
          nullif(trim(coalesce(p_meddelande,'')), ''), p_start, v_slut)
  returning id into v_bokning;

  -- Bekräftelsen skickas i bakgrunden. net.http_post köar anropet, så den som
  -- bokar får sitt svar direkt oavsett hur långsam mejlservern är — och en
  -- trasig SMTP får aldrig fälla själva bokningen.
  if l.skicka_bekraftelse and l.konto_id is not null then
    select nyckel into v_nyckel from public.hub_cron_nyckel;
    if v_nyckel is not null then
      perform net.http_post(
        url := 'https://abwmdhvaxqlpyzgvuedj.supabase.co/functions/v1/boka-bekraftelse',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-hub-cron', v_nyckel),
        body := jsonb_build_object('bokning', v_bokning),
        timeout_milliseconds := 30000);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'start', p_start, 'slut', v_slut, 'namn', l.namn);
end $function$;

grant execute on function public.hub_boka(text, timestamptz, text, text, text) to anon, authenticated;

-- ── Avboka ─────────────────────────────────────────────────────────────────
drop function if exists public.hub_avboka(uuid, text);

-- Avbokar en tid och köar mejlet till den som bokat.
--
-- Anledningen är obligatorisk. Att få "inställt" utan ett ord om varför är
-- sämre än att inte få något alls, och den som bokat kan inte fråga tillbaka
-- annat än genom att svara på mejlet.
--
-- p_slapp_tiden avgör om tiden blir bokningsbar igen. Utgångsläget är nej:
-- ställer man in för att man inte kan då, kan man inte då åt någon annan
-- heller.
create or replace function public.hub_avboka(
  p_bokning uuid, p_anledning text, p_slapp_tiden boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'net'
as $function$
declare
  b public.hub_bokningar;
  l public.hub_bokningslankar;
  e public.hub_events;
  v_nyckel text;
  v_mejl boolean := false;
begin
  if coalesce(trim(p_anledning), '') = '' then
    return jsonb_build_object('ok', false, 'fel', 'Skriv en anledning — den går med i mejlet.');
  end if;

  -- Ägarkontrollen görs här eftersom funktionen är SECURITY DEFINER och alltså
  -- går förbi radsäkerheten.
  select * into b from public.hub_bokningar where id = p_bokning and user_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'fel', 'Bokningen hittades inte.'); end if;
  if b.avbokad_at is not null then
    return jsonb_build_object('ok', false, 'fel', 'Tiden är redan avbokad.');
  end if;

  select * into l from public.hub_bokningslankar where id = b.lank_id;

  update public.hub_bokningar
     set avbokad_at = now(), avbokad_anledning = trim(p_anledning),
         tiden_slappt = coalesce(p_slapp_tiden, false)
   where id = b.id;

  -- Mötet ska bort ur kalendern oavsett vad som händer med tiden.
  if b.event_id is not null then
    select * into e from public.hub_events where id = b.event_id;
    if found then
      if e.calendar_id is null then
        -- Ligger bara i Hubben. calendar-push hoppar över händelser utan
        -- kalender och skulle lämna raden kvar för alltid — och då hade den
        -- fortsatt blockera sin egen tid. Alltså bort direkt.
        delete from public.hub_events where id = e.id;
      else
        update public.hub_events
           set pending_op = 'radera', pending_scope = null,
               pending_nasta = now(), pending_forsok = 0, pending_fel = null
         where id = e.id;
      end if;
    end if;
  end if;

  -- Mejlet köas i bakgrunden. En trasig SMTP får inte göra att avbokningen
  -- misslyckas — tiden är släppt oavsett, och det är det viktiga.
  if l.konto_id is not null then
    select nyckel into v_nyckel from public.hub_cron_nyckel;
    if v_nyckel is not null then
      perform net.http_post(
        url := 'https://abwmdhvaxqlpyzgvuedj.supabase.co/functions/v1/boka-bekraftelse',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-hub-cron', v_nyckel),
        body := jsonb_build_object('bokning', b.id, 'typ', 'avbokning'),
        timeout_milliseconds := 30000);
      v_mejl := true;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'mejl_koat', v_mejl, 'till', b.epost,
                            'tiden_slappt', coalesce(p_slapp_tiden, false));
end $function$;

-- Bara Per. Den publika sidan får boka, aldrig avboka åt någon annan.
revoke execute on function public.hub_avboka(uuid, text, boolean) from anon;
grant execute on function public.hub_avboka(uuid, text, boolean) to authenticated;
