# Serverfunktionerna

Hubbens tjugo edge-funktioner. De körs i Supabase-projektet **WORK**
(`abwmdhvaxqlpyzgvuedj`) och låg tidigare bara där — det här är källan.

## Vad som finns här och vad som inte gör det

`functions/*/index.ts` är hela källkoden. `config.toml` bär den enda
inställning som inte syns i koden: `verify_jwt`. Fem funktioner har den
avstängd, var och en av ett tvingande skäl som står i filens inledning —
läs den innan du rör inställningen.

Migrationerna här är bara de som skrivits sedan repot fick den här mappen.
Databasschemat i övrigt bor fortfarande enbart i Supabase.

Hemligheter finns inte här och ska inte hamna här. Lösenord ligger i Supabase
Vault, OAuth-klienthemligheter i `hub_oauth_klienter` via
`hub_satt_oauth_hemlighet`, och tjänstenycklarna som miljövariabler.

## Karta

| Funktion | Gör |
| --- | --- |
| `mail-sync` | Hämtar rubriker via IMAP. Kan köras av schemaläggaren. |
| `mail-body` | Brödtext + bilagekarta för ett mejl. |
| `mail-prefetch` | Samma sak för många mejl i en uppkoppling. |
| `mail-folders` | Speglar mappstrukturen och räknar. |
| `mail-attachment` | Hämtar en enskild bilaga. |
| `mail-send` | SMTP, med bilagor och kopia till Skickat. |
| `mail-drain` | Betar av kön av flyttar mot IMAP. |
| `mail-move`, `mail-move-x`, `mail-move-bulk` | Äldre direktflyttar. Oanvända sedan skrivvägen vändes 2026-08-10, kvar tills de är säkert döda. |
| `calendar-sync` | Hämtar hem Google-kalendrarna. |
| `calendar-push` | Skickar upp ändringar, inklusive flytt mellan kalendrar. |
| `google-oauth-start` / `-callback` | Ansluter Google Kalender. |
| `ms-oauth-start` / `-callback` | Ansluter Outlook. |
| `market-data` | Proxar Yahoo Finance. |
| `imap-probe`, `imap-test` | Diagnostik. |
| `assistent` | Utfasad, svarar 410. |

## Två saker som återkommer i mejlfunktionerna

**`msAccessToken()` + `inloggningsrad()`** finns i alla sju IMAP-funktioner.
Outlook.com kan inte använda lösenord — Microsoft stängde basic auth för
privata konton 2024 — så de kontona loggar in med XOAUTH2 och ett färskt
Microsoft-token. Kontofrågan måste därför alltid ha med `provider`; utan den
faller Outlook tillbaka på ett lösenord som inte finns.

**`skrivAllt()`** i `mail-send`, `mail-drain` och `mail-move-x`. `write()`
lovar inte att skriva allt den fick — små kommandon ryms i ett svep, ett helt
mejl gör det inte, och då hänger servern och väntar på resten.

## Deploya

Ingen Supabase-CLI är uppsatt i det här repot. Funktionerna deployas via
Supabase-panelen eller MCP-verktyget. Filerna här ska vara identiska med det
som ligger uppe — ändra alltid här först och deploya därifrån, aldrig tvärtom.
