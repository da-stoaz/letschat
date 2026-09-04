# Bug-Analyse — produktionsrelevante Fehler

> Erstellt: 2026-08-24 · Branch `claude/codebase-bug-analysis-otaq55`
> Methode: statische Code-Analyse (Lesen, keine Ausführung). Kein Code wurde verändert.
> Umfang: `server/` (SpacetimeDB-Modul), `core-api/` (.NET), `src/` (React-Client),
> `deploy/`, `docker-compose.prod.*`, `spacetimedb/`.

**Wichtiger Hinweis zur Verifikation:** Alle Befunde stammen aus dem Lesen des Codes.
Sie wurden *nicht* zur Laufzeit reproduziert. Jeder Eintrag nennt die konkrete Stelle
und den Auslöser, damit er gezielt nachgestellt werden kann. Die Einstufung der
Schwere ist eine Einschätzung, keine gemessene Größe.

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
| [A5](#a5) | Upload-Größenlimit und Tagesquote sind clientseitig deklariert, nicht durchgesetzt | S2 | Storage |
| [A6](#a6) | Presigned Download-URLs ohne Zugriffsprüfung auf den Storage-Key | S2 | Storage |
| [A7](#a7) | Kein Account-Lockout, keine Passwort-Längenobergrenze → Argon2-DoS | S2 | Auth |
| [A8](#a8) | Erstregistrierung wird automatisch Instanz-Admin (Land-Grab) | S2 | Auth |
| [A9](#a9) | Account-Enumeration über `/auth/register` | S3 | Auth |
| [A10](#a10) | LiveKit-Token überlebt Kick/Ban um bis zu 1 Stunde | S3 | Voice |
| [B1](#b1) | `transfer_ownership` auf sich selbst sperrt den Owner dauerhaft aus | S2 | Modul |
| [B2](#b2) | Owner kann sich selbst kicken/bannen → verwaister Space | S2 | Modul |
| [B3](#b3) | `edit_direct_message` prüft weder Block noch Freundschaft | S2 | Modul |
| [B4](#b4) | `edit_message` prüft weder Mitgliedschaft, Timeout noch Lösch-Status | S3 | Modul |
| [B5](#b5) | `update_profile`: `display_name`/`avatar_url` völlig unvalidiert | S3 | Modul |
| [B6](#b6) | Avatar-/Icon-URLs erlauben Tracking über beliebige Fremdhosts | S3 | Modul |
| [B7](#b7) | Invite-Token mit nur 8 Zeichen, kein Kollisionsschutz, kein Mengenlimit | S3 | Modul |
| [B8](#b8) | `create_invite`: `expires_in_seconds` läuft in einen i64-Overflow | S4 | Modul |
| [B9](#b9) | `avatar_url` lässt sich nie wieder entfernen | S4 | Modul |
| [C1](#c1) | ~~Jede eingehende Nachricht löst drei volle Durchläufe der Historie aus~~ · **✅ behoben (PR #73)** | ~~S1~~ | Client |
| [C2](#c2) | ~~Initialer Sync ist O(N²) und läuft in den 5-Sekunden-Timeout~~ · **✅ behoben (PR #73)** | ~~S1~~ | Client |
| [C3](#c3) | ~~`my_channel_messages` liefert die komplette Historie ohne Limit~~ · **✅ behoben (PR #77)** | ~~S1~~ | Views |
| [C4](#c4) | `my_server_members` gibt alle Mitglieder aller Discover-Spaces preis | S2 | Views |
| [C5](#c5) | Typing-Indikator macht pro Tastenanschlag einen Full-Table-Scan | S2 | Modul |
| [C6](#c6) | Lösch-Reducer scannen ganze Tabellen statt Indizes zu nutzen | S2 | Modul |
| [C7](#c7) | Mitglieder-Events erzwingen instanzweiten Re-Sync bei allen Clients | S2 | Client |
| [C8](#c8) | `cleanup_stale_invites_internal` scannt bei jeder Invite-Operation | S3 | Modul |
| [D1](#d1) | `TypingState` wird bei Verbindungsabbruch nie aufgeräumt | S3 | Modul |
| [D2](#d2) | Präsenz bleibt nach Absturz dauerhaft „online" | S3 | Modul |
| [D3](#d3) | `delete_server` lässt Pins, Read-States und DM-Invites verwaist zurück | S3 | Modul |
| [D4](#d4) | Verwaiste MinIO-Objekte werden nie gelöscht | S3 | Storage |
| [D5](#d5) | `rekey_identities` korrumpiert Daten bei verketteten Remaps | S3 | Modul |
| [D6](#d6) | Stale Messages im Client-Store nach Hard-Delete | S4 | Client |
| [E1](#e1) | Stiller Fallback auf anonyme Identity bei Token-Ablehnung | S2 | Client |
| [E2](#e2) | Abmelden während des Verbindungsaufbaus kann die Sitzung wiederbeleben | S3 | Client |
| [E3](#e3) | Discovery fällt bei nacktem Hostnamen auf `http://` zurück | S3 | Client |
| [E4](#e4) | CSP wird nur im Report-Only-Modus ausgeliefert | S3 | Deploy |
| [E5](#e5) | Download-URL-Cache wächst unbegrenzt | S4 | Client |
| [F1](#f1) | Bool-Konfiguration schlägt bei unerwarteten Werten still fehl | S3 | Config |
| [F2](#f2) | `SystemConfigService`-Cache ist prozesslokal | S4 | Config |
| [F3](#f3) | `MigrateLegacyIdentitiesAsync` lädt bei jedem Start alle User | S4 | Config |
| [F4](#f4) | GitHub-Timeout in `/downloads/{os}` wird zu einem 500 | S4 | API |
| [G1](#g1) | `CODEBASE.md` beschreibt einen überholten Stand | S4 | Doku |

---

# A — Authentifizierung, Autorisierung, Sicherheit

<a id="a1"></a>
## A1 — SpacetimeDB akzeptiert anonyme Identities · ✅ **behoben**

**Behoben in PR #71** (`fix/spacetimedb-anonymous-identity-gate`).

Zwei Gates im Modul schließen die Lücke:

- **`require_account`** in allen 60 client-aufrufbaren Reducern (`server/src/helpers.rs`):
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
in allen 60 client-aufrufbaren Reducern) erzwingt beide. Damit greifen alle drei
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
## A5 — Upload-Größenlimit und Tagesquote sind clientseitig deklariert, nicht durchgesetzt · **S2**

**Stellen:** `core-api/src/CoreApi/Endpoints/UploadEndpoints.cs:16-17`, `:60-92`,
`:141-165`; `Services/StorageService.cs:45-52`

Der Ablauf: Der Client meldet in `/uploads/request` eine `file_size`. Diese Zahl wird
gegen `MaxFileSize` (500 MB) und die Tagesquote (2 GB) geprüft. Anschließend wird eine
Presigned-PUT-URL erzeugt:

```csharp
public async Task<string> PresignPutAsync(string storageKey, int expiresInSeconds) =>
    ForceScheme(await _presign.GetPreSignedURLAsync(new GetPreSignedUrlRequest
    {
        BucketName = _bucket,
        Key = storageKey,
        Verb = HttpVerb.PUT,
        Expires = DateTime.UtcNow.AddSeconds(expiresInSeconds),
    }));
```

Es wird **keine** `ContentLength`- bzw. `content-length-range`-Bedingung gesetzt. Die
URL akzeptiert jede beliebige Objektgröße.

In `ConfirmUpload` wird dann erneut die *behauptete* Größe verbucht:

```csharp
if (!await storage.ObjectExistsAsync(pending.StorageKey))   // prüft nur Existenz
    throw ApiException.BadRequest(...);
// ...
quota.BytesUploaded += pending.FileSize;                    // die Client-Angabe
```

`ObjectExistsAsync` (`StorageService.cs:65-76`) ruft `GetObjectMetadataAsync` auf —
die tatsächliche `ContentLength` liegt in der Antwort vor, wird aber verworfen.

**Auswirkung:** `file_size: 1` melden und über die Presigned-URL ein 5-GB-Objekt
hochladen. Sowohl das 500-MB-Limit als auch die 2-GB-Tagesquote sind damit umgangen.
Ein authentifizierter Nutzer kann den MinIO-Speicher unbegrenzt füllen.

**Richtung für einen Fix:** Die echte `ContentLength` aus der `GetObjectMetadata`-
Antwort in `ConfirmUpload` verwenden (für Quote *und* Limit-Prüfung, mit Löschen des
Objekts bei Überschreitung) und zusätzlich beim Presigning eine
Content-Length-Bedingung setzen.

**Nebenbefund (S4):** Die MIME-Sperrliste (`UploadEndpoints.cs:23-31`) prüft den vom
Client gesendeten `mime_type`. Der Client bestimmt diesen Wert frei, und die
Dateiendung wird ungeprüft in den Storage-Key übernommen (Z. 95-99). Die Liste hält
niemanden auf, der `application/octet-stream` sendet.

---

<a id="a6"></a>
## A6 — Presigned Download-URLs ohne Zugriffsprüfung auf den Storage-Key · **S2**

**Stellen:** `core-api/src/CoreApi/Endpoints/UploadEndpoints.cs:171-223`

```csharp
private static async Task<DownloadUrlResponse> DownloadUrl(...)
{
    await RequireSession(payload.SessionToken, tokens);          // nur: irgendeine Sitzung

    if (!payload.StorageKey.StartsWith("uploads/", StringComparison.Ordinal))
        throw ApiException.BadRequest("Invalid storage key.");

    var url = await storage.PresignGetAsync(payload.StorageKey, PresignDownloadSeconds);
    ...
}
```

Die einzige Prüfung ist, dass der Key mit `uploads/` beginnt. Es wird nicht geprüft,
ob der Aufrufer Mitglied des Channels oder Teilnehmer der DM ist, in der der Anhang
gepostet wurde — und auch nicht, ob er es je war.

**Auswirkung:**

- Jeder angemeldete Nutzer erhält für jeden `uploads/…`-Key eine gültige URL. Der
  Schutz besteht allein darin, dass der Key eine GUID enthält — Sicherheit durch
  Unkenntnis, nicht durch Autorisierung.
- Konkret und ohne Raten: **ein gekickter oder gebannter Nutzer behält dauerhaften
  Zugriff auf jeden Anhang, dessen Key er je gesehen hat.** Die Keys stehen im
  Nachrichtentext, den er während seiner Mitgliedschaft synchronisiert hat. Nach dem
  Ban kann er weiterhin für jeden davon eine frische Presigned-URL anfordern, solange
  seine Sitzung gültig ist (und dank [A4](#a4) auch danach noch).
- Gleiches gilt für `/uploads/download-urls` (Batch, bis zu 128 Keys pro Anfrage).

---

<a id="a7"></a>
## A7 — Kein Account-Lockout, keine Passwort-Längenobergrenze → Argon2-DoS · **S2**

**Stellen:** `core-api/src/CoreApi/Endpoints/AuthEndpoints.cs:218-246` (`Login`),
`Pages/Admin/Login.cshtml.cs:32-57`, `Validation.cs:28-34`

**Kein Lockout.** Beide Login-Pfade verwenden `UserManager.CheckPasswordAsync`. Diese
Methode wendet die Lockout-Mechanik von ASP.NET Identity nicht an — das täte
`SignInManager.PasswordSignInAsync(..., lockoutOnFailure: true)`. Es gibt also keine
Sperre nach fehlgeschlagenen Versuchen. Zusammen mit [A2](#a2) (Rate-Limit greift
faktisch nicht pro Angreifer) bleibt für gezieltes Passwort-Raten gegen einen
einzelnen Account kein wirksamer Schutz. Das Admin-Login unter `/admin/login` ist
zusätzlich gar nicht vom Rate-Limiter erfasst (Razor Pages werden von
`RequireRateLimiting` nicht abgedeckt) — hier hilft nur, dass `ADMIN_BIND` nicht
öffentlich exponiert ist.

**Keine Längenobergrenze.**

```csharp
public static void ValidatePassword(string password)
{
    if (password.Length < 8)
        throw ApiException.BadRequest("Password must be at least 8 characters.");
}
```

Nur eine Untergrenze. Der Passwort-Hasher ist Argon2id
(`Identity/Argon2PasswordHasher.cs`), bewusst rechen- und speicherintensiv. Ein
Passwort von mehreren MB wird vollständig gehasht. Kestrels Standard-Request-Limit
liegt bei 30 MB und wird nirgends gesenkt.

**Auswirkung:** Wenige parallele Anfragen mit sehr langen Passwörtern binden CPU und
Speicher des Prozesses. Der wirksamste Weg dorthin ist `/auth/link` ([A3](#a3)), weil
dieser Endpunkt gar nicht rate-limitiert ist.

**Nebenbefund:** `Validation.Required` (`Validation.cs:49-58`) hat ebenfalls keine
Obergrenze. `DisplayName` geht damit unbegrenzt in die Datenbank.

---

<a id="a8"></a>
## A8 — Erstregistrierung wird automatisch Instanz-Admin · **S2**

**Stelle:** `server/src/reducers/users.rs:38-46`

```rust
let is_first_admin = !ctx.db.user().iter().any(|user| user.is_admin);
```

Der Kommentar darüber begründet das Verhalten ausführlich und schließt mit:
*"Operators should sign in once before exposing a new instance publicly."* Das ist
eine Betriebsanweisung, keine technische Schranke.

**Auswirkung:** Auf einer frisch veröffentlichten Instanz wird derjenige
Instanz-Admin, der zuerst `register_user` aufruft. Zusammen mit [A1](#a1) genügt dafür
eine anonyme WebSocket-Verbindung — ein Account bei der core-api ist nicht nötig. Der
so erlangte Admin kann `set_space_create_policy`, `set_user_admin` und
`set_archive_service_identity` aufrufen, und die Last-Admin-Schranke in
`set_user_admin` (`system.rs:95-101`) hält ihn danach dort.

Das Zeitfenster ist real: es reicht von `spacetime publish` bis zum ersten Login des
Betreibers, und bei einem automatisierten Container-Deployment ist genau dieser Login
das, was der Kommentar als „geschieht nicht" beschreibt.

**Nebenbefund (S4):** Der Ausdruck ist ein Full-Table-Scan über `user` bei *jeder*
Registrierung, nicht nur der ersten.

---

<a id="a9"></a>
## A9 — Account-Enumeration über `/auth/register` · **S3**

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
## A10 — LiveKit-Token überlebt Kick/Ban um bis zu 1 Stunde · **S3**

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

# B — SpacetimeDB-Modul: Logik und Berechtigungen

<a id="b1"></a>
## B1 — `transfer_ownership` auf sich selbst sperrt den Owner dauerhaft aus · **S2**

**Stelle:** `server/src/reducers/member_management.rs:181-216`

```rust
let mut target_row = ctx.db.server_member().member_key()
    .find(member_key(server_id, target_identity)) ...;
target_row.role = Role::Owner;
ctx.db.server_member().member_key().update(target_row);        // (1)

let mut caller_row = ctx.db.server_member().member_key()
    .find(member_key(server_id, ctx.sender())) ...;
caller_row.role = Role::Moderator;
ctx.db.server_member().member_key().update(caller_row);        // (2)
```

Es fehlt eine Prüfung `target_identity != ctx.sender()`. Bei `target == sender` sind
(1) und (2) **dieselbe Zeile**: Erst wird sie auf `Owner` gesetzt, dann wird sie neu
gelesen und auf `Moderator` gesetzt. Der zweite Schreibvorgang gewinnt.

**Endzustand:** `Server.owner_identity` zeigt auf den Aufrufer, seine
`ServerMember.role` ist aber `Moderator`.

**Auswirkung:** `require_owner` (`helpers.rs:99-105`) prüft ausschließlich die Rolle
in `ServerMember`, nicht `Server.owner_identity`. Der Owner verliert damit dauerhaft
den Zugriff auf `rename_server`, `set_server_invite_policy`, `set_server_discovery`,
`set_server_tags`, `set_server_icon`, `delete_server`, `set_member_role` und
`transfer_ownership` — es gibt **keinen Weg zurück**. Der Space hat danach keinen
Owner mehr und kann nicht einmal gelöscht werden.

Verschärfend: Da die Rolle nun `Moderator` ist, greift die Schranke in `leave_server`
(`servers.rs:384-387`, `role != Role::Owner`) nicht mehr — der Ex-Owner kann den
Space verlassen und lässt ihn endgültig verwaist zurück.

**Auslöser:** `transfer_ownership(server_id, <eigene Identity>)`.

---

<a id="b2"></a>
## B2 — Owner kann sich selbst kicken oder bannen → verwaister Space · **S2**

**Stellen:** `server/src/reducers/member_management.rs:10-47` (`kick_member`),
`:49-83` (`ban_member`)

```rust
let caller_role = require_mod_or_owner(ctx, server_id, ctx.sender())?;
let target_role = require_member_role(ctx, server_id, target_identity)?;

if matches!(target_role, Role::Moderator | Role::Owner) {
    assert_or_err(caller_role == Role::Owner, "only owner can kick moderators/owner")?;
}
```

Bei `target_identity == ctx.sender()` und Rolle `Owner` sind beide Bedingungen
erfüllt: Der Aufrufer *ist* Owner, darf also „Owner kicken". Die eigene
`ServerMember`-Zeile wird gelöscht.

**Auswirkung:** Der Space bleibt ohne Owner-Zeile zurück. Alle `require_owner`- und
`require_mod_or_owner`-Aufrufe schlagen für den vormaligen Owner mit
`"not a server member"` fehl. Bei `ban_member` kommt hinzu, dass er zusätzlich in der
`Ban`-Tabelle landet und den Space nicht einmal per Invite wieder betreten kann —
`use_invite` prüft `is_banned` (`invites.rs:129-132`).

Beachtenswert: `leave_server` hat exakt diese Schranke (`servers.rs:384-387`,
*"owner must transfer ownership before leaving"*). Sie fehlt in `kick_member` und
`ban_member`.

**Auslöser:** `kick_member(server_id, <eigene Identity>)` oder
`ban_member(server_id, <eigene Identity>, None)` als Owner.

---

<a id="b3"></a>
## B3 — `edit_direct_message` prüft weder Block noch Freundschaft · **S2**

**Stelle:** `server/src/reducers/direct_messages.rs:43-70`

```rust
pub fn edit_direct_message(ctx, message_id, new_content) -> Result<(), String> {
    assert_or_err((1..=4000).contains(&new_content.len()), ...)?;
    let mut dm_row = ctx.db.direct_message().id().find(message_id)...;
    assert_or_err(dm_row.sender_identity == ctx.sender(), "only sender can edit message")?;
    dm_row.content = new_content;      // keine weitere Prüfung
    ...
}
```

`send_direct_message` (`:7-40`) prüft sorgfältig `has_block_either_direction` und
`FriendStatus::Accepted`. `edit_direct_message` prüft nur die Urheberschaft.

**Auswirkung:** Ein blockierter oder entfreundeter Nutzer kann den Inhalt jeder von
ihm zuvor gesendeten DM beliebig neu setzen. Die Zeilen bleiben in
`my_direct_messages` sichtbar — die View filtert nach Sender/Empfänger, nicht nach
Block-Status (`views.rs:272-279`). Das Opfer sieht den neuen Text in seiner
DM-Ansicht.

Damit ist Blockieren als Schutz gegen Belästigung wirkungslos, solange der Blockierte
irgendwann einmal eine DM geschickt hat — er behält einen dauerhaften Schreibkanal.

**Richtung für einen Fix:** Dieselben beiden Prüfungen wie in `send_direct_message`
auch in `edit_direct_message`.

---

<a id="b4"></a>
## B4 — `edit_message` prüft weder Mitgliedschaft, Timeout noch Lösch-Status · **S3**

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

---

<a id="b5"></a>
## B5 — `update_profile`: `display_name` und `avatar_url` völlig unvalidiert · **S3**

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
## B6 — Avatar- und Icon-URLs erlauben Tracking über beliebige Fremdhosts · **S3**

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
## B7 — Invite-Token mit nur 8 Zeichen, kein Kollisionsschutz, kein Mengenlimit · **S3**

**Stellen:** `server/src/reducers/invites.rs:80-85`, `:100-108`, `:266-284`

```rust
let token: String = ctx.rng().sample_iter(&Alphanumeric).take(8).map(char::from).collect();
```

Drei Punkte:

1. **Entropie.** 62⁸ ≈ 2,2 × 10¹⁴. Für ein Bearer-Credential wenig, und `use_invite`
   ist weder rate-limitiert noch protokolliert. Zusammen mit [A1](#a1) (anonyme
   Verbindungen erlaubt) ist Token-Raten ein realistischer Weg in einen fremden Space.
2. **Kollision.** `token` ist der Primärschlüssel. `ctx.db.invite().insert(...)` bei
   einem bereits vorhandenen Token verletzt die Unique-Constraint und lässt den
   Reducer panicken. Es gibt keine Retry-Schleife.
3. **Menge.** Weder pro Nutzer noch pro Space existiert eine Obergrenze für die Anzahl
   der Invites. `allowed_usernames: Vec<String>` (`:63`) ist ebenfalls unbegrenzt —
   ein einzelner Aufruf kann eine sehr große Liste in eine Zeile schreiben.

---

<a id="b8"></a>
## B8 — `create_invite`: `expires_in_seconds` läuft in einen i64-Overflow · **S4**

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
## B9 — `avatar_url` lässt sich nie wieder entfernen · **S4**

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
## C4 — `my_server_members` gibt alle Mitglieder aller Discover-Spaces preis · **S2**

**Stelle:** `server/src/views.rs:231-243`

```rust
let mut visible = my_server_ids(ctx);
for server in ctx.db.server().is_discoverable().filter(true) {
    visible.insert(server.id);              // <- jeder Discover-Space
}
for server_id in &visible {
    rows.extend(ctx.db.server_member().server_id().filter(*server_id));
}
```

Der Kommentar nennt den Zweck: *"so Discover cards can show member counts for spaces
the caller hasn't joined"*. Ausgeliefert wird dafür aber die vollständige
`ServerMember`-Zeile — `user_identity`, `role`, `joined_at` und `timeout_until` — für
**jedes** Mitglied **jedes** öffentlich gelisteten Space, an **jeden** verbundenen
Client.

**Auswirkung — zwei Probleme:**

1. **Datenschutz.** Für eine Zahl auf einer Karte wird die komplette
   Mitgliederstruktur offengelegt. Wer in welchem öffentlichen Space Moderator ist,
   seit wann, und wer aktuell einen Timeout hat, ist für jeden sichtbar.
2. **Skalierung.** Die Datenmenge wächst mit (Anzahl Discover-Spaces × deren
   Mitgliederzahl) und wird an jeden Client repliziert — unabhängig davon, ob er die
   Discover-Seite überhaupt öffnet. Zusammen mit [C7](#c7) ist das der Auslöser für
   instanzweite Re-Sync-Wellen.

**Richtung für einen Fix:** Eine separate View, die pro Discover-Space nur eine
aggregierte Mitgliederzahl liefert.

---

<a id="c5"></a>
## C5 — Typing-Indikator macht pro Tastenanschlag einen Full-Table-Scan · **S2**

**Stelle:** `server/src/reducers/presence.rs:46-51` (in `ensure_scope_allowed`, ab Zeile 26)

```rust
let friend_row = ctx.db.friend().iter().find(|row| {
    row.status == FriendStatus::Accepted
        && ((row.user_a == ctx.sender() && normalize_identity(&row.user_b.to_string()) == other)
            || (row.user_b == ctx.sender() && normalize_identity(&row.user_a.to_string()) == other))
})...
```

`.iter()` ist ein Scan über **die gesamte `friend`-Tabelle der Instanz**. Pro
geprüfter Zeile werden zusätzlich zwei `Identity::to_string()`-Allokationen und ein
`to_lowercase()` durchgeführt.

Aufgerufen wird das aus `set_typing_state` (`:100`, Aufruf in `:109`) — also bei jedem Tastenanschlag
jedes Nutzers in jeder DM.

Dabei ist der Primärschlüssel-Lookup direkt verfügbar: `find_friend_row`
(`helpers.rs:241-243`) nutzt `friend_pair_key` und wird in `send_direct_message`,
`join_dm_voice` und `mark_dm_read` bereits korrekt so verwendet. Nur diese eine Stelle
scannt.

**Auswirkung:** Der Aufwand für den Typing-Indikator wächst linear mit der Gesamtzahl
aller Freundschaften der Instanz — auf dem heißesten Pfad im System.

**Richtung für einen Fix:** `find_friend_row(ctx, ctx.sender(), other_identity)`
verwenden. Da `other` hier als normalisierter String vorliegt, muss dafür die
`Identity` rekonstruiert oder der DM-Scope-Parser so umgebaut werden, dass er
`Identity` zurückgibt.

---

<a id="c6"></a>
## C6 — Lösch-Reducer scannen ganze Tabellen statt Indizes zu nutzen · **S2**

**Stellen:** `server/src/reducers/servers.rs:300-378` (`delete_server`),
`channels.rs:98-136` (`delete_channel_with_dependencies`),
`voice.rs:19-25` (`join_voice_channel`), `voice.rs:75-81` (`on_client_disconnected`)

`delete_server` durchläuft für **jeden** Channel des Space die **gesamte**
`message`-Tabelle der Instanz:

```rust
for channel_id in &channel_ids {
    let messages: Vec<Message> = ctx.db.message().iter()
        .filter(|m| m.channel_id == *channel_id).collect();
```

Aufwand: O(Channels × alle Nachrichten der Instanz). Dabei existiert genau der
passende Index — `Message.channel_id` ist als `#[index(btree)]` deklariert
(`schema.rs`), und `views.rs:252` nutzt ihn korrekt mit
`ctx.db.message().channel_id().filter(channel.id)`.

Das gleiche Muster in derselben Datei für `voice_participant`, `server_member`, `ban`,
`invite`, `join_request` und `channel` (Zeilen 303, 312, 322, 333, 346, 356, 366, 397)
— alle diese Tabellen haben einen `server_id`- bzw. `channel_id`-Index, keiner wird
benutzt.

Interessanterweise ist es in `delete_channel_with_dependencies` gemischt: Der
Pin-Teil nutzt korrekt `ctx.db.pinned_message().channel_id().filter(channel_id)`
(`channels.rs:123-129`), der Nachrichten- und Voice-Teil direkt darüber (`:99-121`)
scannt.

Auch `on_client_disconnected` (`voice.rs:75-81`) scannt `voice_participant`
vollständig, während der DM-Teil unmittelbar darunter (`:82-89`) den
`user_identity`-Index nutzt.

**Auswirkung:** Auf einer Instanz mit umfangreicher Historie kann `delete_server` das
Zeit- und Energiebudget des Reducers überschreiten und die Transaktion abbrechen — der
Space wäre dann nicht löschbar. `on_client_disconnected` läuft bei **jedem**
Verbindungsabbruch und skaliert mit der Gesamtzahl aller Voice-Teilnehmer.

---

<a id="c7"></a>
## C7 — Mitglieder-Events erzwingen instanzweiten Re-Sync bei allen Clients · **S2**

**Stellen:** `src/lib/spacetimedb/events.ts:204-206`, `sync.ts:453-461`

```ts
conn.db.my_server_members.onInsert(() => syncServerScopedState(conn))
conn.db.my_server_members.onUpdate(() => syncServerScopedState(conn))
conn.db.my_server_members.onDelete(() => syncServerScopedState(conn))
```

`syncServerScopedState` führt sechs vollständige Re-Syncs aus: `syncServers`,
`syncMembers`, `syncChannels`, `syncInvites`, `syncDiscover`, `syncJoinRequests`.

Kombiniert mit [C4](#c4) — `my_server_members` enthält alle Mitglieder aller
Discover-Spaces — bedeutet das: **Jeder Beitritt, jedes Verlassen, jede Rollenänderung
und jede Timeout-Änderung in irgendeinem öffentlich gelisteten Space löst bei jedem
verbundenen Client der Instanz sechs volle Re-Syncs aus.**

Auf einer Instanz mit einigen aktiven öffentlichen Spaces ist das ein dauerhafter
Grundlast-Sturm auf allen Clients.

---

<a id="c8"></a>
## C8 — `cleanup_stale_invites_internal` scannt bei jeder Invite-Operation · **S3**

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

# D — Datenkonsistenz und Leaks

<a id="d1"></a>
## D1 — `TypingState` wird bei Verbindungsabbruch nie aufgeräumt · **S3**

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
## D2 — Präsenz bleibt nach Absturz dauerhaft „online" · **S3**

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
## D3 — `delete_server` lässt Pins, Read-States und DM-Invites verwaist zurück · **S3**

**Stelle:** `server/src/reducers/servers.rs:297-379`

`delete_server` räumt auf: `message`, `voice_participant`, `server_member`, `ban`,
`invite`, `join_request`, `channel`, `server`. Nicht aufgeräumt werden:

| Tabelle | Verwaiste Zeilen |
|---|---|
| `pinned_message` | zeigen auf gelöschte Channels und Nachrichten |
| `read_state` | `scope_key = "channel:{id}"` für gelöschte Channels |
| `dm_server_invite` | verweisen auf den gelöschten Space und dessen gelöschte Token |

Bemerkenswert: `delete_channel_with_dependencies` (`channels.rs:98-136`) räumt die
Pins korrekt auf. `delete_server` löscht Channels aber direkt über
`ctx.db.channel().id().delete(channel_id)` (`servers.rs:373-375`) und umgeht diese
Hilfsfunktion — die Pin-Bereinigung fällt dabei durch.

`leave_server` (`:382-409`) und `kick_member` (`member_management.rs:10`) lassen
ebenfalls `join_request`- und `read_state`-Zeilen des Betroffenen stehen.

**Auswirkung:** Monoton wachsende Tabellen mit toten Verweisen. Die verwaisten Pins
werden über `my_pinned_messages` nicht mehr ausgeliefert (die View filtert über
existierende Channels), belegen aber dauerhaft Platz und landen im Archiv.

---

<a id="d4"></a>
## D4 — Verwaiste MinIO-Objekte werden nie gelöscht · **S3**

**Stellen:** `core-api/src/CoreApi/DbInitializer.cs:82-90`,
`Endpoints/UploadEndpoints.cs:118-169`

Es gibt drei Wege zu verwaisten Objekten, und keinen zurück:

1. **Upload ohne Confirm.** Der Client holt eine Presigned-URL, lädt hoch, ruft aber
   `/uploads/confirm` nie auf. Die `PendingUpload`-Zeile wird — nur beim
   Anwendungsstart — gelöscht:
   ```csharp
   var swept = await db.PendingUploads.Where(p => p.ExpiresAt < now).ExecuteDeleteAsync();
   ```
   Das **Objekt in MinIO bleibt**. Es gibt keinen Aufruf, der es entfernt.
2. **Kein periodischer Sweep.** Die Bereinigung läuft ausschließlich in
   `DbInitializer.InitializeAsync`. Ein Prozess, der wochenlang läuft, räumt in dieser
   Zeit gar nichts auf.
3. **Gelöschte Nachrichten und Channels.** Wird eine Nachricht mit Anhang gelöscht
   oder ein ganzer Channel/Space entfernt, wird das zugehörige Objekt nirgends
   angefasst.

**Auswirkung:** Der MinIO-Speicher wächst monoton und wird nie kleiner. Zusammen mit
[A5](#a5) (Größenlimit nicht durchgesetzt) gibt es keine wirksame Obergrenze für den
Speicherverbrauch der Instanz.

---

<a id="d5"></a>
## D5 — `rekey_identities` korrumpiert Daten bei verketteten Remaps · **S3**

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
## D6 — Stale Messages im Client-Store nach Hard-Delete · **S4**

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

# E — Client und Deployment

<a id="e1"></a>
## E1 — Stiller Fallback auf anonyme Identity bei Token-Ablehnung · **S2**

**Stellen:** `src/lib/spacetimedb/connection.ts:426-440` (insb. `:433`), `:219-227`

```ts
if (getStoredToken() && /verify token/i.test(getConnectionErrorDetails(error))) {
  console.warn('[spacetimedb] stored token rejected by server; clearing it and retrying anonymously')
  clearStoredToken()
  await connectWithCompressionFallback()      // verbindet ohne Token → anonyme Identity
}
```

Und in `onConnect` (`:219-227`) wird die zurückgegebene Identity samt Token
gespeichert:

```ts
useConnectionStore.getState().setIdentity(identityString)
setStoredToken(token)                          // jetzt das anonyme Token
```

Der Kommentar begründet den Pfad damit, dass ein nicht mehr verifizierbares Token den
Client sonst „für immer lahmlegen" würde. Die Heilung erzeugt aber einen schlechteren
Zustand als die Krankheit.

**Auswirkung:** Läuft das 30-Tage-Token ab, oder ändert sich `SPACETIME_OIDC_PRIVATE_KEY`
serverseitig, verbindet sich der Client **still** unter einer neuen, anonymen Identity
und überschreibt das gespeicherte Account-Token damit dauerhaft. Der Nutzer sieht eine
angemeldete Oberfläche, ist aber jemand anderes: keine Spaces, keine Freunde, keine
DMs, keine Nachrichten. Beim nächsten Start wird das anonyme Token wiederverwendet.

`loginWithPassword` (`auth.ts:107-116`) prüft die Identität nach dem Login sehr wohl
und wirft eine gute Fehlermeldung — dieser Pfad wird aber nur beim expliziten Login
durchlaufen. `connect()` wird ebenso von `scheduleReconnect()` (`:344-356`, Aufruf `:352`) und von
`call()` (`:487-489`) aufgerufen; dort greift keine Prüfung.

Zusammen mit [A1](#a1) ist die entstandene anonyme Identity zudem voll
handlungsfähig — sie kann Spaces anlegen und Invites einlösen.

**Richtung für einen Fix:** Nach dem Reconnect prüfen, ob die verbundene Identity noch
der zuletzt authentifizierten entspricht, und andernfalls in einen expliziten
„Bitte erneut anmelden"-Zustand gehen, statt das Token zu überschreiben.

---

<a id="e2"></a>
## E2 — Abmelden während des Verbindungsaufbaus kann die Sitzung wiederbeleben · **S3**

**Stellen:** `src/lib/spacetimedb/connection.ts:358-361`, `:443-456`, `:459-478`

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
## E3 — Discovery fällt bei nacktem Hostnamen auf `http://` zurück · **S3**

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
## E4 — CSP wird nur im Report-Only-Modus ausgeliefert · **S3**

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
`update_profile` sichtbare Regressionen erzeugen.

---

<a id="e5"></a>
## E5 — Download-URL-Cache wächst unbegrenzt · **S4**

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

# F — Konfiguration und Betrieb

<a id="f1"></a>
## F1 — Bool-Konfiguration schlägt bei unerwarteten Werten still fehl · **S3**

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
## F2 — `SystemConfigService`-Cache ist prozesslokal · **S4**

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
## F3 — `MigrateLegacyIdentitiesAsync` lädt bei jedem Start alle User · **S4**

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
## F4 — GitHub-Timeout in `/downloads/{os}` wird zu einem 500 · **S4**

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
## G1 — `CODEBASE.md` beschreibt einen überholten Stand · **S4**

**Stelle:** `CODEBASE.md`

Die Datei trägt selbst den Hinweis, dass Teile veraltet sein können. Der Abstand ist
allerdings groß genug, dass sie aktiv in die Irre führt:

| Aussage in `CODEBASE.md` | Tatsächlicher Stand |
|---|---|
| „Auth service: Rust + Axum + SQLite (`auth-service/`, **current prod**)" | `auth-service/` existiert nicht mehr; core-api ist alleiniges Backend (siehe `CLAUDE.md`) |
| „SpacetimeDB 2.2" | 2.5 laut `CLAUDE.md` |
| „Tauri 2.8" | siehe `package.json` |
| **Urgent #1:** „Server voice controls are completely stubbed out … lines 240-254" | behoben — `src/features/voice/VoiceChannelView.tsx:149`, `:371-385` rufen echte Handler aus `useVoiceControlActions` |
| **Urgent #2:** „DM message editing is disabled, `allowEditOwn={false}`" | behoben — `src/features/dm/DMView.tsx:389` setzt `allowEditOwn` (true) |
| „Pinned messages … no schema support" | implementiert — `PinnedMessage` in `schema.rs`, `reducers/pins.rs`, `my_pinned_messages` |
| Schema-Tabelle | unvollständig: `SystemSettings`, `ArchiveService`, `IdCounter`, `JoinRequest`, `DmServerInvite`, `PinnedMessage`, `ReadState` fehlen |
| „Overall Assessment: ~65% complete MVP … most critical gap is server voice controls" | trifft nicht mehr zu |

**Auswirkung:** Die als „Urgent / Broken" markierten Punkte sind erledigt, die
tatsächlich offenen Probleme (dieses Dokument) stehen nirgends. Wer sich auf die Datei
verlässt, arbeitet an den falschen Stellen.

---

## Beobachtungen ohne Befund

Der Vollständigkeit halber — diese Bereiche wurden geprüft und wirkten solide:

- **Kein XSS-Sink im Client.** Kein `dangerouslySetInnerHTML`, kein `innerHTML`, kein
  `eval`. Nachrichten werden als Text gerendert, es gibt keine Linkifizierung. Anhänge
  öffnen über `window.open(url, '_blank', 'noopener,noreferrer')`
  (`src/features/chat/components/attachments/AttachmentListItem.tsx:18`).
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

**Erledigt:** [A2](#a2) (Forwarded Headers) und [A3](#a3) (`/auth/link` absichern)
sind in PR #70 behoben, [A1](#a1) (Gate für anonyme Identities) in PR #71,
[A4](#a4) (Token-Revokation) in PR #72, [C1](#c1)/[C2](#c2) (inkrementeller Sync)
in PR #73 und [C3](#c3) (begrenzte Views plus seitenweises Nachladen) in PR #77.
**Damit ist kein S1 mehr offen** — 6 von 43 Befunden erledigt, 37 verbleiben.

**Zuerst — Sicherheit, kleiner Aufwand, große Wirkung:**
[B1](#b1)/[B2](#b2) (Selbstbezug-Prüfungen, je eine Zeile), [B3](#b3) (Block-Prüfung
in `edit_direct_message`), [A5](#a5) (echte Objektgröße verwenden).

**Danach — Betriebsfähigkeit unter Last:**
[C5](#c5)/[C6](#c6) (Full-Table-Scans in Typing- und Lösch-Reducern) und [C7](#c7)
(instanzweiter Re-Sync bei Mitglieder-Events). Das schwerste Stück dieser Gruppe,
das S1-Cluster [C1](#c1)/[C2](#c2)/[C3](#c3), ist erledigt.

**Strukturell — braucht eine Entwurfsentscheidung:**
[A6](#a6) (Autorisierung für Anhänge), [C4](#c4) (Discover-Mitgliederzahl aggregieren).
