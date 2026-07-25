# CleanMac v5.1 — Synthesis Edition

Documento di sintesi della fusione tra le due repository:

- **CleanMac** — tool bash (`CleanMac.command`) + dashboard web Node.js/Socket.IO. Set di operazioni molto ampio (31 ops), report HTML, smart offload verso volumi esterni.
- **MyPureMac** — app nativa SwiftUI. Uninstaller euristico a 10 livelli, orphaned file finder, boot optimization, scan engine con discovery dinamica.

L'obiettivo era creare **una versione unica** che integri tutte le funzionalità e, dove si sovrappongono, adotti l'implementazione migliore. La piattaforma scelta come base è **CleanMac**, perché possiede già sia un motore CLI sia una GUI (web) e il set di operazioni più esteso; da MyPureMac sono state portate le capacità mancanti.

## Matrice funzionale e decisioni

| Funzionalità | CleanMac | MyPureMac | Scelta v5.0 | Note |
|---|:---:|:---:|---|---|
| Operazioni di cleanup | 31 | ~9 categorie | **CleanMac** | Set più ampio mantenuto integralmente |
| Dashboard web + report HTML/log | ✅ | ❌ | **CleanMac** | Unica delle due con GUI real-time |
| Smart offload (symlink → volume esterno) | ✅ | ❌ | **CleanMac** | Mantenuto |
| Selezione categorie / dry-run | ✅ | parziale | **CleanMac** | Flusso dry-run → cleanup mantenuto |
| Whitelist app di sistema Apple | 34 app | 27 app | **CleanMac** | Lista più completa |
| Protezione symlink su rm | `safe_remove` | resolve+validate | **entrambe** | Già allineate in v4.3 |
| Boot optimization (LaunchAgents/Daemons) | ❌ | ✅ | **MyPureMac → portato (op32)** | Con quarantena reversibile invece di rm |
| Orphaned file finder | ❌ | ✅ | **MyPureMac → portato (op33)** | Solo analisi (euristica non distruttiva) |
| Uninstaller con file correlati | solo `.app` | ✅ AppPathFinder 10 livelli | **MyPureMac → portato** (`appPathFinder.js`) | Matching bundle id/nome/last-two/company + container |
| Discovery dinamica cache utente | rimozione totale | enumerazione dinamica | **MyPureMac → migliorato (op02)** | Breakdown top-10 cache nel dry-run |
| HOMEBREW_CACHE personalizzato | default hardcoded | `brew --cache` | **MyPureMac → migliorato (op26)** | Rispetta env var / path custom |
| Rilevamento purgeable APFS | `diskutil` grep | URLResourceValues | **CleanMac** | URLResourceValues non disponibile in bash |
| Scheduler cleaning | ❌ | ✅ SchedulerService | **MyPureMac → portato** (`schedule.command`) | LaunchAgent `com.cleanmac.scheduler` con StartInterval |

## Cosa è stato aggiunto/modificato in v5.0

### Nuove operazioni bash (`CleanMac.command`)
- **op32 — Boot Optimization** (categoria PERFORMANCE)
  - Scansiona `~/Library/LaunchAgents`, `/Library/LaunchAgents`, `/Library/LaunchDaemons`.
  - Lista di item "noti problematici" portata 1:1 da `ScanEngine.scanBootOptimization`.
  - Rilevamento orfani via `PlistBuddy` (Program / ProgramArguments[0] → eseguibile mancante).
  - **Sicurezza**: in cleanup NON rimuove mai daemon di sistema. Mette in *quarantena reversibile* (`launchctl unload` + `mv` in `boot_quarantine_TS/`) solo gli agent **utente** noti.
- **op33 — Orphaned Files** (categoria ANALYSIS)
  - Costruisce l'insieme degli identificatori installati (bundle id via `defaults read` + nome normalizzato) da `/Applications` e `~/Applications`.
  - Confronta Preferences / Application Support / Containers / Caches; segnala i residui non associati ad alcuna app installata.
  - **Solo analisi**: nessuna eliminazione automatica (euristica → rischio falsi positivi).

### Miglioramenti a operazioni sovrapposte
- **op02 (cache utente)**: aggiunto breakdown dinamico delle 10 cache più grandi nel report dry-run.
- **op26 (Homebrew)**: usa `brew --cache` per rispettare `HOMEBREW_CACHE` personalizzato invece del path fisso.

### Scheduler (`schedule.command`)
- Porting di `SchedulerService` (MyPureMac): installa/rimuove un LaunchAgent utente
  `com.cleanmac.scheduler` che esegue `CleanMac.command --cleanup --categories=…` a
  intervallo `daily`/`weekly`/`monthly` (`StartInterval`).
- Comandi: `./schedule.command install weekly CLEANUP`, `./schedule.command status`, `./schedule.command uninstall`.

### Web layer (`server.js` + `appPathFinder.js`)
- Nuovo modulo `appPathFinder.js`: porting del motore euristico di MyPureMac in Node.
  - Matching multi-livello: bundle id completo → nome app → ultimi due componenti bundle → company (deep).
  - Sensitivity `strict` / `enhanced` / `deep`.
  - Discovery container sandbox (UUID via metadata plist + nominati).
  - Mai segue symlink; `filterSubpaths` elimina i figli quando il genitore è già incluso.
