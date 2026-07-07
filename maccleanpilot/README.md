# MacCleanPilot v1.0

App locale macOS per la manutenzione periodica del disco, **semi-automatica**:
scansiona, misura e propone; tu approvi per categoria (o per singola voce);
lei esegue e produce un report. Nessuna cancellazione avviene mai senza
approvazione esplicita.

Implementazione del tech spec derivato da *Guida_Manutenzione_Disco_macOS.pdf*
(procedura manuale mensile, Sez. 1–8).

## Invarianti di design

1. **Whitelist-only** — l'engine tocca solo i percorsi in `catalog.yaml`.
2. **Dry-run di default** — si elimina solo con `--execute`.
3. **Backup-gated** — esecuzione reale bloccata senza snapshot APFS della sessione.
4. **Svuota contenuti, mai cartelle** — `rm -rf <dir>/*`, mai `rm -rf <dir>`.
5. **Blocklist hard-coded** in `core/guard.py`, non sovrascrivibile da config.

## Requisiti

- macOS 12+ (testato per Mac mini Intel 2018), Python 3.11+
- Full Disk Access al terminale (verifica con `mcp doctor`)
- Volume `/Volumes/Dati` montato per il backup rsync

```bash
cd maccleanpilot
pip3 install -r requirements.txt
alias mcp="python3 $(pwd)/mcp.py"
```

## Uso

```bash
mcp scan                          # misura le aree del catalogo (solo lettura)
mcp backup                        # snapshot APFS + rsync su /Volumes/Dati
mcp clean                         # flusso interattivo completo (dry-run)
mcp clean --execute               # esecuzione reale (richiede backup ok)
mcp clean --only cache_dev,log --execute
mcp history                       # storico sessioni (SQLite)
mcp history --session 3           # dettaglio azioni di una sessione
mcp doctor                        # verifica FDA, sudo, volume backup, voci morte
mcp web                           # dashboard su http://127.0.0.1:7787
mcp remind --install              # promemoria mensile (LaunchAgent + osascript)
```

Flusso della sessione: `SCAN → REPORT → BACKUP → APPROVE → EXECUTE → VERIFY`.
Il gate backup si bypassa solo con `--skip-backup --i-know-what-i-am-doing`
(doppio flag, loggato).

### Dashboard web

`mcp web` serve una single page mobile-first su `127.0.0.1:7787` (mai
`0.0.0.0`; dall'iPhone: tunnel SSH). Difese attive:

- **allowlist header Host** (`127.0.0.1`/`localhost`/`::1`): richieste con
  Host estranei → 403, contro attacchi DNS rebinding da pagine web malevole;
- **gate con scadenza**: il backup verificato sblocca "Esegui" per 2 ore,
  poi va rifatto;
- le voci `glob_review` (Downloads/Desktop), `require_explicit` (docker
  prune) e `sudo` (cache/log di sistema) sono eseguibili **solo dalla CLI**:
  richiedono selezione file per file, conferma dedicata o TTY per sudo.

Prima dell'esecuzione reale la CLI rileva i client di sync attivi
(Dropbox, Google Drive, OneDrive) e chiede la pausa manuale (§6 spec).

## Catalogo (`catalog.yaml`)

Modi operativi per voce:

| Modo | Comportamento |
|------|---------------|
| `empty_children` | rimuove i contenuti della dir, mai la dir — ammesso solo sotto `~/Library`, `/Library/Caches`, `/Library/Logs`, `/private/var/log` |
| `glob_delete` | elimina solo i file che matchano i pattern |
| `glob_review` | lista i file, eliminazione solo per selezione manuale |
| `delegate` | comando nativo (`brew cleanup`, `pip cache purge`, `npm cache clean`, `docker system prune`) |

Le voci che violano blocklist o radici ammesse vengono **disabilitate al
load** (WARN nel log) e restano visibili ma inerti.

## Test

```bash
python3 -m pytest --cov=core          # 117 test
```

Tutta la suite gira contro una fixture in `tmp_path` che replica l'albero
`Library/Caches`, `Logs`, `Downloads`; **nessun test esegue mai `--execute`
fuori dalla fixture**. Copertura `guard.py`: 100% (obbligatoria da spec §7).

## Note operative

- Il delta `df` prima/dopo include lo spazio *purgeable* APFS: misura
  indicativa, non contabile (il report lo dichiara).
- Lo snapshot APFS creato dalla sessione occupa a sua volta spazio per ~24h.
- App in conflitto aperte (browser, Mail, Dropbox, Docker) → voce SKIPPED
  con motivo; mai kill automatico.
- Output: `data/history.db` (storico), `data/logs/YYYY-MM-DD.log` (log riga
  per riga), `data/logs/session_N_*.md` (report riepilogativo).
