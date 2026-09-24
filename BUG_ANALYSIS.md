# Bug-Analyse — produktionsrelevante Fehler

> Erstellt: 2026-08-24 · Baseline zuletzt abgeglichen: 2026-09-24 (v1.1.1)
> Ursprung: statische Code-Analyse auf Branch `claude/codebase-bug-analysis-otaq55`;
> Review-Durchgang 2026-09-24 auf Branch `ui` (neue Befunde A12–A16, B10–B13, C9–C10,
> D7, E6; Schwerpunkt Object-Storage aus PR #92).
> Umfang: `server/` (SpacetimeDB-Modul), `core-api/` (.NET), `src/` (React-Client),
> `deploy/`, `docker-compose.prod.*`, `spacetimedb/`.

**Wichtiger Hinweis zur Verifikation:** Die ursprünglichen Befunde stammen aus dem
Lesen des Codes und sind nicht automatisch reproduziert. Bei behobenen Einträgen ist
die tatsächlich ausgeführte Verifikation im jeweiligen Abschnitt festgehalten. Ein
offener Eintrag bleibt eine begründete Analyse, bis ein Regressionstest ihn bestätigt.
Die Einstufung der Schwere ist eine Einschätzung, keine gemessene Größe.

---

## Schweregrade

| Grad | Bedeutung |
|---|---|
| **S1** | Kritisch — Sicherheitslücke oder Ausfall im Normalbetrieb |
| **S2** | Hoch — spürbarer Schaden, Datenverlust, Lockout oder DoS-Vektor |
| **S3** | Mittel — funktionaler Fehler, Leak, Fehlverhalten unter Last |
| **S4** | Niedrig — Robustheit, Konsistenz, Wartbarkeit |

## Überblick

| # | Titel | Grad | Bereich |
|---|---|---|---|
| [A1](#a1) | ~~SpacetimeDB akzeptiert anonyme Identities — Account-Kontrollen der core-api greifen nicht~~ · **✅ behoben (PR #71)** | ~~S1~~ | Auth |
| [A2](#a2) | ~~Rate-Limiting partitioniert nach Proxy-IP statt Client-IP~~ · **✅ behoben (PR #70)** | ~~S1~~ | Auth |
| [A3](#a3) | ~~`/auth/link` umgeht Registrierungssperre, E-Mail-Bestätigung und Rate-Limit~~ · **✅ behoben (PR #70)** | ~~S1~~ | Auth |
| [A4](#a4) | ~~Keine Token-Revokation: Passwort-Reset und Account-Sperre wirken nicht~~ · **✅ behoben (PR #72)** | ~~S1~~ | Auth |
| [A5](#a5) | ~~Upload-Größenlimit und Tagesquote sind clientseitig deklariert, nicht durchgesetzt~~ · **✅ behoben (PR #83)** | ~~S2~~ | Storage |
| [A6](#a6) | ~~Presigned Download-URLs ohne Zugriffsprüfung auf den Storage-Key~~ · **✅ behoben (PR #83)** | ~~S2~~ | Storage |
| [A7](#a7) | ~~Kein Account-Lockout, keine Passwort-Längenobergrenze → Argon2-DoS~~ · **✅ behoben (PR #84)** | ~~S2~~ | Auth |
| [A8](#a8) | ~~Erstregistrierung wird automatisch Instanz-Admin (Land-Grab)~~ · **✅ behoben (PR #88)** | ~~S2~~ | Auth |
| [A9](#a9) | ~~Account-Enumeration über `/auth/register`~~ · **✅ behoben** | ~~S3~~ | Auth |
| [A10](#a10) | ~~LiveKit-Token überlebt Kick/Ban um bis zu 1 Stunde~~ · **✅ behoben** | ~~S3~~ | Voice |
| [A11](#a11) | ~~Gemeinsamer niedriger IP-Bucket ermöglicht Availability-DoS hinter CGNAT~~ · **✅ behoben** | ~~S2~~ | Auth |
| [A12](#a12) | ~~`/auth/link` setzt Passwörter mit widerrufener Sitzung und ohne aktuelles Passwort~~ · **✅ behoben** | ~~S2~~ | Auth |
| [A13](#a13) | ~~Mitglieder sehen alle Invite-Tokens, DM-Invites sind nicht an den Empfänger gebunden~~ · **✅ behoben** | ~~S3~~ | Modul |
| [A14](#a14) | ~~ffmpeg verarbeitet unvertrauenswürdige Dateien im core-api-Container~~ · **✅ behoben** | ~~S3~~ | Storage |
| [A15](#a15) | ~~Uploader bestimmt den ausgelieferten Content-Type; PDF-Vorschau-iframe ohne Sandbox~~ · **✅ behoben** | ~~S3~~ | Storage |
| [A16](#a16) | ~~Legacy-Keys umgehen die 10-MiB-/`image/*`-Grenze für Avatare und Icons~~ · **✅ behoben** | ~~S3~~ | Storage |
| [B1](#b1) | ~~`transfer_ownership` auf sich selbst sperrt den Owner dauerhaft aus~~ · **✅ behoben (PR #82)** | ~~S2~~ | Modul |
| [B2](#b2) | ~~Owner kann sich selbst kicken/bannen → verwaister Space~~ · **✅ behoben (PR #82)** | ~~S2~~ | Modul |
| [B3](#b3) | ~~`edit_direct_message` prüft weder Block noch Freundschaft~~ · **✅ behoben (PR #82)** | ~~S2~~ | Modul |
| [B4](#b4) | ~~`edit_message` prüft weder Mitgliedschaft, Timeout noch Lösch-Status~~ · **✅ behoben** | ~~S3~~ | Modul |
| [B5](#b5) | ~~`update_profile`: `display_name`/`avatar_url` völlig unvalidiert~~ · **✅ behoben** | ~~S3~~ | Modul |
| [B6](#b6) | ~~Avatar-/Icon-URLs erlauben Tracking über beliebige Fremdhosts~~ · **✅ behoben** | ~~S4~~ | Modul |
| [B7](#b7) | ~~Invite-Token mit nur 8 Zeichen, kein Kollisionsschutz, kein Mengenlimit~~ · **✅ behoben** | ~~S3~~ | Modul |
| [B8](#b8) | ~~`create_invite`: `expires_in_seconds` läuft in einen i64-Overflow~~ · **✅ behoben** | ~~S4~~ | Modul |
| [B9](#b9) | ~~`avatar_url` lässt sich nie wieder entfernen~~ · **✅ behoben (PR #92)** | ~~S4~~ | Modul |
| [B10](#b10) | ~~Owner kann sich per `set_member_role` selbst degradieren → verwaister Space~~ · **✅ behoben** | ~~S2~~ | Modul |
| [B11](#b11) | ~~`ban_member` entfernt die Voice-Präsenz des Gebannten nicht~~ · **✅ behoben** | ~~S3~~ | Modul |
| [B12](#b12) | ~~`send_dm_server_invite` ignoriert Blockierungen~~ · **✅ behoben** | ~~S3~~ | Modul |
| [B13](#b13) | ~~`send_message` prüft die Channel-Art nicht; Timeout gilt nicht für Voice~~ · **✅ behoben** | ~~S4~~ | Modul |
| [C1](#c1) | ~~Jede eingehende Nachricht löst drei volle Durchläufe der Historie aus~~ · **✅ behoben (PR #73)** | ~~S1~~ | Client |
| [C2](#c2) | ~~Initialer Sync ist O(N²) und läuft in den 5-Sekunden-Timeout~~ · **✅ behoben (PR #73)** | ~~S1~~ | Client |
| [C3](#c3) | ~~`my_channel_messages` liefert die komplette Historie ohne Limit~~ · **✅ behoben (PR #77)** | ~~S1~~ | Views |
| [C4](#c4) | ~~`my_server_members` gibt alle Mitglieder aller Discover-Spaces preis~~ · **✅ behoben (PR #89)** | ~~S2~~ | Views |
| [C5](#c5) | ~~Typing-Indikator macht pro Tastenanschlag einen Full-Table-Scan~~ · **✅ behoben (PR #90)** | ~~S2~~ | Modul |
| [C6](#c6) | ~~Lösch-Reducer scannen ganze Tabellen statt Indizes zu nutzen~~ · **✅ behoben (PR #90)** | ~~S2~~ | Modul |
| [C7](#c7) | ~~Mitglieder-Events erzwingen instanzweiten Re-Sync bei allen Clients~~ · **✅ behoben** | ~~S2~~ | Client |
| [C8](#c8) | ~~`cleanup_stale_invites_internal` scannt bei jeder Invite-Operation~~ · **✅ behoben** | ~~S3~~ | Modul |
| [C9](#c9) | ~~`rebuild_storage_references` scannt die gesamte Historie in einer Transaktion~~ · **akzeptiert** | ~~S4~~ | Storage |
| [C10](#c10) | ~~Weitere lineare Scans in häufig aufgerufenen Reducern~~ · **✅ behoben** | ~~S4~~ | Modul |
| [D1](#d1) | ~~`TypingState` wird bei Verbindungsabbruch nie aufgeräumt~~ · **✅ behoben** | ~~S3~~ | Modul |
| [D2](#d2) | ~~Präsenz bleibt nach Absturz dauerhaft „online"~~ · **✅ behoben** | ~~S3~~ | Modul |
| [D3](#d3) | ~~`delete_server` lässt Read-States und DM-Invites verwaist zurück~~ · **✅ behoben** | ~~S3~~ | Modul |
| [D4](#d4) | ~~Bestätigte Anhänge werden beim Löschen ihrer Nachricht/Channels nicht entfernt~~ · **✅ behoben** | ~~S3~~ | Storage |
| [D5](#d5) | ~~`rekey_identities` korrumpiert Daten bei verketteten Remaps~~ · **✅ behoben** | ~~S3~~ | Modul |
| [D6](#d6) | ~~Stale Messages im Client-Store nach Hard-Delete~~ · **✅ behoben** | ~~S4~~ | Client |
| [D7](#d7) | ~~Storage-Collector löscht nach `--delete-data` Anhänge, bevor der Archiv-Restore beginnt~~ · **✅ behoben** | ~~S2~~ | Storage |
| [E1](#e1) | ~~Stiller Fallback auf anonyme Identity bei Token-Ablehnung~~ · **✅ behoben (PR #90)** | ~~S3~~ | Client |
| [E2](#e2) | ~~Abmelden während des Verbindungsaufbaus kann die Sitzung wiederbeleben~~ · **✅ behoben** | ~~S3~~ | Client |
| [E3](#e3) | ~~Discovery fällt bei nacktem Hostnamen auf `http://` zurück~~ · **✅ behoben** | ~~S3~~ | Client |
| [E4](#e4) | ~~CSP wird nur im Report-Only-Modus ausgeliefert~~ · **✅ behoben** | ~~S3~~ | Deploy |
| [E5](#e5) | ~~Download-URL-Cache wächst unbegrenzt~~ · **✅ behoben** | ~~S4~~ | Client |
| [E6](#e6) | ~~CSPs erlauben Inline-Video und PDF-Vorschau vom Files-Host nicht~~ · **✅ behoben** | ~~S3~~ | Client |
| [F1](#f1) | ~~Bool-Konfiguration schlägt bei unerwarteten Werten still fehl~~ · **✅ behoben** | ~~S3~~ | Config |
| [F2](#f2) | ~~`SystemConfigService`-Cache ist prozesslokal~~ · **akzeptiert** | ~~S4~~ | Config |
| [F3](#f3) | ~~`MigrateLegacyIdentitiesAsync` lädt bei jedem Start alle User~~ · **✅ behoben** | ~~S4~~ | Config |
| [F4](#f4) | ~~GitHub-Timeout in `/downloads/{os}` wird zu einem 500~~ · **✅ behoben** | ~~S4~~ | API |
| [G1](#g1) | ~~`CODEBASE.md` beschreibt einen überholten Stand~~ · **✅ behoben (Baseline 2026-09-15)** | ~~S4~~ | Doku |

---

# A — Authentifizierung, Autorisierung, Sicherheit

<a id="a1"></a>
## A1 — SpacetimeDB akzeptiert anonyme Identities · ✅ **behoben**

**Behoben in PR #71** (`fix/spacetimedb-anonymous-identity-gate`).

Zwei Gates im Modul schließen die Lücke:

- **`require_account`** in allen client-aufrufbaren Reducern (`server/src/helpers.rs`):
  Der Aufrufer braucht eine `User`-Zeile. Ein Primärschlüssel-Lookup pro Aufruf — und
  weil eine `User`-Zeile nur über `register_user` entsteht, wirkt die Issuer-Prüfung
  darüber transitiv überall.
- **`require_trusted_issuer`** in `register_user` (`server/src/reducers/system.rs`),
  dem einzigen Reducer, der überhaupt Standing erzeugt. SpacetimeDB 2.5 stellt das
  bereits verifizierte JWT des Aufrufers über `ctx.sender_auth()` bereit, das Modul
  verlangt also den `iss`-Claim des eigenen OIDC-Issuers. Die Signatur prüft
  SpacetimeDB vorher gegen die JWKS dieses Issuers — `iss` ist damit nicht fälschbar.

Die `archive_*`-Reducer (registrierte Worker-Identity), die admin-gateten Reducer
(`require_system_admin` setzt bereits eine `User`-Zeile voraus) und die
Lifecycle-Reducer behalten bewusst ihre eigene, striktere Grenze.

**Keine neue Konfiguration.** core-api pinnt seinen `SPACETIME_OIDC_ISSUER` über den
neuen, admin-gateten Reducer `set_trusted_issuer` selbst ins Modul — beim Start und
erneut bei jeder Admin-Anmeldung. Solange nichts gepinnt ist, ist die Prüfung **aus**:
Ein Publish auf eine laufende Instanz kann niemanden aussperren, und eine frische
Instanz (die bis zur ersten Registrierung gar keinen Admin hat) startet weiterhin
sauber. Deshalb ist der Rat „vor der Öffentlichmachung einmal selbst anmelden" jetzt
betrieblich relevant — dokumentiert in `DEPLOYMENT.md` und beiden Self-Hosting-Guides.

Verifiziert gegen eine echte SpacetimeDB-Instanz: 7 neue Fälle in
`tests/security/anonymous-identity.test.ts`, von denen 6 gegen das ungepatchte Modul
fehlschlagen. Drei core-api-Tests fixieren zusätzlich die SATS-`Option<String>`-Kodierung
des Reducer-Aufrufs — die Stelle, an der ein stiller Fehler die Prüfung ausgeschaltet
ließe.

**Nachtrag (2026-09-09):** Die ursprüngliche Formulierung „alle 60" stimmte nicht ganz.
`update_profile` (`server/src/reducers/users.rs`) hatte das Gate nicht — der eigene
Zeilen-Lookup weist zwar eine identitätslose Anfrage ab, prüft aber weder `suspended`
noch die Token-Generation-Untergrenze aus [A4](#a4). Ein gesperrtes Konto konnte sich
also weiterhin umbenennen und sein Avatar wechseln. Nachgezogen in Commit `26b30ac`.

Offen bleibt [A8](#a8): Die erste Registrierung auf einer frischen Instanz wird weiterhin
automatisch Instanz-Admin, und genau dieses eine Fenster ist auch beim Issuer-Pinning
noch ungeschützt.

---

<a id="a2"></a>
## A2 — Rate-Limiting partitioniert nach Proxy-IP statt Client-IP · ✅ **behoben**

**Behoben in PR #70** (`fix/auth-link-bypass-and-forwarded-headers`).

`UseForwardedHeaders` wird jetzt in `core-api/src/CoreApi/Program.cs` aufgerufen — und
zwar vor jeder Middleware, die die Client-IP liest. `X-Forwarded-For` wird nur von
Peers aus Loopback-, RFC1918- und IPv6-Unique-Local-Netzen akzeptiert, also aus dem
Container-Netz des Reverse-Proxys; ein direkt verbundener Aufrufer aus dem öffentlichen
Netz kann den Header nicht fälschen, um das Limit zu umgehen. `ForwardLimit = 1`
vertraut nur der Aussage des unmittelbar vorgelagerten Proxys.

Damit partitioniert der Limiter wieder nach echter Client-IP; der beschriebene
instanzweite Login-Lockout durch einen einzelnen Client ist nicht mehr möglich.

---

<a id="a3"></a>
## A3 — `/auth/link` umgeht Registrierungssperre, E-Mail-Bestätigung und Rate-Limit · ✅ **behoben**

**Behoben in PR #70** (`fix/auth-link-bypass-and-forwarded-headers`).

Der Pfad für einen *neuen* Account in `Link` spiegelt jetzt exakt die Kontrollen von
`Register`: Prüfung von `RegistrationOpen`, `Status`/`EmailConfirmed` abgeleitet aus
`RequireEmailConfirmation`, Bestätigungsmail inklusive Rollback bei Zustellfehler, und
abschließend `EnsureSignInAllowed` — ein unbestätigter Account erhält damit ein 401
statt einer nutzbaren Sitzung. Die Route trägt zusätzlich
`.RequireRateLimiting(RateLimitPolicy)` wie jeder andere Auth-Endpunkt.

Der Pfad für *bestehende* Accounts war bereits korrekt abgesichert und ist unverändert.
Der Endpunkt wurde bewusst nicht entfernt (obwohl er keine Client-Aufrufer hat), weil
`CLAUDE.md` API-Endpunkte unter Backwards-Compatibility stellt.

Abgesichert durch `core-api/tests/CoreApi.Tests/IntegrationTests/LinkTests.cs`;
gegen den unkorrigierten Endpunkt fallen 2 der 3 Tests.

---

<a id="a4"></a>
## A4 — Keine Token-Revokation · ✅ **behoben**

**Behoben in PR #72** (`fix/token-revocation`).

Jeder Account trägt jetzt eine monotone `TokenGeneration`, die core-api in **beide**
Token als `gen`-Claim schreibt. Das Modul hält pro Account zwei Werte, die core-api
pusht — `suspended` und `min_token_generation` — und `require_account` (aus [A1](#a1),
in allen client-aufrufbaren Reducern) erzwingt beide. Damit greifen alle drei
Teilprobleme:

1. **Passwort-Reset/-Änderung** erhöht die Generation und pusht die neue Untergrenze.
   Das gestohlene Token liegt darunter und wird beim nächsten Reducer-Aufruf
   abgelehnt — nicht erst nach 30 Tagen. `/auth/renew-session` prüft die Generation
   ebenfalls, sonst könnte der Angreifer sich einfach weiter neue Sitzungen ausstellen.
2. **Account-Sperre** setzt `suspended`; das Modul verweigert daraufhin jeden Reducer,
   auch die admin-gateten. (`rekey_identities` ist bewusst ausgenommen: einmaliger
   Pre-OIDC-Migrationspfad mit statischem Token ohne `gen`.)
3. **`token_use`** wird in `TokenService.ValidateAsync` geprüft.

**Bewusst ein Zähler statt `SecurityStamp`.** Der Push ins Modul ist best-effort; ein
Gleichheitsvergleich würde den *legitimen* Nutzer aus dem Chat aussperren, sobald der
Push fehlschlägt (SpacetimeDB kurz nicht erreichbar). `>=` fällt stattdessen auf „noch
nicht widerrufen" zurück. Aus demselben Grund wird die Generation **vor** dem Push
persistiert.

**Kein kurzlebigeres Token.** Der Lehrbuchansatz (kurze TTL + Refresh) scheitert hier
zweifach: `/auth/refresh-spacetime-token` existiert gar nicht (nur im Doc-Kommentar
`AuthEndpoints.cs:13` erwähnt), und SpacetimeDB prüft das Token **beim Verbinden**,
nicht pro Aufruf — eine kürzere TTL würde eine bereits offene WebSocket-Sitzung eines
Angreifers nie beenden. Nur die Prüfung im Modul tut das.

Verifiziert gegen eine echte SpacetimeDB-Instanz: 7 neue Fälle in
`tests/security/token-revocation.test.ts`, die alle gegen das ungepatchte Modul
fehlschlagen, plus 6 core-api-Tests.

**Rest-Lücke:** Ein widerrufenes Token kann über `/sql` weiterhin die `my_*`-Views
**lesen** — Views sind keine Reducer und liegen nicht auf dem `require_account`-Pfad.
Schreibzugriff ist vollständig unterbunden. Der `localStorage`-Aspekt bleibt ebenfalls
offen (siehe [E4](#e4): CSP nur im Report-Only-Modus).

---

<a id="a5"></a>
## A5 — Upload-Größenlimit und Tagesquote waren nur clientseitig deklariert · ✅ **behoben**

**Behoben in PR #83** (`fix/upload-quota-and-attachment-auth`).

Die Quote wird jetzt erteilt, nicht erst nachträglich geprüft:

1. `/uploads/request` sperrt die Tagesquoten-Zeile in PostgreSQL und zählt
   bestätigte Bytes **plus alle noch offenen Reservierungen**. Erst wenn die Summe
   unter 2 GiB bleibt, wird eine `PendingUpload`-Zeile mit Quota-Datum angelegt.
   Mehrere parallele Requests können die Quote deshalb nicht überbuchen; auch viele
   nie bestätigte Uploads verbrauchen sie bis zum Ablauf.
2. Die Presigned-PUT-URL signiert den exakten `Content-Length`. Ein PUT mit einer
   anderen als der reservierten Länge scheitert bei MinIO an SigV4.
3. `/uploads/confirm` sperrt Reservierung und Quote erneut, liest die echte
   Objektgröße und verlangt exakte Übereinstimmung. Reservierung entfernen und
   bestätigte Bytes erhöhen geschehen in derselben Transaktion.
4. `PendingUploadSweeper` läuft periodisch. Er löscht das abgelaufene Objekt aus
   MinIO **vor** der Datenbankzeile; schlägt Storage fehl, bleibt die Quote reserviert
   und der nächste Lauf versucht es erneut.

Verifiziert gegen das laufende MinIO: ein ehrlicher Upload (16 B gemeldet, 16 B
gesendet) landet und wird mit 16 B verbucht; `1` gemeldet und 64 B gesendet →
PUT 403, kein Objekt; 64 gemeldet und 16 gesendet → PUT 403. Der Signed-Headers-
Parameter der URL zeigt `content-length;host`.

Der Regressionstest
`Pending_Uploads_Reserve_The_Daily_Quota_Without_Confirm` deckt den ursprünglichen
Bypass durch viele unbestätigte Grants ab. Die vorhandenen Upload-Integrationstests
decken Scope und Zugriff mit echten Accounts und Modulabfragen ab.

**Nebenbefund (S4) bleibt offen:** Die MIME-Sperrliste prüft weiterhin den vom
Client gesendeten `mime_type`.

---

<a id="a6"></a>
## A6 — Presigned Download-URLs ohne Zugriffsprüfung auf den Storage-Key · ✅ **behoben**

**Behoben in PR #83** (`fix/upload-quota-and-attachment-auth`).

Der Storage-Key trägt jetzt selbst, wer ihn lesen darf — festgelegt bei
`/uploads/request` über ein `scope`-Feld, geprüft bei `/uploads/download-url(s)`
gegen die Sichtbarkeit, die das Modul dem Aufrufer *selbst* einräumt
(`core-api/src/CoreApi/Services/StorageKey.cs`, `UploadEndpoints.MayReadAsync`):

| Key | Lesen darf |
|---|---|
| `uploads/ch/{channelId}/{uploader}/…` | wer den Channel in `my_channels` sieht — also aktuelle Mitglieder |
| `uploads/dm/{uploader}/{partner}/…` | die beiden Parteien (ohne Modul-Abfrage) |
| `uploads/avatar/{uploader}/…` | jeder Account |
| `uploads/icon/{serverId}/{uploader}/…` | wer den Space in `my_servers` sieht — Mitglieder und, solange er gelistet ist, Discover |
| `uploads/{yyyy}/{MM}/{dd}/{uploader}/…` (alle Objekte von vor dieser Änderung) | der Uploader selbst, und wer ihn in `my_visible_users` sieht (Co-Mitglied, Freund); zusätzlich wer einen Space sieht, dessen `icon_url` der Key ist *und* dessen Owner der Uploader ist |

Die Modul-Abfragen laufen als der Aufrufer (`SpacetimeClient.QueryAsUserAsync`, dieselbe
Mechanik wie das Voice-Gate), also mit exakt seiner Zeilensicht: Kick, Ban oder
Verlassen wirken auf die nächste URL-Anfrage, weil das Modul den Channel bzw. Space
nicht mehr liefert. Kein Modul-Wissen über Keys, keine neue Tabelle. Ein Scope kann
nur *einschränken*, wer liest — ein Uploader, der einen fremden Channel angibt,
verschenkt seine Datei an Leute, denen er sie ohnehin schicken könnte. Ein
nicht erreichbares Modul ist ein 503, kein 403. Alte Clients ohne `scope` bekommen
weiter den Legacy-Key und laden weiter.

Verifiziert gegen den laufenden Stack (echte Accounts, echte Reducer, echtes MinIO):
Channel-Key → Uploader 200, Mitglied 200, Außenstehender 403, Mitglied nach Kick 403;
DM-Key → Partner 200, Dritte 403; Avatar → Fremder 200; Icon → Discover-Besucher 200,
nach Un-Listing 403; Legacy → Uploader 200, Co-Mitglied 200, Fremder 403, und über
die Icon-Regel 200. Der `Option`-/`Identity`-Zeilenformat des `/sql`-Endpunkts
(`[0, wert]`, `["0x…"]`) ist gegen echte Zeilen gepinnt.

**Bewusst offen (nur Legacy-Keys):** Die Uploader-Sichtbarkeit ist eine Näherung an
„Nachricht lesbar“. Zwei Kanten: eine alte Datei eines Users, der inzwischen jeden
gemeinsamen Space verlassen hat, lädt nicht mehr; und wer aus Space A gebannt wurde,
aber mit dem Uploader noch Space B teilt, kann dessen alte Dateien aus A weiterhin
abrufen. Beides endet mit dem Bestand an Legacy-Keys — jeder Upload *des aktuellen
Clients* seit dieser Änderung ist exakt gescopt. **Nachtrag 2026-09-24:** Der Server
erzwingt das nicht: `/uploads/request` ohne `scope` erzeugt weiterhin einen neuen
Legacy-Key, und das Modul akzeptiert Legacy-Keys für Nachrichten, Avatare und Icons
(siehe [A16](#a16)). Außerdem genügt für „Uploader sichtbar" eine *ausstehende*
Freundschaftsanfrage, die jeder per Username stellen kann; praktisch begrenzt das nur
die GUID im Key. Ein alter Space-Icon, das ein Moderator (nicht der
Owner) hochgeladen hat, zeigt Nicht-Mitgliedern auf Discover die Initialen; neu
hochladen behebt es.

---

<a id="a7"></a>
## A7 — Kein Account-Lockout, keine Passwort-Längenobergrenze → Argon2-DoS · ✅ **behoben**

**Behoben in PR #84** (`fix/login-lockout-and-password-cap`).

- **Lockout.** Beide Login-Pfade (`/auth/login`, `/admin/login`) verwenden jetzt
  `SignInManager.CheckPasswordSignInAsync(…, lockoutOnFailure: true)` statt
  `UserManager.CheckPasswordAsync` — das ist die Methode, die die Identity-Lockout-Mechanik
  tatsächlich anwendet, ohne ein Cookie zu setzen. Fünf Fehlversuche sperren den Account
  für fünf Minuten (`Program.cs`, explizit gesetzt); ein erfolgreicher Login setzt den
  Zähler zurück; ein gesperrter Account wird abgewiesen, *bevor* der Hash angefasst wird.
  Die Antwort bei Sperre sagt das auch („Too many failed sign-in attempts…") — sie
  bestätigt zwar die Existenz des Accounts, aber erst nach fünf Fehlversuchen, und
  `/auth/register` beantwortet die Frage ohnehin ([A9](#a9)).
- **Passwort-Obergrenze.** `Validation.MaxPasswordLength = 128`, geprüft in
  `Validation.ValidatePassword` (Register, Link, Login, Change, Reset), im
  Admin-Formular *und* im `Argon2PasswordHasher` selbst: `VerifyHashedPassword` gibt für
  Überlängen `Failed` zurück ohne zu hashen, `HashPassword` wirft. Der Hasher ist der
  eine Punkt, durch den jeder Hash und jede Prüfung geht — die Grenze hält dort, egal
  welcher Aufrufer sie vergisst.
- **Request-Body.** Kestrel auf 256 KB begrenzt (`MaxRequestBodySize`); die API ist
  kleines JSON, Dateien gehen per Presigned-URL direkt an MinIO. Das 30-MB-Default war nur
  ein Multiplikator.
- **Nebenbefund** erledigt: `Validation.Required` kappt bei 256 Zeichen (Display-Name, Room, Identity).
- **Client** spiegelt die Regel (`passwordLengthError` in `src/lib/authService.ts`):
  Registrierung und Passwort-Ändern zeigen „8–128 characters." live unter dem Feld und
  färben es bei Verstoß rot, bevor man das Passwort ein zweites Mal tippt; Login prüft
  vor dem Request; die Browser-Reset-Seite hat `minlength`/`maxlength` plus denselben Hinweis.

Verifiziert gegen den laufenden Stack: fünf falsche Passwörter → ab dem fünften
„Too many failed…", danach auch das richtige 401, `LockoutEnd` in der DB gesetzt;
129-Zeichen-Passwort → 400 vor jeder DB-Abfrage; 300-KB-Body → 413; Admin-Login auf :8788
sperrt ebenso (Antiforgery-Formular, fünfter Versuch → Sperrmeldung, richtiges Passwort
danach abgewiesen).

**Beobachtung dabei:** Identity persistiert den Fehlversuch über `UpdateUserAsync`, also
*mit* `UserValidator`. Eine Zeile, die die Validierung nicht besteht — konkret ein
Bootstrap-Admin ohne E-Mail, wie ihn Versionen vor 2026-05-28 anlegten — zählt still
keine Fehlversuche und sperrt nie; `SignInManager` verschluckt das fehlgeschlagene
`IdentityResult`. Prod-Zeilen haben alle eine E-Mail (Bootstrap seit 05-28, Migrator
setzt Platzhalter); auf einer alten Dev-Datenbank hilft
`UPDATE "AspNetUsers" SET "Email" = …, "NormalizedEmail" = … WHERE "Email" IS NULL`.

---

<a id="a8"></a>
## A8 — Erstregistrierung wird automatisch Instanz-Admin · ✅ **behoben**

**Behoben in PR #88** (`fix/secure-admin-bootstrap`).

- Der `init`-Reducer legt für `ctx.sender()` — die von SpacetimeDB authentifizierte
  Module-Owner-/Publisher-Identity — sofort den reservierten User `@module-owner` mit
  `is_admin = true` an. Diese Identity kontrolliert ohnehin den ausführbaren
  Modulcode und ist damit die richtige Bootstrap-Autorität.
- `register_user` leitet Adminrechte nicht mehr aus Tabellenleere oder
  Registrierungsreihenfolge ab. Normale Registrierungen bleiben Nicht-Admins; der
  Full-Table-Scan auf `user` entfällt ebenfalls.
- Ein bereits autorisierter Admin kann die deterministische Identity eines
  Core-API-Admins schon vor dessen erster Chat-Verbindung freigeben. Der private
  `pending_admin_grant` wird beim späteren `register_user` derselben Identity atomar
  verbraucht. So bleibt die bestehende Reihenfolge HTTP-Login → WebSocket-Registrierung
  ohne zweiten Login funktionsfähig, ohne einen öffentlichen Bootstrap-Pfad zu öffnen.
- Die Produktionsanleitung verwendet den im `module_init_home` persistierten
  Publisher-Token als `SPACETIMEDB_SERVICE_TOKEN`; erste öffentliche Registrierung
  ist kein Betriebs-Schritt mehr.

Regressionstest: `tests/security/admin-bootstrap.test.ts` prüft sowohl den beim
Publish angelegten Module Owner und einen nicht privilegierten ersten öffentlichen
User als auch einen expliziten Grant, dessen Ziel sich erst danach registriert.

---

<a id="a9"></a>
## A9 — Account-Enumeration über `/auth/register` · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Mit E-Mail-Bestätigung (Produktions-Default) antworten `/auth/register` und
`/auth/link` auf eine bereits registrierte Adresse genau wie auf eine neue: Status
`pending_email_verification` mit zufälliger Identity bzw. derselbe 401 wie ein
unbestätigtes Konto. Das Passwort wird trotzdem gehasht, damit die Antwortzeit nicht
verrät, welcher Pfad lief. Der Besitzer bekommt stattdessen die Mail „You already have a
LetsChat account" (gedeckelt über `MailSendLimiter`). Resend und Forgot-Password
verschlucken Zustellfehler und antworten generisch (Nebenbefund). **Bewusst offen:**
Ohne E-Mail-Bestätigung gibt die Registrierung sofort eine Sitzung aus — das lässt sich
nicht vortäuschen, dort bleibt das 409. Usernames sind ohnehin im Chat sichtbar und
bleiben abfragbar. Tests in `AccountEnumerationTests`. Die ursprüngliche Analyse:

**Stelle:** `core-api/src/CoreApi/Endpoints/AuthEndpoints.cs:74-83`

```csharp
if (await users.FindByNameAsync(username) is not null)
    throw ApiException.Conflict("Username already exists.");

if (await users.FindByEmailAsync(email) is not null)
    throw ApiException.Conflict("Email address is already registered.");
```

Der Endpunkt ist unauthentifiziert und beantwortet damit die Frage „hat diese
E-Mail-Adresse hier einen Account?" direkt. Das steht im Widerspruch zur sorgfältig
generischen Antwort in `ForgotPassword` (`:495-517`) und `ResendConfirmation`
(`:460-488`) — die Enumeration, die dort verhindert wird, ist hier offen.

**Nebenbefund:** `ResendConfirmation` antwortet zwar generisch, wirft aber bei
Zustellfehlern eine `EmailDeliveryException`, die zu einem 503 wird
(`Program.cs:211-219`). Ein 503 statt eines 200 verrät indirekt, dass der Account
existiert und unbestätigt ist.

---

<a id="a10"></a>
## A10 — LiveKit-Token überlebt Kick/Ban um bis zu 1 Stunde · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Der neue `LiveKitVoiceReconciler` vergleicht alle 20 s jeden LiveKit-Raum mit der
Voice-Präsenz im Modul und entfernt Teilnehmer, die zwei Runden in Folge keine
haben — Kick, Ban, Timeout (entfernt die Präsenz seit B11/B13) oder Austritt. Die
Präsenz entsteht vor dem Token, ein Teilnehmer ohne sie ist also entfernt worden; die
zwei Runden fangen einen kurzen SpacetimeDB-Reconnect ab, und ein unerreichbares Modul
setzt die Runde aus. Server-Tokens für LiveKits Room-API sind raumgebunden (gegen den
Dev-LiveKit geprüft: `ListParticipants`/`RemoveParticipant` verlangen `room`); ein
Teilnehmer, der zwischen Auflisten und Entfernen geht (404), bricht die Runde nicht ab.
Neue interne Adresse `LIVEKIT_INTERNAL_URL`, in der Compose-Datei fest
`http://livekit:44380` (wie `MINIO_INTERNAL_ENDPOINT`), keine Betreiber-Einstellung.
Tests in `LiveKitVoiceReconcilerTests` (zwei Runden, nie mit Präsenz, nie bei
unerreichbarem Modul). Die ursprüngliche Analyse:

**Stellen:** `core-api/src/CoreApi/Services/LiveKitTokenService.cs:119-145`,
`Endpoints/LiveKitEndpoints.cs:250-293`

Die Ausgabe des Tokens ist sauber abgesichert: `HasVoicePresenceAsync` prüft gegen die
tatsächliche Voice-Präsenz im Modul, und der Kommentar erklärt korrekt, warum das
nötig ist. Das Token selbst ist danach aber eine Stunde lang gültig:

```csharp
Expires = now.AddHours(1),
Claims = { ["video"] = { ["roomJoin"] = true, ["room"] = room,
                         ["canPublish"] = true, ["canSubscribe"] = true } }
```

LiveKit kennt das Modul nicht und prüft nur die Signatur.

**Auswirkung:** Wird ein Nutzer aus einem Space gekickt oder gebannt, während er ein
gültiges Token für einen Voice-Channel dieses Space hält, kann er sich bis zu eine
Stunde lang direkt bei LiveKit wieder in den Raum verbinden — mitlesen und senden.
`kick_member` (`member_management.rs:10-47`) löscht zwar die `VoiceParticipant`-Zeile,
aber das entwertet das bereits ausgestellte Token nicht.

**Richtung für einen Fix:** Kürzere Token-Laufzeit (Minuten statt einer Stunde) plus
ein serverseitiger `RemoveParticipant`-Aufruf an die LiveKit-API bei Kick/Ban/Leave.

---

<a id="a11"></a>
## A11 — Gemeinsamer niedriger IP-Bucket ermöglicht Availability-DoS hinter CGNAT · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Umgesetzt wie unten geplant: vier getrennte Per-IP-Policies
(`auth-login`, `auth-register` inklusive `/auth/link`, `auth-email` für Resend und
Forgot-Password, `auth-password` für Change- und Reset-Password). Login bekommt das
Zehnfache des konfigurierten Werts (`LoginRateLimitMultiplier`), weil der
Account-Lockout das Raten pro Konto bereits begrenzt. Zusätzlich deckelt
`MailSendLimiter` Bestätigungs- und Reset-Mails auf drei pro Account und Stunde; darüber
antwortet der Endpunkt weiter generisch. Keine neue Konfiguration, der Admin-Hinweis und
die `.env`-Beispiele beschreiben die neue Aufteilung. `AuthRateLimitTests`: viele
Anmeldungen hinter einer Adresse nach ausgeschöpftem Registrierungs- und Mail-Budget
bleiben 200, Username-Spraying erreicht 429, und der Mail-Deckel greift ohne
Statusunterschied. Die ursprüngliche Analyse:

**Stellen:** `core-api/src/CoreApi/Program.cs:179-205`,
`core-api/src/CoreApi/Endpoints/AuthEndpoints.cs:22-48`

Alle rate-limitierten Auth-Endpunkte teilen dieselbe Fixed-Window-Policy und werden
ausschließlich nach der öffentlichen Client-IP partitioniert. Der Standardwert von
10 Requests pro 300 Sekunden gilt damit gemeinsam für Login, Registrierung,
Bestätigungsmail, Passwort-Reset, Link und Passwortänderung.

Eine öffentliche IP entspricht nicht zuverlässig einem Nutzer. Hinter Carrier-Grade
NAT, Firmen-Gateways oder VPN-Ausgängen können Hunderte oder Tausende Nutzer denselben
Bucket teilen. Ein einzelner Teilnehmer hinter diesem Ausgang kann die zehn Requests
gezielt verbrauchen und dadurch alle anderen Nutzer dieser IP für bis zu fünf Minuten
von den betroffenen Auth-Funktionen ausschließen. Wiederholtes Leeren jedes neuen
Fensters macht daraus einen Availability-DoS. Die in [A2](#a2) korrigierte Auswertung
von `X-Forwarded-For` verhindert einen instanzweiten Proxy-Bucket, kann gemeinsam
genutzte öffentliche Adressen aber prinzipbedingt nicht auflösen.

Der Account-Lockout begrenzt Passwortversuche bereits auf fünf Fehlschläge pro Konto.
Er ersetzt keinen Schutz vor Username-Spraying, zeigt aber, dass ein sehr kleiner
zusätzlicher IP-Bucket beim Login unnötig viel Kollateralschaden verursacht. Der
Admin-Login verwendet den IP-Limiter derzeit nicht; er ist produktiv nur über den
loopbackgebundenen Port und einen SSH-Tunnel erreichbar.

**Plan für den Fix:**

1. Die gemeinsame Policy in getrennte Budgets für Login, Registrierung und
   Mail-/Reset-Aktionen aufteilen, damit ein gefluteter Endpunkt keinen anderen
   Auth-Flow blockiert.
2. Beim Login den bestehenden Account-Lockout als enge Grenze beibehalten und nur
   ein deutlich großzügigeres IP-Limit gegen breit gestreute Username-Angriffe und
   Ressourcen-DoS ergänzen. Die konkreten Werte anhand eines realistischen Burst-Tests
   festlegen, nicht aus dem bisherigen Wert ableiten.
3. Registrierung und Mail-Versand separat begrenzen; wo ein validierter
   Ziel-Identifier vorhanden ist, diesen zusätzlich zur großzügigen IP-Grenze
   begrenzen, damit wechselnde IPs kein unbegrenztes Mail-Aufkommen erzeugen.
4. Den privaten Admin-Login nicht künstlich an den öffentlichen 10/5-Minuten-Bucket
   hängen. Falls der Admin-Port jemals öffentlich erreichbar wird, bekommt er eine
   eigene Defense-in-Depth-Policy.
5. Regressionstests ergänzen: viele legitime Konten hinter einer IP blockieren sich
   nicht gegenseitig; ein einzelnes Konto wird weiterhin gesperrt; Username-Spraying
   erreicht schließlich 429; und das Ausschöpfen des Mail-/Registrierungsbudgets
   verbraucht nicht das Login-Budget.

---

<a id="a12"></a>
## A12 — `/auth/link` setzt Passwörter mit widerrufener Sitzung und ohne aktuelles Passwort · ✅ **behoben**

**Behoben auf Branch `bug-security-fixes`.** Der Zweig für bestehende Accounts folgt
jetzt denselben Regeln wie `/auth/change-password`: `ResolveAccountAsync` (Generation
und Status), Pflichtfeld `currentPassword` (neu und optional in `LinkRequest`, also
additiv), `ChangePasswordAsync` statt Remove/Add, danach `RevokeTokensAsync`; die
Antwort trägt die neue Generation. Drei neue Fälle in `LinkTests.cs`: widerrufene
Sitzung → 401, Sitzung ohne bzw. mit falschem aktuellem Passwort → 401/400,
erfolgreicher Wechsel widerruft die alte Sitzung. Ein Altclient, der `/auth/link`
ohne `currentPassword` zum Passwortwechsel nutzt, bekommt jetzt 401 — der aktuelle
Client ruft den Pfad nicht auf. Die ursprüngliche Analyse:

**Stelle:** `core-api/src/CoreApi/Endpoints/AuthEndpoints.cs:146-192` (Zweig für
bestehende Accounts)

Der Zweig für einen *bestehenden* Account ersetzt das Passwort, sobald ein
Session-Token für denselben Username vorliegt:

```csharp
var caller = request.SessionToken is null ? null : await tokens.ValidateAsync(request.SessionToken);
if (caller is null || !string.Equals(caller, username, StringComparison.Ordinal)) throw …;
…
await users.RemovePasswordAsync(existing);
await users.AddPasswordAsync(existing, request.Password);
```

Drei Lücken:

1. **`ValidateAsync` statt `RequireAccountAsync`.** Geprüft werden nur Signatur,
   Laufzeit und `token_use` — **nicht** die Token-Generation aus [A4](#a4) und nicht
   der Account-Status. Ein Access-Token, das ein Passwortwechsel oder -Reset gerade
   widerrufen hat, funktioniert hier für den Rest seiner Stunde weiter.
2. **Kein aktuelles Passwort.** Der Doc-Kommentar von `ChangePassword` (`:363-371`)
   benennt genau das als Grund für den separaten Endpunkt — der unsichere Pfad ist
   aber geblieben.
3. **Keine Revokation und falsche Reihenfolge.** Nach dem Setzen wird weder
   `RevokeTokensAsync` aufgerufen noch vorher `EnsureSignInAllowed` geprüft; ein
   gesperrter Account ändert sein Passwort also erfolgreich und bekommt erst danach
   einen 401.

**Auswirkung:** Genau der Fall, für den A4 gebaut wurde, kippt. Ein Angreifer mit
einem gestohlenen Access-Token (z. B. via XSS aus dem `localStorage`, siehe [E4](#e4))
wartet, bis das Opfer sein Passwort zurücksetzt, ruft dann `/auth/link` mit dem
bereits widerrufenen Token auf, setzt sein eigenes Passwort und meldet sich regulär an
— eine dauerhafte Übernahme aus einer Stunde Token-Laufzeit.

**Verifiziert** (2026-09-24, temporärer xUnit-Test gegen `WebApplicationFactory`, nicht
eingecheckt): Registrieren → `change-password` (widerruft) → `/auth/account` mit dem
alten Token = 401 → `/auth/link` mit demselben Token = 200 → Login mit dem neuen
Angreifer-Passwort = 200.

**Richtung für einen Fix:** Der Client ruft `authServiceLink` nirgends mehr auf
(`src/lib/authService.ts:281` ist toter Export). Den Zweig für bestehende Accounts
auf `RequireAccountAsync` plus Pflicht-`currentPassword` umstellen — oder ihn mit
einem 401 ablehnen und auf `/auth/change-password` verweisen; der Endpunkt selbst
bleibt für die API-Kompatibilität bestehen.

---

<a id="a13"></a>
## A13 — Mitglieder sehen alle Invite-Tokens, DM-Invites sind nicht an den Empfänger gebunden · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** `my_invites` zeigt einfachen Mitgliedern nur noch eigene Invites, Moderatoren
weiterhin alle. DM-Invites werden mit `allowed_usernames = [empfänger]` angelegt.
`use_invite` prüft außerdem, dass der Ersteller den Invite *jetzt noch* ausstellen
dürfte — damit sterben Invites mit Kick, Ban, Austritt, Degradierung oder dem Wechsel auf
`ModeratorsOnly`. Bereits bestehende, ungebundene DM-Invites bleiben bis zu ihrem Ablauf
(7 Tage) ungebunden. Tests in `posting-and-invites.test.ts`. Die ursprüngliche Analyse:

**Stellen:** `server/src/views.rs:341-349` (`my_invites`),
`server/src/reducers/invites.rs:234-302` (`send_dm_server_invite`), `:114-192`
(`use_invite`)

`my_invites` liefert **jedem Mitglied** alle Invites seiner Spaces — auch unter
`InvitePolicy::ModeratorsOnly`, auch von Moderatoren erstellte, und auch die
Einmal-Tokens, die `send_dm_server_invite` für einen bestimmten Empfänger anlegt.
Dieses DM-Token wird mit `allowed_usernames: Vec::new()` gespeichert; `use_invite`
kennt also keinen Bezug zum vorgesehenen Empfänger.

**Auswirkung:** `ModeratorsOnly` beschränkt, wer Invites *erzeugt*, aber nicht, wer
sie *weitergibt*: Jedes einfache Mitglied liest die Tokens per `/sql`/Subscription aus
und reicht sie an Außenstehende weiter. Ein DM-Invite an Nutzer B kann von jedem
Dritten eingelöst werden, der das Token kennt; B sieht danach nur noch einen
verbrauchten Invite.

Verwandt: Invites überleben sowohl einen Wechsel von `Everyone` auf `ModeratorsOnly`
als auch Kick/Ban ihres Erstellers — ein unter offener Policy erzeugter
Mitglieder-Invite bleibt nach dem Umschalten gültig.

**Verifiziert** (2026-09-24, temporärer Test gegen `letschattest`): Mitglied liest
unter `ModeratorsOnly` den Owner-Invite aus `my_invites`, ein Außenstehender tritt
damit bei; ein Dritter löst das DM-Invite-Token eines anderen Empfängers ein.

**Richtung für einen Fix:** `my_invites` für einfache Mitglieder auf selbst erstellte
Invites beschränken (Moderatoren sehen alle); DM-Invites mit
`allowed_usernames = [empfänger]` anlegen oder `use_invite` gegen die
`dm_server_invite`-Zeile prüfen lassen.

---

<a id="a14"></a>
## A14 — ffmpeg verarbeitet unvertrauenswürdige Dateien im core-api-Container · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Der Rest: ffmpeg bekommt eine leere Umgebung (vorher erbte es jedes
core-api-Secret) und läuft im Image über `setpriv` als `nobody` — damit liest es auch
nicht `/proc/…/environ` von core-api. Im gebauten Image geprüft: Poster wird als uid
65534 gerendert, keine Umgebungsvariable kommt an. Die Warteschlange nimmt frische Jobs
vor Wiederholungen, und ein Job hat 30 s Gesamtbudget über beide Seek-Versuche statt
60 s pro Versuch. `FfmpegEnvironmentTests` schlägt ohne das Leeren der Umgebung fehl.
**Bewusst belassen:** ffmpeg hat weiter Netzzugang (die Protokoll-/Demuxer-Whitelist
schließt die SSRF) und läuft im core-api-Container; ein eigener Worker-Container wäre
die nächste Stufe. Die ursprüngliche Analyse:

**Teilweise behoben auf Branch `bug-security-fixes`.** Die SSRF war reproduzierbar:
eine Playlist mit Endung `.m3u8` und deklariertem `video/mp4` ließ ffmpeg (lokal 8.1)
die gelistete URL abrufen; ohne die Endung verweigert neueres ffmpeg die Erkennung,
die Endung wählt aber der Uploader. ffmpeg läuft jetzt mit
`-protocol_whitelist http,https,tcp,tls -format_whitelist mov,matroska,avi,mpegts,ogg,flv`.
`VideoThumbnailSmokeTests` lädt zusätzlich eine solche Playlist hoch und prüft mit
einem lokalen Listener, dass keine Verbindung ankommt; ohne die Whitelist schlägt der
Test fehl (und hing dabei ~3 Minuten — der Queue-DoS aus Punkt 3 gleich mit). mp4 und
webm rendern weiter.

**Offen (S3):** Punkt 2 und der Rest von Punkt 3 — ffmpeg läuft weiter als root im
Container mit allen Secrets, und die Job-Warteschlange ist nicht pro Uploader
begrenzt. Das ist eine Deploy-Änderung (eigener Worker-Container bzw. `USER` im
Image mit Blick auf Volume-Rechte). Die ursprüngliche Analyse:

**Stellen:** `core-api/src/CoreApi/Services/VideoThumbnailWorker.cs:65-145`,
`core-api/Dockerfile` (statisches `mwader/static-ffmpeg:7.1`),
`Endpoints/UploadEndpoints.cs:373` (Job-Auswahl über `MimeType.StartsWith("video/")`)

Jede bestätigte Datei, deren **vom Client deklarierter** MIME-Typ mit `video/` beginnt,
wird von ffmpeg im core-api-Prozess-Container geöffnet: `ffmpeg -ss … -i <presigned
interne URL>` ohne `-f`, ohne `-format_whitelist` und ohne `-protocol_whitelist`.
ffmpeg wählt den Demuxer also nach Inhalt.

Drei Folgen:

1. **SSRF.** Eine als `video/mp4` hochgeladene HLS-Playlist (`#EXTM3U`) lässt den
   HLS-Demuxer die darin genannten `http(s)`-URLs abrufen — aus dem Docker-Netz heraus,
   also gegen `spacetimedb:3000`, `minio`, LiveKit oder andere interne Dienste. Blind
   (die Antwort wird als Medium dekodiert), aber GET-Seiteneffekte und Port-Scans
   sind möglich.
2. **Parser-Angriffsfläche im wertvollsten Container.** core-api hält den
   OIDC-Signierschlüssel (damit ließe sich jede Identity inklusive Admins fälschen),
   die PostgreSQL-, MinIO- und LiveKit-Secrets und den SpacetimeDB-Service-Token. Das
   ASP.NET-Basisimage läuft ohne `USER`-Anweisung als root; ffmpeg erbt das. Eine
   Speicherfehler-Lücke in einem der vielen Demuxer/Decoder wird damit zur vollständigen
   Instanzübernahme.
3. **Queue-DoS.** Die Jobs laufen seriell, älteste zuerst; ein Job kann
   2 × 60 s (zwei Seek-Versuche) × 3 Attempts blockieren. Eine Playlist, die auf
   einen langsam antwortenden Host zeigt, hält die Warteschlange pro Datei ~6 Minuten
   auf; ein paar hundert Kleinstdateien innerhalb der Tagesquote legen die Poster aller
   Nutzer tagelang still.

Statische Analyse, nicht gegen den Stack reproduziert.

**Richtung für einen Fix:** ffmpeg mit `-protocol_whitelist http,https,tcp,tls` **und**
`-format_whitelist mov,mp4,m4a,matroska,webm,avi` (kein `hls`, `concat`, `playlist`)
aufrufen; mittelfristig in einen eigenen, secret-losen, nicht-root Worker-Container
ohne Zugang zum internen Netz auslagern. Den Job pro Uploader begrenzen.

---

<a id="a15"></a>
## A15 — Uploader bestimmt den ausgelieferten Content-Type; PDF-Vorschau-iframe ohne Sandbox · ✅ **behoben**

**Behoben auf Branch `bug-security-fixes`**, an der Auslieferung statt am Upload:
`StorageService.PresignGetAsync` überschreibt den gespeicherten Typ. Endungen, die der
Client inline darstellt (Bilder, Video, Audio, PDF), bekommen per
`response-content-type` ihren kanonischen Typ; alles andere wird per
`response-content-disposition: attachment` heruntergeladen. `<img>`/`<video>`
ignorieren die Disposition, Vorschauen bleiben also intakt. Eine HTML-Datei namens
`rechnung.pdf` kommt damit als `application/pdf` an, `seite.html` als Download.
Eine `sandbox` am PDF-iframe bleibt bewusst weg: Chrome rendert PDFs in
sandboxed iframes nicht, und nach der Typ-Überschreibung ist dort nur noch ein PDF
möglich. Die Content-Type-Signatur beim PUT ist damit entbehrlich (alte Clients
bleiben kompatibel). Damit Vorschau und Auslieferung dieselbe Regel verwenden
(Codex-Review), entscheidet der Client „PDF-Vorschau" jetzt am `.pdf`-Storage-Key
statt an Absender-MIME oder Dateiname, und `/uploads/request` gibt einem Upload ohne
Endung die Endung seines deklarierten Inline-Typs (ein PDF namens `dokument` wird
zu `….pdf` und bleibt vorschaubar; ausgeliefert wird es ohnehin als
`application/pdf`). Ältere endungslose PDFs zeigen jetzt „Open" statt „Preview".
Abgesichert durch `DownloadContentTypeSmokeTests` gegen echtes MinIO und
`StorageInlineTypeTests`. Die ursprüngliche Analyse:

**Stellen:** `core-api/src/CoreApi/Services/StorageService.cs:55-66`
(`PresignPutAsync`), `:138-145` (`PresignGetAsync`),
`src/features/chat/components/attachments/AttachmentPdfLightbox.tsx:61-67`,
`AttachmentListItem.tsx:21-28`, `:124-134`

- Die Presigned-PUT-URL signiert `Content-Length`, aber **nicht** `Content-Type`. Der
  Uploader sendet beim PUT jeden Typ, etwa `text/html` oder `image/svg+xml`, und MinIO
  speichert ihn. Der geprüfte `mime_type` aus `/uploads/request` (inklusive der
  Sperrliste aus [A5](#a5)) ist davon völlig entkoppelt.
- `PresignGetAsync` setzt weder `response-content-type` noch
  `response-content-disposition: attachment`. Ausgeliefert wird also der Typ des
  Uploaders, inline.
- Die Vorschau entscheidet „PDF" anhand der Anhang-Metadaten in der Nachricht (vom
  Absender geschrieben) oder der Endung `.pdf` und lädt die URL in ein
  `<iframe>` **ohne `sandbox`**. „Open" öffnet andere Typen per `window.open`.

**Auswirkung:** Eine HTML-Datei namens `rechnung.pdf` läuft beim Klick auf „Preview"
als Skript im Files-Origin — bildschirmfüllend im App-Dialog, also ideal für eine
gefälschte „Sitzung abgelaufen, bitte anmelden"-Maske. Über „Open" bzw. die
presigned URL (eine Stunde gültig, beliebig neu ausstellbar) entsteht eine
Phishing-Seite unter der eigenen `files.`-Domain. Auf App-Tokens kommt das Skript
nicht direkt heran, weil der Files-Host ein eigener Origin ist.

**Richtung für einen Fix:** `Content-Type` in die PUT-Signatur aufnehmen (oder beim
Confirm per Copy-in-place überschreiben) und beim GET `response-content-disposition`
bzw. für aktive Typen `attachment` erzwingen; das Vorschau-iframe mit `sandbox`
ausstatten.

---

<a id="a16"></a>
## A16 — Legacy-Keys umgehen die 10-MiB-/`image/*`-Grenze für Avatare und Icons · ✅ **behoben**

**Behoben auf Branch `bug-security-fixes`.** `sync_avatar_reference` und
`sync_icon_reference` akzeptieren nur noch gescopte Keys. Bestehende Legacy-Werte
bleiben gültig: `update_profile` prüft schon nur einen geänderten Avatar, und
`set_server_icon` tut das jetzt ebenso (vorher prüfte es bei jedem Aufruf, sodass
auch ein neuer Owner das Icon seines Vorgängers nicht erneut speichern konnte).
Regressionstest in `storage-lifecycle.test.ts`. Die ursprüngliche Analyse:

**Stellen:** `core-api/src/CoreApi/Endpoints/UploadEndpoints.cs:90-100`,
`Services/StorageKey.cs:73-79`, `server/src/storage_refs.rs:145-178`, `:430-438`

Die Bild- und Größenprüfung greift nur, wenn der Request `scope.kind` `avatar` oder
`icon` angibt. Ohne `scope` erzeugt `StorageKey.Build` einen Legacy-Key
(`uploads/{yyyy}/{MM}/{dd}/{uploader}/…`), begrenzt nur durch das allgemeine
Dateilimit (Default 500 MiB) und ohne Typprüfung. `sync_avatar_reference` und
`sync_icon_reference` akzeptieren aber ausdrücklich `is_legacy_key(key, uploader)`.

**Auswirkung:** Ein Nutzer setzt eine 500-MiB-Datei beliebigen Typs als Avatar bzw.
Space-Icon. Jeder Client, der ihn in Mitgliederlisten, Nachrichten oder (beim Icon)
auf Discover darstellt, lädt die Datei über `<img>` vollständig herunter — ein
Bandbreiten- und Speicher-DoS gegen Betrachter, getragen vom eigenen MinIO.

**Richtung für einen Fix:** Für Avatar/Icon im Modul nur noch die gescopten Keys
zulassen (Legacy-Werte, die bereits in einer Zeile stehen, bleiben über die
„unverändert"-Ausnahme in `update_profile` gültig); serverseitig `scope` für neue
Uploads verlangen.

---

# B — SpacetimeDB-Modul: Logik und Berechtigungen

<a id="b1"></a>
## B1 — `transfer_ownership` auf sich selbst sperrte den Owner dauerhaft aus · ✅ **behoben**

**Behoben in PR #82** (`fix/module-permission-gaps`).

`transfer_ownership` weist `target_identity == ctx.sender()` jetzt ab
(`"you already own this space"`). Vorher waren die beiden Updates dieselbe Zeile:
erst auf `Owner`, dann neu gelesen und auf `Moderator` — der zweite Schreibvorgang
gewann. `Server.owner_identity` zeigte weiter auf den Aufrufer, `require_owner` liest
aber nur `ServerMember.role`, also verlor er jeden owner-gegateten Reducer
**einschließlich `transfer_ownership` selbst**: kein Weg zurück. Und weil die Rolle
nun `Moderator` war, griff die Schranke in `leave_server` nicht mehr — der Ex-Owner
konnte den Space endgültig verwaist zurücklassen.

---

<a id="b2"></a>
## B2 — Owner konnte sich selbst kicken oder bannen · ✅ **behoben**

**Behoben in PR #82** (`fix/module-permission-gaps`).

`kick_member` und `ban_member` hatten dieselben vier Prüfungen kopiert — und die
fehlende fehlte folglich in beiden. Beide laufen jetzt über einen gemeinsamen Gate
`require_can_remove_member` (`server/src/reducers/member_management.rs`), der
Selbstbezug ausschließt.

Die Sperre gilt für **jede** Rolle, nicht nur für den Owner: ein Moderator, der sich
selbst kickt, ist `leave_server` mit Umweg, also gibt es nichts zu erlauben und einen
Fall weniger zu bedenken. `leave_server` bleibt der unterstützte Ausgang und weist
einen Owner weiterhin ab.

Bemerkenswert: Das UI war nie das Problem — `MembersTab.tsx` blendet das
Aktionsmenü für die eigene Zeile aus (`canActOnTarget = … && !isSelf`). Die Lücke war
ausschließlich über den direkten Reducer-Aufruf erreichbar, also genau über den Weg,
gegen den das Modul absichern muss.

---

<a id="b3"></a>
## B3 — `edit_direct_message` prüfte weder Block noch Freundschaft · ✅ **behoben**

**Behoben in PR #82** (`fix/module-permission-gaps`).

`edit_direct_message` wendet jetzt dieselben zwei Prüfungen an wie
`send_direct_message`: `has_block_either_direction` und `FriendStatus::Accepted`.

Vorher war Urheberschaft die einzige Bedingung. Blockieren war damit wirkungslos,
sobald der Blockierte irgendwann eine DM geschickt hatte: er behielt einen dauerhaften
Schreibkanal in die DM-Ansicht des Opfers, weil `my_direct_messages` nach
Sender/Empfänger filtert und nicht nach Block-Status.

**Bewusste Härte:** Auch das Entfreunden sperrt das Bearbeiten, nicht nur das
Blockieren. Damit ist Bearbeiten exakt so restriktiv wie Senden — die Parität ist die
Regel, die man sich merken kann. Der Preis ist, dass eine Tippfehlerkorrektur nach dem
Entfreunden nicht mehr möglich ist; Löschen bleibt unberührt.

---

<a id="b4"></a>
## B4 — `edit_message` prüft weder Mitgliedschaft, Timeout noch Lösch-Status · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** `send_message` und `edit_message` teilen sich `require_can_post` (Text-Channel,
Mitgliedschaft, `moderator_only`, Timeout); `edit_message` weist zusätzlich gelöschte
Nachrichten ab. Damit entstehen auch keine Storage-Referenzen an gelöschten Nachrichten
mehr. Tests in `posting-and-invites.test.ts`. Die ursprüngliche Analyse:

**Stelle:** `server/src/reducers/messages.rs:48-75`

`send_message` (`:9-45`) prüft Mitgliedschaft, `moderator_only` und `timeout_until`.
`edit_message` prüft nur `sender_identity == ctx.sender()`. Daraus folgen drei Lücken:

1. **Nach Kick oder Ban** kann der ehemalige Sender seine alten Nachrichten weiter
   bearbeiten. Er ist kein Mitglied mehr, sieht sie über `my_channel_messages` zwar
   nicht mehr, kennt die IDs aber aus seiner vorherigen Sitzung.
2. **Während eines Timeouts** (`timeout_member`, `member_management.rs:100`) kann er
   weiter Inhalte in den Channel schreiben — nur eben durch Bearbeiten statt Senden.
3. **Nach dem Löschen durch einen Moderator** ist die Bearbeitung weiter möglich.
   `delete_message` (`:78-102`) setzt `deleted = true` und ersetzt den Inhalt durch
   `"[message deleted]"`; `edit_message` prüft `deleted` nicht und überschreibt den
   Inhalt erneut. Die UI blendet die Aktion aus
   (`src/features/channels/MessageBubble.tsx:124`, `canEdit = … && !message.deleted`) —
   der Reducer verlässt sich also auf eine reine Client-Prüfung. In der Datenbank und
   im Archiv steht danach wieder der neue Inhalt.

**Nachtrag 2026-09-24:** Seit PR #92 legt `edit_message` über
`sync_message_references` auch Storage-Referenzen an. Ein Edit auf eine gelöschte
Nachricht (`deleted = true`) hängt damit wieder Anhänge an eine Zeile, die
`delete_message` gerade von ihren Referenzen befreit hat; `rebuild_storage_references`
überspringt gelöschte Nachrichten und würde sie beim nächsten Rebuild wieder
verwerfen — die beiden Pfade widersprechen sich.

**Verifiziert** (2026-09-24, temporärer Test gegen `letschattest`): Edit nach
Moderator-Löschung und Edit nach Kick werden beide angenommen; die Zeile trägt danach
`deleted = true` mit neuem Inhalt.

---

<a id="b5"></a>
## B5 — `update_profile`: `display_name` und `avatar_url` völlig unvalidiert · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** `validate_display_name` (getrimmt, 1–100 Zeichen, keine Steuerzeichen) gilt
in `update_profile`. `register_user` kürzt statt abzulehnen, weil core-api längere
Namen akzeptiert und ein bestehendes Konto sonst nicht mehr in den Chat käme. Der
Nebenbefund (Byte- statt Zeichenlänge bei Nachrichten) bleibt bewusst: die 4000 Bytes
sind eine Speichergrenze, in die auch der Anhang-Marker zählt. Test in
`module-hygiene.test.ts`. Die ursprüngliche Analyse:

**Stellen:** `server/src/reducers/users.rs:52-73`, `:7-49` (`register_user`)

```rust
if let Some(name) = display_name {
    user_row.display_name = name;      // keine Längen- oder Inhaltsprüfung
}
if avatar_url.is_some() {
    user_row.avatar_url = avatar_url;  // keine Prüfung auf Schema, Host, Länge
}
```

Der Kontrast innerhalb derselben Datei ist auffällig: `username` wird über
`is_valid_username` auf 2-32 Zeichen und `[a-z0-9_]` geprüft (`helpers.rs:13-20`).
`display_name` wird in `register_user` genauso ungeprüft übernommen.

Zum Vergleich validieren andere Reducer sehr wohl: `set_server_icon` begrenzt auf
2048 Zeichen (`servers.rs:278-283`), `set_server_discovery` auf 280
(`servers.rs:135-140`), `set_server_tags` auf 5 × 24 (`servers.rs:178-192`).

**Auswirkung:** Ein `display_name` beliebiger Länge (bis zum Nachrichtenlimit des
SDK) landet in der Zeile, wird über `my_visible_users` an *alle* Clients ausgeliefert,
die den Nutzer sehen können, und bricht dort das Layout. In der core-api gilt
dasselbe: `Validation.Required` hat ebenfalls keine Obergrenze ([A7](#a7)).

**Nebenbefund:** Die Längenprüfungen im gesamten Modul verwenden `.len()` — also
Bytes, nicht Zeichen. `send_message` erlaubt „1-4000 chars", lässt bei
Nicht-ASCII-Text aber effektiv nur ~1000 Zeichen zu. `set_server_discovery` macht es
mit `.chars().count()` richtig; die übrigen Stellen sind inkonsistent.

---

<a id="b6"></a>
## B6 — Avatar- und Icon-URLs erlauben Tracking über beliebige Fremdhosts · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Der Rest: `AvatarImage` rendert nur noch eigene Storage-Keys sowie
lokale `blob:`/`data:`-Vorschauen, keine entfernten URLs mehr. Alt-Einträge mit
Fremd-URL bleiben in der Datenbank, werden aber nicht mehr geladen und zeigen Initialen.
Nur statisch geprüft (kein DOM-Test-Setup im Projekt). Die ursprüngliche Analyse und der
Zwischenstand:

**Stand 2026-09-24:** PR #92 hat den Schreibpfad geschlossen. `update_profile`
(`server/src/reducers/users.rs:88-97`) prüft einen *geänderten* Avatar über
`sync_avatar_reference`, `set_server_icon` (`servers.rs:276-313`) jeden Icon-Wert über
`sync_icon_reference` — beide lassen nur eigene Storage-Keys zu, eine externe URL wird
abgewiesen. Offen bleibt der **Altbestand**: Zeilen, die vor PR #92 eine Fremd-URL
gespeichert haben, behalten sie (der Avatar bewusst, solange er unverändert bleibt),
und `AvatarImage` (`src/components/ui/avatar.tsx:51-58`) reicht jeden
Nicht-`uploads/`-Wert weiterhin direkt als `src` durch. Eine einmalige Bereinigung
der Altwerte (Modul-Migration, die Nicht-`uploads/`-Werte auf `None` setzt) plus ein
Client, der nur Storage-Keys rendert, schließt den Befund. Die ursprüngliche Analyse
folgt unverändert.

**Stellen:** `server/src/reducers/users.rs:67-69`, `servers.rs:267-294`,
`src/features/settings/AccountTab.tsx:135`, alle `<AvatarImage src={…} />`-Stellen

`avatar_url` und `icon_url` werden als freie Strings gespeichert (bei `icon_url`
immerhin längenbegrenzt) und im Client direkt als `src` eines `<img>` gerendert —
z. B. `src/features/channels/MessageBubble.tsx:110`,
`src/layouts/app-layout/MemberPanel.tsx:92`, `src/pages/DiscoverPage.tsx:98`.

**Auswirkung:** Ein Nutzer setzt seine `avatar_url` auf einen von ihm kontrollierten
Host. Jeder Client, der ihn in einer Mitgliederliste, einem Nachrichtenverlauf oder
auf einer Discover-Karte darstellt, lädt das Bild und offenbart dabei IP-Adresse,
User-Agent und den Zeitpunkt an diesen Host. Bei einem Space-Icon auf der
Discover-Seite trifft das jeden Besucher der Seite.

Kein XSS: React rendert `src` als Attribut, `javascript:`-URLs sind in einem `<img>`
wirkungslos, und es gibt im gesamten Client kein `dangerouslySetInnerHTML`.

**Zusätzlicher Widerspruch:** Die vorbereitete CSP (`deploy/web/Caddyfile`) erlaubt
`img-src 'self' data: blob: https://{$FILES_DOMAIN}`. Sobald sie scharf geschaltet
wird ([E4](#e4)), brechen alle externen Avatare als kaputte Bilder — die Funktion und
die geplante CSP schließen einander aus. Beides deutet auf denselben Fix hin: Nur
Keys/URLs aus dem eigenen MinIO zulassen.

---

<a id="b7"></a>
## B7 — Invite-Token mit nur 8 Zeichen, kein Kollisionsschutz, kein Mengenlimit · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Tokens haben 16 Zeichen (62¹⁶ ≈ 5·10²⁸) und werden bei einer
Kollision neu erzeugt statt den Reducer über den Primärschlüssel panicken zu lassen.
Pro Space sind höchstens 200 aktive Invites erlaubt, eine Whitelist hat höchstens 50
Einträge. Test in `module-hygiene.test.ts`. Die ursprüngliche Analyse:

**Stellen:** `server/src/reducers/invites.rs:80-85`, `:100-108`, `:266-284`

```rust
let token: String = ctx.rng().sample_iter(&Alphanumeric).take(8).map(char::from).collect();
```

Drei Punkte:

1. **Entropie.** 62⁸ ≈ 2,2 × 10¹⁴. Für ein Bearer-Credential wenig, und `use_invite`
   ist weder rate-limitiert noch protokolliert. [A1](#a1) verhindert inzwischen
   anonymes Raten; ein registrierter Angreifer kann Versuche aber weiterhin direkt
   über den Reducer verteilen.
2. **Kollision.** `token` ist der Primärschlüssel. `ctx.db.invite().insert(...)` bei
   einem bereits vorhandenen Token verletzt die Unique-Constraint und lässt den
   Reducer panicken. Es gibt keine Retry-Schleife.
3. **Menge.** Weder pro Nutzer noch pro Space existiert eine Obergrenze für die Anzahl
   der Invites. `allowed_usernames: Vec<String>` (`:63`) ist ebenfalls unbegrenzt —
   ein einzelner Aufruf kann eine sehr große Liste in eine Zeile schreiben.

---

<a id="b8"></a>
## B8 — `create_invite`: `expires_in_seconds` läuft in einen i64-Overflow · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** `expires_in_seconds` muss zwischen 1 Sekunde und 365 Tagen liegen;
`None` bleibt „nie". Test in `module-hygiene.test.ts`. Die ursprüngliche Analyse:

**Stelle:** `server/src/reducers/invites.rs:87-92`

```rust
let expiry = if let Some(seconds) = expires_in_seconds {
    ctx.timestamp + TimeDuration::from_micros((seconds as i64) * 1_000_000)
}
```

`expires_in_seconds` ist ein vom Client frei wählbares `u64`. Es gibt keine
Bereichsprüfung. Bei großen Werten ist `seconds as i64` negativ, und die
Multiplikation mit 1 000 000 läuft über. Im Release-Build (WASM, `--release`) wird
still umgebrochen.

**Auswirkung:** Der Invite bekommt ein Ablaufdatum in der Vergangenheit oder einen
sinnlosen Wert. `cleanup_stale_invites_internal` löscht ihn beim nächsten Durchlauf
sofort wieder. Kein Sicherheitsproblem, aber ein stiller Fehlschlag statt einer
klaren Fehlermeldung.

Zum Vergleich: `timeout_member` (`member_management.rs:100`) macht es richtig und
begrenzt auf 1 s bis 28 Tage.

---

<a id="b9"></a>
## B9 — `avatar_url` lässt sich nie wieder entfernen · ✅ **behoben**

**Behoben nebenbei durch PR #92** (Object-Storage). `update_profile` akzeptiert jetzt
einen leeren String als Entfernen: `sync_avatar_reference` filtert `""` zu „kein
Key", räumt die Referenz ab, und die Zeile speichert `Some("")`, das der Client
(`AvatarImage`, `AccountTab.tsx:145`) als „kein Avatar" behandelt. Nur statisch
geprüft; es gibt dafür noch keinen Regressionstest. Die ursprüngliche Analyse:

**Stelle:** `server/src/reducers/users.rs:67-69`

```rust
if avatar_url.is_some() {
    user_row.avatar_url = avatar_url;
}
```

`None` bedeutet hier „nicht ändern" — es gibt keinen Weg, `None` als „entfernen" zu
übermitteln. Ein einmal gesetzter Avatar kann nur ersetzt, nie gelöscht werden.

`set_server_icon` (`servers.rs:267-294`) löst dasselbe Problem korrekt: Ein leerer
String wird zu `None` normalisiert und entfernt das Icon.

---

<a id="b10"></a>
## B10 — Owner kann sich per `set_member_role` selbst degradieren · ✅ **behoben**

**Behoben auf Branch `bug-security-fixes`.** `set_member_role` weist ein Ziel mit
Rolle `Owner` ab („use transfer_ownership …"); weil nur der Owner den Reducer aufrufen
darf, ist das genau der Selbstbezug. Regressionstest in
`member-permissions.test.ts`. Die ursprüngliche Analyse:

**Stelle:** `server/src/reducers/member_management.rs:181-205`

Dieselbe Lücke wie [B1](#b1)/[B2](#b2), im dritten Reducer, der eine Rolle verändert.
`set_member_role` verbietet nur `new_role == Owner`, prüft aber weder
`target_identity != ctx.sender()` noch, ob das Ziel der Owner ist. Ein Owner, der sich
selbst auf `Moderator` oder `Member` setzt, verliert jede owner-gegatete Aktion
einschließlich `transfer_ownership` und `delete_server`; `Server.owner_identity` zeigt
weiter auf ihn, aber `require_owner` liest nur `ServerMember.role`. Da die Rolle nun
nicht mehr `Owner` ist, lässt ihn `leave_server` auch gehen — der Space ist dauerhaft
verwaist.

**Verifiziert** (2026-09-24, temporärer Test gegen `letschattest`):
`set_member_role(server, owner, moderator)` wird angenommen, danach scheitert
`rename_server` mit `owner permission required`.

**Richtung für einen Fix:** In `set_member_role` ein Ziel mit Rolle `Owner`
ablehnen („use transfer_ownership"). Das deckt Selbstbezug mit ab, weil nur der Owner
den Reducer aufrufen darf.

---

<a id="b11"></a>
## B11 — `ban_member` entfernt die Voice-Präsenz des Gebannten nicht · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Kick, Ban und Timeout rufen den gemeinsamen Helper `remove_voice_presence`.
WebSocket-Test in `voice-lifecycle.test.ts`, der gegen das alte Modul fehlschlägt.
Die ursprüngliche Analyse:

**Stelle:** `server/src/reducers/member_management.rs:78-106` (vgl. `kick_member`
`:46-76`)

`kick_member` löscht die `VoiceParticipant`-Zeilen des Ziels in allen Channels des
Space, `ban_member` löscht nur `ServerMember`. Der Gebannte bleibt bis zum Ende seiner
Verbindung als Teilnehmer im Voice-Channel sichtbar, belegt einen der 15 Plätze
(`voice.rs:28`), und sein laufender LiveKit-Raum bleibt ohnehin bestehen
([A10](#a10)). Neue LiveKit-Tokens bekommt er nicht mehr: `my_voice_participants`
zeigt ihm als Nicht-Mitglied die eigene Zeile nicht, das Gate in
`HasVoicePresenceAsync` verweigert also korrekt.

Statisch geprüft; ein Test braucht eine WebSocket-Verbindung, weil HTTP-Joins die
Zeile beim Verbindungsende sofort verlieren.

**Richtung für einen Fix:** Die Voice-Bereinigung aus `kick_member` in einen
gemeinsamen Helper ziehen und in beiden Reducern aufrufen.

---

<a id="b12"></a>
## B12 — `send_dm_server_invite` ignoriert Blockierungen · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** `send_dm_server_invite` prüft `has_block_either_direction` wie
`send_direct_message`. Eine Freundschaft wird bewusst nicht verlangt. Test in
`posting-and-invites.test.ts`. Die ursprüngliche Analyse:

**Stelle:** `server/src/reducers/invites.rs:234-302`

Der Reducer prüft Invite-Recht, Existenz, Mitgliedschaft und Bann des Empfängers, aber
weder `has_block_either_direction` noch eine Freundschaft. Die Zeile erscheint über
`my_dm_server_invites` beim Empfänger und macht den Absender zusätzlich in dessen
`my_visible_users` sichtbar (`views.rs:443-449`).

**Auswirkung:** Blockieren beendet nicht jeden Kontakt. Ein blockierter Nutzer legt
beliebig viele Spaces an (Default-Policy `Anyone`) und schickt aus jedem einen
DM-Invite — ein Belästigungskanal, den das Opfer nicht schließen kann. Dieselbe
Parität, die [B3](#b3) für `edit_direct_message` hergestellt hat, fehlt hier.

**Verifiziert** (2026-09-24, temporärer Test gegen `letschattest`): Opfer blockiert,
der Blockierte sendet danach erfolgreich einen DM-Invite, das Opfer sieht die Zeile.

---

<a id="b13"></a>
## B13 — `send_message` prüft die Channel-Art nicht; Timeout gilt nicht für Voice · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** `require_can_post` verlangt einen Text- oder Announcement-Channel;
`join_voice_channel` weist ein Mitglied im Timeout ab, und `timeout_member` entfernt es
sofort aus dem Voice-Channel. Tests in `posting-and-invites.test.ts`. Die ursprüngliche
Analyse:

**Stellen:** `server/src/reducers/messages.rs:12-57`,
`server/src/reducers/voice.rs:8-62`

- `send_message` akzeptiert jeden Channel, auch `ChannelKind::Voice`. Der Client zeigt
  dort keinen Text an, die Zeilen landen aber in `message`, werden an alle Mitglieder
  repliziert, archiviert und belegen das 200er-Fenster ([C3](#c3)) des Channels.
  **Verifiziert** gegen `letschattest`.
- `join_voice_channel` prüft `timeout_until` nicht. Ein Mitglied im Timeout darf nicht
  schreiben, aber im Voice-Channel sprechen und seinen Bildschirm teilen.

---

# C — Performance und Skalierung

<a id="c1"></a>
## C1 — Jede eingehende Nachricht löste drei volle Durchläufe der Historie aus · ✅ **behoben**

**Behoben in PR #73** (`perf/incremental-message-sync`).

Im stationären Betrieb fiel pro eingehender Zeile Arbeit proportional zur
gesamten lokal gehaltenen Historie an, und das dreifach: `syncMessages` mappte
und sortierte jeden Channel neu, `setChannelMessages` verglich danach Feld für
Feld, und `recomputeUnreadStateFromReadCursors` lief zweimal über jede Nachricht
jedes Channels — einmal aus dem Handler, einmal aus `handleIncomingMessage`.
Präsenz (alle 25 s je sichtbarem Nutzer) und Typing (pro Tastenanschlag) machten
denselben vollen Rebuild.

Die Handler arbeiten jetzt inkrementell auf der betroffenen Zeile statt den
Store neu aufzubauen.

---

<a id="c2"></a>
## C2 — Initialer Sync war O(N²) und lief in den Verbindungs-Timeout · ✅ **behoben**

**Behoben in PR #73** (`perf/incremental-message-sync`).

`watchLiveTables` wird vor dem Abonnement registriert, und der `isLive()`-Guard
stand **hinter** den Rebuilds. Beim initialen Anwenden feuerte `onInsert` einmal
pro Zeile, und jeder dieser Aufrufe baute jeden Store aus den bis dahin
eingetroffenen Zeilen neu auf — O(N²) innerhalb des Verbindungsbudgets, das erst
in `onApplied` gelöscht wird. Nutzer mit echter Historie erreichten es nie und
sahen `"Connection Error"` gegen einen gesunden Server.

Jeder Handler bricht jetzt ab, bevor er Arbeit tut, solange das Abonnement nicht
live ist; `syncAll` in `onApplied` macht den einen vollständigen Durchlauf. Das
Budget wurde zusätzlich von 5 s auf 45 s angehoben und dokumentiert, was es
tatsächlich abdeckt.

---

<a id="c3"></a>
## C3 — `my_channel_messages` lieferte die komplette Historie ohne Limit · ✅ **behoben**

**Behoben in PR #77** (`perf/bounded-message-history`).

Beide Nachrichten-Views sind jetzt begrenzt: die neuesten 200 Zeilen **pro
Channel** und **pro Konversation** (`RECENT_MESSAGE_WINDOW` in `views.rs`). DMs
werden vor dem Schnitt nach Gegenüber gruppiert, damit ein einzelner reger Thread
nicht alle anderen aus dem Fenster drängt — dabei fiel auch auf, dass eine
Notiz an sich selbst doppelt zurückkam, weil sie sowohl den Sender- als auch den
Empfänger-Filter traf.

Ältere Historie bleibt erreichbar, seitenweise über zwei neue Prozeduren
(`server/src/procedures.rs`): `load_older_channel_messages` und
`load_older_direct_messages`. **Prozeduren statt Views**, weil eine View in
SpacetimeDB 2.5 keine Parameter annimmt (`Views do not take parameters other
than &ViewContext`) — „älter als X" lässt sich als View gar nicht ausdrücken.
Beide sind lesend, senden nichts an andere Clients und sind so abgesichert wie
die Views: Account vorhanden und nicht gesperrt, plus Mitgliedschaft im Space
des Channels bzw. Beteiligung an der Konversation.

**Rest-Lücke:** Die Token-Generation-Untergrenze aus [A4](#a4) lässt sich in der
Prozedur nicht prüfen — innerhalb von `with_tx` ist der Sender `Identity::ZERO`
und kein JWT im Zugriff. Das ist dieselbe lesende Lücke, die A4 bereits
dokumentiert; Schreibzugriff bleibt vollständig gegated.

Client-seitig holt der Feed die nächste Seite, sobald über die älteste lokal
gehaltene Nachricht hinaus gescrollt wird. Nachgeladene Seiten liegen neben dem
Live-Fenster im Store, damit der nächste Subscription-Sync — der dieses Fenster
komplett ersetzt — sie nicht wieder wegwirft.

Verifiziert gegen eine echte SpacetimeDB-Instanz: 4 neue Fälle in
`tests/security/message-history.test.ts` (View stoppt bei 200 von 205 gesendeten
Nachrichten, die 5 darunter kommen über die Prozedur zurück, ein Nicht-Mitglied
bekommt nichts, DM-Paging bleibt auf den eigenen Thread beschränkt), plus 3
Unit-Tests auf die Store-Zusammenführung.

Nicht in einer laufenden Desktop-Sitzung durchgeklickt: der Pfad
Scroll-an-den-Anfang → Nachladen → Rendern.

---

<a id="c4"></a>
## C4 — `my_server_members` gab alle Mitglieder aller Discover-Spaces preis · ✅ **behoben**

**Behoben in PR #89** (`fix/private-discover-members`).

`my_server_members` liefert nur noch Mitglieder von Spaces, denen der aufrufende
Client selbst angehört. Discover-Karten beziehen ihre Zahl aus der separaten View
`discover_server_member_counts`, die pro öffentlichem Space ausschließlich
`server_id` und `member_count` veröffentlicht. Identitäten, Rollen, Beitrittszeiten
und Timeouts fremder Mitglieder verlassen den Server nicht mehr.

Der Client abonniert die Aggregation separat. Änderungen daran aktualisieren nur
noch den Discover-Store statt der sechs serverbezogenen Stores. Ein Black-box-Test
gegen die HTTP-/SQL-Grenze verifiziert sowohl die leere fremde Mitglieder-View als
auch den weiterhin korrekten aggregierten Count.

---

<a id="c5"></a>
## C5 — Typing-Indikator machte im Hotpath einen Full-Table-Scan · ✅ **behoben**

**Behoben in PR #90** (`fix/auth-and-scaling-batch`).

Die DM-Scope-Identitäten werden jetzt direkt als `Identity` geparst. Die
Freundschaftsprüfung verwendet den vorhandenen `find_friend_row`-Lookup über den
`pair_key`-Primärschlüssel statt `friend().iter()`. Auch die Channel-Autorisierung
nutzt mit `has_member_role` den vorhandenen Membership-Primärschlüssel.

Drei Black-box-Tests decken akzeptierte Freunde, Nicht-Freunde sowie erlaubte und
abgewiesene Channel-Mitglieder ab.

---

<a id="c6"></a>
## C6 — Lösch-Reducer scannten ganze Tabellen statt Indizes zu nutzen · ✅ **behoben**

**Behoben in PR #90** (`fix/auth-and-scaling-batch`).

Channel-, Message-, Mitglieder-, Ban-, Invite-, Join-Request- und Voice-Zeilen werden
jetzt über ihre vorhandenen `server_id`-, `channel_id`-, `room_key`- und
`user_identity`-Accessors gelesen. Für `VoiceParticipant.user_identity` kam der eine
fehlende B-Tree-Index hinzu. `delete_server` verwendet außerdem den gemeinsamen
`delete_channel_with_dependencies`-Pfad statt Message-, Voice- und Channel-Cleanup zu
duplizieren.

Regressionstests prüfen, dass ein Disconnect nur die Voice-Zeilen der sterbenden
Verbindung entfernt und dass beim Löschen eines Space dessen Pins mit verschwinden.

---

<a id="c7"></a>
## C7 — Mitglieder-Events erzwingen instanzweiten Re-Sync bei allen Clients · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** `watchLiveTables` unterscheidet jetzt: Ändert sich die *eigene*
Mitgliedschaft, laufen weiterhin alle sechs Space-Stores neu (alle filtern danach). Tritt
ein anderes Mitglied bei, aus, oder ändert sich seine Rolle, läuft nur `syncMembers`.
`my_servers`-Events bauen nur Servers und Discover neu.

**Nebenbefund dabei, mitbehoben:** `my_join_requests` hatte gar keinen Live-Handler.
Neue Beitrittsanfragen erreichten Moderatoren und eine Ablehnung den Anfragenden nur,
wenn zufällig ein anderes Mitglieder-Event den breiten Re-Sync auslöste. Drei neue
Unit-Tests in `events.test.ts`. Nicht im laufenden Client durchgeklickt. Die ursprüngliche
Analyse:

**Stellen:** `watchLiveTables` in `src/lib/spacetimedb/events.ts` und
`syncServerScopedState` in `src/lib/spacetimedb/sync.ts`

```ts
const serverScoped = stale('serverScoped', () => syncServerScopedState(conn))
conn.db.my_server_members.onInsert(serverScoped)
conn.db.my_server_members.onUpdate(serverScoped)
conn.db.my_server_members.onDelete(serverScoped)
```

`syncServerScopedState` führt sechs vollständige Re-Syncs aus: `syncServers`,
`syncMembers`, `syncChannels`, `syncInvites`, `syncDiscover`, `syncJoinRequests`.

Seit [C4](#c4) behoben ist, erhalten nur noch Mitglieder des betroffenen Space die
vollständigen Mitglieder-Events; Discover-Counts aktualisieren separat nur den
Discover-Store. Offen bleibt: Jeder Beitritt, jedes Verlassen, jede Rollenänderung
und jede Timeout-Änderung baut bei jedem verbundenen Mitglied des Space weiterhin
sechs Stores vollständig neu auf. Außerdem aktualisiert eine Count-Änderung den
Discover-Store auch bei Clients, die die Discover-Seite nicht geöffnet haben.

---

<a id="c8"></a>
## C8 — `cleanup_stale_invites_internal` scannt bei jeder Invite-Operation · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Keine Invite-Operation scannt mehr alle Invites der Instanz:
`create_invite` und `send_dm_server_invite` räumen nur den eigenen Space über den
`server_id`-Index auf, `use_invite` sucht DM-Zeilen über `by_recipient`, und die
Doppel-/Dreifach-Aufrufe in `respond_dm_server_invite` samt der wirkungslosen
Rollback-Logik (Nebenbefund) sind entfernt. Der globale Durchlauf bleibt nur in
`cleanup_expired_invites`. Die ursprüngliche Analyse:

**Stelle:** `server/src/reducers/invites.rs:22-55`

Die Funktion scannt `invite` vollständig und danach `dm_server_invite` vollständig,
mit einem Punkt-Lookup pro gefundener DM-Invite-Zeile.

Aufgerufen wird sie in `create_invite` (`:66`), `use_invite` (`:115`),
`send_dm_server_invite` (`:237`), `respond_dm_server_invite` (`:306`) und
`cleanup_expired_invites` (`:224`) — also bei praktisch jeder Invite-Operation.

`respond_dm_server_invite` ruft sie im Erfolgsfall zweimal (einmal direkt, einmal über
das intern aufgerufene `use_invite`), im Fehlerfall dreimal (`:340`).

**Nebenbefund (S4):** Die Rollback-Logik in `respond_dm_server_invite` (`:333-341`) ist
funktionslos. Ein Reducer, der `Err` zurückgibt, macht in SpacetimeDB die gesamte
Transaktion rückgängig — auch die Rollback-Schreibvorgänge selbst.

---

<a id="c9"></a>
## C9 — `rebuild_storage_references` scannt die gesamte Historie in einer Transaktion · **akzeptiert**

**Akzeptiert (Branch `fix/security-batch-2`).** Seit dem ersten Teil läuft der Rebuild nur
noch, wenn das Modul selbst „nicht bereit" meldet — nach Upgrade, Wipe oder Restore, also
in einem Wartungsfenster, in dem eine Schreibpause hinnehmbar ist. Seitenweises Aufteilen
bleibt als `ponytail:`-Notiz am Reducer, falls es je das Zeitbudget sprengt. Die
ursprüngliche Analyse und der Zwischenstand:

**Teilweise behoben auf Branch `bug-security-fixes`.** core-api startet optimistisch
(`_storageReferencesReady = true`) und setzt das Flag nur noch zurück, wenn das Modul
selbst „storage references are not ready" meldet oder der View seinen Sentinel
weglässt — nicht mehr bei Transport- oder HTTP-Fehlern. Der Rebuild läuft damit nur
noch nach einem Upgrade, Wipe oder Restore, nicht bei jedem Start. Korrektheit
hängt daran nicht: `claim_unreferenced_storage` prüft den Ready-Zustand im Modul
atomar. **Offen:** Wenn er läuft, ist der Rebuild weiterhin ein einzelner
Full-Scan-Reducer. Die ursprüngliche Analyse:

**Stellen:** `server/src/storage_refs.rs:196-247`,
`core-api/src/CoreApi/Services/SpacetimeClient.cs:418`, `:444`, `:454`, `:490-513`,
`Services/PendingUploadSweeper.cs:113`

Der Rebuild löscht jede `storage_reference`-Zeile und iteriert danach vollständig über
`message`, `direct_message`, `user` und `server` — inklusive Base64-/JSON-Parsing jeder
Nachricht mit Anhang-Marker — in **einem** Reducer. core-api ruft ihn nicht nur nach
Upgrades auf: `_storageReferencesReady` ist prozesslokal und startet auf `false`, also
läuft der Rebuild bei **jedem core-api-Start**, und jeder fehlgeschlagene Claim oder
View-Read setzt das Flag zurück, sodass der nächste Sweep eine Minute später erneut
rebuildet.

**Auswirkung:** SpacetimeDB serialisiert alle Schreibvorgänge. Auf einer Instanz mit
großer Historie blockiert jeder Rebuild alle Reducer (Nachrichten, Presence, Typing)
für seine gesamte Laufzeit; überschreitet er das Reducer-Zeitbudget, scheitert er
jede Minute erneut — Cleanup steht dann still (fail-closed, kein Datenverlust), aber
die Last bleibt. Ein kurzer SpacetimeDB-Schluckauf während eines Claims reicht als
Auslöser.

**Richtung für einen Fix:** Den Ready-Zustand im Modul (`storage_reference_state`)
als Wahrheit behandeln und nur rebuilden, wenn *er* `false` ist, statt bei jedem
Transportfehler; den Rebuild seitenweise über mehrere Reducer-Aufrufe verteilen.

---

<a id="c10"></a>
## C10 — Weitere lineare Scans in häufig aufgerufenen Reducern · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Die häufigen Pfade sind umgestellt: `mark_channel_read` nutzt
`has_member_role`, `send_dm_server_invite` und `use_invite` den `by_recipient`-Index.
`set_server_discovery` und `set_user_admin` scannen weiterhin — beide laufen selten und
über Admin- bzw. Owner-Aktionen. Die ursprüngliche Analyse:

Nachtrag zu [C5](#c5)/[C6](#c6); dieselbe Klasse, jeweils mit vorhandenem
Punkt-Lookup als Alternative:

| Stelle | Scan | Aufruf-Frequenz |
|---|---|---|
| `mark_channel_read` (`read_state.rs:37-42`) | alle Mitglieder des Space statt `has_member_role` | bei jedem gelesenen Channel |
| `set_server_discovery` (`servers.rs:149-161`) | gesamte `server`-Tabelle | selten |
| `send_dm_server_invite` (`invites.rs:261-265`) | gesamte `dm_server_invite`-Tabelle statt `by_recipient` | pro DM-Invite |
| `use_invite` (`invites.rs:175-183`) | gesamte `dm_server_invite`-Tabelle | pro erschöpftem Invite |
| `set_user_admin` (`system.rs:197-202`) | gesamte `user`-Tabelle | selten |

---

# D — Datenkonsistenz und Leaks

<a id="d1"></a>
## D1 — `TypingState` wird bei Verbindungsabbruch nie aufgeräumt · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** `client_disconnected` löscht die `TypingState`-Zeilen der Identity
über den `by_user`-Index. Ein weiteres offenes Fenster setzt sie beim nächsten
Tastenanschlag neu. WebSocket-Test in `voice-lifecycle.test.ts`; der HTTP-basierte
Typing-Test prüft deshalb nur noch die Autorisierung. Die ursprüngliche Analyse:

**Stellen:** `server/src/reducers/presence.rs:100-130`,
`server/src/reducers/voice.rs:69-98`

Eine `TypingState`-Zeile wird ausschließlich durch `set_typing_state(scope, false)`
gelöscht (`presence.rs:127`). Es gibt im gesamten Modul keinen Scheduled Reducer — eine
Suche nach `scheduled`, `ScheduleAt` und `scheduled_at` über `server/src/` liefert
keinen Treffer. Auch `on_client_disconnected` räumt ausschließlich `voice_participant`
und `dm_voice_participant` auf, nicht `typing_state`.

**Auswirkung:** Bricht die Verbindung ab, während der Nutzer tippt — App gekillt,
Netzwerk weg, Proxy-Cull, Modul-Republish — bleibt die Zeile **dauerhaft** in der
Tabelle. Die Tabelle wächst monoton mit der Zahl solcher Abbrüche. Der Client
verdeckt das über eine eigene TTL beim Rendern, aber die Daten bleiben liegen und
werden weiterhin über `my_typing_states` (`views.rs:117-195`) an alle berechtigten
Clients repliziert — eine View, die für jeden Aufruf über alle sichtbaren Nutzer
iteriert.

---

<a id="d2"></a>
## D2 — Präsenz bleibt nach Absturz dauerhaft „online" · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Eine neue private Tabelle `client_connection` (additiv) wird in
`client_connected` gefüllt und in `client_disconnected` geleert. Ist die letzte
Verbindung einer Identity weg, geht ihre Präsenz auf offline. Verbindungen von vor dem
Update haben keine Zeile; der Heartbeat eines noch offenen Clients stellt „online"
innerhalb von 25 s wieder her. WebSocket-Test in `voice-lifecycle.test.ts`. Die ursprüngliche Analyse:

**Stellen:** `server/src/reducers/presence.rs:94-98`,
`server/src/reducers/voice.rs:69-98`, `src/lib/spacetimedb/connection.ts:468-473`

`online = false` wird nur durch einen expliziten `set_presence_offline`-Aufruf
gesetzt. Der Client tut das in `disconnect()` und `signOut()` — beides sind
*geordnete* Abmeldungen. `on_client_disconnected` setzt die Präsenz **nicht** auf
offline.

**Auswirkung:** Wird die App hart beendet oder bricht das Netz weg, bleibt der Nutzer
für alle anderen dauerhaft „online". Es gibt keinen Sweeper, der das korrigiert.

Der Fix liegt nahe: `on_client_disconnected` bekommt bereits `ctx.sender()` und
`ctx.connection_id()` und räumt dort die Voice-Zeilen auf — die Präsenz könnte an
derselben Stelle mit erledigt werden (mit einer Prüfung, ob noch weitere Verbindungen
derselben Identity aktiv sind).

---

<a id="d3"></a>
## D3 — `delete_server` lässt Read-States und DM-Invites verwaist zurück · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** `delete_channel_with_dependencies` löscht die Read-States des
Channels, `delete_server` zusätzlich seine DM-Invites. Leave, Kick und Ban räumen über
`remove_member_traces` Voice-Präsenz, Read-States und eine Join-Anfrage des Nutzers ab.
Test in `module-hygiene.test.ts`. Die ursprüngliche Analyse:

**Stelle:** `server/src/reducers/servers.rs:297-379`

`delete_server` räumt auf: `message`, `voice_participant`, `server_member`, `ban`,
`invite`, `join_request`, `channel`, `server`. Nicht aufgeräumt werden:

| Tabelle | Verwaiste Zeilen |
|---|---|
| `read_state` | `scope_key = "channel:{id}"` für gelöschte Channels |
| `dm_server_invite` | verweisen auf den gelöschten Space und dessen gelöschte Token |

Der Pin-Anteil wurde in PR #90 behoben: `delete_server` verwendet jetzt
`delete_channel_with_dependencies`, das Pins zusammen mit Nachrichten, Voice-Zeilen
und Channels entfernt. Read-States und DM-Invites bleiben als Restbefund offen.

`leave_server` (`:382-409`) und `kick_member` (`member_management.rs:10`) lassen
ebenfalls `join_request`- und `read_state`-Zeilen des Betroffenen stehen.

**Auswirkung:** Monoton wachsende Tabellen mit toten Read-State- und
DM-Invite-Verweisen, die dauerhaft Platz belegen und im Archiv landen.

---

<a id="d4"></a>
## D4 — Bestätigte Anhänge überleben das Löschen ihrer Nachricht/Channels · ✅ **behoben**

**Stellen:** Message-/Channel-Lösch-Reducer unter `server/src/reducers/`,
Upload-Metadaten unter `core-api/src/CoreApi/Data/`

PR #83 hat zwei der drei ursprünglichen Ursachen geschlossen: Ein periodischer
`PendingUploadSweeper` löscht abgelaufene, nie bestätigte Uploads aus MinIO, bevor er
ihre DB-Reservierung entfernt. Scheitert die Storage-Löschung, bleiben Zeile und Quote
für einen erneuten Versuch bestehen.

Der bestätigte Lebenszyklus ist jetzt geschlossen:

- `/uploads/confirm` verschiebt die Reservierung in eine dauerhafte
  `ConfirmedUploads`-Registry statt jede Buchführung zu verwerfen.
- SpacetimeDB führt normalisierte `StorageReference`-Zeilen. Send/Edit/Delete von
  Channel-Nachrichten und DMs sowie Avatar-/Icon-Wechsel aktualisieren sie in derselben
  Transaktion wie die fachliche Zeile. Channel-/Space-Löschung und Archive-Restore sind
  ebenfalls abgedeckt.
- Vor dem ersten Cleanup baut der admin-gatete Reducer
  `rebuild_storage_references` den gesamten Bestand neu auf.
- Core API übernimmt vorhandene `uploads/`-Objekte aus dem MinIO-Inventar in die
  Registry. Damit werden auch Objekte von vor der Migration und frühere Orphans
  kontrolliert erfasst.
- Nach einer Stunde Grace Period übergibt der Sweeper Kandidaten an
  `claim_unreferenced_storage`. Der admin-gatete Reducer legt atomar nur dann einen
  dauerhaften Lösch-Claim an, wenn keine Referenz existiert; alle Referenz-Writer
  lehnen bereits geclaimte Keys ab. Damit gibt es kein Zeitfenster mehr, in dem
  zwischen Referenzabfrage und MinIO-Löschung eine neue Live-Referenz entstehen
  kann.
- Core API löscht ausschließlich Claims aus einem geschützten View mit
  Autorisierungs-/Ready-Sentinel. Erst nach erfolgreicher MinIO-Löschung fällt die
  Registry-Zeile weg; Claim und Registry bleiben bei Fehlern retrybar und
  fail-closed.

Kurzzeitig ungebundene Bytes zwischen PUT und Message-/Profil-Commit sind in einem
verteilten Flow unvermeidbar. Sie sind aber immer als Pending/Confirmed registriert und
können nicht mehr zu unbekannten oder dauerhaften Orphans werden.

---

<a id="d5"></a>
## D5 — `rekey_identities` korrumpiert Daten bei verketteten Remaps · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** `rekey_identities` lehnt Ketten (`A→B, B→C`) und mehrere Quellen
auf dasselbe Ziel ab, bevor etwas geschrieben wird. In den Tabellen mit
zusammengesetztem Schlüssel gewinnt die alte Zeile gegen eine bereits vorhandene unter
dem neuen Schlüssel, statt den Insert panicken zu lassen. Test in
`module-hygiene.test.ts`. Die ursprüngliche Analyse:

**Stelle:** `server/src/reducers/rekey.rs:51-66`

```rust
for row in ctx.db.user().iter().collect::<Vec<_>>() {      // Snapshot vor der Mutation
    let new_id = remap(row.identity);
    if new_id == row.identity { continue; }
    ctx.db.user().identity().delete(row.identity);
    if ctx.db.user().identity().find(new_id).is_some() {
        ctx.db.user().identity().delete(new_id);           // "Platzhalter" entfernen
    }
    let mut nu = row;                                       // Daten aus dem Snapshot
    nu.identity = new_id;
    ctx.db.user().insert(nu);
}
```

Die Schleife arbeitet auf einem Snapshot, der **vor** allen Mutationen erstellt wurde,
schreibt aber gegen den **aktuellen** Tabellenzustand.

**Problemfall:** Die Paar-Liste enthält `A → B` und `B → C`, und `A` steht im Snapshot
vor `B`.

1. `A` wird verarbeitet: Zeile `A` gelöscht, Zeile `B` als „Platzhalter" gelöscht,
   A-Daten unter der Identity `B` eingefügt.
2. `B` wird verarbeitet — mit den **veralteten** Snapshot-Daten von `B`. Die Zeile
   unter `B` (die jetzt A-Daten enthält) wird gelöscht, und die alten B-Daten werden
   unter `C` eingefügt.

Ergebnis: **A ist vollständig verloren.**

Ein zweiter Fall betrifft die Tabellen mit zusammengesetztem String-Schlüssel
(`server_member`, `ban`, `friend`, `block`, `read_state`, ab Zeile 123): Existiert der
neu berechnete Schlüssel bereits, verletzt `insert` die Primärschlüssel-Constraint und
lässt den Reducer panicken — die gesamte Migration bricht ab.

**Auswirkung:** Der Reducer wird von `MigrateLegacyIdentitiesAsync`
(`DbInitializer.cs:126-196`) beim Start automatisch ausgeführt. Ein Datenverlust an
dieser Stelle ist stumm und nicht rückgängig zu machen. Die Wahrscheinlichkeit einer
verketteten Zuordnung ist gering — der praktische Anwendungsfall ist eine
1:1-Abbildung —, die Auswirkung im Fehlerfall aber hoch.

**Richtung für einen Fix:** Vor Beginn prüfen, dass Quell- und Zielmenge disjunkt sind,
und andernfalls mit einer klaren Fehlermeldung abbrechen.

---

<a id="d6"></a>
## D6 — Stale Messages im Client-Store nach Hard-Delete · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** `syncMessages` und `syncDirectMessages` setzen bekannte Channels
bzw. Konversationen ohne Zeilen in der View explizit leer. Nur statisch und über
Build/Lint geprüft. Die ursprüngliche Analyse:

**Stellen:** `src/lib/spacetimedb/sync.ts:284-299`, `:361-377`

```ts
const store = useMessagesStore.getState()
for (const [channelId, rows] of grouped.entries()) {
  store.setChannelMessages(channelId, rows)
}
```

Es wird nur über die Channels iteriert, für die die View aktuell Zeilen liefert.
Verschwinden **alle** Nachrichten eines Channels — etwa nach `delete_channel`, das
hart löscht (`channels.rs:99-109`) —, taucht der Channel in `grouped` nicht mehr auf
und `messagesByChannel[channelId]` behält die alten Einträge.

Vergleichbare Stellen machen es richtig: `syncInvites` (`sync.ts:418`, Abschluss-Schleife `:440-445`) setzt für
bekannte Server ohne Zeilen explizit eine leere Liste.

Dasselbe gilt für `syncDirectMessages` (`:361`) bei Konversationen, deren Nachrichten
beidseitig gelöscht wurden (`direct_messages.rs:89-90` löscht dann hart).

---

<a id="d7"></a>
## D7 — Storage-Collector löscht nach `--delete-data` Anhänge, bevor der Archiv-Restore beginnt · ✅ **behoben**

**Behoben auf Branch `bug-security-fixes`.** `init` setzt jetzt einen unbefristeten
Fence (`fence_fresh_database`: Init-Zeitpunkt plus ~1000 Jahre, sodass er nie abläuft
und trotzdem festhält, wann `init` lief). Der erste Restore-Batch ersetzt ihn durch
den normalen 10-Minuten-Fence. Der neue, admin-gegatete Reducer
`release_storage_init_fence(oldest_object_at)` hebt ausschließlich diesen Init-Fence
auf, und nur wenn kein gespeichertes Objekt älter als `init` ist: Auf einer frischen
Installation sind alle Objekte jünger, nach einem Wipe unter bestehenden Anhängen
nicht. core-api übergibt sein ältestes `ConfirmedUploads.ConfirmedAt` und fragt jeden
Sweep erneut, bis das Modul „erledigt" meldet (gelöst, oder kein Init-Fence) — ein
fehlgeschlagener erster Versuch, nach dem schon Uploads eintreffen, blockiert damit
nicht mehr dauerhaft (Codex-Review). Upgrades bestehender Instanzen sind nicht
betroffen, weil `init` dort nicht läuft. `DEPLOYMENT.md` beschreibt den Ablauf und
die manuelle Freigabe mit `'{"none":[]}'`. Regressionstests:
`storage-lifecycle.test.ts` auf einer eigens frisch publizierten Datenbank (Rebuild
verweigert, Freigabe mit älterem Objekt verweigert, mit jüngerem erlaubt) und
`InitFenceRetrySmokeTests` für die Wiederholung im Sweeper. Die ursprüngliche
Analyse:

**Stellen:** `server/src/storage_refs.rs:118-143` (`fence_archive_restore`),
`:196-203` (Fence-Prüfung im Rebuild), `server/src/reducers/system.rs:16-50`
(`init`), `core-api/src/CoreApi/Services/PendingUploadSweeper.cs:105-147`,
`Services/SpacetimeClient.cs:414-424`, `DEPLOYMENT.md:222`

Der Fence aus Commit `d3be15b` schützt nur das Fenster **während** eines Restores:
Er wird vom ersten `archive_restore_*`-Batch gesetzt und liegt selbst in einer
Modul-Tabelle. Der dokumentierte Ablauf ist aber „drain → `--delete-data` → Rebuild
aus Postgres", und zwischen Wipe und erstem Restore-Batch gibt es **keinen** Fence:

1. `--delete-data` leert alle Tabellen, `init` legt den Module-Owner als Admin wieder
   an. `SPACETIMEDB_SERVICE_TOKEN` ist laut Anleitung genau dieser Publisher-Token, ist
   also sofort wieder Admin.
2. Nächster Sweep (≤ 1 min): `claim_unreferenced_storage` scheitert („not ready", die
   State-Zeile fehlt) → core-api setzt `_storageReferencesReady = false`.
3. Übernächster Sweep: `rebuild_storage_references` läuft auf der **leeren** Datenbank
   durch (kein Fence vorhanden), setzt `ready = true`.
4. Direkt danach werden bis zu 500 `ConfirmedUploads` älter als eine Stunde geclaimt —
   ohne Nachrichten gibt es keine Referenzen — und aus MinIO **und** der Registry
   gelöscht. Das wiederholt sich jede Minute, bis der erste Restore-Batch den Fence
   setzt.

Der anschließende Restore stellt die Nachrichten wieder her, `unclaimed()` verwirft
dabei aber die Referenzen auf bereits geclaimte Keys; die Anhänge sind endgültig weg.
Bei einem Operator, der zwischen Publish und `ARCHIVE_REBUILD=1` zehn Minuten
Schema-Checks macht, sind das bis zu ~4 000 Dateien.

Statische Analyse; Modul- und core-api-Hälfte einzeln gelesen, die Kette nicht
gegen den Stack reproduziert. „drain" ist in `DEPLOYMENT.md` nicht definiert —
wer core-api vorher stoppt, ist nicht betroffen, das steht aber nirgends.

**Richtung für einen Fix:** `init` setzt einen Fence, der **nicht** von allein
abläuft, sondern erst durch eine explizite Admin-Aktion nach abgeschlossenem Restore
aufgehoben wird (oder: `rebuild_storage_references` verweigert, solange ein
„frisch initialisiert"-Flag gesetzt ist). Zusätzlich in `DEPLOYMENT.md` „core-api vor
`--delete-data` stoppen" als Schritt aufnehmen.

---

# E — Client und Deployment

<a id="e1"></a>
## E1 — Stiller Fallback auf anonyme Identity bei Token-Ablehnung · ✅ **behoben**

**Behoben in PR #90** (`fix/auth-and-scaling-batch`).

Eine Ablehnung des gespeicherten SpacetimeDB-Tokens löst keinen anonymen zweiten
Verbindungsversuch mehr aus. Der Client beendet stattdessen Socket und Reconnect,
setzt den Client-State zurück, entfernt SpacetimeDB- und Core-API-Credentials und
zeigt explizit „Session expired“ mit einer „Sign in again“-Aktion. Andere Netzwerk-
und Schemafehler behalten den normalen Retry-Pfad.

Ein Unit-Test beweist, dass genau ein Verbindungsversuch mit dem Account-Token erfolgt,
nie ohne Token weiterverbunden wird und beide Credentials samt State bereinigt werden.

---

<a id="e2"></a>
## E2 — Abmelden während des Verbindungsaufbaus kann die Sitzung wiederbeleben · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Beide Teile. `disconnect()` erhöht eine Generation; ein `connect()`
aus einer älteren Generation probiert keinen weiteren URI-Kandidaten und keinen
Kompressions-Fallback mehr, startet keinen Heartbeat und meldet keinen Fehler. Der Fall
war schlimmer als ursprünglich beschrieben: `disconnect()` riss den noch im Aufbau
befindlichen Socket ab, `connect()` ging daraufhin zum *nächsten* Kandidaten (bzw. im Web
zum Fallback ohne Kompression) und öffnete nach der Abmeldung einen neuen. Unit-Test in
`connection.test.ts`, der gegen den alten Code fehlschlägt. Die ursprüngliche Analyse:

**Stellen:** `src/lib/spacetimedb/connection.ts:375-472` (`connect`), `:475-494`
(`disconnect`)

**Stand 2026-09-24:** Punkt 2 unten ist erledigt — `disconnect()` löscht inzwischen
einen anstehenden `reconnectTimer`, ein Reconnect kann also nicht mehr *nach* dem
Abmelden feuern. Punkt 1 besteht unverändert: Die laufende `connectPromise` wird nur
vergessen, nicht abgebrochen; nach ihrem Ende ruft `connect()` weiterhin
`startHeartbeat()` (`:462`), und eine noch in `connectWithUri` hängende Verbindung
kann nach der Abmeldung einen aktiven Socket hinterlassen. Die Zeilenangaben im Code
unten sind vom Stand 2026-08.

```ts
export async function connect(): Promise<void> {
  intentionalDisconnect = false          // (1) setzt die Abbruch-Absicht zurück
  ...
}
...
export function disconnect(): void {
  intentionalDisconnect = true           // (2)
  stopHeartbeat()
  ...
  connectPromise = null                  // (3) verwirft die Referenz, bricht nichts ab
}
```

Zwei Fehler:

1. `disconnect()` setzt `connectPromise = null`, **beendet die laufende Operation
   aber nicht**. Der äußere `await connectPromise` in `connect()` läuft weiter und
   ruft anschließend `startHeartbeat()` (`:446`) auf — nach der Abmeldung. Der
   25-Sekunden-Timer läuft von da an dauerhaft weiter; `stopHeartbeat` wurde bereits
   vorher aufgerufen und wird nicht erneut erreicht.
2. `scheduleReconnect` (`:344-356`) ruft `connect()` auf, und `connect()` setzt in
   Zeile 359 `intentionalDisconnect = false`. Ein Reconnect-Timer, der kurz nach einem
   `disconnect()` feuert, hebt damit dessen Wirkung auf.

**Auswirkung:** Ein Sign-out oder ein Verbindungsabbruch zum ungünstigen Zeitpunkt
hinterlässt einen laufenden Heartbeat-Timer (Leak) und kann im ungünstigsten Fall die
Verbindung nach der Abmeldung wieder aufbauen.

---

<a id="e3"></a>
## E3 — Discovery fällt bei nacktem Hostnamen auf `http://` zurück · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Ein nackter öffentlicher Host wird zu `https://`; `localhost`,
Loopback, `.local` und private Netze behalten `http://`. Liefert ein https-Server
Klartext-Endpunkte (`http://`, `ws://`), bricht die Discovery ab. Unit-Tests in
`src/lib/discovery.test.ts`. Die ursprüngliche Analyse:

**Stelle:** `src/lib/discovery.ts:12-15`

```ts
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  return trimmed.includes('://') ? trimmed : `http://${trimmed}`
}
```

Auf dem Setup-Bildschirm gibt der Nutzer eine Instanz an. Tippt er `chat.example.com`
statt `https://chat.example.com`, wird `/.well-known/letschat.json` über **unverschlüsseltes
HTTP** abgerufen.

**Auswirkung:** Das Discovery-Dokument legt anschließend `authServiceUrl`,
`spacetimedbUri` und `livekitUrl` für die gesamte Sitzung fest
(`discovery.ts:35-40`). Ein Angreifer im Netzpfad kann diese Antwort ersetzen und
sämtlichen Verkehr — einschließlich der Anmeldedaten — auf einen eigenen Host lenken.
Die zurückgelieferten URLs werden nicht auf ihr Schema geprüft.

Der bequeme Eingabepfad ist also zugleich der unsichere. Der Standard sollte `https://`
sein, mit einem expliziten Opt-in für lokale Entwicklung.

---

<a id="e4"></a>
## E4 — CSP wird nur im Report-Only-Modus ausgeliefert · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Der Header ist jetzt `Content-Security-Policy`. Vorher in headless Chrome mit
genau dieser Policy gegen den Dev-Stack geprüft (Dev-Hosts statt der Domain-Platzhalter):
Anmeldung über das echte Formular, SpacetimeDB-Sync, Nachrichten, ein Bild aus MinIO und
ein LiveKit-Voice-Call (Teilnehmer ACTIVE mit Audiospur) — null Verstöße. **Dabei
gefunden:** Die bisherige Policy hätte die Web-App beim Scharfschalten komplett
gebrochen. Das SpacetimeDB-SDK holt vor dem WebSocket
`https://{CHAT}/v1/identity/websocket-token`, `connect-src` erlaubte aber nur
`wss://{CHAT}`; `https://{$CHAT_DOMAIN}` ist ergänzt. Die vier Domain-Variablen sind
damit auf beiden Tracks Pflicht (`DEPLOYMENT.md`, `SECURITY.md` und die
Breaking-Changes-Seite der Website sagen das). Die ursprüngliche Analyse:

**Stelle:** `deploy/web/Caddyfile`

```
Content-Security-Policy-Report-Only "default-src 'none'; script-src 'self' 'unsafe-eval'; ..."
```

Der Kommentar erklärt den Plan sauber: erst beobachten, dann auf
`Content-Security-Policy` umbenennen. Ausgeliefert wird aber der Report-Only-Header,
und es gibt keine `report-uri`/`report-to`-Direktive — die Berichte landen also nur in
der Browser-Konsole und werden nirgends gesammelt. Damit fehlt auch das Signal, das
die Umstellung auslösen soll.

**Auswirkung:** Der als *"key anti-XSS lever"* bezeichnete Schutz ist im
ausgelieferten Zustand inaktiv. Das wiegt schwer, weil die Token im `localStorage`
liegen und 30 Tage lang nicht widerrufbar sind ([A4](#a4)) — ein XSS im Web-Build
bedeutet damit eine langfristige Account-Übernahme.

Zusätzlich blockiert die CSP in ihrer aktuellen Form externe Avatar-URLs, die das
Produkt heute erlaubt ([B6](#b6)) — die Umstellung würde ohne vorherige Änderung an
`update_profile` sichtbare Regressionen erzeugen. **Nachtrag 2026-09-24:** Der
Schreibpfad ist inzwischen zu (B6 teilweise behoben), aber `media-src` und das
fehlende `frame-src` würden beim Scharfschalten Inline-Video und PDF-Vorschau
brechen, siehe [E6](#e6).

---

<a id="e5"></a>
## E5 — Download-URL-Cache wächst unbegrenzt · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Abgelaufene Einträge fliegen bei jedem neuen Batch aus dem Cache.
`inflightDownloadRequests` war nie ein Leck (wird im `finally` geleert). Die ursprüngliche Analyse:

**Stelle:** `src/lib/downloadUrls.ts:18`

```ts
const downloadUrlCache = new Map<string, DownloadCacheEntry>()
```

Es gibt keine Größenbegrenzung und keine Räumung abgelaufener Einträge. Geleert wird
die Map nur durch `clearSignedDownloadUrlCache`, das ausschließlich beim Sign-out
aufgerufen wird (`src/lib/spacetimedb/auth.ts:31`).

**Auswirkung:** In einer lang laufenden Desktop-Sitzung mit vielen Anhängen wächst die
Map monoton. `inflightDownloadRequests` (`:19`) hat dieselbe Struktur.

---

<a id="e6"></a>
## E6 — CSPs erlauben Inline-Video und PDF-Vorschau vom Files-Host nicht · ✅ **behoben**

**Behoben auf Branch `bug-security-fixes`.** Desktop-CSP: `media-src … https:` und
`frame-src https:` (der Desktop-Client verbindet sich mit beliebigen Instanzen, wie
bei `img-src`). Web-CSP: `media-src` und `frame-src` um `https://{$FILES_DOMAIN}`
ergänzt. Ob ein Release-Bundle vorher tatsächlich blockierte, wurde nicht
verifiziert; die Änderung ist in beiden Fällen korrekt. Die ursprüngliche Analyse:

**Stellen:** `src-tauri/tauri.conf.json:25`, `deploy/web/Caddyfile` (CSP),
`src/features/chat/components/attachments/inlineVideoSession.ts:17`,
`AttachmentPdfLightbox.tsx:61-67`

Beide Features aus PR #92 laden die presigned MinIO-URL direkt: das Video per
`video.src = url`, das PDF per `<iframe src={url}>`. Beide CSPs lassen das nicht zu:

| CSP | Video (`media-src`) | PDF (`frame-src` → `default-src`) |
|---|---|---|
| Desktop (Tauri, **erzwungen**) | `'self' blob:` — `https:` fehlt | `'self'` — Files-Host fehlt |
| Web (Report-Only, [E4](#e4)) | `'self' blob:` — Files-Host fehlt | `'none'` |

`img-src` erlaubt den Files-Host bzw. `https:`, deshalb funktionieren Bilder und
Video-Poster.

**Auswirkung (vermutet):** In einem **Release-Build** der Desktop-App bleiben
Inline-Videos schwarz und die PDF-Vorschau leer. Im Tauri-Dev-Modus
(`devUrl`) injiziert Tauri die CSP nicht, im Web greift nur Report-Only — genau die
beiden Umgebungen, in denen das Feature vermutlich getestet wurde. Nicht in einem
gebauten Bundle verifiziert; bitte dort gegenprüfen.

**Richtung für einen Fix:** Den Files-Host (bzw. `https:` in der Desktop-CSP) in
`media-src` und `frame-src` aufnehmen — zusammen mit dem `sandbox`-Attribut aus
[A15](#a15), damit die Lockerung nicht ein beliebiges HTML-Dokument einbettet.

---

# F — Konfiguration und Betrieb

<a id="f1"></a>
## F1 — Bool-Konfiguration schlägt bei unerwarteten Werten still fehl · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Ein gesetzter, aber unbekannter Wert verhindert den Start mit klarer
Meldung statt still auf `false` bzw. den Default zu fallen; akzeptiert werden
true/false, 1/0, yes/no, on/off. Tests in `ServiceOptionsTests`. Der Nebenbefund zu
`MINIO_ACCESS_KEY`/`LIVEKIT_API_KEY` bleibt: das sind Kennungen, die zugehörigen
Secrets werden bereits geprüft. Die ursprüngliche Analyse:

**Stelle:** `core-api/src/CoreApi/Configuration/ServiceOptions.cs:156-159`

```csharp
bool GetBool(string key, bool fallback) =>
    config[key] is { Length: > 0 } value
        ? value.Trim().ToLowerInvariant() is "true" or "1" or "yes"
        : fallback;
```

Ist die Variable gesetzt, aber nicht `true`/`1`/`yes`, ist das Ergebnis **`false`** —
nicht der Fallback und keine Fehlermeldung.

**Auswirkung:** `REQUIRE_EMAIL_CONFIRMATION=on`, `=enabled`, `=True ` mit einem
unsichtbaren Zeichen oder ein simpler Tippfehler deaktivieren die E-Mail-Bestätigung
still — der Default wäre `true` (`:197`). Der Betreiber hat keinen Hinweis darauf,
dass seine Einstellung ins Gegenteil verkehrt wurde. Gleiches gilt für
`REQUIRE_ADMIN_APPROVAL` und `SMTP_USE_STARTTLS`.

`GetInt` (`:161-164`) hat dasselbe Verhalten: Ein nicht parsbarer Wert fällt still auf
den Default zurück. Bei `RATE_LIMIT_PERMIT` bedeutet das eine stumm anders
konfigurierte Sicherheitsgrenze.

**Nebenbefund (S4):** `FindInsecureDefaults` (`:227-255`) prüft `AUTH_JWT_SECRET`,
`LIVEKIT_API_SECRET`, `MINIO_SECRET_KEY`, `SPACETIME_OIDC_ISSUER` und
`SPACETIME_OIDC_PRIVATE_KEY` — aber nicht `MINIO_ACCESS_KEY` (Default `minioadmin`),
nicht `LIVEKIT_API_KEY` (Default `devkey`) und nicht `ADMIN_BOOTSTRAP_PASSWORD`.

---

<a id="f2"></a>
## F2 — `SystemConfigService`-Cache ist prozesslokal · **akzeptiert**

**Akzeptiert (Branch `fix/security-batch-2`).** Die ausgelieferte Topologie hat genau
eine core-api-Instanz; der Cache ist dort korrekt. Die Upgrade-Richtung (Reload per
Timer oder Postgres-NOTIFY) steht als `ponytail:`-Notiz am Feld. Die ursprüngliche
Analyse:

**Stelle:** `core-api/src/CoreApi/Services/SystemConfigService.cs:260`, `:283-294`

```csharp
private volatile SystemConfig _current = SeedFrom(options);
```

`UpdateAsync` schreibt in die Datenbank und aktualisiert `_current` **nur im eigenen
Prozess**. Es gibt keine Invalidierung über Instanzgrenzen hinweg und kein
periodisches Nachladen.

**Auswirkung:** Beim Betrieb mit mehreren core-api-Replikaten wirkt eine Änderung im
Admin-Panel (Registrierung schließen, Rate-Limits, SMTP) nur auf der Instanz, die die
Anfrage bearbeitet hat. Die dokumentierte Compose-Topologie ist einzelinstanzig, daher
heute nur latent — aber eine Schranke für horizontales Skalieren.

Verwandt: `DbInitializer.InitializeAsync` (`:18-105`) führt `MigrateAsync` bei jedem
Start aus. Bei parallel startenden Replikaten laufen EF-Migrationen gleichzeitig.

---

<a id="f3"></a>
## F3 — `MigrateLegacyIdentitiesAsync` lädt bei jedem Start alle User · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Die Migration liest bei jedem Start nur noch zwei Spalten ohne
Change-Tracking und lädt vollständige Zeilen nur für Konten, die tatsächlich angepasst
werden müssen (normalerweise keine). Ein Flag wäre eine Schema-Migration für einen
Blake3-Hash pro Konto gewesen. Test in `LegacyIdentityMigrationTests`. Die ursprüngliche
Analyse:

**Stelle:** `core-api/src/CoreApi/DbInitializer.cs:139`

```csharp
foreach (var user in await db.Users.ToListAsync())
```

Die gesamte Benutzertabelle wird bei **jedem** Start in den Speicher geladen und für
jede Zeile `ComputeIdentityHex` (ein Blake3-Hash) berechnet — auch dann, wenn die
Migration längst abgeschlossen ist und `pending` leer bleibt (`:153-156`).

**Auswirkung:** Startzeit und Speicherbedarf wachsen linear mit der Nutzerzahl. Ein
Flag in `SystemConfig`, das die einmalige Migration als erledigt markiert, würde das
auf einen einzelnen Lesezugriff reduzieren.

---

<a id="f4"></a>
## F4 — GitHub-Timeout in `/downloads/{os}` wird zu einem 500 · ✅ **behoben**

**Behoben auf Branch `fix/security-batch-2`.** Timeout (`TaskCanceledException`) und unerwartete Antwort
(`JsonException`) liefern jetzt die freundliche 404. Ohne eigenen Test — der Pfad ist
im Testhost hinter `IsDevBuild` nicht erreichbar. Die ursprüngliche Analyse:

**Stellen:** `core-api/src/CoreApi/Endpoints/DownloadEndpoints.cs:83-97`,
`Program.cs:112-117`

```csharp
try {
    release = await http.GetFromJsonAsync<GitHubRelease>(..., cancellationToken);
} catch (HttpRequestException ex) {
    ...
    return Results.NotFound(new { error = $"Could not reach GitHub to resolve installer for {tag}." });
}
```

Gefangen wird nur `HttpRequestException`. Der HttpClient `"github"` hat aber ein
Timeout von 8 Sekunden (`Program.cs:114`), und ein Timeout äußert sich als
`TaskCanceledException`. Ebenso wenig abgedeckt: `JsonException` bei einer
unerwarteten Antwortstruktur und `NotSupportedException`.

**Auswirkung:** Genau der häufigste Fehlerfall — GitHub antwortet langsam — umgeht die
freundliche 404-Behandlung, landet im globalen Handler (`Program.cs:220-224`) und
liefert dem Besucher der Landing Page einen 500 mit `"Internal server error."`.

---

# G — Dokumentation

<a id="g1"></a>
## G1 — `CODEBASE.md` beschrieb einen überholten Stand · ✅ **behoben**

**Behoben mit der Architektur-Baseline vom 2026-09-15.**

`CODEBASE.md` ist jetzt eine datierte Karte des laufenden Systems statt einer
prozentualen Feature-Einschätzung. Sie beschreibt `core-api` als einziges Backend,
SpacetimeDB 2.5, die vollständigen Service- und Daten-Grenzen, zentrale Request-Flows,
Deployment-Topologie und die passende Testmatrix. Erledigte Feature-Lücken wurden
entfernt.

Zusätzlich trennen `README.md`, `SECURITY.md` und dieses Register ihre Rollen klar:
Architektur beschreibt den Ist-Zustand, `SECURITY.md` die einzuhaltenden
Vertrauensgrenzen und diese Datei die offenen bzw. verifizierten Befunde.

---

## Beobachtungen ohne Befund

Der Vollständigkeit halber — diese Bereiche wurden geprüft und wirkten solide:

- **Kein XSS-Sink im Client.** Kein `dangerouslySetInnerHTML`, kein `innerHTML`, kein
  `eval`. Nachrichten werden als Text gerendert, es gibt keine Linkifizierung. Anhänge
  öffnen über `window.open(url, '_blank', 'noopener,noreferrer')`
  (`src/features/chat/components/attachments/AttachmentListItem.tsx:18`).
  *Einschränkung seit PR #92:* Die PDF-Vorschau bettet fremde Inhalte in ein iframe
  ohne `sandbox` ein, siehe [A15](#a15).
- **Admin-Panel-Autorisierung.** Alle Razor-Seiten unter `Pages/Admin/` tragen
  `[Authorize(Roles = AdminRole)]`, nur `Login` ist `[AllowAnonymous]` und prüft dort
  Rolle *und* `AccountStatus`. Der Listener-Guard in `Program.cs:169-189` trennt die
  Ports sauber, und die Compose-Datei bindet beide an Loopback.
- **SQL-Injection im Voice-Gate.** `VoiceRoom.TryParse`
  (`Services/VoiceRoom.cs:34-70`) validiert strikt auf Zahl bzw. Hex-Identity, bevor
  der Wert in die SpacetimeDB-`/sql`-Abfrage interpoliert wird
  (`SpacetimeClient.cs:259-262`) — das ist als Injection-Guard ausreichend und im
  Kommentar auch so begründet.
- **LiveKit-Raumautorisierung.** `/livekit/token` prüft nicht nur die Sitzung, sondern
  die tatsächliche Voice-Präsenz im Modul (`LiveKitEndpoints.cs:281-290`). Die
  Retry-Logik in `HasVoicePresenceAsync` ist mit einer nachvollziehbaren Begründung
  versehen und schwächt das Gate nicht ab. Einzige Lücke ist die Token-Laufzeit,
  siehe [A10](#a10).
- **Zeilensicherheit der `archive_*`-Views.** Alle prüfen `is_archive_service(ctx)` und
  geben andernfalls eine leere Menge zurück (`views.rs:450-560`).
- **Fail-fast bei Dev-Secrets.** `EnsureSecretsAreProductionSafe`
  (`Program.cs:259-276`) verweigert außerhalb von Development den Start bei
  unveränderten Dev-Secrets — ein gutes Muster, dem nur ein paar Einträge fehlen
  ([F1](#f1)).

---

## Vorschlag zur Priorisierung

**Stand 2026-09-24 (nach Branch `fix/security-batch-2`):** Alle 57 Befunde sind bearbeitet:
55 behoben, 2 bewusst akzeptiert (C9 und F2, jeweils mit `ponytail:`-Notiz im Code und
Begründung oben). Offene Rest-Kanten, dokumentiert in den Einträgen: A9 ohne
E-Mail-Bestätigung, A14 ohne eigenen Worker-Container, A6 für Legacy-Keys.
