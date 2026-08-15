-- ═══════════════════════════════════════════════════════════════════════════
-- HUBBEN — DATABASSCHEMA (DOKUMENTATION)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Genererad: 2026-08-16
-- Supabase-projekt: abwmdhvaxqlpyzgvuedj
-- Omfattning: schemat `public`, enbart objekt vars namn börjar på `hub_`.
--
-- DEN HÄR FILEN ÄR INTE EN MIGRATION OCH SKA INTE KÖRAS.
-- Den är en läsbar avbild av hur databasen faktiskt ser ut, avsedd för
-- människor och AI-assistenter som behöver veta hur radsäkerheten fungerar
-- innan de skriver kod. Riktiga ändringar görs som vanligt via
-- supabase/migrations/ eller via MCP-verktyget apply_migration.
--
-- SÅ GENERERAR DU OM DEN:
--   Kör frågorna mot pg_catalog i samma ordning som avsnitten nedan
--   (pg_attribute + pg_description, pg_constraint, pg_indexes, pg_policies,
--   pg_get_functiondef, pg_get_triggerdef, pg_get_viewdef, cron.job) och
--   skriv om filen. Allt är sorterat alfabetiskt så att en omgenerering
--   ger minimal diff.
--
-- INGA DATA finns i filen — bara struktur.
-- INGA HEMLIGHETER hittades i några definitioner. Lösenord, klienthemligheter
-- och refresh-tokens ligger i Supabase Vault och nås enbart via de
-- SECURITY DEFINER-funktioner som listas i avsnitt 5. Projektets publika
-- functions-URL förekommer i cron-funktionerna men är inte hemlig.
--
-- SNABB SAMMANFATTNING
--   24 tabeller, 1 vy (hub_mejl), 25 funktioner (15 SECURITY DEFINER),
--   3 triggers, 26 RLS-policyer, 3 cron-jobb.
--
-- SÖKVEKTORN: `hub_sok_pa_kropp` på hub_message_bodies är DEN trigger som
-- håller hub_messages.sok och .betalning uppdaterade när brödtexten kommer
-- in från synken. Den kallar hub_uppdatera_sok_pa_kropp(). Behöver du röra
-- hur sökningen indexeras är det den vägen som gäller — leta inte efter
-- någon annan. (Det var oklart tidigare och ledde till att en identisk
-- dubblettrigger skapades av misstag; den är borttagen 2026-08-16.)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- LÄS DETTA FÖRST: SÅ FUNGERAR RADSÄKERHETEN I HUBBEN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hubben är enanvändarsystem. Varje tabell har user_id och RLS är påslagen
-- överallt. Men mönstret är INTE enhetligt — det finns två stilar:
--
--   A) `auth.uid() = user_id`                       (11 tabeller)
--   B) `user_id in (select hub_agare())`            (10 tabeller)
--
-- Båda betyder samma sak. hub_agare() är en STABLE SECURITY DEFINER-funktion
-- som bara returnerar auth.uid(); varianten med `in (select ...)` gör att
-- Postgres beräknar värdet en gång per fråga i stället för en gång per rad.
-- Det är alltså en prestandaoptimering, inte en säkerhetsskillnad.
--
-- VIKTIGT ATT VETA INNAN DU SKRIVER KOD:
--
--   * Mejltabellerna är LÄSBARA men inte SKRIVBARA från klienten.
--     hub_messages och hub_folders har bara SELECT + UPDATE. hub_attachments,
--     hub_message_bodies och hub_mail_accounts har bara SELECT.
--     INSERT och DELETE saknar policy helt = nekas för authenticated.
--     All inmatning av mejl sker via edge functions med service_role.
--     Vill du skapa ett mejlkonto från appen fungerar det INTE med ett
--     vanligt insert — det måste gå via en edge function.
--
--   * hub_cron_nyckel har RLS på men NOLL policyer. Tabellen är helt
--     oåtkomlig för anon och authenticated. Bara service_role/postgres
--     kommer åt cron-nyckeln. Det är avsiktligt och ska förbli så.
--
--   * Tre policyer är skrivna för rollen `public` i stället för
--     `authenticated`: hub_calendars, hub_oauth_klienter och
--     hub_pending_ops. Det betyder att policyn även utvärderas för anon.
--     I praktiken läcker ingenting, eftersom auth.uid() är NULL för anon
--     och `user_id = NULL` aldrig är sant — men det är en avvikelse från
--     mönstret och bör städas om någon rör dem.
--
--   * Vyn hub_mejl har `security_invoker=on`. Den ärver alltså anroparens
--     RLS från hub_messages och hub_folders i stället för att köra som
--     vyägaren postgres. Om den flaggan någonsin försvinner blir vyn en
--     förbikoppling av radsäkerheten för hela mejlarkivet.
--
--   * hub_message_bodies har ingen egen user_id. Dess policy går via en
--     EXISTS mot hub_messages. Kropparna är alltså exakt så skyddade som
--     mejlraden de hänger på.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TABELLER
-- ═══════════════════════════════════════════════════════════════════════════
-- Ingen av tabellerna har en tabellkommentar. Kolumnkommentarer som finns i
-- pg_description återges som `--` på kolumnens egen rad.


create table hub_attachments (
  id            uuid        not null default gen_random_uuid(),
  user_id       uuid        not null,
  msg_id        uuid        not null,
  part_id       text        not null,
  filename      text        not null default 'bilaga',
  content_type  text        not null default 'application/octet-stream',
  size_bytes    integer     null,
  inline        boolean     not null default false,
  content_id    text        null,
  created_at    timestamptz not null default now()
);


create table hub_avsandare (
  id        uuid        not null default gen_random_uuid(),
  user_id   uuid        not null,
  epost     text        null,
  doman     text        null,
  beslut    text        not null,
  beslutad  timestamptz not null default now()
);
-- Exakt en av epost/doman måste vara satt (se check-villkoret i avsnitt 2).
-- beslut: 'in' = släpp in i inkorgen, 'ut' = gallra bort.


create table hub_budgets (
  id            uuid          not null default gen_random_uuid(),
  user_id       uuid          not null,
  category      text          not null,
  monthly_limit numeric(12,2) not null
);


create table hub_calendars (
  id             uuid        not null default gen_random_uuid(),
  user_id        uuid        not null,
  provider       text        not null default 'microsoft',
  external_id    text        not null,
  namn           text        not null,
  color          text        not null default '#6366f1',
  aktiv          boolean     not null default true,
  delta_link     text        null,
  fonster_fran   timestamptz null,
  fonster_till   timestamptz null,
  senast_synkad  timestamptz null,
  sista_fel      text        null,
  skapad         timestamptz not null default now(),
  synlig         boolean     not null default true,
  tidszon        text        not null default 'Europe/Stockholm'
);


create table hub_cron_nyckel (
  id      boolean     not null default true,
  nyckel  text        not null default encode(gen_random_bytes(32), 'hex'),
  skapad  timestamptz not null default now()
);
-- Singleton: id är boolean med check(id), så tabellen rymmer exakt en rad.
-- Nyckeln skickas som x-hub-cron-huvud till edge functions. RLS är på och
-- tabellen saknar policyer helt — oåtkomlig utanför service_role.


create table hub_events (
  id                    uuid        not null default gen_random_uuid(),
  user_id               uuid        not null,
  title                 text        not null,
  description           text        null,
  location              text        null,
  starts_at             timestamptz not null,
  ends_at               timestamptz null,
  all_day               boolean     not null default false,
  color                 text        not null default '#38bdf8',
  created_at            timestamptz not null default now(),
  calendar_id           uuid        null,
  external_id           text        null,
  etag                  text        null,
  series_master_id      text        null,
  organizer             text        null,
  installd              boolean     not null default false,
  pending_op            text        null,
  pending_forsok        integer     not null default 0,
  pending_fel           text        null,
  pending_nasta         timestamptz null,
  rrule                 text        null,
  pending_scope         text        null,
  pending_till_kalender uuid        null
    -- Onskad kalender tills calendar-push hunnit kora Googles events/move.
    -- NULL = ingen flytt pa gang.
);


create table hub_folders (
  id             uuid        not null default gen_random_uuid(),
  user_id        uuid        not null,
  account_id     uuid        not null,
  path           text        not null,
  name           text        not null,
  role           text        null,
  uidvalidity    bigint      null,
  last_uid       bigint      not null default 0,
  highestmodseq  bigint      null,
  total_count    integer     null,
  unseen_count   integer     null,
  last_synced_at timestamptz null,
  hidden         boolean     not null default false
);
-- role är IMAP-rollen: 'inbox', 'sent', 'trash', 'drafts', 'archive' m.fl.
-- Den används av hub_flytta() för att hitta rätt målmapp per konto.


create table hub_goals (
  id          uuid        not null default gen_random_uuid(),
  user_id     uuid        not null,
  title       text        not null,
  description text        null,
  target_date date        null,
  progress    integer     not null default 0,
  created_at  timestamptz not null default now()
);


