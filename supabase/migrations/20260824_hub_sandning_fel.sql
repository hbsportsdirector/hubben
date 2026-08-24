-- Ett mejl som inte gick iväg ska säga till, även om ingen står kvar och
-- tittar.
--
-- Svaret från mail-send var enda stället felet fanns, och det tar bara den
-- ruta som skickade emot. Stänger man skrivrutan medan sändningen pågår —
-- eller går till en annan sida — kommer svaret fram till ingen alls, och ett
-- mejl som aldrig lämnade servern ser skickat ut. Det märks först när
-- mottagaren säger att hen inte fått något.
--
-- Samma lösning som sent_kopia_fel bredvid: felet blir kvar på kontoraden
-- tills man kvitterat det, och Mail-sidan visar det så fort den öppnas.
alter table public.hub_mail_accounts
  add column if not exists sandning_fel text;

comment on column public.hub_mail_accounts.sandning_fel is
  'Senaste misslyckade sändningen: ämnet och serverns svar. Nollställs av nästa lyckade sändning eller när användaren kvitterar.';
