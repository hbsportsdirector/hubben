-- Andra försvarslinjen på de två funktioner som lämnar ut hemligheter.
--
-- Bägge är SECURITY DEFINER och läser klartext ur Vault: IMAP-lösenordet
-- respektive klienthemlighet och refresh-token. De gjorde ingen ägarkontroll
-- alls — enda spärren var att bara service_role har EXECUTE. Det håller i dag,
-- men det är en enda felaktig `grant execute ... to authenticated` från att
-- öppna hela valvet för vem som helst som kan gissa ett id.
--
-- Vakten slår till ENBART när det finns en inloggad användare. Under
-- service_role är auth.uid() null, så edge-funktionerna påverkas inte alls.
-- Det är med flit: en kontroll som kan sänka mejlsynken vore ett sämre byte
-- än den risk den skyddar mot. EXECUTE-listan är fortfarande primärspärren.
--
-- Verifierat efteråt: service_role-vägen fungerar oförändrat, och en
-- inloggad användare som frågar om någon annans konto nekas på bägge.

create or replace function public.hub_get_mail_secret(p_account_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'vault'
as $function$
declare
  v_secret uuid;
  v_varde text;
begin
  if auth.uid() is not null then
    if not exists (
      select 1 from public.hub_mail_accounts
      where id = p_account_id and user_id = auth.uid()
    ) then
      raise exception 'Åtkomst nekad';
    end if;
  end if;

  select secret_id into v_secret from public.hub_mail_accounts where id = p_account_id;
  if v_secret is null then return null; end if;
  select decrypted_secret into v_varde from vault.decrypted_secrets where id = v_secret;
  return v_varde;
end $function$;

create or replace function public.hub_hamta_oauth(p_user uuid, p_provider text)
returns table(client_id text, hemlighet text, refresh_token text)
language plpgsql
security definer
set search_path to 'public', 'vault'
as $function$
declare v_rad public.hub_oauth_klienter;
begin
  if auth.uid() is not null and p_user is distinct from auth.uid() then
    raise exception 'Åtkomst nekad';
  end if;

  select * into v_rad from public.hub_oauth_klienter
  where user_id = p_user and provider = p_provider;
  if not found then return; end if;
  return query
    select v_rad.client_id,
           (select decrypted_secret from vault.decrypted_secrets where id = v_rad.hemlighet_id),
           (select decrypted_secret from vault.decrypted_secrets where id = v_rad.token_id);
end $function$;
