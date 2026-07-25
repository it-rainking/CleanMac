# CleanMac v5.2 — Synthesis Edition

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

## v5.2 — Moduli Uninstaller e Residui (chiusura della fusione)

Con la v5.1 il *motore* era allineato, ma due **moduli utente** di MyPureMac non
avevano equivalente in CleanMac: la vista uninstaller (`AppListView` +
`AppFilesView`) e la vista residui (`OrphanListView`). Erano le ultime funzioni
presenti solo nella app SwiftUI. La v5.2 le porta nella dashboard web.

### Nuovi moduli backend
- **`appInventory.js`** — porting di `AppInfoFetcher.swift`: elenco di tutte le
  app installate (`/Applications`, `~/Applications`, `/System/Applications`) con
  bundle id, dimensione (`du`), ultimo utilizzo (Spotlight `kMDItemLastUsedDate`
  con fallback su mtime) e giorni di inutilizzo. Le 39 app Apple di
  `PROTECTED_BUNDLE_IDS` e tutto `/System/Applications` sono marcati
  `removable: false` e non selezionabili.
- **`orphanFinder.js`** — porting di `AppState.findOrphans()`: ricerca inversa
  sulle `reverseSearchPaths` di `conditions.js`, con `skipReverse`, confronto
  con l'inventario installato e soglia dimensionale.

### Nuovi endpoint
| Endpoint | Funzione |
|---|---|
| `GET /api/apps[?fast=1]` | Inventario app (cache 60 s; `fast=1` salta `du`/`mdls`) |
| `GET /api/orphans[?minSizeMB=N]` | Residui candidati, ognuno con flag `deletable` |
| `POST /api/orphans/delete` | Eliminazione residui — **rivalida ogni path lato server** |
| `GET /api/disk-info` | Spazio totale/libero/usato (porting `getDiskInfo`) |

### Guard-rail dei residui
`isDeletableOrphan` è più stretto delle location scandite: consente solo i
**figli** di 9 directory dentro `~/Library`, rifiuta `..`, path relativi,
qualunque bundle `.app`, symlink non risolvibili e ogni percorso che dopo
`realpath` esce dall'area consentita. `/Library`, `PrivilegedHelperTools` e
`/Users/Shared` vengono **scanditi e segnalati ma mai eliminati**.
La lista di path inviata dal client non è mai considerata attendibile: ogni
percorso viene rivalidato in `POST /api/orphans/delete` e i rifiuti sono
riportati nella risposta.

### UI
- **Pannello Uninstaller**: lista app con ricerca, badge "non usata da Ng" e
  "🔒 protetta"; selezione di un'app → elenco dei file correlati con dimensioni,
  selettore di precisione (`strict`/`enhanced`/`deep`) e conteggio del selezionato.
  Gli elementi non eliminabili sono marcati `manuale` e disabilitati.
- **Pannello Residui**: soglia MB configurabile, selezione multipla dei soli
  item eliminabili, totale selezionato ed eliminazione con conferma.

### Difetto trovato dai test
`skipReverse` confronta **prefissi** del nome normalizzato: un item
`com.apple.X` diventa `comappleX` e **non** veniva intercettato dal prefisso
`apple` (l'op33 bash aveva invece un `case com.apple.*` esplicito). Senza la
guardia, ogni file di sistema Apple sarebbe stato classificato come residuo.
Aggiunta `SYSTEM_NAME_PREFIXES` in `orphanFinder.js` + test di regressione.

## Test
- `test/orphanFinder.test.js`: **15 test** su guard-rail di eliminazione,
  classificazione e inventario app (NEW v5.2).
- `test/appPathFinder.test.js`: **29 test unitari** committati sulla logica pura
  (normalizzazione, 9 livelli di matching, condizioni per-app, skip logic,
  filterSubpaths, parser codesign/entitlements) — eseguibili senza macOS.
- **Totale: 44 test**, `npm test` esegue entrambe le suite.
- `CleanMac.command`: `bash -n` pulito.
- `server.js`, `app.js`, moduli: `node --check` puliti.
