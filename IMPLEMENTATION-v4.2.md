# 🚀 CleanMac v4.2 - Guida Implementazione Completa

## 📋 STATO ATTUALE

**Versione**: 4.2-beta
**Completamento**: 10% (1/29 operazioni + infrastruttura)
**Prossimo step**: Applicare pattern a operazioni rimanenti

---

## ✅ GIÀ IMPLEMENTATO

### 1. Infrastruttura Base ✅
```bash
# Variabili globali
SELECTIVE_MODE=false
OPERATIONS_DATA_FILE=$(mktemp)
ENABLE_CLEANUP=0
ENABLE_PERFORMANCE=0
ENABLE_ANALYSIS=0

# Funzioni
register_operation(op_id, mb_value, category, description)
is_operation_enabled(op_id)
```

### 2. Dialog Post-DryRun ✅
- Step 1: Riepilogo con MB per categoria
- Step 2: 3 opzioni (Annulla, Personalizza, Esegui Tutto)
- Step 3: Selezione multi-scelta categorie
- Step 4: Salvataggio preferenze

### 3. Operazione Prototipo ✅
**Op02 - Cache Utente** implementata come template

---

## 📝 PATTERN DA APPLICARE

### Pattern per CLEANUP (libera spazio)

```bash
#############################################
# X. NOME OPERAZIONE
#############################################
log "Analisi NOME..."
{
    # ... calcolo MB_VALUE ...

    if [ "$DRY_RUN" = true ]; then
        # AGGIUNGERE QUESTA RIGA ⬇️
        register_operation "opXX" "$MB_VALUE" "CLEANUP" "Descrizione breve"

        append_dryrun ""
        append_dryrun "🗑️  NOME (DRY RUN)"
        # ... resto dry run ...
        calculate_freed "$BYTES" "Categoria"
    else
        # SOSTITUIRE BLOCCO ELSE CON ⬇️
        if is_operation_enabled "opXX"; then
            # ... esegui pulizia ...
            calculate_freed "$BYTES" "Categoria"
            add_to_report "✅ NOME pulito ($MB_VALUE MB)"
        else
            log "NOME: SALTATA (non selezionata)"
            add_to_report "⏭️  NOME saltata (non selezionata)"
        fi
    fi

    log "NOME analizzato: $MB_VALUE MB"
}
```

### Pattern per PERFORMANCE (no spazio)

```bash
if [ "$DRY_RUN" = true ]; then
    register_operation "opXX" "0" "PERFORMANCE" "Descrizione"
    # ... dry run ...
else
    if is_operation_enabled "opXX"; then
        # ... esegui ottimizzazione ...
        add_to_report "✅ NOME completato"
    else
        log "NOME: SALTATA (non selezionata)"
        add_to_report "⏭️  NOME saltata (non selezionata)"
    fi
fi
```

### Pattern per ANALYSIS (solo report)

```bash
if [ "$DRY_RUN" = true ]; then
    register_operation "opXX" "0" "ANALYSIS" "Descrizione"
    # ... dry run ...
else
    if is_operation_enabled "opXX"; then
        # ... genera report ...
        add_to_report "✅ NOME completato → file"
    else
        log "NOME: SALTATA (non selezionata)"
        add_to_report "⏭️  NOME saltata (non selezionata)"
    fi
fi
```

### Pattern per UTILITY (sempre attiva)

```bash
if [ "$DRY_RUN" = true ]; then
    register_operation "opXX" "0" "UTILITY" "Descrizione"
    # ... dry run ...
else
    # NO CHECK - sempre eseguita
    # ... esegui utility ...
    add_to_report "✅ NOME completato"
fi
```

---

## 🗂️ MAPPING COMPLETO OPERAZIONI (29)

