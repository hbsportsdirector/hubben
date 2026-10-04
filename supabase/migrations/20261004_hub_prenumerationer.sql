-- Prenumerationer på kalendrar via en .ics-länk (lagkalendrar och liknande).
--
-- De bor i hub_calendars med provider 'ics' och länken som external_id, och
-- hämtas av edge-funktionen ics-sync. Se dess inledning.

-- ── Räknas kalendern som upptagen på bokningssidan? ─────────────────────────
-- Google-kalendrarna gör det, precis som förut. En prenumeration läggs till
-- med false: ett helt seriespel är information, inte möten Per själv ska på,
-- och skulle annars stänga bokningssidan varje helg.
alter table public.hub_calendars
  add column if not exists blockerar boolean not null default true;

comment on column public.hub_calendars.blockerar is
  'Om händelserna i kalendern gör tiden upptagen på bokningssidan. Prenumerationer läggs till med false.';

-- Bokningssidan ska fråga efter kolumnen. Funktionen har ändrats direkt i
-- databasen sedan den sist låg i en migration, så den lappas på plats i
-- stället för att skrivas om från ett gammalt original.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.hub_bokningssida'::regproc);
  if position('k.aktiv and k.blockerar' in d) = 0 then
    if position('where e.user_id = l.user_id and k.aktiv' in d) = 0 then
      raise exception 'hub_bokningssida ser inte ut som väntat - lappen hittar inte sitt ställe';
    end if;
    execute replace(d, 'where e.user_id = l.user_id and k.aktiv',
                       'where e.user_id = l.user_id and k.aktiv and k.blockerar');
  end if;
end $$;

-- ── Att koppla bort Google slår bara av Googles kalendrar ───────────────────
-- Förut slogs ALLA kalendrar av, vilket nu skulle ta prenumerationerna med sig.
CREATE OR REPLACE FUNCTION public.hub_koppla_bort_oauth(p_provider text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare v_rad public.hub_oauth_klienter;
begin
  select * into v_rad from public.hub_oauth_klienter
  where user_id = auth.uid() and provider = p_provider;
  if not found then return; end if;
  if v_rad.token_id is not null then
    perform vault.update_secret(v_rad.token_id, 'bortkopplad');
  end if;
  update public.hub_oauth_klienter
    set token_id = null, ansluten_vid = null, konto = null, sista_fel = null
    where id = v_rad.id;
  -- Kalendrarna forlorar sin kalla; handelserna far ligga kvar tills Per
  -- sjalv tar bort dem, sa att inget forsvinner bakom ryggen pa honom.
  update public.hub_calendars set aktiv = false
    where user_id = auth.uid() and provider = p_provider;
end $function$;

-- ── Schemalagd hämtning ─────────────────────────────────────────────────────
-- Var trettionde minut, inte var tionde som Google-synken: det är någon
-- annans server, och en matchtid som ändras syns ändå inom en halvtimme.
CREATE OR REPLACE FUNCTION public.hub_kor_icssynk()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'net'
AS $function$
declare nyckeln text;
begin
  if not exists (select 1 from hub_calendars where provider = 'ics' and aktiv) then return; end if;
  select nyckel into nyckeln from hub_cron_nyckel;
  if nyckeln is null then return; end if;
  perform net.http_post(
    url := 'https://abwmdhvaxqlpyzgvuedj.supabase.co/functions/v1/ics-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-hub-cron',nyckeln),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
end $function$;

revoke execute on function public.hub_kor_icssynk() from public, anon, authenticated;

select cron.schedule('hubben-icssynk', '13,43 * * * *', 'select public.hub_kor_icssynk()');
