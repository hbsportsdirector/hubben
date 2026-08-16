-- Bokningslänkar: andra människor bokar tid hos Per utan att logga in.
--
-- Hubbens FÖRSTA publika yta. Hela datamodellen är annars låst till Per via
-- radsäkerheten, så den publika sidan får ingenting direkt — den går via två
-- snävt tillskurna funktioner som lämnar ut exakt det som behövs för att visa
-- lediga tider och boka en. Länkens token är enda nyckeln, och därför 32
-- slumpade tecken.
--
-- OBS tidszonen i hub_bokningssida: generate_series(current_date, ...) löser ut
-- till timestamptz. Utan ::date blir `dag + fran_tid` en timestamptz och
-- `at time zone` konverterar FRÅN UTC i stället för TILL — en öppettid 13:00
-- hamnar då 15:00. Det kostade en felsökning; rör inte kastet.

create table if not exists public.hub_bokningslankar (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  namn text not null,
  langd_min integer not null default 30,
  kalender_id uuid references public.hub_calendars(id) on delete set null,
  plats text,
  beskrivning text,
  framforhallning_dagar integer not null default 28,
  varsel_timmar integer not null default 12,
  aktiv boolean not null default true,
  skapad timestamptz not null default now(),
  constraint hub_bokningslankar_langd check (langd_min between 5 and 480),
  constraint hub_bokningslankar_fram check (framforhallning_dagar between 1 and 180)
);

-- veckodag följer Postgres dow: 0 = söndag
create table if not exists public.hub_oppettider (
  id uuid primary key default gen_random_uuid(),
  lank_id uuid not null references public.hub_bokningslankar(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  veckodag smallint not null check (veckodag between 0 and 6),
  fran_tid time not null,
  till_tid time not null,
  constraint hub_oppettider_ordning check (till_tid > fran_tid)
);
create index if not exists hub_oppettider_lank_idx on public.hub_oppettider (lank_id, veckodag);

create table if not exists public.hub_bokningar (
  id uuid primary key default gen_random_uuid(),
  lank_id uuid not null references public.hub_bokningslankar(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.hub_events(id) on delete set null,
  namn text not null,
  epost text not null,
  meddelande text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  skapad timestamptz not null default now(),
  avbokad_at timestamptz
);
create index if not exists hub_bokningar_lank_idx on public.hub_bokningar (lank_id, starts_at);

alter table public.hub_bokningslankar enable row level security;
alter table public.hub_oppettider enable row level security;
alter table public.hub_bokningar enable row level security;

drop policy if exists owner_all on public.hub_bokningslankar;
create policy owner_all on public.hub_bokningslankar for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists owner_all on public.hub_oppettider;
create policy owner_all on public.hub_oppettider for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists owner_all on public.hub_bokningar;
create policy owner_all on public.hub_bokningar for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.hub_bokningslankar to authenticated;
grant select, insert, update, delete on public.hub_oppettider to authenticated;
grant select, insert, update, delete on public.hub_bokningar to authenticated;

-- ── Den publika sidan ──────────────────────────────────────────────────────
-- Returnerar mötets namn och de lediga tiderna. INGENTING annat.
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
  select * into l from public.hub_bokningslankar where token = p_token and aktiv;
  if not found then return jsonb_build_object('finns', false); end if;

  select coalesce(jsonb_agg(x.start_at order by x.start_at), '[]'::jsonb) into v_tider
  from (
    select s.start_at
    from (
      select ((d.dag::date + o.fran_tid) at time zone v_tz)
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
      -- Krocka mot allt som redan står i Pers påslagna kalendrar
      and not exists (
        select 1 from public.hub_events e
        join public.hub_calendars k on k.id = e.calendar_id
        where e.user_id = l.user_id and k.aktiv
          and e.starts_at < s.start_at + make_interval(mins => l.langd_min)
          and coalesce(e.ends_at, e.starts_at + interval '1 hour') > s.start_at
      )
      -- och mot bokningar som ännu inte hunnit bli händelser
      and not exists (
        select 1 from public.hub_bokningar b
        where b.lank_id = l.id and b.avbokad_at is null
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
-- Tiden kontrolleras mot samma uträkning som sidan visar. Klienten får aldrig
-- bestämma vad som är ledigt — den kan bara föreslå en tid som funktionen
-- själv verifierar.
create or replace function public.hub_boka(
  p_token text, p_start timestamptz, p_namn text, p_epost text, p_meddelande text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  l public.hub_bokningslankar;
  v_sida jsonb;
  v_slut timestamptz;
  v_event uuid;
begin
  if coalesce(trim(p_namn), '') = '' or coalesce(trim(p_epost), '') = '' then
    return jsonb_build_object('ok', false, 'fel', 'Namn och mejladress behövs.');
  end if;
  if p_epost !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'fel', 'Mejladressen ser inte riktig ut.');
  end if;

  select * into l from public.hub_bokningslankar where token = p_token and aktiv;
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
          nullif(trim(coalesce(p_meddelande,'')), ''), p_start, v_slut);

  return jsonb_build_object('ok', true, 'start', p_start, 'slut', v_slut, 'namn', l.namn);
end $function$;

-- Anon får köra exakt de här två och ingenting annat.
grant execute on function public.hub_bokningssida(text) to anon, authenticated;
grant execute on function public.hub_boka(text, timestamptz, text, text, text) to anon, authenticated;

-- ── Bekräftelse till den som bokat (tillägg) ───────────────────────────────
--
-- Skickas av edge-funktionen boka-bekraftelse, INTE av mail-send. Skälet är
-- avgränsning: mail-send tar godtycklig mottagare och godtycklig text, så att
-- öppna den för cron-nyckeln hade betytt att nyckeln kan skicka vad som helst
-- i Pers namn. boka-bekraftelse kan bara skicka EN sorts mejl, till adressen i
-- en bokning som redan finns, med text den bygger själv.
alter table public.hub_bokningslankar
  add column if not exists konto_id uuid references public.hub_mail_accounts(id) on delete set null,
  add column if not exists skicka_bekraftelse boolean not null default true;

alter table public.hub_bokningar
  add column if not exists bekraftelse_at timestamptz,
  add column if not exists bekraftelse_fel text;

-- hub_boka avslutas med ett net.http_post till boka-bekraftelse när länken har
-- ett avsändarkonto. Anropet KÖAS, så den som bokar får sitt svar direkt
-- oavsett hur långsam mejlservern är — och en trasig SMTP får aldrig fälla
-- själva bokningen. Se den fullständiga definitionen i migrationen
-- 20260816_hub_boka_bekraftelse (applicerad via MCP).
