-- Eget innehav på en bevakad post, så kortet kan visa plus eller minus.
--
-- kopt_kurs anges ALLTID i noteringens egen valuta — samma valuta som kortet
-- visar priset i. Ett XRP-köp gjort i kronor måste alltså skrivas om till
-- dollar, annars jämförs äpplen med päron och kortet ljuger utan att det
-- märks. Gränssnittet skriver ut valutan i fältetiketten just därför.
--
-- Alla tre är frivilliga och oberoende av varandra: bara datum ger "köpt den
-- 3 mars", datum och kurs ger procent, och med antal också blir det pengar.
alter table public.hub_stocks
  add column if not exists kopt_datum date,
  add column if not exists kopt_kurs numeric,
  add column if not exists kopt_antal numeric;

-- Noll som köpkurs skulle ge division med noll i procenträkningen, och ett
-- negativt antal är inget man kan äga. Båda spärras här i stället för att
-- lita på att gränssnittet håller ordning.
alter table public.hub_stocks drop constraint if exists hub_stocks_kurs_positiv;
alter table public.hub_stocks add constraint hub_stocks_kurs_positiv
  check (kopt_kurs is null or kopt_kurs > 0);

alter table public.hub_stocks drop constraint if exists hub_stocks_antal_positivt;
alter table public.hub_stocks add constraint hub_stocks_antal_positivt
  check (kopt_antal is null or kopt_antal > 0);
