-- answered saknades i vyn hub_mejl.
--
-- Listan i Mail.tsx började be om kolumnen när svarspilen lades till
-- (commit "Kopia, hemlig kopia och svara alla"). En kolumn som inte finns gör
-- att HELA frågan misslyckas — inte att fältet blir tomt. Inkorgen såg alltså
-- tom ut trots att räknaren visade 262, eftersom räknaren är en egen fråga
-- utan kolumnlista och därför fortsatte fungera.
--
-- Kolumnen ligger SIST med flit: create or replace view får inte skjuta in en
-- kolumn i mitten — den tolkar det som att de befintliga döps om och vägrar.
--
-- Lärdomen: lägg aldrig till ett fält i en select mot hub_mejl utan att först
-- se efter att VYN har det. hub_messages har fler kolumner än vyn visar, så
-- det räcker inte att titta på tabellen.
create or replace view public.hub_mejl as
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
    m.sok,
    m.thread_key,
    m.sorterad_at,
    m.answered
   FROM hub_messages m
     JOIN hub_folders f ON f.id = COALESCE(m.pending_folder_id, m.folder_id)
     LEFT JOIN hub_avsandare pa ON pa.user_id = m.user_id AND pa.epost = m.from_email
     LEFT JOIN hub_avsandare pd ON pd.user_id = m.user_id AND pd.doman = split_part(m.from_email, '@'::text, 2);
