# CleanMac - CLAUDE.md

## Descrizione
Script di pulizia e manutenzione macOS con doppia interfaccia: GUI tradizionale via osascript e dashboard web real-time via Node.js + Socket.IO.

**Versione attuale**: v4.3 + Web Interface v1.0

---

## Stack
- **Script principale**: Bash (compatibile bash 3.x macOS)
- **Web backend**: Node.js + Express.js + Socket.IO
- **Web frontend**: HTML5 / CSS3 / Vanilla JS (no framework)
- **GUI nativa**: osascript (dialog macOS)

---

## Struttura progetto
```
CleanMac/
├── CleanMac.command      # Script bash principale (v4.3, ~2100 righe)
├── server.js             # Backend web (Express + Socket.IO)
├── start-web.command     # Launcher interfaccia web
├── stop-web.command      # Stop server web
├── package.json          # Dipendenze Node.js
└── public/
    ├── index.html        # Dashboard web UI
    ├── app.js            # Logica frontend (WebSocket, stats, modals)
    └── style.css         # Stili dashboard
```

---

## Agenti consigliati
- **vibe-dev**: modifiche a server.js, app.js, index.html, nuove feature bash
- **code-reviewer**: revisione pre-deploy, verifica sicurezza operazioni rm -rf
- **railway-ops**: se mai si vuole containerizzare il server web

---

## Operazioni Disponibili (31 totali)

### Categorie v4.3
- **CLEANUP** (19 ops): Cache utente/sistema, log, Safari, Xcode, DS_Store, temp, trash, localized, cache app (Slack/Discord/VSCode/Chrome/Firefox/Spotify/Teams/Zoom/Telegram/Notion/WhatsApp), log vecchi, download >30gg, npm/yarn/pip/pnpm, Docker, Homebrew, Time Machine, iOS backup, **Mail Attachments (NEW)**
- **PERFORMANCE** (5 ops): RAM purge, LaunchServices rebuild, permessi utente, DNS flush, Spotlight reset
- **ANALYSIS** (6 ops): Spazio disco, file >500MB, app non usate, duplicati, swap/sleepimage, **APFS Purgeable (NEW)**
- **UTILITY** (1 op): Backup config (sempre attiva)

---

## Architettura v4.3

### Funzioni Core (CleanMac.command)
- `register_operation(op_id, mb, categoria, desc)`: traccia MB per dry run
- `is_operation_enabled(op_id)`: controlla se operazione abilitata in selective mode
- `init_operations_map()`: mappa 31 ops → formato `op_id:0:CATEGORIA:descrizione`
- `safe_remove(path)`: wrapper `rm -rf` con protezione symlink (da MyPureMac)
- `is_system_app(nome)`: whitelist 34 app Apple protette (da MyPureMac)
- `calculate_freed(bytes, cat)`: accumula MB per categoria via file temp

### FIX critici v4.3 (non rimuovere)
- `init_operations_map()` scrive formato `op_id:0:CATEGORIA:desc` — campo 3 = CATEGORIA.
  `is_operation_enabled()` legge campo 3 via `cut -d: -f3`. Prima era rotto (field 2 vs 3).
- File temp sudo: permessi `0o700` (non 0o755) + cleanup su `process.on('exit')`
- Sostituzione `sudo` in server.js: skippa righe commento (`startsWith('#')`)

### Flusso dati (dry-run → cleanup)
```
DRY_RUN → register_operation() → OPERATIONS_DATA_FILE
CLEANUP → is_operation_enabled() → legge OPERATIONS_DATA_FILE (init_operations_map entries)
```

---

## Web Interface

- **URL**: `http://localhost:3000`
- **Avvio**: `./start-web.command` oppure `node server.js`
- **API REST**: `/api/run`, `/api/stop`, `/api/reports`, `/api/analysis-files`, `/api/delete-files`, `/api/uninstall-apps`
- **WebSocket events**: `execution:start`, `execution:stdout`, `execution:stderr`, `execution:complete`, `execution:error`, `request:password`
- **Features**: Real-time log, statistiche live, modal file grandi, modal app non usate, cronologia report HTML

---

## Smart Offload Module

Modulo per spostare directory pesanti su disco esterno con symlink trasparente.

