-- Flytt av en händelse mellan två Google-kalendrar.
--
-- Vart Per vill flytta händelsen. calendar_id fortsätter betyda VAR HÄNDELSEN
-- LIGGER HOS GOOGLE, precis som hub_messages.folder_id betyder var mejlet
-- ligger på servern. Skrevs calendar_id om direkt skulle nästa synk hitta
-- raden på fel plats och lägga in en dubblett i den gamla kalendern.
alter table public.hub_events
  add column if not exists pending_till_kalender uuid
    references public.hub_calendars(id) on delete set null;

comment on column public.hub_events.pending_till_kalender is
  'Onskad kalender tills calendar-push hunnit kora Googles events/move. NULL = ingen flytt pa gang.';