| Op ID | Nome | Categoria | Var MB | Note |
|-------|------|-----------|--------|------|
| op01 | Analisi spazio disco | ANALYSIS | 0 | Solo report, nessuna pulizia |
| **op02** | **Cache utente** | **CLEANUP** | **CACHE_MB** | **✅ FATTO** |
| op03 | Cache sistema | CLEANUP | SYSCACHE_MB | |
| op04 | Log files | CLEANUP | LOG_MB | |
| op05 | Safari cache | CLEANUP | SAFARI_MB | |
| op06 | Xcode | CLEANUP | XCODE_MB | DerivedData+Archives+Simulator |
| op07 | .DS_Store | CLEANUP | DS_MB | |
| op08 | Temp folders | CLEANUP | TMP_MB | |
| op09 | Trash | CLEANUP | TRASH_MB | |
| op10 | File grandi >500MB | ANALYSIS | 0 | Solo report |
| op11 | .localized + junk | CLEANUP | JUNK_MB | |
| op12 | Cache app (12 app) | CLEANUP | APP_MB | |
| op13 | Log vecchi compress | CLEANUP | ~30% di OLD_LOG_COUNT | Stima riduzione |
| op14 | Download vecchi >30gg | CLEANUP | OLD_DL_MB | |
| op15 | App non usate | ANALYSIS | 0 | Solo report |
| op16 | Backup config | UTILITY | 0 | **Sempre ON** |
| op17 | Duplicati | ANALYSIS | 0 | Solo report |
| op18 | Ottimizza RAM | PERFORMANCE | 0 | purge |
| op19 | LaunchServices | PERFORMANCE | 0 | rebuild |
| op20 | Permessi utente | PERFORMANCE | 0 | repair |
| op21 | Flush DNS | PERFORMANCE | 0 | reset cache |
| op22 | Spotlight | PERFORMANCE | 0 | rebuild index |
| op23 | Font cache | CLEANUP | ~50MB | Stima |
| op24 | npm/yarn/pip/pnpm | CLEANUP | DEV_MB | |
| op25 | Docker | CLEANUP | 0 | Usa docker system df |
| op26 | Homebrew | CLEANUP | BREW_CACHE_MB | |
| op27 | Time Machine snapshots | CLEANUP | TM_MB | |
| op28 | Backup iOS/iPad | CLEANUP | IOS_MB | **Ha già dialog conferma** |
| op29 | Swap/Sleepimage | ANALYSIS | 0 | Solo report + suggerimenti |

---

## 🔧 MODIFICHE DA APPLICARE

### GRUPPO 1: CLEANUP (Operazioni 3-14, 23-27)

Applicare pattern CLEANUP a:
- Op03: Cache sistema
- Op04: Log files
- Op05: Safari cache
- Op06: Xcode (già parziale, aggiungere register)
- Op07: .DS_Store
- Op08: Temp folders
- Op09: Trash
- Op11: .localized + junk
- Op12: Cache app
- Op13: Log vecchi
- Op14: Download vecchi
- Op23: Font cache
- Op24: npm/yarn/pip/pnpm
- Op25: Docker
- Op26: Homebrew
- Op27: Time Machine snapshots

**Totale**: 16 operazioni

### GRUPPO 2: PERFORMANCE (Operazioni 18-22)

Applicare pattern PERFORMANCE a:
- Op18: Ottimizza RAM (`sudo purge`)
- Op19: LaunchServices rebuild
- Op20: Permessi utente
- Op21: Flush DNS
- Op22: Spotlight rebuild

**Totale**: 5 operazioni

### GRUPPO 3: ANALYSIS (Operazioni 1, 10, 15, 17, 29)

Applicare pattern ANALYSIS a:
- Op01: Analisi spazio disco
- Op10: File grandi >500MB
- Op15: App non usate
- Op17: Duplicati
- Op29: Swap/Sleepimage

**Totale**: 5 operazioni

### GRUPPO 4: UTILITY (Operazione 16)

Applicare pattern UTILITY a:
- Op16: Backup configurazioni

**Totale**: 1 operazione

### GRUPPO 5: SPECIALI (Operazione 28)

- Op28: Backup iOS/iPad - **HA GIÀ dialog conferma**, aggiungere solo register

**Totale**: 1 operazione

---

## 📄 ESEMPI PRATICI

### Esempio 1: Op03 - Cache Sistema (CLEANUP)