create table hub_habit_logs (
  id        uuid not null default gen_random_uuid(),
  habit_id  uuid not null,
  user_id   uuid not null,
  log_date  date not null default CURRENT_DATE,
  status    text not null default 'klar'
    -- klar = utfort, overhoppad = medvetet bortvalt.
    -- Missad dag har ingen rad alls.
);


create table hub_habits (
  id              uuid        not null default gen_random_uuid(),
  user_id         uuid        not null,
  name            text        not null,
  emoji           text        not null default '✅',
  color           text        not null default '#22c55e',
  target_per_week smallint    not null default 7,
  archived        boolean     not null default false,
  created_at      timestamptz not null default now(),
  paused_from     date        null,
  paused_to       date        null
    -- Vanan ar pausad t.o.m. detta datum.
    -- Veckor helt inom pausen bryter inte sviten.
);


create table hub_links (
  id         uuid        not null default gen_random_uuid(),
  user_id    uuid        not null,
  title      text        not null,
  url        text        not null,
  category   text        not null default 'Övrigt',
  created_at timestamptz not null default now()
);


create table hub_mail_accounts (
  id               uuid             not null default gen_random_uuid(),
  user_id          uuid             not null,
  email            text             not null,
  label            text             not null default '',
  provider         text             not null,
  imap_host        text             null,
  imap_port        integer          not null default 993,
  smtp_host        text             null,
  smtp_port        integer          not null default 465,
  color            text             not null default '#6366f1',
  active           boolean          not null default true,
  secret_id        uuid             null,
  last_checked_at  timestamptz      null,
  last_error       text             null,
  sort_order       double precision not null default 0,
  created_at       timestamptz      not null default now(),
  signature        text             not null default '',
    -- Signatur som läggs till automatiskt vid sändning från detta konto.
  sent_kopia_fel   text             null,
  gallring_mapp_id uuid             null
);
-- secret_id pekar in i vault.secrets. Själva lösenordet nås bara via
-- hub_get_mail_secret() / hub_set_mail_secret() (SECURITY DEFINER).


create table hub_message_bodies (
  msg_id        uuid        not null,
  text_body     text        null,
  html_body     text        null,
  fetched_at    timestamptz not null default now(),
  bilagor_lasta boolean     not null default false
);
-- bilagor_lasta = false betyder att kroppen hämtades av en äldre version
-- som inte kartlade bilagorna; hub_messages_utan_kropp() plockar upp dem igen.


create table hub_messages (
  id                    uuid        not null default gen_random_uuid(),
  user_id               uuid        not null,
  account_id            uuid        not null,
  folder_id             uuid        not null,
  uid                   bigint      not null,
  rfc_message_id        text        null,
  in_reply_to           text        null,
  references_ids        text[]      null,
  thread_key            text        null,
  from_name             text        null,
  from_email            text        null,
  to_emails             text[]      not null default '{}',
  cc_emails             text[]      not null default '{}',
  subject               text        not null default '',
  snippet               text        not null default '',
  sent_at               timestamptz null,
  seen                  boolean     not null default false,
  flagged               boolean     not null default false,
  answered              boolean     not null default false,
  draft                 boolean     not null default false,
  has_attachments       boolean     not null default false,
  size_bytes            integer     null,
  modseq                bigint      null,
  synced_at             timestamptz not null default now(),
  reply_later           boolean     not null default false,
  reply_later_at        timestamptz null,
  bubble_up_at          timestamptz null,
  bubble_up_if_no_reply boolean     not null default false,
  destination           text        not null default 'imbox',
  pending_folder_id     uuid        null,
  sok                   tsvector    null,
  betalning             boolean     not null default false
);
-- folder_id = var mejlet FAKTISKT ligger på servern.
-- pending_folder_id = dit användaren flyttat det i appen, innan IMAP-kön
-- hunnit ikapp. Vyn hub_mejl visar coalesce(pending_folder_id, folder_id).
-- sok och betalning fylls automatiskt av triggers (avsnitt 6).


