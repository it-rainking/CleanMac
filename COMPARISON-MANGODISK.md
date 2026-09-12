# CleanMac ↔ MangoDisk — confronto funzionale e roadmap

Confronto tra **CleanMac v5.3 (Synthesis Edition)** e
[MangoDisk](https://github.com/harry0703/MangoDisk) (Tauri 2 + Rust + Vue 3,
GPL-3.0, cross-platform macOS/Windows).

> **Nota sulle fonti**: i dati su MangoDisk provengono dal README del repository
> e da `src-tauri/crates/mangodisk-core/rules/README.md`, consultati il
> 2026-09-04. Non è stato letto il codice Rust: le valutazioni riguardano
> quanto il progetto dichiara, non quanto è stato verificato in esecuzione.

---

## 1. Matrice funzionale

| Feature | CleanMac v5.3 | MangoDisk | Verdetto |
|---|:---:|:---:|---|
| Deep cleanup cache (sistema/app/browser) | ✅ 20 ops | ✅ regole TOML | Pari — CleanMac ha più coverage macOS-specifica |
| Dev artifacts (Xcode, Docker, npm/pip) | ✅ op06/24/25 | ✅ + Rust/Gradle/Swift/Python a livello progetto | MangoDisk avanti: scansiona `target/`, `node_modules`, `.gradle` nei progetti |
| Cache modelli AI | ✅ op35 (cache) + op36 (inventario) | ✅ categoria `ai` | **Pari da v5.3** |
| File grandi | ✅ op10 (report testuale) | ✅ con filtri tipo/dimensione | MangoDisk avanti sulla UX |
| Duplicati per contenuto | ✅ op17 (md5) | ✅ + preserva ≥1 copia per gruppo | MangoDisk avanti |
| Analisi spazio treemap | ❌ solo liste | ✅ treemap + list view | Gap UX |
| Uninstaller app + file correlati | ✅ 9 livelli, entitlements + Team ID | ✅ generico | **CleanMac avanti** |
| Residui app disinstallate | ✅ op33 + UI azionabile | ✅ | Pari |
| Gestione item di avvio | ✅ op32, quarantena reversibile | ✅ | Pari |
| System maintenance (Spotlight, icone, audio, rete) | ⚠️ parziale (op19/21/22) | ✅ suite dedicata | MangoDisk avanti |
| Cronologia operazioni con esito | ⚠️ report su file | ✅ registro strutturato | Gap |
| Undo / staging atomico | ⚠️ solo op32 | ✅ `deleteWholeRoot` → staging | **Gap di sicurezza** |
| Regole dichiarative versionate | ❌ logica in bash | ✅ TOML `schema_version=3` | Gap architetturale |
| Modello di rischio formale | ⚠️ implicito nelle categorie | ✅ `safe`/`recoverable`/`highImpact` + `evidence` + `references` | Gap |
| Dry-run / preview | ✅ nativo con stime MB | ✅ read-only di default | Pari |
| Report HTML + log tecnico | ✅ | ❌ | **CleanMac avanti** |
| Offload su volume esterno (symlink) | ✅ | ❌ | **CleanMac avanti, unico** |
| Scheduler ricorrente | ✅ LaunchAgent | ❌ non documentato | **CleanMac avanti** |
| Rilevamento Full Disk Access | ✅ v5.1 | non documentato | CleanMac avanti |
| CLI + GUI sullo stesso motore | ✅ bash + web | ✅ CLI + Tauri | Pari |
| Cross-platform Windows | ❌ | ✅ | Fuori scope per CleanMac |
| Distribuzione (brew cask, installer) | ❌ | ✅ | Gap go-to-market |
| Test automatici | 54 unit test JS | `cargo test` + `pnpm check` | Pari |

---

## 2. Punti di attacco (redteam)