- Nuovo endpoint `GET /api/uninstall-scan?app=Foo.app&sensitivity=enhanced` — anteprima dei file correlati (nessuna eliminazione).
- `POST /api/uninstall-apps` esteso con `includeRelated` + `sensitivity`: disinstalla il bundle **e** i file correlati, con validazione `isSafeRelatedPath` (solo dentro `~/Library`, `/Applications`, `~/Applications`; no `..`; risoluzione realpath contro fughe via symlink).
- Frontend (`app.js`): la disinstallazione chiede se rimuovere anche i file correlati e riporta il conteggio.

## Sicurezza — invarianti mantenute

- `safe_remove()` per i path bash; validazione symlink.
- Uninstaller: eliminazioni confinate ad aree note, path assoluti, no `..`, realpath verificato.
- Boot optimization: quarantena reversibile, mai rimozione diretta di daemon di sistema.
- Password sudo (web): file temp `0o700`, cleanup su exit/SIGINT/SIGTERM (invariato).

## v5.1 — Parità completa del motore euristico (round 2 della sintesi)

La v5.0 aveva portato una versione semplificata di `AppPathFinder` (4 livelli su 9,
nessun database di condizioni). La v5.1 completa il porting 1:1 dei sorgenti
MyPureMac rimasti fuori:

### Nuovi moduli
- **`stringNormalization.js`** — porting di `StringNormalization.swift`:
  `normalizeForMatching` (semantica Swift: rimuove spazi/trattini/underscore/punti),
  `strippingTrailingVersion`, `lettersOnly`, `bundleCompanyName`,
  `bundleLastTwoComponents`, `baseBundleIdentifier` (strip suffissi
  `.helper/.agent/.daemon/…`).
- **`conditions.js`** — porting di `Conditions.swift` + `Locations.swift`:
  - `appConditions`: 25 regole per-app (Xcode vs Xcodes, Chrome vs iTerm,
    Logi vs login/logic, VS Code vs Insiders, JetBrains, Arc, Zoom, …) con
    includeTerms/excludeTerms e forceInclude/forceExclude path.
  - `skipConditions`: prefissi e path di sistema mai toccati (password manager,
    SystemExtensions, Trash, …) con `allowPrefixes` per le eccezioni Apple volute.
  - `skipDeepSearch`: ~160 directory di sistema escluse dalla deep search del Library.
  - `skipReverse`: ~150 prefissi (daemon Apple, SDK condivisi, telemetria) mai
    segnalati come orfani.
  - `standardLibrarySubdirectories` + location di ricerca complete (incluse
    system-wide: `/Library`, `/usr/local`, receipts, …).

### `appPathFinder.js` v5.1 — parità con `AppPathFinder.swift`
- Matching a **9 livelli**: bundle id → nome app → nome directory `.app` →
  nome solo-lettere → ultimi due componenti bundle → base bundle id →
  nome senza versione → company (deep) → **Team ID della firma codice** (deep,
  via `codesign`); più matching sugli **entitlements** (`application-groups`,
  `keychain-access-groups`).
- **Deep search del Library a depth 2** con esclusioni `skipDeepSearch` e
  riconoscimento delle *vendor folder* (il match dentro
  `Application Support/Vendor/...` include la cartella del vendor).
- Condizioni per-app applicate (exclude vince, include forza, force paths).
- Regola del Cestino: un risultato composto dal solo `.Trash` viene scartato.

### Guard-rail nuovi (oltre lo Swift originale)
- Lo scan esteso può toccare aree non eliminabili (Documents, `/Library`, altri
  bundle): ogni file di `/api/uninstall-scan` è ora marcato **`deletable`** e
  la disinstallazione **non elimina mai un bundle `.app` diverso dal target**
  (`isOtherAppBundle`), anche se il matcher lo aggancia (es. "Google Drive.app"
  durante l'uninstall di Chrome).
- Il frontend conta nella conferma solo i file realmente eliminabili e segnala
  a parte quelli trovati fuori dalle aree sicure.

### op33 Orphaned Files — skipReverse
- La lista `skipReverse` è ora applicata anche nell'op33 bash (heredoc di
  prefissi normalizzati, matching con `grep -f`): stop ai falsi positivi su
  daemon Apple, SDK condivisi (Sparkle, Sentry, Chromium, …) e telemetria.
  Da tenere allineata a `conditions.js`.

### Full Disk Access (porting `FullDiskAccessManager.swift`)
- `CleanMac.command`: probe TCC all'avvio (Safari Bookmarks, Mail, TCC.db,
  Cestino); warning nel log e dialog interattivo con apertura diretta di
  *Privacy e Sicurezza → Accesso completo al disco*.
- `server.js`: endpoint `GET /api/fda-status`; la dashboard mostra un banner
  se il processo non ha FDA (senza il quale Mail/Safari/Cestino non sono pulibili).

## Test
- `test/appPathFinder.test.js`: **29 test unitari** committati sulla logica pura
  (normalizzazione, 9 livelli di matching, condizioni per-app, skip logic,
  filterSubpaths, parser codesign/entitlements) — eseguibili senza macOS: `npm test`.
- `CleanMac.command`: `bash -n` pulito.
- `server.js`, `app.js`, moduli: `node --check` puliti.