create table hub_notes (
  id         uuid        not null default gen_random_uuid(),
  user_id    uuid        not null,
  title      text        not null default '',
  content    text        not null default '',
  pinned     boolean     not null default false,
  tags       text[]      not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- OBS: updated_at har ingen trigger — den måste sättas av klienten.


create table hub_oauth_klienter (
  id           uuid        not null default gen_random_uuid(),
  user_id      uuid        not null,
  provider     text        not null,
  client_id    text        null,
  hemlighet_id uuid        null,
  token_id     uuid        null,
  konto        text        null,
  ansluten_vid timestamptz null,
  sista_fel    text        null,
  skapad       timestamptz not null default now()
);
-- hemlighet_id och token_id pekar in i vault.secrets. Klienten kan skriva
-- raden men får aldrig läsa hemligheterna — det går bara via
-- hub_hamta_oauth() som enbart service_role har EXECUTE på.


create table hub_pending_ops (
  id             uuid        not null default gen_random_uuid(),
  user_id        uuid        not null,
  msg_id         uuid        not null,
  fran_folder_id uuid        not null,
  fran_uid       bigint      not null,
  till_folder_id uuid        not null,
  forsok         integer     not null default 0,
  sista_fel      text        null,
  nasta_forsok   timestamptz not null default now(),
  skapad         timestamptz not null default now()
);
-- Kö för IMAP-flyttar. fran_* pekar alltid på var mejlet ligger på servern,
-- även om samma mejl flyttas två gånger innan kön betats av.


create table hub_projects (
  id         uuid        not null default gen_random_uuid(),
  user_id    uuid        not null,
  name       text        not null,
  color      text        not null default '#6366f1',
  created_at timestamptz not null default now()
);


create table hub_savings_goals (
  id             uuid          not null default gen_random_uuid(),
  user_id        uuid          not null,
  name           text          not null,
  target_amount  numeric(12,2) not null,
  current_amount numeric(12,2) not null default 0,
  deadline       date          null,
  created_at     timestamptz   not null default now()
);


create table hub_stocks (
  id         uuid             not null default gen_random_uuid(),
  user_id    uuid             not null,
  symbol     text             not null,
  label      text             null,
  sort_order double precision not null default 0,
  created_at timestamptz      not null default now()
);


create table hub_tasks (
  id             uuid             not null default gen_random_uuid(),
  user_id        uuid             not null,
  project_id     uuid             null,
  title          text             not null,
  notes          text             null,
  priority       smallint         not null default 2,
  due_date       date             null,
  done           boolean          not null default false,
  completed_at   timestamptz      null,
  sort_order     double precision not null default 0,
  created_at     timestamptz      not null default now(),
  mail_msg_id    uuid             null,
  mail_avsandare text             null
);
-- mail_msg_id kopplar en uppgift till mejlet den skapades ur.
-- mail_avsandare sparas separat så texten överlever om mejlet försvinner.


create table hub_transactions (
  id          uuid          not null default gen_random_uuid(),
  user_id     uuid          not null,
  kind        text          not null,
  amount      numeric(12,2) not null,
  category    text          not null default 'Övrigt',
  description text          null,
  tx_date     date          not null default CURRENT_DATE,
  created_at  timestamptz   not null default now()
);


create table hub_weekly_reviews (
  id           uuid        not null default gen_random_uuid(),
  user_id      uuid        not null,
  week_start   date        not null,
  focus        text        not null default '',
  priorities   text[]      not null default '{}',
  wins         text        not null default '',
  carried_over text        not null default '',
  completed_at timestamptz null,
  created_at   timestamptz not null default now()
);


create table hub_workouts (
  id           uuid        not null default gen_random_uuid(),
  user_id      uuid        not null,
  workout_date date        not null default CURRENT_DATE,
  kind         text        not null default 'Handboll',
  duration_min integer     not null,
  intensity    smallint    not null default 3,
  notes        text        null,
  created_at   timestamptz not null default now()
);


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. NYCKLAR OCH VILLKOR
-- ═══════════════════════════════════════════════════════════════════════════
-- Alla främmande nycklar mot auth.users(id) är ON DELETE CASCADE — raderas
-- kontot försvinner allt. Undantagen där raden ska överleva sin förälder är
-- markerade ON DELETE SET NULL.

-- hub_attachments
alter table hub_attachments add constraint hub_attachments_pkey                PRIMARY KEY (id);
alter table hub_attachments add constraint hub_attachments_msg_id_part_id_key  UNIQUE (msg_id, part_id);
alter table hub_attachments add constraint hub_attachments_msg_id_fkey         FOREIGN KEY (msg_id) REFERENCES hub_messages(id) ON DELETE CASCADE;
alter table hub_attachments add constraint hub_attachments_user_id_fkey        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_avsandare
alter table hub_avsandare add constraint hub_avsandare_pkey          PRIMARY KEY (id);
alter table hub_avsandare add constraint hub_avsandare_beslut_check  CHECK (beslut = ANY (ARRAY['in'::text, 'ut'::text]));
alter table hub_avsandare add constraint hub_avsandare_check         CHECK (num_nonnulls(epost, doman) = 1);
alter table hub_avsandare add constraint hub_avsandare_user_id_fkey  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_budgets
alter table hub_budgets add constraint hub_budgets_pkey                  PRIMARY KEY (id);
alter table hub_budgets add constraint hub_budgets_user_id_category_key  UNIQUE (user_id, category);
alter table hub_budgets add constraint hub_budgets_monthly_limit_check   CHECK (monthly_limit >= 0::numeric);
alter table hub_budgets add constraint hub_budgets_user_id_fkey          FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_calendars
alter table hub_calendars add constraint hub_calendars_pkey                            PRIMARY KEY (id);
alter table hub_calendars add constraint hub_calendars_user_id_provider_external_id_key UNIQUE (user_id, provider, external_id);
alter table hub_calendars add constraint hub_calendars_user_id_fkey                    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_cron_nyckel
alter table hub_cron_nyckel add constraint hub_cron_nyckel_pkey      PRIMARY KEY (id);
alter table hub_cron_nyckel add constraint hub_cron_nyckel_id_check  CHECK (id);   -- singleton: bara raden med id = true tillåts

-- hub_events
alter table hub_events add constraint hub_events_pkey                        PRIMARY KEY (id);
alter table hub_events add constraint hub_events_pending_op_check            CHECK (pending_op = ANY (ARRAY['skapa'::text, 'andra'::text, 'radera'::text]));
alter table hub_events add constraint hub_events_pending_scope_check         CHECK (pending_scope = ANY (ARRAY['instans'::text, 'serie'::text]));
alter table hub_events add constraint hub_events_calendar_id_fkey            FOREIGN KEY (calendar_id) REFERENCES hub_calendars(id) ON DELETE CASCADE;
alter table hub_events add constraint hub_events_pending_till_kalender_fkey  FOREIGN KEY (pending_till_kalender) REFERENCES hub_calendars(id) ON DELETE SET NULL;
alter table hub_events add constraint hub_events_user_id_fkey                FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_folders
alter table hub_folders add constraint hub_folders_pkey                 PRIMARY KEY (id);
alter table hub_folders add constraint hub_folders_account_id_path_key  UNIQUE (account_id, path);
alter table hub_folders add constraint hub_folders_account_id_fkey      FOREIGN KEY (account_id) REFERENCES hub_mail_accounts(id) ON DELETE CASCADE;
alter table hub_folders add constraint hub_folders_user_id_fkey         FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_goals
alter table hub_goals add constraint hub_goals_pkey            PRIMARY KEY (id);
alter table hub_goals add constraint hub_goals_progress_check  CHECK (progress >= 0 AND progress <= 100);
alter table hub_goals add constraint hub_goals_user_id_fkey    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_habit_logs
alter table hub_habit_logs add constraint hub_habit_logs_pkey                   PRIMARY KEY (id);
alter table hub_habit_logs add constraint hub_habit_logs_habit_id_log_date_key  UNIQUE (habit_id, log_date);
alter table hub_habit_logs add constraint hub_habit_logs_status_check           CHECK (status = ANY (ARRAY['klar'::text, 'overhoppad'::text]));
alter table hub_habit_logs add constraint hub_habit_logs_habit_id_fkey          FOREIGN KEY (habit_id) REFERENCES hub_habits(id) ON DELETE CASCADE;
alter table hub_habit_logs add constraint hub_habit_logs_user_id_fkey           FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_habits
alter table hub_habits add constraint hub_habits_pkey                   PRIMARY KEY (id);
alter table hub_habits add constraint hub_habits_target_per_week_check  CHECK (target_per_week >= 1 AND target_per_week <= 7);
alter table hub_habits add constraint hub_habits_user_id_fkey           FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_links
alter table hub_links add constraint hub_links_pkey          PRIMARY KEY (id);
alter table hub_links add constraint hub_links_user_id_fkey  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_mail_accounts
alter table hub_mail_accounts add constraint hub_mail_accounts_pkey                PRIMARY KEY (id);
alter table hub_mail_accounts add constraint hub_mail_accounts_user_id_email_key   UNIQUE (user_id, email);
alter table hub_mail_accounts add constraint hub_mail_accounts_provider_check      CHECK (provider = ANY (ARRAY['imap'::text, 'gmail'::text, 'outlook'::text]));
alter table hub_mail_accounts add constraint hub_mail_accounts_user_id_fkey        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
-- OBS: gallring_mapp_id har INGEN främmande nyckel mot hub_folders.

-- hub_message_bodies
alter table hub_message_bodies add constraint hub_message_bodies_pkey         PRIMARY KEY (msg_id);
alter table hub_message_bodies add constraint hub_message_bodies_msg_id_fkey  FOREIGN KEY (msg_id) REFERENCES hub_messages(id) ON DELETE CASCADE;

-- hub_messages
alter table hub_messages add constraint hub_messages_pkey                   PRIMARY KEY (id);
alter table hub_messages add constraint hub_messages_folder_id_uid_key      UNIQUE (folder_id, uid);
alter table hub_messages add constraint hub_messages_destination_check      CHECK (destination = ANY (ARRAY['imbox'::text, 'feed'::text, 'papertrail'::text]));
alter table hub_messages add constraint hub_messages_account_id_fkey        FOREIGN KEY (account_id) REFERENCES hub_mail_accounts(id) ON DELETE CASCADE;
alter table hub_messages add constraint hub_messages_folder_id_fkey         FOREIGN KEY (folder_id) REFERENCES hub_folders(id) ON DELETE CASCADE;
alter table hub_messages add constraint hub_messages_pending_folder_id_fkey FOREIGN KEY (pending_folder_id) REFERENCES hub_folders(id) ON DELETE SET NULL;
alter table hub_messages add constraint hub_messages_user_id_fkey           FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_notes
alter table hub_notes add constraint hub_notes_pkey          PRIMARY KEY (id);
alter table hub_notes add constraint hub_notes_user_id_fkey  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_oauth_klienter
alter table hub_oauth_klienter add constraint hub_oauth_klienter_pkey                  PRIMARY KEY (id);
alter table hub_oauth_klienter add constraint hub_oauth_klienter_user_id_provider_key  UNIQUE (user_id, provider);
alter table hub_oauth_klienter add constraint hub_oauth_klienter_user_id_fkey          FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_pending_ops
alter table hub_pending_ops add constraint hub_pending_ops_pkey                PRIMARY KEY (id);
alter table hub_pending_ops add constraint hub_pending_ops_msg_id_key          UNIQUE (msg_id);   -- ett mejl kan bara ha en väntande flytt
alter table hub_pending_ops add constraint hub_pending_ops_fran_folder_id_fkey FOREIGN KEY (fran_folder_id) REFERENCES hub_folders(id) ON DELETE CASCADE;
alter table hub_pending_ops add constraint hub_pending_ops_msg_id_fkey         FOREIGN KEY (msg_id) REFERENCES hub_messages(id) ON DELETE CASCADE;
alter table hub_pending_ops add constraint hub_pending_ops_till_folder_id_fkey FOREIGN KEY (till_folder_id) REFERENCES hub_folders(id) ON DELETE CASCADE;
alter table hub_pending_ops add constraint hub_pending_ops_user_id_fkey        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_projects
alter table hub_projects add constraint hub_projects_pkey          PRIMARY KEY (id);
alter table hub_projects add constraint hub_projects_user_id_fkey  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_savings_goals
alter table hub_savings_goals add constraint hub_savings_goals_pkey                 PRIMARY KEY (id);
alter table hub_savings_goals add constraint hub_savings_goals_target_amount_check  CHECK (target_amount > 0::numeric);
alter table hub_savings_goals add constraint hub_savings_goals_user_id_fkey         FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_stocks
alter table hub_stocks add constraint hub_stocks_pkey                PRIMARY KEY (id);
alter table hub_stocks add constraint hub_stocks_user_id_symbol_key  UNIQUE (user_id, symbol);
alter table hub_stocks add constraint hub_stocks_user_id_fkey        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_tasks
alter table hub_tasks add constraint hub_tasks_pkey            PRIMARY KEY (id);
alter table hub_tasks add constraint hub_tasks_priority_check  CHECK (priority >= 1 AND priority <= 3);
alter table hub_tasks add constraint hub_tasks_mail_msg_id_fkey FOREIGN KEY (mail_msg_id) REFERENCES hub_messages(id) ON DELETE SET NULL;
alter table hub_tasks add constraint hub_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES hub_projects(id) ON DELETE SET NULL;
alter table hub_tasks add constraint hub_tasks_user_id_fkey    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_transactions
alter table hub_transactions add constraint hub_transactions_pkey          PRIMARY KEY (id);
alter table hub_transactions add constraint hub_transactions_amount_check  CHECK (amount > 0::numeric);
alter table hub_transactions add constraint hub_transactions_kind_check    CHECK (kind = ANY (ARRAY['income'::text, 'expense'::text]));
alter table hub_transactions add constraint hub_transactions_user_id_fkey  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_weekly_reviews
alter table hub_weekly_reviews add constraint hub_weekly_reviews_pkey                    PRIMARY KEY (id);
alter table hub_weekly_reviews add constraint hub_weekly_reviews_user_id_week_start_key  UNIQUE (user_id, week_start);
alter table hub_weekly_reviews add constraint hub_weekly_reviews_user_id_fkey            FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- hub_workouts
alter table hub_workouts add constraint hub_workouts_pkey                PRIMARY KEY (id);
alter table hub_workouts add constraint hub_workouts_duration_min_check  CHECK (duration_min > 0);
alter table hub_workouts add constraint hub_workouts_intensity_check     CHECK (intensity >= 1 AND intensity <= 5);
alter table hub_workouts add constraint hub_workouts_user_id_fkey        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. INDEX
-- ═══════════════════════════════════════════════════════════════════════════
-- Index som backar en primärnyckel eller ett unique-villkor skapas
-- automatiskt av villkoret i avsnitt 2 och listas här för fullständighet.

-- hub_attachments
CREATE UNIQUE INDEX hub_attachments_msg_id_part_id_key ON public.hub_attachments USING btree (msg_id, part_id);
CREATE INDEX hub_attachments_msg_idx ON public.hub_attachments USING btree (msg_id);
CREATE UNIQUE INDEX hub_attachments_pkey ON public.hub_attachments USING btree (id);

-- hub_avsandare
CREATE UNIQUE INDEX hub_avsandare_doman_unik ON public.hub_avsandare USING btree (user_id, doman) WHERE (doman IS NOT NULL);
CREATE UNIQUE INDEX hub_avsandare_epost_unik ON public.hub_avsandare USING btree (user_id, epost) WHERE (epost IS NOT NULL);
CREATE UNIQUE INDEX hub_avsandare_pkey ON public.hub_avsandare USING btree (id);

-- hub_budgets
CREATE UNIQUE INDEX hub_budgets_pkey ON public.hub_budgets USING btree (id);
CREATE UNIQUE INDEX hub_budgets_user_id_category_key ON public.hub_budgets USING btree (user_id, category);
CREATE INDEX hub_budgets_user_idx ON public.hub_budgets USING btree (user_id);

-- hub_calendars
CREATE UNIQUE INDEX hub_calendars_pkey ON public.hub_calendars USING btree (id);
CREATE UNIQUE INDEX hub_calendars_user_id_provider_external_id_key ON public.hub_calendars USING btree (user_id, provider, external_id);

-- hub_cron_nyckel
CREATE UNIQUE INDEX hub_cron_nyckel_pkey ON public.hub_cron_nyckel USING btree (id);

-- hub_events
CREATE UNIQUE INDEX hub_events_extern_idx ON public.hub_events USING btree (calendar_id, external_id);
CREATE INDEX hub_events_ko_idx ON public.hub_events USING btree (pending_nasta) WHERE (pending_op IS NOT NULL);
CREATE UNIQUE INDEX hub_events_pkey ON public.hub_events USING btree (id);
CREATE INDEX hub_events_user_idx ON public.hub_events USING btree (user_id, starts_at);

-- hub_folders
CREATE UNIQUE INDEX hub_folders_account_id_path_key ON public.hub_folders USING btree (account_id, path);
CREATE UNIQUE INDEX hub_folders_pkey ON public.hub_folders USING btree (id);
CREATE INDEX hub_folders_user_idx ON public.hub_folders USING btree (user_id, account_id);

-- hub_goals
CREATE UNIQUE INDEX hub_goals_pkey ON public.hub_goals USING btree (id);
CREATE INDEX hub_goals_user_idx ON public.hub_goals USING btree (user_id);

-- hub_habit_logs
CREATE UNIQUE INDEX hub_habit_logs_habit_id_log_date_key ON public.hub_habit_logs USING btree (habit_id, log_date);
CREATE UNIQUE INDEX hub_habit_logs_pkey ON public.hub_habit_logs USING btree (id);
CREATE INDEX hub_habit_logs_user_idx ON public.hub_habit_logs USING btree (user_id, log_date);

-- hub_habits
CREATE UNIQUE INDEX hub_habits_pkey ON public.hub_habits USING btree (id);
CREATE INDEX hub_habits_user_idx ON public.hub_habits USING btree (user_id);

-- hub_links
CREATE UNIQUE INDEX hub_links_pkey ON public.hub_links USING btree (id);
CREATE INDEX hub_links_user_idx ON public.hub_links USING btree (user_id);

-- hub_mail_accounts
CREATE UNIQUE INDEX hub_mail_accounts_pkey ON public.hub_mail_accounts USING btree (id);
CREATE UNIQUE INDEX hub_mail_accounts_user_id_email_key ON public.hub_mail_accounts USING btree (user_id, email);
CREATE INDEX hub_mail_accounts_user_idx ON public.hub_mail_accounts USING btree (user_id);

-- hub_message_bodies
CREATE UNIQUE INDEX hub_message_bodies_pkey ON public.hub_message_bodies USING btree (msg_id);

-- hub_messages
CREATE INDEX hub_messages_avsandare_idx ON public.hub_messages USING btree (user_id, from_email);
CREATE INDEX hub_messages_betalning_idx ON public.hub_messages USING btree (user_id, betalning) WHERE betalning;
CREATE INDEX hub_messages_bubble_idx ON public.hub_messages USING btree (user_id, bubble_up_at) WHERE (bubble_up_at IS NOT NULL);
CREATE INDEX hub_messages_dest_idx ON public.hub_messages USING btree (user_id, destination, sent_at DESC);
CREATE UNIQUE INDEX hub_messages_folder_id_uid_key ON public.hub_messages USING btree (folder_id, uid);
CREATE INDEX hub_messages_lista_idx ON public.hub_messages USING btree (user_id, folder_id, sent_at DESC);
CREATE INDEX hub_messages_olasta_idx ON public.hub_messages USING btree (user_id, seen) WHERE (NOT seen);
CREATE INDEX hub_messages_pending_idx ON public.hub_messages USING btree (pending_folder_id) WHERE (pending_folder_id IS NOT NULL);
CREATE UNIQUE INDEX hub_messages_pkey ON public.hub_messages USING btree (id);
CREATE INDEX hub_messages_reply_later_idx ON public.hub_messages USING btree (user_id, reply_later_at DESC) WHERE reply_later;
CREATE INDEX hub_messages_sok_kolumn_idx ON public.hub_messages USING gin (sok);
CREATE INDEX hub_messages_trad_idx ON public.hub_messages USING btree (user_id, thread_key);
-- hub_messages_sok_kolumn_idx är det index sökningen använder. Det täcker
-- kolumnen sok, som inkluderar brödtexten. Det gamla uttrycksindexet
-- hub_messages_sok_idx (bara rubrik + avsändare + snippet) togs bort
-- 2026-08-16.

-- hub_notes
CREATE UNIQUE INDEX hub_notes_pkey ON public.hub_notes USING btree (id);
CREATE INDEX hub_notes_user_idx ON public.hub_notes USING btree (user_id);

-- hub_oauth_klienter
CREATE UNIQUE INDEX hub_oauth_klienter_pkey ON public.hub_oauth_klienter USING btree (id);
CREATE UNIQUE INDEX hub_oauth_klienter_user_id_provider_key ON public.hub_oauth_klienter USING btree (user_id, provider);

-- hub_pending_ops
CREATE INDEX hub_pending_ops_ko_idx ON public.hub_pending_ops USING btree (nasta_forsok, skapad);
CREATE UNIQUE INDEX hub_pending_ops_msg_id_key ON public.hub_pending_ops USING btree (msg_id);
CREATE UNIQUE INDEX hub_pending_ops_pkey ON public.hub_pending_ops USING btree (id);

-- hub_projects
CREATE UNIQUE INDEX hub_projects_pkey ON public.hub_projects USING btree (id);
CREATE INDEX hub_projects_user_idx ON public.hub_projects USING btree (user_id);

-- hub_savings_goals
CREATE UNIQUE INDEX hub_savings_goals_pkey ON public.hub_savings_goals USING btree (id);
CREATE INDEX hub_savings_goals_user_idx ON public.hub_savings_goals USING btree (user_id);

-- hub_stocks
CREATE UNIQUE INDEX hub_stocks_pkey ON public.hub_stocks USING btree (id);
CREATE UNIQUE INDEX hub_stocks_user_id_symbol_key ON public.hub_stocks USING btree (user_id, symbol);
CREATE INDEX hub_stocks_user_idx ON public.hub_stocks USING btree (user_id);

-- hub_tasks
CREATE INDEX hub_tasks_mail_idx ON public.hub_tasks USING btree (mail_msg_id) WHERE (mail_msg_id IS NOT NULL);
CREATE UNIQUE INDEX hub_tasks_pkey ON public.hub_tasks USING btree (id);
CREATE INDEX hub_tasks_user_idx ON public.hub_tasks USING btree (user_id);

-- hub_transactions
CREATE UNIQUE INDEX hub_transactions_pkey ON public.hub_transactions USING btree (id);
CREATE INDEX hub_transactions_user_idx ON public.hub_transactions USING btree (user_id, tx_date);

-- hub_weekly_reviews
CREATE UNIQUE INDEX hub_weekly_reviews_pkey ON public.hub_weekly_reviews USING btree (id);
CREATE UNIQUE INDEX hub_weekly_reviews_user_id_week_start_key ON public.hub_weekly_reviews USING btree (user_id, week_start);
CREATE INDEX hub_weekly_reviews_user_idx ON public.hub_weekly_reviews USING btree (user_id, week_start);
-- OBS: hub_weekly_reviews_user_idx dubblerar unique-indexet ovan.

-- hub_workouts
CREATE UNIQUE INDEX hub_workouts_pkey ON public.hub_workouts USING btree (id);
CREATE INDEX hub_workouts_user_idx ON public.hub_workouts USING btree (user_id, workout_date);


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. RADSÄKERHET (RLS)
-- ═══════════════════════════════════════════════════════════════════════════
-- RLS är PÅSLAGEN på samtliga 24 hub_-tabeller.
-- Alla policyer nedan är PERMISSIVE. Saknas ett kommando för en tabell
-- (t.ex. INSERT på hub_messages) betyder det att kommandot NEKAS för den
-- rollen — bara service_role, som går förbi RLS, kommer igenom.

-- hub_attachments  — RLS: på
create policy owner_select on hub_attachments for select to authenticated
  using (user_id in (select hub_agare()));
-- Ingen INSERT/UPDATE/DELETE. Bilagor skrivs bara av edge functions.

-- hub_avsandare  — RLS: på
create policy owner_all on hub_avsandare for all to authenticated
  using      (user_id in (select hub_agare()))
  with check (user_id in (select hub_agare()));

-- hub_budgets  — RLS: på
create policy owner_all on hub_budgets for all to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- hub_calendars  — RLS: på
create policy "egna kalendrar" on hub_calendars for all to public
  using      (user_id in (select hub_agare()))
  with check (user_id in (select hub_agare()));
-- AVVIKELSE: rollen är `public`, inte `authenticated`. Se noten högst upp.

-- hub_cron_nyckel  — RLS: på, INGA POLICYER.
-- Tabellen är helt stängd för anon och authenticated. Avsiktligt: den
-- innehåller den delade hemligheten som cron använder mot edge functions.

-- hub_events  — RLS: på
create policy owner_all on hub_events for all to authenticated
  using      (user_id in (select hub_agare()))
  with check (user_id in (select hub_agare()));

-- hub_folders  — RLS: på
create policy owner_select on hub_folders for select to authenticated
  using (user_id in (select hub_agare()));
create policy owner_update on hub_folders for update to authenticated
  using      (user_id in (select hub_agare()))
  with check (user_id in (select hub_agare()));
-- Ingen INSERT/DELETE: mappträdet ägs av IMAP-synken.

-- hub_goals  — RLS: på
create policy owner_all on hub_goals for all to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- hub_habit_logs  — RLS: på
create policy owner_all on hub_habit_logs for all to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- hub_habits  — RLS: på
create policy owner_all on hub_habits for all to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- hub_links  — RLS: på
create policy owner_all on hub_links for all to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- hub_mail_accounts  — RLS: på
create policy owner_select on hub_mail_accounts for select to authenticated
  using (user_id in (select hub_agare()));
create policy owner_update on hub_mail_accounts for update to authenticated
  using      (user_id in (select hub_agare()))
  with check (user_id in (select hub_agare()));
-- Ingen INSERT/DELETE. Nya konton måste läggas till via edge function.

-- hub_message_bodies  — RLS: på
create policy owner_select on hub_message_bodies for select to authenticated
  using (exists (
    select 1 from hub_messages m
    where m.id = hub_message_bodies.msg_id
      and m.user_id in (select hub_agare())
  ));
-- Tabellen saknar egen user_id; ägandet ärvs från hub_messages.

-- hub_messages  — RLS: på
create policy owner_select on hub_messages for select to authenticated
  using (user_id in (select hub_agare()));
create policy owner_update on hub_messages for update to authenticated
  using      (user_id in (select hub_agare()))
  with check (user_id in (select hub_agare()));
-- Ingen INSERT/DELETE: mejl skapas och raderas bara av synken.

-- hub_notes  — RLS: på
create policy owner_all on hub_notes for all to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- hub_oauth_klienter  — RLS: på
create policy "egna oauth-klienter" on hub_oauth_klienter for all to public
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);
-- AVVIKELSE: rollen är `public`, inte `authenticated`.
-- Raden är läsbar för ägaren, men hemlighet_id/token_id är bara uuid-pekare
-- in i vault — själva värdena kommer man inte åt härifrån.

