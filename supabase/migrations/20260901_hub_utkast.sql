-- Påbörjade mejl som inte skickats.
--
-- I databasen och inte i webbläsaren, av två skäl: ett utkast överlever att
-- man byter dator, och det överlever att webbläsaren rensas. Samma princip
-- som resten av Hubben — databasen är sanningen.
--
-- svar_pa avgör VILKET utkast det är. null betyder det fristående nya mejlet;
-- pekar det på ett meddelande är det ett påbörjat svar på just det. Därför
-- kan man ha svar liggande i flera trådar samtidigt utan att de blandas.
--
-- Bilagor sparas INTE. De ligger som base64 i minnet och skulle blåsa upp
-- raden med megabyte per utkast. Den som stänger rutan med en bifogad fil får
-- bifoga om — texten är det som tar tid att skriva.
create table if not exists public.hub_utkast (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  svar_pa uuid references public.hub_messages(id) on delete cascade,
  konto_id uuid references public.hub_mail_accounts(id) on delete set null,
  lage text not null default 'nytt',
  till text,
  kopia text,
  hemlig text,
  amne text,
  text text,
  uppdaterad timestamptz not null default now(),
  constraint hub_utkast_lage check (lage in ('nytt', 'svar', 'svaraAlla', 'vidare'))
);

-- Ett utkast per sak. Ett vanligt unikt villkor duger inte: Postgres räknar
-- NULL som skilt från NULL, så (user_id, svar_pa) hade tillåtit hur många
-- fristående utkast som helst. Två partiella index i stället.
create unique index if not exists hub_utkast_nytt_idx
  on public.hub_utkast (user_id) where svar_pa is null;
create unique index if not exists hub_utkast_svar_idx
  on public.hub_utkast (user_id, svar_pa) where svar_pa is not null;

alter table public.hub_utkast enable row level security;
drop policy if exists owner_all on public.hub_utkast;
create policy owner_all on public.hub_utkast for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.hub_utkast to authenticated;

-- Sparar eller uppdaterar ett utkast, och raderar det när allt är tomt.
--
-- Att tomma utkast tas bort är själva poängen: annars ligger en tom rad kvar
-- så fort man öppnat rutan och ångrat sig, och nästa gång ser det ut som att
-- det finns något sparat när det inte gör det.
create or replace function public.hub_spara_utkast(
  p_svar_pa uuid, p_lage text, p_konto uuid,
  p_till text, p_kopia text, p_hemlig text, p_amne text, p_text text)
returns timestamptz
language plpgsql
security invoker
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tomt boolean;
  v_nu timestamptz := now();
begin
  -- Ämnet räknas inte som innehåll: ett svar får sitt ämne ifyllt av sig
  -- självt, och skulle annars spara ett utkast man aldrig börjat skriva.
  v_tomt := coalesce(trim(p_till), '') = ''
        and coalesce(trim(p_kopia), '') = ''
        and coalesce(trim(p_hemlig), '') = ''
        and coalesce(trim(p_text), '') = '';

  if v_tomt then
    delete from public.hub_utkast
     where user_id = auth.uid()
       and (svar_pa is not distinct from p_svar_pa);
    return null;
  end if;

  -- on conflict kan inte peka på ett partiellt index utan att villkoret
  -- upprepas, och det finns två olika. Enklare att göra det för hand.
  update public.hub_utkast
     set lage = p_lage, konto_id = p_konto, till = p_till, kopia = p_kopia,
         hemlig = p_hemlig, amne = p_amne, text = p_text, uppdaterad = v_nu
   where user_id = auth.uid() and (svar_pa is not distinct from p_svar_pa);

  if not found then
    insert into public.hub_utkast (user_id, svar_pa, lage, konto_id, till, kopia, hemlig, amne, text, uppdaterad)
    values (auth.uid(), p_svar_pa, p_lage, p_konto, p_till, p_kopia, p_hemlig, p_amne, p_text, v_nu);
  end if;

  return v_nu;
end $function$;

grant execute on function public.hub_spara_utkast(uuid, text, uuid, text, text, text, text, text) to authenticated;
