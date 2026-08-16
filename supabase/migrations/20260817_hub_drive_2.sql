-- Drive, andra omgången — efter första skarpa hämtningen.
--
-- Registret visade sig innehålla 23 000 filer, varav 3 093 mappar. Med den
-- volymen blev sökningen 105 ms, och det räckte inte.

-- ── Snabbare sökning ───────────────────────────────────────────────────────
-- Villkoret "alla ord finns" är ett not exists över unnest, och det kan inget
-- index hjälpa till med — planeraren läste varenda rad. Därför står första
-- ordet dessutom som ett rakt ilike direkt på kolumnen. Det är redundant, men
-- det är den formen trigramindexet kan svara på, så genomsökningen krymper
-- till en handfull rader innan det dyra villkoret ens prövas.
--
-- Uppmätt: 105 ms före, 54 ms efter, och samma fråga som förberedd sats med
-- parameter går på 1,1 ms med Bitmap Index Scan på hub_drive_filer_namn_trgm.
-- Ta inte bort ilike-raden för att den ser överflödig ut.
create or replace function public.hub_drive_sok(
  p_fraga text default '', p_kategori text default null, p_antal integer default 40)
returns table (
  file_id text, namn text, mime text, storlek bigint, andrad timestamptz,
  webblank text, agare text, stjarnmarkt boolean, delad boolean)
language sql
stable
security invoker
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
  select f.file_id, f.namn, f.mime, f.storlek, f.andrad,
         f.webblank, f.agare, f.stjarnmarkt, f.delad
  from public.hub_drive_filer f
  where f.user_id = auth.uid()
    and not f.papperskorg
    and f.mime <> 'application/vnd.google-apps.folder'
    and (
      p_kategori is null or p_kategori = '' or case p_kategori
        when 'dokument' then f.mime in (
          'application/vnd.google-apps.document',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/rtf', 'text/plain')
        when 'kalkyl' then f.mime in (
          'application/vnd.google-apps.spreadsheet',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/csv')
        when 'presentation' then f.mime in (
          'application/vnd.google-apps.presentation',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation')
        when 'pdf' then f.mime = 'application/pdf'
        when 'bild' then f.mime like 'image/%'
        else true
      end
    )
    -- Indexerbar förfiltrering på första ordet, se kommentaren ovan
    and (coalesce(trim(p_fraga), '') = ''
         or f.namn ilike '%' || split_part(lower(trim(p_fraga)), ' ', 1) || '%')
    and (
      coalesce(trim(p_fraga), '') = ''
      or not exists (
        select 1 from unnest(string_to_array(lower(trim(p_fraga)), ' ')) ord
        where ord <> '' and f.namn not ilike '%' || ord || '%'
      )
    )
  order by
    (coalesce(trim(p_fraga), '') <> '' and f.namn ilike trim(p_fraga) || '%') desc,
    case when coalesce(trim(p_fraga), '') = '' then 0
         else similarity(f.namn, p_fraga) end desc,
    f.andrad desc nulls last
  limit greatest(1, least(p_antal, 100));
$function$;

grant execute on function public.hub_drive_sok(text, text, integer) to authenticated;

-- ── Schemalagd hämtning ────────────────────────────────────────────────────
-- Egen körning i stället för att läggas i hub_kor_bakgrundssynk: mejl behöver
-- hämtas ofta, men ett dokument som döps om kan gott synas en halvtimme
-- senare. Efter första hämtningen är det ett enda anrop till Drives
-- changes-API, så det kostar nästan ingenting — men det finns ingen anledning
-- att göra det sex gånger i timmen.
create or replace function public.hub_kor_drivesynk()
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'net'
as $function$
declare nyckeln text;
begin
  select nyckel into nyckeln from public.hub_cron_nyckel;
  if nyckeln is null then return; end if;
  perform net.http_post(
    url := 'https://abwmdhvaxqlpyzgvuedj.supabase.co/functions/v1/drive-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-hub-cron',nyckeln),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
end $function$;

-- 7 och 37 över, alltså vid sidan av de andra jobben i stället för samtidigt
select cron.schedule('hubben-drivesynk', '7,37 * * * *', 'select public.hub_kor_drivesynk()');
