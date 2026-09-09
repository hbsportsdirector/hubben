-- Öppettiderna syns i kalendern.
--
-- Varje öppettid blir en veckovis återkommande händelse, så Per ser i
-- telefonen när han är bokningsbar. Tas öppettiden bort försvinner serien.
--
-- FÄLLAN som styrde hela designen: hub_bokningssida hoppar över varje tid som
-- krockar med något i en påslagen kalender. Lägger man in öppettiderna som
-- vanliga händelser krockar varje ledig tid med sig själv och sidan visar
-- noll tider — funktionen hade sett ut att fungera tills någon försökte boka.
--
-- Igenkänningen sker via serie_id, inte via en kolumn på händelsen. Skälet är
-- att en serie inte överlever resan till Google som samma rad: calendar-push
-- skickar upp moderhändelsen och SLÄPPER den lokala raden, varefter
-- calendar-sync hämtar hem de expanderade tillfällena som nya rader. En
-- markering på ursprungsraden hade försvunnit i det bytet. Googles id för
-- serien följer däremot med varje tillfälle som series_master_id.
alter table public.hub_oppettider
  add column if not exists serie_id text;

comment on column public.hub_oppettider.serie_id is
  'Googles id för den återkommande händelsen. Skrivs av calendar-push när serien skapats, och är det som gör att tiden inte krockar med sig själv.';

-- Transient: behövs bara mellan att triggern skapar raden och att
-- calendar-push fått Googles id. Efter det är serie_id det som gäller.
alter table public.hub_events
  add column if not exists oppettid_id uuid references public.hub_oppettider(id) on delete set null;

-- Veckodag till RFC 5545-kod. Postgres dow: 0 = söndag.
create or replace function public.hub_veckodagskod(p_dow smallint)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $function$
  select (array['SU','MO','TU','WE','TH','FR','SA'])[p_dow + 1]
$function$;

create or replace function public.hub_oppettid_skapad()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  l public.hub_bokningslankar;
  v_dag date;
  v_start timestamptz;
  v_slut timestamptz;
begin
  select * into l from public.hub_bokningslankar where id = new.lank_id;
  if not found then return new; end if;

  -- Närmaste dag framåt med rätt veckodag, inklusive idag.
  v_dag := current_date + ((new.veckodag - extract(dow from current_date)::int + 7) % 7);
  -- Samma kast som i hub_bokningssida: date + time ger en timestamp UTAN zon,
  -- och at time zone tolkar den då som lokal tid och räknar om till UTC. Utan
  -- kastet blir det tvärtom och tiden hamnar två timmar fel.
  v_start := (v_dag + new.fran_tid) at time zone 'Europe/Stockholm';
  v_slut  := (v_dag + new.till_tid) at time zone 'Europe/Stockholm';

  insert into public.hub_events (
    user_id, calendar_id, title, description, starts_at, ends_at, all_day,
    color, rrule, oppettid_id, pending_op, pending_nasta, pending_forsok
  ) values (
    new.user_id, l.kalender_id,
    'Bokningsbar: ' || l.namn,
    'Tid som går att boka via ' || l.namn || '. Läggs in och tas bort av Hubben.',
    v_start, v_slut, false,
    -- Grafit: ska synas men inte skrika, det är ingen riktig bokning
    '#616161',
    'FREQ=WEEKLY;BYDAY=' || public.hub_veckodagskod(new.veckodag),
    new.id,
    case when l.kalender_id is not null then 'skapa' end,
    case when l.kalender_id is not null then now() end,
    0
  );
  return new;
end $function$;

drop trigger if exists hub_oppettid_skapad_trg on public.hub_oppettider;
create trigger hub_oppettid_skapad_trg
  after insert on public.hub_oppettider
  for each row execute function public.hub_oppettid_skapad();

create or replace function public.hub_oppettid_borttagen()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  -- Ännu inte uppe hos Google: raden kan bara försvinna.
  delete from public.hub_events
   where oppettid_id = old.id and (external_id is null or calendar_id is null);

  -- Uppe hos Google: köa en radering av HELA serien. Ett enda tillfälle räcker
  -- att märka — calendar-push raderar moderhändelsen och städar de lokala
  -- raderna med samma series_master_id.
  if old.serie_id is not null then
    update public.hub_events
       set pending_op = 'radera', pending_scope = 'serie',
           pending_nasta = now(), pending_forsok = 0, pending_fel = null
     where user_id = old.user_id and series_master_id = old.serie_id
       and id = (select id from public.hub_events
                  where user_id = old.user_id and series_master_id = old.serie_id
                  order by starts_at limit 1);
  end if;
  return old;
end $function$;

drop trigger if exists hub_oppettid_borttagen_trg on public.hub_oppettider;
create trigger hub_oppettid_borttagen_trg
  before delete on public.hub_oppettider
  for each row execute function public.hub_oppettid_borttagen();

-- hub_bokningssida hoppar nu över öppettidernas egna händelser. Se
-- migrationen hub_bokningssida_hoppar_over_egna_oppettider (via MCP) och
-- kommentaren i funktionen.
