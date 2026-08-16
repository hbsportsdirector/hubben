-- Regler som sorterar inkommande post till rätt mapp.
--
-- Det här är den halva som saknades när HEY-lådorna byggdes och togs bort i
-- somras: facken fanns, men aldrig det som fyllde dem. Nu finns mapparna på
-- riktigt och det är sorteringen som fattas.
--
-- Flytten går genom kön som redan finns — pending_folder_id på mejlet plus en
-- rad i hub_pending_ops — så mail-drain verkställer den mot IMAP och mappen
-- ser likadan ut i Outlook och på telefonen.

create table if not exists public.hub_regler (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Antingen en adress eller en domän. Adressregel vinner över domänregel.
  epost text,
  doman text,
  -- Målmappen hör till ett konto, så regeln blir kontospecifik av sig själv.
  mapp_id uuid not null references public.hub_folders(id) on delete cascade,
  aktiv boolean not null default true,
  skapad timestamptz not null default now(),
  antal_flyttade integer not null default 0,
  constraint hub_regler_har_villkor check (epost is not null or doman is not null)
);

create unique index if not exists hub_regler_unik_epost
  on public.hub_regler (user_id, epost, mapp_id) where epost is not null;
create unique index if not exists hub_regler_unik_doman
  on public.hub_regler (user_id, doman, mapp_id) where doman is not null;

alter table public.hub_regler enable row level security;

drop policy if exists owner_all on public.hub_regler;
create policy owner_all on public.hub_regler
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.hub_regler to authenticated;

-- När en regel flyttade mejlet. Driver raden "N mejl sorterade av regler".
alter table public.hub_messages
  add column if not exists sorterad_at timestamptz;

create index if not exists hub_messages_sorterad_idx
  on public.hub_messages (user_id, sorterad_at desc) where sorterad_at is not null;

-- SECURITY DEFINER därför att bakgrundsjobbet kör den utan inloggad användare.
-- Vakten gör att en inloggad ändå bara kan köra sina egna regler.
create or replace function public.hub_kor_regler(p_user uuid, p_regel uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  r record;
  v_antal integer := 0;
begin
  if auth.uid() is not null and p_user is distinct from auth.uid() then
    raise exception 'Åtkomst nekad';
  end if;

  for r in
    select m.id as msg_id, m.folder_id, m.uid, re.id as regel_id, re.mapp_id
    from public.hub_messages m
    join public.hub_folders f on f.id = m.folder_id
    join public.hub_folders mal on mal.id = (
      select re2.mapp_id from public.hub_regler re2
      join public.hub_folders mf on mf.id = re2.mapp_id
      where re2.user_id = m.user_id
        and re2.aktiv
        and (p_regel is null or re2.id = p_regel)
        and mf.account_id = m.account_id
        and (re2.epost = m.from_email
             or re2.doman = split_part(coalesce(m.from_email, ''), '@', 2))
      order by (re2.epost is not null) desc
      limit 1
    )
    join public.hub_regler re on re.mapp_id = mal.id
      and re.user_id = m.user_id and re.aktiv
      and (re.epost = m.from_email
           or re.doman = split_part(coalesce(m.from_email, ''), '@', 2))
    where m.user_id = p_user
      -- Bara inkorgen. Regler sorterar inkommande post, de flyttar inte runt
      -- det man själv redan lagt någonstans.
      and f.role = 'inbox'
      and m.pending_folder_id is null
      and m.folder_id <> mal.id
    order by (re.epost is not null) desc
  loop
    update public.hub_messages
       set pending_folder_id = r.mapp_id, sorterad_at = now()
     where id = r.msg_id;

    insert into public.hub_pending_ops (user_id, msg_id, fran_folder_id, fran_uid, till_folder_id)
    values (p_user, r.msg_id, r.folder_id, r.uid, r.mapp_id)
    on conflict (msg_id) do update
      set till_folder_id = excluded.till_folder_id,
          forsok = 0, sista_fel = null, nasta_forsok = now(), skapad = now();

    update public.hub_regler set antal_flyttade = antal_flyttade + 1 where id = r.regel_id;
    v_antal := v_antal + 1;
  end loop;

  return v_antal;
end $function$;

grant execute on function public.hub_kor_regler(uuid, uuid) to authenticated, service_role;

-- Kör allas regler. Ligger i schemaläggaren i stället för i mail-sync: det är
-- ren databaslogik, och att lägga den i en edge-funktion hade betytt en
-- omdeploy av 330 rader för tre. Två minuter efter synken.
create or replace function public.hub_sortera_alla()
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare u record;
begin
  for u in select distinct user_id from public.hub_regler where aktiv loop
    perform public.hub_kor_regler(u.user_id);
  end loop;
end $function$;

-- select cron.schedule('hubben-sortera', '2-59/10 * * * *', 'select hub_sortera_alla()');

-- hub_mejl utökad med sorterad_at (sist — create or replace view kan bara
-- utöka i slutet). security_invoker=on måste sättas om vid varje replace.
