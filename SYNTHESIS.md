# CleanMac v5.0 — Synthesis Edition

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

## Test
- `appPathFinder.js`: 11 test unitari sulla logica di matching pura (eseguibili senza macOS).
- `CleanMac.command`: `bash -n` pulito.
- `server.js`: caricamento verificato (nessun errore TDZ/modulo).