### API endpoints
| Endpoint | Descrizione |
|----------|-------------|
| `GET /api/offload/volumes` | Volumi esterni montati (`fs.readdirSync('/Volumes')`) |
| `GET /api/offload/scan` | Scansiona `OFFLOAD_TARGETS` con `du -sk`, rileva symlink esistenti |
| `POST /api/offload/execute` | Pipeline: pre-flight pgrep → rsync → verifica count → rm → ln -s |
| `GET /api/offload/registry` | Legge `~/.config/cleanmac/symlinks.json` |
| `POST /api/offload/restore` | rsync inverso + verifica lstatSync symlink + rimozione registry |
| `GET /api/offload/health` | Verifica integrità tutti i symlink nel registry |

### Invarianti critici (non rimuovere)
- **Write-ahead registry**: entry `status:'pending'` salvata PRIMA di `rmSync`+`symlinkSync`; aggiornata ad `active` dopo. Se crash tra i due, la UI mostra entry pending con restore disabilitato.
- **Lock concorrenza**: `activeOffloads` Set blocca doppie esecuzioni sullo stesso path.
- **Pre-flight**: `pgrep -xi processName` blocca offload se l'app è aperta — LevelDB/IndexedDB corrompono su rsync con file aperti.
- **Restore guard**: `lstatSync` verifica che il path sia symlink prima di `unlinkSync`; ENOENT distinto da altri errori.
- **Sicurezza HTML**: `escAttr()`/`escText()` su tutti i valori dinamici in innerHTML; event delegation invece di onclick inline.

### Risk levels in OFFLOAD_TARGETS
- `safe` — cache CLI rigenerabili, dati app senza lock (OpenEmu, Kodi, Google, ecc.)
- `caution` — Electron/LevelDB: VSCode, Claude App, Microsoft Edge, Python 3.10
- `risky` — Firefox Application Support (profiles.ini, LevelDB aperto)

### Registry
- Path: `~/.config/cleanmac/symlinks.json`
- Struttura entry: `{ id, original, dest, created, status: 'pending'|'active' }`
- Destinazione default: `/Volumes/<disco>/MacSymlinks/<nome>`

---

## Regole specifiche progetto

### Bash (CleanMac.command)
- Compatibilità bash 3.x: no array associativi, usa file temp invece di `declare -A`
- Ogni operazione ha ID `op01`–`op31` e deve essere registrata in `init_operations_map()`
- Nuove operazioni vanno aggiunte in ENTRAMBI i rami `if [ "$DRY_RUN" = true ]` / `else`
- Usa `safe_remove()` invece di `rm -rf` per path singoli; usa loop con `safe_remove` per wildcard
- Nuove op CLEANUP: aggiungere `calculate_freed` nel ramo dry-run
- Stima TM snapshots: `SNAPSHOTS * 2048` MB (non 5000 — troppo ottimistico)

### Node.js (server.js)
- Non salvare mai la password sudo in chiaro su file con permessi > 0o700
- Temp script eliminato su `process.on('exit')` + SIGINT + SIGTERM
- Modifica sudo nel script: skippa righe che iniziano con `#`

### Frontend (app.js / index.html)
- Parsing log output è generico (cerca pattern `MB`, `file`, `✅`)
- Nuove operazioni vengono parse automaticamente senza modifiche al frontend
- Modal "File grandi" e "App non usate" leggono i file `.txt` generati dallo script

---

## Dipendenze
```json
"express": "^4.18.2"
"socket.io": "^4.6.1"
"nodemon": "^3.0.1" (dev)
Node.js >= 14.0.0
```

---

## Output generati (nella dir dello script)
| File | Contenuto |
|------|-----------|
| `cleanmac_TS.log` | Log tecnico completo |
| `dryrun_report_TS.txt` | Report dry run con stime MB |
| `cleanmac_report_TS.html` | Dashboard HTML visuale |
| `disk_analysis_TS.txt` | Analisi cartelle Desktop/Downloads/Documents |
| `large_files_TS.txt` | File >500MB |
| `unused_apps_TS.txt` | App non usate (esclude whitelist Apple) |
| `duplicates_TS.txt` | File duplicati raggruppati per hash |
| `config_backup_TS/` | Backup .zshrc, .gitconfig, .ssh/config |

---

## Note
- Confronto con MyPureMac (SwiftUI): già integrati safe_remove, is_system_app, Mail Attachments, APFS Purgeable
