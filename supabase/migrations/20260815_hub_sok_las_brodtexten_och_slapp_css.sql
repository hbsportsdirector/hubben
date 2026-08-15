-- Sökningen hittade ord man inte kunde se i mejlet, och missade ord som stod
-- mitt i brödtexten. Två buggar, båda åtgärdade här.

-- 1) Läsbar text ur ett mejl.
--
-- Den gamla stripningen körde bara '<[^>]*>', vilket tar bort SJÄLVA taggarna
-- men lämnar kvar det som står mellan dem. Innehållet i <style> är CSS, och
-- den hamnade rakt i sökindexet: klassnamn, mediefrågor och teckensnitt blev
-- sökbara ord. Ett marknadsföringsmejl har 25 000–160 000 tecken sådant.
--
-- style/script plockas därför bort med innehåll och allt, och så
-- HTML-kommentarer (Outlooks villkorliga kommentarer är fulla av skräp).
-- Ingen bakåtreferens och inga nästlade kvantifierare: mönstren ska vara
-- förutsägbart snabba även på ett 150 kB-mejl.
create or replace function public.hub_lasbar_text(p_text text, p_html text)
returns text
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $function$
  select coalesce(
    p_text,
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(left(coalesce(p_html, ''), 400000),
            '<style[^>]*>.*?</style[^>]*>', ' ', 'gi'),
          '<script[^>]*>.*?</script[^>]*>', ' ', 'gi'),
        '<!--.*?-->', ' ', 'g'),
      '<[^>]*>', ' ', 'g')
  );
$function$;

create or replace function public.hub_sokvektor(
  p_subject text, p_from_name text, p_from_email text, p_text text, p_html text)
returns tsvector
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $function$
  select setweight(to_tsvector('swedish', coalesce(p_subject, '')), 'A')
      || setweight(to_tsvector('swedish', coalesce(p_from_name, '') || ' ' || coalesce(p_from_email, '')), 'B')
      || setweight(to_tsvector('swedish', left(public.hub_lasbar_text(p_text, p_html), 200000)), 'C');
$function$;

-- 2) Brödtexten nådde aldrig indexet.
--
-- Triggern på hub_messages är BEFORE INSERT OR UPDATE OF subject, from_name,
-- from_email. Brödtexten hämtas EFTER att mejlraden skapats, och
-- snippet-uppdateringen rör ingen av de tre kolumnerna — så sok byggdes medan
-- hub_message_bodies fortfarande var tom. Brödtexten kom med bara om en senare
-- synk råkade skriva om ämnet. Vilka mejl som var sökbara i brödtexten var
-- alltså slumpen.
--
-- Ingen risk för evig runda: den här skriver sok och betalning, och triggern
-- på hub_messages lyssnar bara på subject/from_name/from_email.
create or replace function public.hub_sok_nar_brodtext_kommer()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  update public.hub_messages m
     set sok = public.hub_sokvektor(m.subject, m.from_name, m.from_email, new.text_body, new.html_body),
         betalning = public.hub_ar_betalning(m.subject, new.text_body, new.html_body)
   where m.id = new.msg_id;
  return new;
end $function$;

drop trigger if exists hub_sok_efter_brodtext on public.hub_message_bodies;
create trigger hub_sok_efter_brodtext
after insert or update of text_body, html_body on public.hub_message_bodies
for each row execute function public.hub_sok_nar_brodtext_kommer();

-- 3) sok-kolumnen saknade index. Frågan gick på sok, men det enda GIN-indexet
--    låg på ett HELT annat uttryck (subject||from||snippet), så varje sökning
--    var en full genomläsning.
create index if not exists hub_messages_sok_kolumn_idx
  on public.hub_messages using gin (sok);

-- Backfill: indexet är fel på varenda befintligt mejl tills det räknats om.
update public.hub_messages m
   set sok = public.hub_sokvektor(m.subject, m.from_name, m.from_email, b.text_body, b.html_body),
       betalning = public.hub_ar_betalning(m.subject, b.text_body, b.html_body)
  from public.hub_message_bodies b
 where b.msg_id = m.id;
