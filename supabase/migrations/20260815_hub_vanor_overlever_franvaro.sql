-- Vanor som går att komma tillbaka till.
--
-- Sviten räknade obrutna DAGAR och struntade i target_per_week, trots att
-- kolumnen funnits hela tiden. Ett missat dygn nollade allt. Forskningen är
-- entydig: en missad dag påverkar inte vanebildningen — skadan är psykologisk
-- och orsakas av appar som nollställer. Sviten räknar nu veckor där målet
-- nåddes, vilket är det man faktiskt lovat sig själv.

-- Överhoppad är ett eget tillstånd, skilt från missad. "Jag valde bort det"
-- ska inte se ut som "jag glömde" i rutnätet.
alter table public.hub_habit_logs
  add column if not exists status text not null default 'klar';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hub_habit_logs_status_check'
  ) then
    alter table public.hub_habit_logs
      add constraint hub_habit_logs_status_check
      check (status in ('klar', 'overhoppad'));
  end if;
end $$;

comment on column public.hub_habit_logs.status is
  'klar = utfort, overhoppad = medvetet bortvalt. Missad dag har ingen rad alls.';

-- Semesterläge. Veckor som ligger helt inom pausen bryter inte sviten - de
-- hoppas over. Todoists vacation mode ar forebilden.
alter table public.hub_habits
  add column if not exists paused_from date,
  add column if not exists paused_to date;

comment on column public.hub_habits.paused_to is
  'Vanan ar pausad t.o.m. detta datum. Veckor helt inom pausen bryter inte sviten.';