**PRIMA:**
```bash
log "Analisi cache sistema..."
{
    SYSCACHE_MB=$(get_dir_size_mb /Library/Caches)
    SYSCACHE_BYTES=$(( SYSCACHE_MB * 1048576 ))

    if [ "$DRY_RUN" = true ]; then
        append_dryrun ""
        append_dryrun "🗑️  CACHE SISTEMA (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "Spazio che sarebbe liberato: $SYSCACHE_MB MB"
        append_dryrun "Percorso: /Library/Caches/*"
        calculate_freed "$SYSCACHE_BYTES" "Cache Sistema"
    else
        sudo rm -rf /Library/Caches/* 2>/dev/null
        calculate_freed "$SYSCACHE_BYTES" "Cache Sistema"
        add_to_report "✅ Cache sistema pulita ($SYSCACHE_MB MB)"
    fi

    log "Cache sistema analizzata: $SYSCACHE_MB MB"
}
```

**DOPO (modifiche evidenziate con ⬇️):**
```bash
log "Analisi cache sistema..."
{
    SYSCACHE_MB=$(get_dir_size_mb /Library/Caches)
    SYSCACHE_BYTES=$(( SYSCACHE_MB * 1048576 ))

    if [ "$DRY_RUN" = true ]; then
        register_operation "op03" "$SYSCACHE_MB" "CLEANUP" "Cache sistema (/Library/Caches)"  # ⬇️ AGGIUNTO

        append_dryrun ""
        append_dryrun "🗑️  CACHE SISTEMA (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "Spazio che sarebbe liberato: $SYSCACHE_MB MB"
        append_dryrun "Percorso: /Library/Caches/*"
        calculate_freed "$SYSCACHE_BYTES" "Cache Sistema"
    else
        if is_operation_enabled "op03"; then  # ⬇️ AGGIUNTO CHECK
            sudo rm -rf /Library/Caches/* 2>/dev/null
            calculate_freed "$SYSCACHE_BYTES" "Cache Sistema"
            add_to_report "✅ Cache sistema pulita ($SYSCACHE_MB MB)"
        else  # ⬇️ AGGIUNTO ELSE
            log "Cache sistema: SALTATA (non selezionata)"
            add_to_report "⏭️  Cache sistema saltata (non selezionata)"
        fi  # ⬇️ CHIUSURA IF
    fi

    log "Cache sistema analizzata: $SYSCACHE_MB MB"
}
```

### Esempio 2: Op18 - Ottimizza RAM (PERFORMANCE)

**PRIMA:**
```bash
log "Ottimizzazione memoria..."
{
    sudo purge 2>/dev/null
    add_to_report "✅ Memoria ottimizzata (RAM liberata)"
    log "RAM ottimizzata."
}
```

**DOPO:**
```bash
log "Ottimizzazione memoria..."
{
    if [ "$DRY_RUN" = true ]; then  # ⬇️ AGGIUNTO IF
        register_operation "op18" "0" "PERFORMANCE" "Ottimizza RAM (purge)"

        append_dryrun ""
        append_dryrun "⚡ OTTIMIZZA RAM (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "Operazione: sudo purge"
        append_dryrun "Benefici: Libera memoria cache (migliora performance)"
    else
        if is_operation_enabled "op18"; then  # ⬇️ AGGIUNTO CHECK
            sudo purge 2>/dev/null
            add_to_report "✅ Memoria ottimizzata (RAM liberata)"
        else
            log "Ottimizza RAM: SALTATA (non selezionata)"
            add_to_report "⏭️  Ottimizza RAM saltata (non selezionata)"
        fi
    fi

    log "RAM ottimizzata."
}
```

### Esempio 3: Op01 - Analisi Disco (ANALYSIS)

**PRIMA:**
```bash
log "Analisi spazio disco..."
{
    ANALYSIS_FILE="$SCRIPT_DIR/disk_analysis_${TIMESTAMP}.txt"

    # ... genera file ...

    add_to_report "✅ Analisi spazio disco completata → $ANALYSIS_FILE"
    log "Analisi salvata in $ANALYSIS_FILE"
}
```