1. **Il motore non è ispezionabile.** Le regole di MangoDisk sono TOML con
   `evidence`, `references` a documentazione ufficiale e `verified_at`. Quelle di
   CleanMac sono `rm -rf` distribuiti in ~2.900 righe di bash. Chi valuta un
   cleaner guarda *come si dimostra* che un path è eliminabile, non quanti path
   si conoscono.
2. **Le eliminazioni non hanno rete di sicurezza.** MangoDisk sposta in staging
   atomico; CleanMac usa `safe_remove`, che è distruttivo. La quarantena
   reversibile esiste solo per op32.
3. **Il numero di operazioni non è un argomento.** Molte ops sono micro-task
   (flush DNS, `.DS_Store`). Il conteggio è debito di manutenzione, non valore.
4. **L'installazione è un funnel rotto.** MangoDisk: `brew install --cask`.
   CleanMac: download di un `.command`, permessi, sblocco Gatekeeper, server
   Node su :3000.

## 3. Premortem — perché il progetto potrebbe fermarsi

- **Manutenibilità (rischio alto)**: ogni nuova regola richiede modifiche nei due
  rami `dry-run`/`cleanup`, in `init_operations_map()` e in eventuali heredoc
  duplicati. Il costo marginale per feature cresce.
- **Rottura da aggiornamento macOS (medio)**: path hardcoded in `~/Library` e
  restrizioni TCC più severe rompono le regole in blocco, senza un canale di
  aggiornamento delle regole indipendente dal codice.
- **Incidente di perdita dati (medio)**: uninstaller in modalità `deep` senza
  undo. Un solo caso pubblico costa la reputazione del progetto.
- **Perdita del differenziatore (basso)**: se MangoDisk aggiunge l'offload,
  resta poco di esclusivo.

## 4. Punti ciechi

- **Manca un posizionamento.** MangoDisk vende "safety-first, cross-platform,
  regole aperte". CleanMac elenca operazioni. Il differenziatore reale e
  inespresso è **automazione headless schedulabile + offload su volume esterno**:
  il cleaner per chi ha un Mac da 256 GB e un SSD esterno.
- **L'uninstaller è l'asset migliore ed è trattato come sotto-feature.** Nove
  livelli di matching con entitlements e Team ID sono più profondi di quanto
  MangoDisk documenti.
- **Il server web è superficie d'attacco.** Node su localhost con escalation
  sudo è il primo bersaglio di una review di sicurezza; MangoDisk gira in un
  processo Rust sandboxato in Tauri.
- **Il confronto si gioca sulla fiducia, non sulle feature.** Il prodotto non
  vende spazio liberato: vende la certezza di non rompere nulla.

---

## 5. Roadmap

| # | Azione | Perché | Stato |
|---|---|---|---|
| 3 | Categoria AI (cache + inventario modelli) | Quick win, decine di GB su macchine di sviluppo | ✅ **fatto in v5.3** (op35/op36) |
| 1 | Staging + undo universale al posto di `rm -rf` | Chiude il gap di fiducia principale | ⏳ prossimo |
| 6 | Cronologia operazioni strutturata (JSON append-only) | Prerequisito dell'undo, argomento di trasparenza | da fare |
| 2 | Estrazione delle regole in JSON/TOML versionato | Dimezza il costo di ogni nuova regola | da fare |
| 4 | Scanner artefatti di progetto (`node_modules`, `target`, `venv`) | Il singolo recupero di spazio più grande | da fare |
| 5 | Treemap nella dashboard | Unico gap UX visibile a colpo d'occhio | da fare |
| 7 | Distribuzione: Homebrew tap + `.app` firmato | Senza questo il resto non raggiunge nessuno | da fare |
| 8 | Universal binary thinning (`lipo -thin arm64`) | Feature vetrina, 1-3 GB su app universal | da fare |

**Da non fare**: inseguire Windows, aumentare il conteggio delle operazioni,
riscrivere in Rust/Tauri adesso. Il vantaggio competitivo è uninstaller +
offload + scheduling, non la parità di piattaforma.