-- hub_pending_ops  — RLS: på
create policy "egna koposter" on hub_pending_ops for all to public
  using      (user_id in (select hub_agare()))
  with check (user_id in (select hub_agare()));
-- AVVIKELSE: rollen är `public`, inte `authenticated`.

-- hub_projects  — RLS: på
create policy owner_all on hub_projects for all to authenticated
  using      (user_id in (select hub_agare()))
  with check (user_id in (select hub_agare()));

-- hub_savings_goals  — RLS: på
create policy owner_all on hub_savings_goals for all to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- hub_stocks  — RLS: på
create policy owner_all on hub_stocks for all to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- hub_tasks  — RLS: på
create policy owner_all on hub_tasks for all to authenticated
  using      (user_id in (select hub_agare()))
  with check (user_id in (select hub_agare()));

-- hub_transactions  — RLS: på
create policy owner_all on hub_transactions for all to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- hub_weekly_reviews  — RLS: på
create policy owner_all on hub_weekly_reviews for all to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- hub_workouts  — RLS: på
create policy owner_all on hub_workouts for all to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. FUNKTIONER
-- ═══════════════════════════════════════════════════════════════════════════
-- 25 funktioner. 15 av dem är SECURITY DEFINER och kör alltså med ägarens
-- (postgres) rättigheter, förbi RLS. För var och en anges vilka roller som
-- har EXECUTE — det är den enda spärren mot en SECURITY DEFINER-funktion.
--
-- SÄKERHETSKRITISK ÖVERSIKT — SECURITY DEFINER:
--   Nåbara för `authenticated` (inloggad användare):
--     hub_agare, hub_min_hub, hub_clear_mail_secret, hub_set_mail_secret,
--     hub_satt_oauth_hemlighet, hub_koppla_bort_oauth
--   Endast service_role/postgres:
--     hub_get_mail_secret, hub_hamta_oauth, hub_spara_oauth_token,
--     hub_kor_bakgrundssynk, hub_toem_kon, hub_messages_utan_kropp,
--     hub_satt_bilageflagga
--   Triggerfunktioner (nås i praktiken bara via sina triggers):
--     hub_uppdatera_sok_pa_kropp, hub_uppdatera_sok_pa_mejl
--   Endast supabase_auth_admin (triggerfunktion på auth.users):
--     hub_auto_confirm_owner
--
--   Funktionerna som rör vault kontrollerar själva att auth.uid() äger
--   raden innan de gör något (hub_set_mail_secret, hub_clear_mail_secret).
--   hub_get_mail_secret och hub_hamta_oauth saknade den kontrollen helt fram
--   till 2026-08-16. De har nu en andra försvarslinje som slår till när
--   auth.uid() inte är null, alltså när en riktig användare frågar. Under
--   service_role är den overksam med flit — en kontroll som kan sänka
--   mejlsynken vore ett sämre byte än risken den skyddar mot.
--   EXECUTE-listan är fortfarande den PRIMÄRA spärren: ge aldrig
--   authenticated rättigheter på någon av dem.
--
--   OBS: hub_agare() och hub_min_hub() är identiska (båda `select auth.uid()`
--   som STABLE SECURITY DEFINER). RLS-policyerna använder hub_agare(),
--   gallringsfunktionerna använder hub_min_hub(). Onödig dubblett.


