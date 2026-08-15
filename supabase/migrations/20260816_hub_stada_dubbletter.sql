-- Tre dubbletter som kostade skrivtid utan att ge något.

-- 1) Två identiska triggers på hub_message_bodies.
--
-- hub_sok_pa_kropp fanns redan och gör exakt samma sak som den
-- hub_sok_efter_brodtext som lades till 2026-08-15. Diagnosen då var delvis
-- fel: brödtexten NÅDDE indexet, det fanns en trigger för det. Det som
-- verkligen var trasigt var att <style>-innehåll indexerades som text, och att
-- rader vars kropp hämtades innan triggern fanns låg kvar med gammal
-- sökvektor — bägge åtgärdade av stripningen och backfillen i
-- 20260815_hub_sok_las_brodtexten_och_slapp_css.sql.
--
-- Två triggers innebar att varje hämtad brödtext skrev om samma rad i
-- hub_messages två gånger.
drop trigger if exists hub_sok_efter_brodtext on public.hub_message_bodies;
drop function if exists public.hub_sok_nar_brodtext_kommer();

-- 2) Identiska index på hub_events: bägge btree (user_id, starts_at).
--    Ett av dem underhölls i onödan vid varje skrivning.
drop index if exists public.hub_events_tid_idx;

-- 3) Gammalt sökindex som ingen fråga längre träffar.
--
-- Det låg på uttrycket to_tsvector(subject||from_name||from_email||snippet).
-- Sökningen går numera mot kolumnen sok, som har hub_messages_sok_kolumn_idx.
-- Ett GIN-index är dyrt att underhålla, och det här underhölls för ingenting.
drop index if exists public.hub_messages_sok_idx;