**DOPO:**
```bash
log "Analisi spazio disco..."
{
    ANALYSIS_FILE="$SCRIPT_DIR/disk_analysis_${TIMESTAMP}.txt"

    if [ "$DRY_RUN" = true ]; then  # ⬇️ AGGIUNTO IF
        register_operation "op01" "0" "ANALYSIS" "Analisi spazio disco"

        # ... genera file dry run ...
    else
        if is_operation_enabled "op01"; then  # ⬇️ AGGIUNTO CHECK
            # ... genera file ...
            add_to_report "✅ Analisi spazio disco completata → $ANALYSIS_FILE"
        else
            log "Analisi disco: SALTATA (non selezionata)"
            add_to_report "⏭️  Analisi disco saltata (non selezionata)"
        fi
    fi

    log "Analisi salvata in $ANALYSIS_FILE"
}
```

### Esempio 4: Op28 - Backup iOS (SPECIALE - già ha conferma)

**NOTA**: Questa operazione HA GIÀ un dialog di conferma, quindi aggiungere solo `register_operation` nella parte dry run.

**MODIFICARE SOLO QUESTA RIGA:**
```bash
if [ "$DRY_RUN" = true ]; then
    register_operation "op28" "$IOS_MB" "CLEANUP" "Backup iOS/iPad locale"  # ⬇️ AGGIUNGERE SOLO QUESTO

    append_dryrun ""
    append_dryrun "📱 BACKUP iOS/iPAD (DRY RUN)"
    # ... resto invariato (ha già la sua logica di conferma) ...
```

**NON modificare** il blocco `else` perché ha già un dialog di conferma esplicito.

---

## 🎯 CHECKLIST IMPLEMENTAZIONE

### Fase 1: CLEANUP (16 ops)
- [ ] Op03: Cache sistema
- [ ] Op04: Log files
- [ ] Op05: Safari cache
- [ ] Op06: Xcode (solo register)
- [ ] Op07: .DS_Store
- [ ] Op08: Temp folders
- [ ] Op09: Trash
- [ ] Op11: .localized + junk
- [ ] Op12: Cache app
- [ ] Op13: Log vecchi
- [ ] Op14: Download vecchi
- [ ] Op23: Font cache
- [ ] Op24: npm/yarn/pip/pnpm
- [ ] Op25: Docker
- [ ] Op26: Homebrew
- [ ] Op27: Time Machine snapshots

### Fase 2: PERFORMANCE (5 ops)
- [ ] Op18: Ottimizza RAM
- [ ] Op19: LaunchServices
- [ ] Op20: Permessi
- [ ] Op21: Flush DNS
- [ ] Op22: Spotlight

### Fase 3: ANALYSIS (5 ops)
- [ ] Op01: Analisi disco
- [ ] Op10: File grandi
- [ ] Op15: App non usate
- [ ] Op17: Duplicati
- [ ] Op29: Swap/Sleepimage

### Fase 4: UTILITY (1 op)
- [ ] Op16: Backup config

### Fase 5: SPECIALI (1 op)
- [ ] Op28: Backup iOS (solo register)

---

## 🧪 TESTING

Dopo implementazione, testare:

1. **Dry Run** → Verifica MB correttamente calcolati per categoria
2. **Dialog Selezione** → Verifica 3 opzioni funzionanti
3. **Selezione Categorie** → Verifica multi-select con pre-selezione Performance
4. **Esecuzione Selettiva** → Pulizia Diretta con solo CLEANUP abilitata
5. **Esecuzione Completa** → Pulizia Diretta con "Esegui Tutto"
6. **Log Skip** → Verifica "SALTATA (non selezionata)" appare nel log

---

## 📊 METRICHE ATTESE

Dopo implementazione completa v4.2:

| Metrica | Valore |
|---------|--------|
| Operazioni totali | 29 |
| CLEANUP | 17 (include op28 iOS) |
| PERFORMANCE | 5 |
| ANALYSIS | 5 |
| UTILITY | 1 |
| MB tracciati | ~99% operazioni |
| Selezione granulare | 3 categorie |

---

## 🚀 PROSSIMI STEP

1. Applicare pattern a 28 operazioni rimanenti (segui checklist)
2. Testare Dry Run
3. Testare selezione categorie
4. Aggiornare CLAUDE.md → v4.2
5. Aggiornare WEB-INTERFACE-README.md
6. Creare changelog dettagliato

---

**Data creazione**: 2025-12-31
**Versione target**: 4.2
**Autore**: Claude Code Assistant
