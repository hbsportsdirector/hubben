-- Adressförslag när man skriver i Till, Kopia eller Hemlig.
--
-- Ingen adressbok behövs — svaret finns redan i mejlen. Två källor: avsändare
-- av det som kommit in (de enda som har ett NAMN; to_emails och cc_emails
-- innehåller bara rena adresser), och mottagarna på allt som skickats eller
-- tagits emot.
--
-- Rangordningen är den som gör att rätt person står överst: den man skrivit
-- med oftast först, och vid lika många den man skrivit med senast. En träff
-- som BÖRJAR med det man skrivit går före en som bara innehåller det.

-- Adresser man aldrig kan skriva till.
--
-- De ligger högt i statistiken just för att de skickar mycket — Svenska Lag
-- och GitHub var de två vanligaste av alla. Ett förslag man inte kan använda
-- är sämre än inget förslag, för det tar platsen från ett som går att välja.
create or replace function public.hub_ar_svarslos(p_adress text)
returns boolean
language sql
immutable
set search_path to 'pg_catalog'
as $function$
  select p_adress ~* '(^|[.+_-])(no[-_.]?reply|donotreply|do[-_.]?not[-_.]?reply|noreply|bounce[sd]?|mailer[-_.]?daemon|postmaster|notifications?|ci[-_.]?activity)([.+_-]|@)'
      or split_part(p_adress, '@', 2) ~* '^(noreply|no-reply|bounce|mail)\.'
$function$;

comment on function public.hub_ar_svarslos(text) is
  'Ser adressen ut att vara en avsändare man inte kan svara till? Grov men medveten: hellre ett bortfiltrerat förslag för mycket än en lista full av noreply.';

create or replace function public.hub_mottagare_forslag(
  p_fraga text default '', p_antal integer default 6)
returns table (adress text, namn text, antal bigint, senast timestamptz)
language sql
stable
security invoker
set search_path to 'pg_catalog', 'public'
as $function$
  with rader as (
    select lower(trim(m.from_email)) as adress,
           nullif(trim(coalesce(m.from_name, '')), '') as namn,
           m.sent_at
    from public.hub_messages m
    where m.user_id = auth.uid() and m.from_email is not null
    union all
    select lower(trim(a)), null, m.sent_at
    from public.hub_messages m,
         unnest(coalesce(m.to_emails, '{}') || coalesce(m.cc_emails, '{}')) a
    where m.user_id = auth.uid() and trim(coalesce(a, '')) <> ''
  ),
  utan_mig as (
    select r.* from rader r
    where r.adress <> '' and r.adress like '%@%'
      and not public.hub_ar_svarslos(r.adress)
      -- Att föreslå sig själv som mottagare är aldrig rätt svar
      and not exists (
        select 1 from public.hub_mail_accounts k
        where k.user_id = auth.uid() and lower(k.email) = r.adress
      )
  ),
  samlat as (
    select u.adress,
           -- Namnet från det senaste mejlet som hade ett
           (array_agg(u.namn order by (u.namn is null), u.sent_at desc nulls last))[1] as namn,
           count(*) as antal,
           max(u.sent_at) as senast
    from utan_mig u
    group by u.adress
  )
  select s.adress, s.namn, s.antal, s.senast
  from samlat s
  where coalesce(trim(p_fraga), '') = ''
     or s.adress ilike '%' || trim(p_fraga) || '%'
     or coalesce(s.namn, '') ilike '%' || trim(p_fraga) || '%'
  order by
    -- coalesce runt hela uttrycket: utan den blir det NULL för varje rad som
    -- saknar namn (false or null = null), och NULL sorterar FÖRE true i
    -- fallande ordning — alltså hamnade de riktiga inledningsträffarna sist.
    coalesce(
      coalesce(trim(p_fraga), '') <> ''
        and (coalesce(s.namn, '') ilike trim(p_fraga) || '%'
             or s.adress ilike trim(p_fraga) || '%'),
      false) desc,
    s.antal desc,
    s.senast desc nulls last
  limit greatest(1, least(p_antal, 20));
$function$;

grant execute on function public.hub_mottagare_forslag(text, integer) to authenticated;
