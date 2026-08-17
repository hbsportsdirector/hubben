-- Google Drive i Hubben.
--
-- Filregistret hämtas hem hit i stället för att sökas hos Google vid varje
-- tangenttryckning. Skälet är samma som för mejlet: databasen är sanningen,
-- Google är kön. Det ger sökning som svarar direkt, som kan sortera på det
-- Per bryr sig om (senast ändrat), och som slipper Drives mappträd helt.
--
-- Inget filINNEHÅLL sparas — bara namn, typ, ägare och länk. Det som ska
-- öppnas eller bifogas hämtas färskt från Google i det ögonblicket.
--
-- Scopet är drive.readonly, vilket Google klassar som "restricted". En
-- verifierad app måste gå igenom en betald tredjepartsgranskning (CASA) för
-- att få använda det. Hubben är inte verifierad och behöver inte bli det:
-- appen står som In production med User type External, och då räcker det att
-- Per klickar förbi rutan om ogranskad app. Se google-oauth-start för de två
-- begränsningar som följer med, och för varför appen aldrig får sättas
-- tillbaka till Testing.
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.hub_drive_filer (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_id text not null,
  namn text not null,
  mime text,
  storlek bigint,
  andrad timestamptz,
  webblank text,
  ikon text,
  agare text,
  foraldrar text[],
  stjarnmarkt boolean not null default false,
  delad boolean not null default false,
  papperskorg boolean not null default false,
  hamtad timestamptz not null default now(),
  unique (user_id, file_id)
);

-- Trigram på namnet: "budg" hittar "Budget 2026.xlsx" utan att man behöver
-- kunna början av ordet. Ett vanligt ordindex klarar inte det.
create index if not exists hub_drive_filer_namn_trgm
  on public.hub_drive_filer using gin (namn extensions.gin_trgm_ops);
create index if not exists hub_drive_filer_andrad
  on public.hub_drive_filer (user_id, andrad desc);

-- Var synken står. page_token är Drives changes-token: efter första fulla
-- hämtningen frågar vi bara efter det som ändrats.
create table if not exists public.hub_drive_synk (
  user_id uuid primary key references auth.users(id) on delete cascade,
  page_token text,
  senast_synkad timestamptz,
  sista_fel text,
  antal integer not null default 0
);

alter table public.hub_drive_filer enable row level security;
alter table public.hub_drive_synk enable row level security;

drop policy if exists owner_all on public.hub_drive_filer;
create policy owner_all on public.hub_drive_filer for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists owner_all on public.hub_drive_synk;
create policy owner_all on public.hub_drive_synk for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.hub_drive_filer to authenticated;
grant select, insert, update, delete on public.hub_drive_synk to authenticated;

-- Sökningen som ska slå Drives egen.
--
-- Alla ord måste finnas i filnamnet, men i vilken ordning som helst — "budget
-- täby" hittar "Täby HBK budget 2026.xlsx". Tom fråga ger de senast ändrade,
-- vilket är rätt svar på "jag vet inte riktigt vad den heter".
--
-- Kategorin är grovhuggen med flit. Ingen tänker "application/vnd.openxml…";
-- man tänker "det var ett kalkylark", och då ska både Googles ark, xlsx och
-- csv komma med.
--
-- Ordningen är medveten: det som börjar med frågan först, sedan det som mest
-- liknar den, sedan det senast ändrade. Mappar finns inte i resultatet alls —
-- att slippa dem är själva poängen.
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