-- ── hub_agare() ────────────────────────────────────────── SECURITY DEFINER
-- EXECUTE: authenticated, postgres, service_role
-- Används av nästan alla RLS-policyer. Ändras den här ändras radsäkerheten
-- för halva databasen på en gång.
CREATE OR REPLACE FUNCTION public.hub_agare()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$ select auth.uid() $function$;


-- ── hub_ar_betalning(p_subject text, p_text text, p_html text) ────────────
-- EXECUTE: PUBLIC, anon, authenticated, postgres, service_role
-- Ren textmatchning, ingen dataåtkomst. Sätter hub_messages.betalning.
CREATE OR REPLACE FUNCTION public.hub_ar_betalning(p_subject text, p_text text, p_html text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(p_subject, '') || ' ' ||
         left(coalesce(p_text, regexp_replace(coalesce(p_html, ''), '<[^>]*>', ' ', 'g')), 60000)
         ~* ('(ocr[- ]?(nummer|referens|nr)|bankgiro|plusgiro|autogiro|e-faktura'
           || '|fakturanummer|fakturanr|faktura nr|fakturan bifogas'
           || '|förfallodatum|förfallodag|sista betalningsdag|betalningsvillkor'
           || '|betalningspåminnelse|påminnelseavgift|kravavgift|inkasso'
           || '|att betala|belopp att betala|totalt att betala)');
$function$;


-- ── hub_auto_confirm_owner() ───────────────────────────── SECURITY DEFINER
-- EXECUTE: postgres, service_role, supabase_auth_admin
-- Triggerfunktion på auth.users. Bekräftar ägarens mejladress automatiskt
-- vid signup, så att inget bekräftelsemejl behöver skickas.
CREATE OR REPLACE FUNCTION public.hub_auto_confirm_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.email = 'lundgrenper.pl@gmail.com' then
    new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  end if;
  return new;
end;
$function$;


-- ── hub_clear_mail_secret(p_account_id uuid) ───────────── SECURITY DEFINER
-- EXECUTE: authenticated, postgres, service_role
-- Kontrollerar själv att auth.uid() äger kontot innan den rör vault.
CREATE OR REPLACE FUNCTION public.hub_clear_mail_secret(p_account_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare
  v_secret uuid;
  v_owner uuid;
begin
  select user_id, secret_id into v_owner, v_secret
  from public.hub_mail_accounts where id = p_account_id;

  if v_owner is null or v_owner is distinct from auth.uid() then
    raise exception 'Åtkomst nekad';
  end if;

  update public.hub_mail_accounts set secret_id = null where id = p_account_id;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end $function$;


-- ── hub_flytta(p_msg_ids uuid[], p_mal_mapp uuid, p_mal_roll text) ────────
-- EXECUTE: authenticated, postgres, service_role
-- INVOKER (ej definer) — läser och skriver alltså under anroparens RLS.
-- Köar IMAP-flyttar. Returnerar {"koade": n, "hoppade": n}.
CREATE OR REPLACE FUNCTION public.hub_flytta(p_msg_ids uuid[], p_mal_mapp uuid DEFAULT NULL::uuid, p_mal_roll text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_mal uuid;
  v_koade int := 0;
  v_hoppade int := 0;
begin
  if p_mal_mapp is null and p_mal_roll is null then
    raise exception 'Ange en målmapp eller en roll';
  end if;

  if p_mal_mapp is not null then
    perform 1 from hub_folders where id = p_mal_mapp;
    if not found then raise exception 'Målmappen finns inte'; end if;
  end if;

  for r in
    select m.id, m.account_id, m.folder_id, m.uid, m.pending_folder_id
    from hub_messages m where m.id = any(p_msg_ids)
  loop
    -- Målet väljs per mejl, så en bunt från flera konton hamnar i rätt
    -- papperskorg i respektive konto i stället för allihop i ett.
    if p_mal_mapp is not null then
      v_mal := p_mal_mapp;
    else
      select f.id into v_mal from hub_folders f
      where f.account_id = r.account_id and f.role = p_mal_roll limit 1;
    end if;

    if v_mal is null or coalesce(r.pending_folder_id, r.folder_id) = v_mal then
      v_hoppade := v_hoppade + 1;
      continue;
    end if;

    update hub_messages set pending_folder_id = v_mal where id = r.id;

    -- fran_* pekar alltid på var mejlet FAKTISKT ligger på servern, även om
    -- samma mejl hinner flyttas två gånger innan kön betats av.
    insert into hub_pending_ops (user_id, msg_id, fran_folder_id, fran_uid, till_folder_id)
    values (auth.uid(), r.id, r.folder_id, r.uid, v_mal)
    on conflict (msg_id) do update
      set till_folder_id = excluded.till_folder_id,
          forsok = 0, sista_fel = null, nasta_forsok = now(), skapad = now();

    v_koade := v_koade + 1;
  end loop;

  return jsonb_build_object('koade', v_koade, 'hoppade', v_hoppade);
end;
$function$;


-- ── hub_forslag_mapp(p_msg_ids uuid[]) ────────────────────────────────────
-- EXECUTE: authenticated, postgres, service_role   |   INVOKER, STABLE
CREATE OR REPLACE FUNCTION public.hub_forslag_mapp(p_msg_ids uuid[])
 RETURNS TABLE(folder_id uuid, path text, name text, account_id uuid, traffar integer, anledning text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with valda as (
    select distinct m.from_email, m.account_id
    from hub_messages m
    where m.id = any(p_msg_ids) and m.user_id = auth.uid()
  ),
  -- Mappar dit post från samma avsändare redan flyttats
  fran_avsandare as (
    select m.folder_id, count(*)::int as antal
    from hub_messages m
    join valda v on v.from_email = m.from_email and v.account_id = m.account_id
    join hub_folders f on f.id = m.folder_id
    where m.user_id = auth.uid()
      and f.role is distinct from 'inbox'
      and not f.hidden
      and m.id <> all(p_msg_ids)
    group by m.folder_id
  ),
  -- Mappar som fått post nyligen, oavsett avsändare
  nyligen as (
    select m.folder_id, count(*)::int as antal
    from hub_messages m
    join hub_folders f on f.id = m.folder_id
    where m.user_id = auth.uid()
      and f.role is distinct from 'inbox'
      and not f.hidden
      and m.synced_at > now() - interval '30 days'
    group by m.folder_id
  )
  select f.id, f.path, f.name, f.account_id,
         coalesce(a.antal, n.antal, 0) as traffar,
         case when a.antal is not null
              then a.antal || ' mejl från samma avsändare ligger här'
              else 'Nyligen använd' end as anledning
  from hub_folders f
  left join fran_avsandare a on a.folder_id = f.id
  left join nyligen n on n.folder_id = f.id
  where (a.antal is not null or n.antal is not null)
  order by (a.antal is null), coalesce(a.antal, n.antal) desc
  limit 6;
$function$;


-- ── hub_gallring_adresser(p_doman text) ───────────────────────────────────
-- EXECUTE: authenticated, postgres, service_role   |   INVOKER, STABLE
CREATE OR REPLACE FUNCTION public.hub_gallring_adresser(p_doman text)
 RETURNS TABLE(epost text, visningsnamn text, antal bigint, senaste timestamp with time zone, exempel text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select
    m.from_email,
    (array_agg(m.from_name order by m.sent_at desc nulls last)
       filter (where m.from_name is not null))[1],
    count(*),
    max(m.sent_at),
    (array_agg(m.subject order by m.sent_at desc nulls last))[1]
  from hub_mejl m
  where m.user_id = hub_min_hub()
    and m.avsandarbeslut = 'oavgjord'
    and coalesce(m.visad_roll, '') not in ('sent', 'trash', 'drafts')
    and split_part(m.from_email, '@', 2) = p_doman
  group by 1
  order by count(*) desc;
$function$;


-- ── hub_gallring_lista() ──────────────────────────────────────────────────
-- EXECUTE: authenticated, postgres, service_role   |   INVOKER, STABLE
CREATE OR REPLACE FUNCTION public.hub_gallring_lista()
 RETURNS TABLE(doman text, adresser text[], visningsnamn text, antal bigint, senaste timestamp with time zone, exempel text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select
    split_part(m.from_email, '@', 2) as doman,
    array_agg(distinct m.from_email) as adresser,
    (array_agg(m.from_name order by m.sent_at desc nulls last)
       filter (where m.from_name is not null))[1] as visningsnamn,
    count(*) as antal,
    max(m.sent_at) as senaste,
    (array_agg(m.subject order by m.sent_at desc nulls last))[1] as exempel
  from hub_mejl m
  where m.user_id = hub_min_hub()
    and m.avsandarbeslut = 'oavgjord'
    and coalesce(m.visad_roll, '') not in ('sent', 'trash', 'drafts')
    and m.from_email is not null
  group by 1
  order by count(*) desc, max(m.sent_at) desc;
$function$;


-- ── hub_gallring_start() ──────────────────────────────────────────────────
-- EXECUTE: authenticated, postgres, service_role   |   INVOKER
-- Fyller hub_avsandare med 'in' för alla man själv har mejlat.
CREATE OR REPLACE FUNCTION public.hub_gallring_start()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  agare uuid := hub_min_hub();
  antal integer;
begin
  insert into hub_avsandare (user_id, epost, beslut)
  select distinct agare, lower(mottagare), 'in'
  from hub_messages m
  join hub_folders f on f.id = m.folder_id,
       unnest(m.to_emails) as mottagare
  where m.user_id = agare
    and f.role = 'sent'
    and mottagare is not null
    and position('@' in mottagare) > 1
  on conflict do nothing;
  get diagnostics antal = row_count;
  return antal;
end $function$;


-- ── hub_get_mail_secret(p_account_id uuid) ─────────────── SECURITY DEFINER
-- EXECUTE: postgres, service_role   ← MÅSTE förbli så.
-- Lämnar ut IMAP-lösenordet i klartext. Sedan 2026-08-16 finns en andra
-- försvarslinje: en INLOGGAD användare får bara sitt eget konto. Under
-- service_role är auth.uid() null, så vakten rör inte edge-funktionerna —
-- med flit, en kontroll som kan sänka mejlsynken vore ett sämre byte.
-- EXECUTE-listan är fortfarande den primära spärren.
CREATE OR REPLACE FUNCTION public.hub_get_mail_secret(p_account_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
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


-- ── hub_hamta_oauth(p_user uuid, p_provider text) ──────── SECURITY DEFINER
-- EXECUTE: postgres, service_role   ← MÅSTE förbli så.
-- Returnerar klienthemlighet och refresh-token i klartext. Tar user_id som
-- parameter, så sedan 2026-08-16 kontrolleras att en INLOGGAD användare bara
-- frågar om sig själv. Under service_role är auth.uid() null och vakten är
-- overksam — EXECUTE-listan är fortfarande den primära spärren.
CREATE OR REPLACE FUNCTION public.hub_hamta_oauth(p_user uuid, p_provider text)
 RETURNS TABLE(client_id text, hemlighet text, refresh_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
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


-- ── hub_koppla_bort_oauth(p_provider text) ─────────────── SECURITY DEFINER
-- EXECUTE: authenticated, postgres, service_role
-- Använder auth.uid() internt, så den kan bara röra anroparens egen rad.
CREATE OR REPLACE FUNCTION public.hub_koppla_bort_oauth(p_provider text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare v_rad public.hub_oauth_klienter;
begin
  select * into v_rad from public.hub_oauth_klienter
  where user_id = auth.uid() and provider = p_provider;
  if not found then return; end if;
  if v_rad.token_id is not null then
    perform vault.update_secret(v_rad.token_id, 'bortkopplad');
  end if;
  update public.hub_oauth_klienter
    set token_id = null, ansluten_vid = null, konto = null, sista_fel = null
    where id = v_rad.id;
  -- Kalendrarna forlorar sin kalla; handelserna far ligga kvar tills Per
  -- sjalv tar bort dem, sa att inget forsvinner bakom ryggen pa honom.
  update public.hub_calendars set aktiv = false where user_id = auth.uid();
end $function$;


-- ── hub_kor_bakgrundssynk() ────────────────────────────── SECURITY DEFINER
-- EXECUTE: postgres, service_role
-- Anropas av cron var tionde minut. Läser cron-nyckeln ur hub_cron_nyckel
-- och postar mot mail-sync och calendar-sync via pg_net.
CREATE OR REPLACE FUNCTION public.hub_kor_bakgrundssynk()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'net'
AS $function$
declare nyckeln text; huvuden jsonb;
  adress text := 'https://abwmdhvaxqlpyzgvuedj.supabase.co/functions/v1/';
begin
  select nyckel into nyckeln from hub_cron_nyckel;
  if nyckeln is null then return; end if;
  huvuden := jsonb_build_object('Content-Type','application/json','x-hub-cron',nyckeln);
  perform net.http_post(url := adress||'mail-sync', headers := huvuden, body := '{}'::jsonb, timeout_milliseconds := 150000);
  perform net.http_post(url := adress||'calendar-sync', headers := huvuden, body := '{}'::jsonb, timeout_milliseconds := 150000);
end $function$;


-- ── hub_lasbar_text(p_text text, p_html text) ─────────────────────────────
-- EXECUTE: PUBLIC, anon, authenticated, postgres, service_role
-- Ren strängfunktion, IMMUTABLE, ingen dataåtkomst.
CREATE OR REPLACE FUNCTION public.hub_lasbar_text(p_text text, p_html text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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


-- ── hub_messages_utan_kropp(p_user uuid, p_antal integer) ─ SECURITY DEFINER
-- EXECUTE: postgres, service_role
-- Returnerar bara id:n och mapp-referenser, inget innehåll.
CREATE OR REPLACE FUNCTION public.hub_messages_utan_kropp(p_user uuid, p_antal integer DEFAULT 25)
 RETURNS TABLE(id uuid, uid bigint, account_id uuid, folder_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.id, m.uid, m.account_id, m.folder_id
  from public.hub_messages m
  left join public.hub_message_bodies b on b.msg_id = m.id
  -- Antingen saknas brödtexten helt, eller så är den hämtad av en äldre
  -- version som inte kartlade bilagorna.
  where m.user_id = p_user and (b.msg_id is null or not b.bilagor_lasta)
  order by m.sent_at desc nulls last
  limit p_antal;
$function$;


-- ── hub_min_hub() ──────────────────────────────────────── SECURITY DEFINER
-- EXECUTE: authenticated, postgres, service_role
-- Identisk med hub_agare(). Används av gallringsfunktionerna.
CREATE OR REPLACE FUNCTION public.hub_min_hub()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$ select auth.uid() $function$;


-- ── hub_satt_bilageflagga(p_msg uuid) ──────────────────── SECURITY DEFINER
-- EXECUTE: postgres, service_role
CREATE OR REPLACE FUNCTION public.hub_satt_bilageflagga(p_msg uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.hub_messages
  set has_attachments = exists (
    select 1 from public.hub_attachments a
    where a.msg_id = p_msg and not a.inline
  )
  where id = p_msg;
$function$;


-- ── hub_satt_oauth_hemlighet(p_provider, p_client_id, p_hemlighet) ────────
--                                                        SECURITY DEFINER
-- EXECUTE: authenticated, postgres, service_role
-- Använder auth.uid() internt — rör bara anroparens egen klientrad.
CREATE OR REPLACE FUNCTION public.hub_satt_oauth_hemlighet(p_provider text, p_client_id text, p_hemlighet text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare
  v_rad public.hub_oauth_klienter;
  v_ny uuid;
begin
  if p_hemlighet is null or length(trim(p_hemlighet)) = 0 then
    raise exception 'Hemligheten får inte vara tom';
  end if;

  insert into public.hub_oauth_klienter (user_id, provider, client_id)
  values (auth.uid(), p_provider, p_client_id)
  on conflict (user_id, provider) do update set client_id = excluded.client_id
  returning * into v_rad;

  if v_rad.hemlighet_id is null then
    v_ny := vault.create_secret(
      trim(p_hemlighet),
      'hub_oauth_' || p_provider || '_' || auth.uid()::text,
      'Hubben: klienthemlighet för ' || p_provider
    );
    update public.hub_oauth_klienter set hemlighet_id = v_ny, sista_fel = null where id = v_rad.id;
  else
    perform vault.update_secret(v_rad.hemlighet_id, trim(p_hemlighet));
    update public.hub_oauth_klienter set sista_fel = null where id = v_rad.id;
  end if;
end $function$;


-- ── hub_set_mail_secret(p_account_id uuid, p_password text) SECURITY DEFINER
-- EXECUTE: authenticated, postgres, service_role
-- Kontrollerar själv att auth.uid() äger kontot.
CREATE OR REPLACE FUNCTION public.hub_set_mail_secret(p_account_id uuid, p_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare
  v_secret uuid;
  v_owner uuid;
begin
  select user_id, secret_id into v_owner, v_secret
  from public.hub_mail_accounts where id = p_account_id;

  if v_owner is null or v_owner is distinct from auth.uid() then
    raise exception 'Åtkomst nekad';
  end if;

  if p_password is null or length(trim(p_password)) = 0 then
    raise exception 'Lösenordet får inte vara tomt';
  end if;

  if v_secret is null then
    v_secret := vault.create_secret(
      p_password,
      'hub_mail_' || p_account_id::text,
      'Hubben: mejllösenord'
    );
    update public.hub_mail_accounts
      set secret_id = v_secret, last_error = null
      where id = p_account_id;
  else
    perform vault.update_secret(v_secret, p_password);
    update public.hub_mail_accounts
      set last_error = null
      where id = p_account_id;
  end if;
end $function$;


-- ── hub_sok_traffar(p_ids uuid[], p_fraga text) ───────────────────────────
-- EXECUTE: PUBLIC, anon, authenticated, postgres, service_role
-- INVOKER, STABLE. Läser hub_messages/hub_message_bodies under anroparens
-- RLS, så anon får inga rader trots EXECUTE-rätten.
CREATE OR REPLACE FUNCTION public.hub_sok_traffar(p_ids uuid[], p_fraga text)
 RETURNS TABLE(id uuid, traff text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select m.id, h.traff
  from public.hub_messages m
  join public.hub_message_bodies b on b.msg_id = m.id
  cross join lateral (
    select ts_headline(
      'swedish',
      -- Samma läsbara text som indexet byggs av, annars kan utdraget peka på
      -- något som inte finns i sökvektorn. 60 kB räcker gott för ett utdrag.
      left(public.hub_lasbar_text(b.text_body, b.html_body), 60000),
      websearch_to_tsquery('swedish', p_fraga),
      'StartSel=' || chr(2) || ',StopSel=' || chr(3) ||
      ',MaxWords=16,MinWords=7,MaxFragments=1,FragmentDelimiter= … '
    ) as traff
  ) h
  where m.id = any(p_ids[1:200])
    -- ts_headline ger dokumentets början när ingenting matchar. Utan det här
    -- skulle varje mejl få ett utdrag, även de som träffade på ämnet.
    and position(chr(2) in h.traff) > 0;
$function$;


-- ── hub_sokvektor(p_subject, p_from_name, p_from_email, p_text, p_html) ───
-- EXECUTE: PUBLIC, anon, authenticated, postgres, service_role
-- IMMUTABLE, ingen dataåtkomst. Viktning: A = ämne, B = avsändare,
-- C = brödtext (max 200 kB).
CREATE OR REPLACE FUNCTION public.hub_sokvektor(p_subject text, p_from_name text, p_from_email text, p_text text, p_html text)
 RETURNS tsvector
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select setweight(to_tsvector('swedish', coalesce(p_subject, '')), 'A')
      || setweight(to_tsvector('swedish', coalesce(p_from_name, '') || ' ' || coalesce(p_from_email, '')), 'B')
      || setweight(to_tsvector('swedish', left(public.hub_lasbar_text(p_text, p_html), 200000)), 'C');
$function$;


-- ── hub_spara_oauth_token(p_user, p_provider, p_token, p_konto) ───────────
--                                                        SECURITY DEFINER
-- EXECUTE: postgres, service_role   ← MÅSTE förbli så.
-- Tar user_id som parameter utan ägarkontroll; skriver refresh-token i vault.
CREATE OR REPLACE FUNCTION public.hub_spara_oauth_token(p_user uuid, p_provider text, p_token text, p_konto text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare
  v_rad public.hub_oauth_klienter;
  v_ny uuid;
begin
  select * into v_rad from public.hub_oauth_klienter
  where user_id = p_user and provider = p_provider;
  if not found then raise exception 'Ingen klient registrerad'; end if;

  if v_rad.token_id is null then
    v_ny := vault.create_secret(
      p_token,
      'hub_oauth_token_' || p_provider || '_' || p_user::text,
      'Hubben: refresh-token för ' || p_provider
    );
  else
    perform vault.update_secret(v_rad.token_id, p_token);
    v_ny := v_rad.token_id;
  end if;

  update public.hub_oauth_klienter
    set token_id = v_ny,
        konto = coalesce(p_konto, konto),
        ansluten_vid = now(),
        sista_fel = null
    where id = v_rad.id;
end $function$;


-- ── hub_toem_kon() ─────────────────────────────────────── SECURITY DEFINER
-- EXECUTE: postgres, service_role
-- Cron-jobbet som betar av hub_pending_ops via edge functionen mail-drain.
CREATE OR REPLACE FUNCTION public.hub_toem_kon()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'net'
AS $function$
declare nyckeln text;
begin
  select nyckel into nyckeln from hub_cron_nyckel;
  if nyckeln is null then return; end if;
  perform net.http_post(
    url := 'https://abwmdhvaxqlpyzgvuedj.supabase.co/functions/v1/mail-drain',
    headers := jsonb_build_object('Content-Type','application/json','x-hub-cron',nyckeln),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
end $function$;


-- ── hub_uppdatera_sok_pa_kropp() ───────────────────────── SECURITY DEFINER
-- EXECUTE: PUBLIC, anon, authenticated, postgres, service_role
-- DEN HÄR HÅLLER SÖKNINGEN UPPDATERAD. Körs av triggern hub_sok_pa_kropp
-- på hub_message_bodies varje gång brödtexten skrivs, och sätter då både
-- hub_messages.sok och hub_messages.betalning. Ändras indexeringen är det
-- här den ska ändras.
CREATE OR REPLACE FUNCTION public.hub_uppdatera_sok_pa_kropp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  update hub_messages m
     set sok = hub_sokvektor(m.subject, m.from_name, m.from_email, new.text_body, new.html_body),
         betalning = hub_ar_betalning(m.subject, new.text_body, new.html_body)
   where m.id = new.msg_id;
  return new;
end $function$;


-- ── hub_uppdatera_sok_pa_mejl() ────────────────────────── SECURITY DEFINER
-- EXECUTE: PUBLIC, anon, authenticated, postgres, service_role
-- BEFORE-trigger på hub_messages. Sätter new.sok och new.betalning direkt.
CREATE OR REPLACE FUNCTION public.hub_uppdatera_sok_pa_mejl()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare t text; h text;
begin
  select text_body, html_body into t, h from hub_message_bodies where msg_id = new.id;
  new.sok := hub_sokvektor(new.subject, new.from_name, new.from_email, t, h);
  new.betalning := hub_ar_betalning(new.subject, t, h);
  return new;
end $function$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════
-- Tre triggers, varav en ligger i auth-schemat. Interna triggers
-- (FK-kontroller m.m.) är utelämnade.

-- auth.users
CREATE TRIGGER hub_auto_confirm_owner_trg BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION hub_auto_confirm_owner();

-- hub_message_bodies
CREATE TRIGGER hub_sok_pa_kropp AFTER INSERT OR UPDATE OF text_body, html_body ON public.hub_message_bodies
  FOR EACH ROW EXECUTE FUNCTION hub_uppdatera_sok_pa_kropp();
-- DEN HÄR är triggern som håller sökvektorn uppdaterad när brödtexten
-- kommer in. Det finns bara en; dubbletten hub_sok_efter_brodtext togs
-- bort 2026-08-16 tillsammans med sin funktion.

-- hub_messages
CREATE TRIGGER hub_sok_pa_mejl BEFORE INSERT OR UPDATE OF subject, from_name, from_email ON public.hub_messages
  FOR EACH ROW EXECUTE FUNCTION hub_uppdatera_sok_pa_mejl();


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. VYER
-- ═══════════════════════════════════════════════════════════════════════════
-- En enda vy. Ingen materialiserad vy finns.

-- ── hub_mejl ──────────────────────────────────────────────────────────────
-- Ägare: postgres.  reloptions: security_invoker=on
--
-- DET HÄR ÄR APPENS HUVUDINGÅNG TILL MEJLEN. Vyn gör tre saker:
--   1. visar mejlet i den mapp användaren FLYTTAT det till
--      (coalesce(pending_folder_id, folder_id)) i stället för där det
--      fortfarande ligger på servern — därav kolumnen `vantar`,
--   2. plockar med mappens roll och sökväg via joinen mot hub_folders,
--   3. slår upp avsändarbeslutet, först på exakt adress, sedan på domän,
--      annars 'oavgjord'.
--
-- security_invoker=on är avgörande: vyn kör med anroparens rättigheter och
-- ärver därmed RLS från hub_messages och hub_folders. Utan flaggan skulle
-- vyn köra som postgres och lämna ut hela mejlarkivet oavsett RLS.
--
-- Joinen mot hub_folders är en INNER JOIN. Ett mejl vars mapp saknas
-- försvinner alltså tyst ur vyn.
create view hub_mejl
with (security_invoker = on)
as
 SELECT m.id,
    m.user_id,
    m.account_id,
    m.folder_id,
    COALESCE(m.pending_folder_id, m.folder_id) AS visad_mapp_id,
    f.role AS visad_roll,
    f.path AS visad_mapp,
    m.pending_folder_id IS NOT NULL AS vantar,
    m.uid,
    m.subject,
    m.from_name,
    m.from_email,
    m.sent_at,
    m.seen,
    m.flagged,
    m.reply_later,
    m.bubble_up_at,
    m.destination,
    m.has_attachments,
    m.rfc_message_id,
    m.snippet,
    m.to_emails,
    m.cc_emails,
    COALESCE(pa.beslut, pd.beslut, 'oavgjord'::text) AS avsandarbeslut,
    m.betalning,
    m.sok
   FROM hub_messages m
     JOIN hub_folders f ON f.id = COALESCE(m.pending_folder_id, m.folder_id)
     LEFT JOIN hub_avsandare pa ON pa.user_id = m.user_id AND pa.epost = m.from_email
     LEFT JOIN hub_avsandare pd ON pd.user_id = m.user_id AND pd.doman = split_part(m.from_email, '@'::text, 2);


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. SCHEMALAGDA JOBB (pg_cron)
-- ═══════════════════════════════════════════════════════════════════════════
-- cron-schemat var läsbart. Tre aktiva jobb.

-- hubben-bakgrundssynk   */10 * * * *      select hub_kor_bakgrundssynk()
--   Var tionde minut, på hela tiotalet. Postar mot mail-sync och
--   calendar-sync.

-- hubben-kotomning       5-59/10 * * * *   select hub_toem_kon()
--   Också var tionde minut, men förskjutet fem minuter så att kön töms
--   mitt emellan synkarna i stället för samtidigt.

-- hubben-stada-svar      17 4 * * *
--   delete from net._http_response where created < now() - interval '3 days'
--   Städar pg_net:s svarstabell nattetid så den inte växer i all evighet.

-- ═══════════════════════════════════════════════════════════════════════════
-- SLUT
-- ═══════════════════════════════════════════════════════════════════════════
