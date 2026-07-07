#!/bin/bash
# CleanMac.command — versione 5.0 (Synthesis Edition)
# Salvataggio automatico nella cartella dello script
# Changelog v5.0 (2026-07-07) — SINTESI CleanMac + MyPureMac:
#   - op32 Boot Optimization: rileva LaunchAgents/LaunchDaemons problematici e orfani (da MyPureMac)
#   - op33 Orphaned Files: file residui in ~/Library da app disinstallate (da MyPureMac)
#   - op26 Homebrew: rileva HOMEBREW_CACHE personalizzato via `brew --cache` (da MyPureMac)
#   - op02 Cache utente: discovery dinamica di ~/Library/Caches (da MyPureMac) oltre ai path noti
#   - Uninstaller euristico multi-livello nel server web (porting AppPathFinder)
#   - Totale operazioni: 33
# Changelog v4.2 (2025-12-31):
#   - Aggiunta selezione interattiva operazioni post-DryRun
#   - Categorizzazione operazioni (Pulizia, Performance, Analisi)
#   - Indicazione spazio recuperabile per ogni categoria
#   - Pre-selezione automatica operazioni performance
# Changelog v4.1 (2025-12-31):
#   - Aggiunta pulizia Time Machine snapshot locali
#   - Aggiunta analisi/pulizia backup iOS/iPad
#   - Aggiunta analisi file Swap e Sleepimage
#   - Estesa pulizia Xcode (Archives + CoreSimulator)
# Changelog v4.0:
#   - Fix calcolo spazio in subshell
#   - Fix SPACE_FREED_MB nel report HTML
#   - Fix comando stat per app non utilizzate
#   - Aggiunta pulizia cache: Firefox, Spotify, Teams, Zoom, Telegram, Notion, WhatsApp
#   - Aggiunta notifiche Notification Center
#   - Aggiunta pulizia cache npm/yarn/pip/pnpm
#   - Aggiunta pulizia Docker (prune)
#   - Aggiunta pulizia Homebrew

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
REPORTS_DIR="$SCRIPT_DIR/reports"
mkdir -p "$REPORTS_DIR"
LOGFILE="$REPORTS_DIR/cleanmac_${TIMESTAMP}.log"
DRY_RUN_REPORT="$REPORTS_DIR/dryrun_report_${TIMESTAMP}.txt"
REPORT_HTML="$REPORTS_DIR/cleanmac_report_${TIMESTAMP}.html"
BACKUP_DIR="$REPORTS_DIR/config_backup_${TIMESTAMP}"

# Flag per dry run
DRY_RUN=true
PROCEED_WITH_CLEANUP=false
SELECTIVE_MODE=false
SELECTED_OPS=""

# Variabili per tracking (FIX: uso file temporaneo invece di subshell)
SPACE_TEMP_FILE=$(mktemp)
CATEGORY_TEMP_FILE=$(mktemp)
# OPERATIONS_DATA_FILE: usa path da env var (server web) per consentire lettura post-esecuzione
if [ -n "$CLEANMAC_OPS_FILE" ]; then
    OPERATIONS_DATA_FILE="$CLEANMAC_OPS_FILE"
else
    OPERATIONS_DATA_FILE=$(mktemp)
fi
echo "0" > "$SPACE_TEMP_FILE"
echo "" > "$CATEGORY_TEMP_FILE"
echo "" > "$OPERATIONS_DATA_FILE"
SPACE_FREED_MB=0
OPERATIONS_LOG=""

# Array per tracking MB per operazione (formato: "op_id:mb_value:category:description")
# Categorie: CLEANUP, PERFORMANCE, ANALYSIS, UTILITY

# Variabili per selezione categorie
ENABLE_CLEANUP=0
ENABLE_PERFORMANCE=0
ENABLE_ANALYSIS=0

# Mappatura statica operazioni → categorie (NEW v4.2-lite)
# Questo evita di modificare tutte le 29 operazioni manualmente
init_operations_map() {
    # FIX v4.3: formato unificato op_id:0:CATEGORIA:descrizione
    # (field 3 = CATEGORIA, compatibile con register_operation() e is_operation_enabled())

    # CLEANUP (liberano spazio)
    echo "op02:0:CLEANUP:Cache utente" >> "$OPERATIONS_DATA_FILE"
    echo "op03:0:CLEANUP:Cache sistema" >> "$OPERATIONS_DATA_FILE"
    echo "op04:0:CLEANUP:Log files" >> "$OPERATIONS_DATA_FILE"
    echo "op05:0:CLEANUP:Safari cache" >> "$OPERATIONS_DATA_FILE"
    echo "op06:0:CLEANUP:Xcode" >> "$OPERATIONS_DATA_FILE"
    echo "op07:0:CLEANUP:.DS_Store" >> "$OPERATIONS_DATA_FILE"
    echo "op08:0:CLEANUP:Temp folders" >> "$OPERATIONS_DATA_FILE"
    echo "op09:0:CLEANUP:Trash" >> "$OPERATIONS_DATA_FILE"
    echo "op11:0:CLEANUP:Junk files" >> "$OPERATIONS_DATA_FILE"
    echo "op12:0:CLEANUP:App cache" >> "$OPERATIONS_DATA_FILE"
    echo "op13:0:CLEANUP:Old logs" >> "$OPERATIONS_DATA_FILE"
    echo "op14:0:CLEANUP:Old downloads" >> "$OPERATIONS_DATA_FILE"
    echo "op23:0:CLEANUP:Font cache" >> "$OPERATIONS_DATA_FILE"
    echo "op24:0:CLEANUP:Dev tools cache" >> "$OPERATIONS_DATA_FILE"
    echo "op25:0:CLEANUP:Docker" >> "$OPERATIONS_DATA_FILE"
    echo "op26:0:CLEANUP:Homebrew" >> "$OPERATIONS_DATA_FILE"
    echo "op27:0:CLEANUP:Time Machine" >> "$OPERATIONS_DATA_FILE"
    echo "op28:0:CLEANUP:iOS backups" >> "$OPERATIONS_DATA_FILE"
    echo "op30:0:CLEANUP:Mail attachments" >> "$OPERATIONS_DATA_FILE"

    # PERFORMANCE (velocità)
    echo "op18:0:PERFORMANCE:RAM optimize" >> "$OPERATIONS_DATA_FILE"
    echo "op19:0:PERFORMANCE:LaunchServices" >> "$OPERATIONS_DATA_FILE"
    echo "op20:0:PERFORMANCE:Permissions" >> "$OPERATIONS_DATA_FILE"
    echo "op21:0:PERFORMANCE:DNS flush" >> "$OPERATIONS_DATA_FILE"
    echo "op22:0:PERFORMANCE:Spotlight" >> "$OPERATIONS_DATA_FILE"
    echo "op32:0:PERFORMANCE:Boot optimization" >> "$OPERATIONS_DATA_FILE"

    # ANALYSIS (solo report)
    echo "op01:0:ANALYSIS:Disk analysis" >> "$OPERATIONS_DATA_FILE"
    echo "op10:0:ANALYSIS:Large files" >> "$OPERATIONS_DATA_FILE"
    echo "op15:0:ANALYSIS:Unused apps" >> "$OPERATIONS_DATA_FILE"
    echo "op17:0:ANALYSIS:Duplicates" >> "$OPERATIONS_DATA_FILE"
    echo "op29:0:ANALYSIS:Swap analysis" >> "$OPERATIONS_DATA_FILE"
    echo "op31:0:ANALYSIS:APFS Purgeable Space" >> "$OPERATIONS_DATA_FILE"
    echo "op33:0:ANALYSIS:Orphaned files" >> "$OPERATIONS_DATA_FILE"

    # UTILITY (sempre ON)
    echo "op16:0:UTILITY:Config backup" >> "$OPERATIONS_DATA_FILE"
}

# Funzione helper per determinare categoria da op_id
# FIX v4.3: legge field 3 (formato unificato op_id:mb:CATEGORIA:desc)
get_operation_category() {
    local op_id="$1"
    local category=$(grep "^${op_id}:" "$OPERATIONS_DATA_FILE" 2>/dev/null | head -1 | cut -d: -f3)
    echo "${category:-CLEANUP}"  # Default: CLEANUP
}

log() {
    echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOGFILE"
}

# Rimossa funzione confirm - tutte le operazioni eseguite automaticamente

add_to_report() {
    OPERATIONS_LOG="$OPERATIONS_LOG<li>$1</li>"
}

# FIX: Funzione migliorata per calcolo spazio (compatibile bash 3.x)
calculate_freed() {
    local bytes=$1
    local category=$2
    local current=$(cat "$SPACE_TEMP_FILE")
    local mb=$(( bytes / 1048576 ))
    echo $(( current + mb )) > "$SPACE_TEMP_FILE"
    if [ -n "$category" ]; then
        # FIX: Uso file per categorie invece di array associativo (bash 3.x compat)
        local cat_key=$(echo "$category" | tr ' ' '_')
        local existing=$(grep "^${cat_key}:" "$CATEGORY_TEMP_FILE" 2>/dev/null | cut -d: -f2)
        existing=${existing:-0}
        local new_val=$(( existing + mb ))
        # Rimuovi vecchia entry e aggiungi nuova
        grep -v "^${cat_key}:" "$CATEGORY_TEMP_FILE" > "${CATEGORY_TEMP_FILE}.tmp" 2>/dev/null || true
        mv "${CATEGORY_TEMP_FILE}.tmp" "$CATEGORY_TEMP_FILE"
        echo "${cat_key}:${new_val}" >> "$CATEGORY_TEMP_FILE"
    fi
}

# FIX: Funzione per calcolare dimensione senza subshell
get_dir_size_bytes() {
    local path="$1"
    if [ -e "$path" ]; then
        du -sk "$path" 2>/dev/null | awk '{print $1 * 1024}'
    else
        echo "0"
    fi
}

get_dir_size_mb() {
    local path="$1"
    if [ -e "$path" ]; then
        du -sm "$path" 2>/dev/null | awk '{print $1}'
    else
        echo "0"
    fi
}

# SICUREZZA v4.3: wrapper rm -rf con protezione symlink (da MyPureMac)
# Blocca eliminazioni se il path è un symlink che punta fuori dalle aree sicure
safe_remove() {
    local target="$1"
    [ -z "$target" ] && return 1
    # Espandi ~ se necessario
    target="${target/#\~/$HOME}"
    if [ -L "$target" ]; then
        local real
        real=$(readlink -f "$target" 2>/dev/null) || real=""
        if [ -n "$real" ]; then
            case "$real" in
                "$HOME"*|/Library*|/private/var/tmp*|/private/var/log*|/tmp*)
                    rm -rf "$target" 2>/dev/null ;;
                *)
                    log "⚠️  SICUREZZA: Symlink ignorato: $target → $real (punta fuori dalle aree sicure)"
                    return 1 ;;
            esac
        else
            rm -rf "$target" 2>/dev/null
        fi
    else
        rm -rf "$target" 2>/dev/null
    fi
}

append_dryrun() {
    echo "$1" >> "$DRY_RUN_REPORT"
}

# Notifica Notification Center
send_notification() {
    local title="$1"
    local message="$2"
    osascript -e "display notification \"$message\" with title \"$title\" sound name \"Glass\"" 2>/dev/null
}

# Funzione per registrare dati operazione (NEW v4.2)
register_operation() {
    local op_id="$1"
    local mb_value="$2"
    local category="$3"  # CLEANUP, PERFORMANCE, ANALYSIS, UTILITY
    local description="$4"

    echo "${op_id}:${mb_value}:${category}:${description}" >> "$OPERATIONS_DATA_FILE"
}

# Funzione per verificare se operazione è abilitata (NEW v4.2)
is_operation_enabled() {
    local op_id="$1"

    # Se non siamo in modalità selettiva, tutte le operazioni sono abilitate
    if [ "$SELECTIVE_MODE" = false ]; then
        return 0
    fi

    # Se sono specificate singole ops, controlla direttamente
    if [ -n "$SELECTED_OPS" ]; then
        case ",$SELECTED_OPS," in
            *",${op_id},"*) return 0 ;;
            *) return 1 ;;
        esac
    fi

    # Leggi categoria operazione
    local op_data=$(grep "^${op_id}:" "$OPERATIONS_DATA_FILE" 2>/dev/null)
    if [ -z "$op_data" ]; then
        return 0  # Default: abilita se non trovata
    fi

    local category=$(echo "$op_data" | cut -d: -f3)

    # Controlla se categoria è abilitata
    case "$category" in
        CLEANUP)
            [ "$ENABLE_CLEANUP" = "1" ] && return 0 || return 1
            ;;
        PERFORMANCE)
            [ "$ENABLE_PERFORMANCE" = "1" ] && return 0 || return 1
            ;;
        ANALYSIS)
            [ "$ENABLE_ANALYSIS" = "1" ] && return 0 || return 1
            ;;
        UTILITY)
            return 0  # Utility sempre abilitate
            ;;
        *)
            return 0  # Default: abilita
            ;;
    esac
}

log "═══════════════════════════════════════════════════════════"
log "CleanMac v5.0 (Synthesis Edition) — Avvio"
log "═══════════════════════════════════════════════════════════"

# Inizializzo mappatura operazioni (NEW v4.2)
init_operations_map
log "Mappatura operazioni inizializzata: 33 operazioni (v5.0)"

# Supporto parametri CLI (NEW v4.2 - Web Interface)
# Uso: ./CleanMac.command --dry-run --categories="CLEANUP,PERFORMANCE"
CLI_MODE=false
for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            CLI_MODE=true
            ;;
        --no-dry-run|--cleanup)
            DRY_RUN=false
            CLI_MODE=true
            ;;
        --categories=*)
            CATEGORIES="${arg#*=}"
            SELECTIVE_MODE=true
            CLI_MODE=true
            # Parse categorie
            if echo "$CATEGORIES" | grep -q "CLEANUP"; then
                ENABLE_CLEANUP=1
            fi
            if echo "$CATEGORIES" | grep -q "PERFORMANCE"; then
                ENABLE_PERFORMANCE=1
            fi
            if echo "$CATEGORIES" | grep -q "ANALYSIS"; then
                ENABLE_ANALYSIS=1
            fi
            log "Categorie abilitate via CLI: $CATEGORIES"
            ;;
        --ops=*)
            SELECTED_OPS="${arg#*=}"
            SELECTIVE_MODE=true
            CLI_MODE=true
            log "Operazioni singole abilitate via CLI: $SELECTED_OPS"
            ;;
        --all)
            SELECTIVE_MODE=false
            CLI_MODE=true
            ;;
    esac
done

# Se non modalità CLI, chiedi tramite dialog
if [ "$CLI_MODE" = false ]; then
    # Chiedi se vuoi eseguire dry run
    DRY_RUN_CHOICE=$(osascript <<EOF
        set dialogText to "Eseguire DRY RUN? (analizza spazio senza eliminare)"
        display dialog dialogText buttons {"Dry Run", "Pulizia Diretta"} default button "Dry Run"
        return button returned of result
EOF
    )

    if [ "$DRY_RUN_CHOICE" = "Pulizia Diretta" ]; then
        DRY_RUN=false
        log "Modalità: PULIZIA DIRETTA (senza dry run)"
    else
        log "Modalità: DRY RUN (analisi senza eliminazione)"
    fi
else
    if [ "$DRY_RUN" = true ]; then
        log "Modalità CLI: DRY RUN"
    else
        log "Modalità CLI: PULIZIA DIRETTA"
    fi
fi

# Inizializza report dry run
echo "═══════════════════════════════════════════════════════════" > "$DRY_RUN_REPORT"
echo "CLEANMAC v5.0 — DRY RUN REPORT" >> "$DRY_RUN_REPORT"
echo "Data: $(date)" >> "$DRY_RUN_REPORT"
echo "═══════════════════════════════════════════════════════════" >> "$DRY_RUN_REPORT"
echo "" >> "$DRY_RUN_REPORT"

#############################################
# 1. ANALISI SPAZIO DISCO PER CARTELLA
#############################################
log "Analisi spazio disco..."
{

    ANALYSIS_FILE="$REPORTS_DIR/disk_analysis_${TIMESTAMP}.txt"

    if [ "$DRY_RUN" = true ]; then
        register_operation "op01" "0" "ANALYSIS" "Disk analysis (Desktop/Downloads/Documents)"

        echo "═══════════════════════════════════════════" > "$ANALYSIS_FILE"
        echo "ANALISI SPAZIO DISCO" >> "$ANALYSIS_FILE"
        echo "$(date)" >> "$ANALYSIS_FILE"
        echo "═══════════════════════════════════════════" >> "$ANALYSIS_FILE"
        echo "" >> "$ANALYSIS_FILE"

        echo "" >> "$DRY_RUN_REPORT"
        echo "📁 ANALISI DISCO" >> "$DRY_RUN_REPORT"
        echo "────────────────────────────────────────" >> "$DRY_RUN_REPORT"

        for DIR in ~/Desktop ~/Downloads ~/Documents; do
            if [ -d "$DIR" ]; then
                SIZE=$(du -sh "$DIR" 2>/dev/null | cut -f1)
                echo "📁 $DIR: $SIZE" >> "$ANALYSIS_FILE"
                echo "📁 $DIR: $SIZE" >> "$DRY_RUN_REPORT"
                log "📁 $DIR: $SIZE"
            fi
        done

        echo "" >> "$ANALYSIS_FILE"
        echo "SPAZIO DISCO TOTALE:" >> "$ANALYSIS_FILE"
        df -h / >> "$ANALYSIS_FILE"

        echo "" >> "$DRY_RUN_REPORT"
        echo "Spazio disco totale:" >> "$DRY_RUN_REPORT"
        df -h / >> "$DRY_RUN_REPORT"
    else
        if is_operation_enabled "op01"; then
            echo "═══════════════════════════════════════════" > "$ANALYSIS_FILE"
            echo "ANALISI SPAZIO DISCO" >> "$ANALYSIS_FILE"
            echo "$(date)" >> "$ANALYSIS_FILE"
            echo "═══════════════════════════════════════════" >> "$ANALYSIS_FILE"
            echo "" >> "$ANALYSIS_FILE"

            for DIR in ~/Desktop ~/Downloads ~/Documents; do
                if [ -d "$DIR" ]; then
                    SIZE=$(du -sh "$DIR" 2>/dev/null | cut -f1)
                    echo "📁 $DIR: $SIZE" >> "$ANALYSIS_FILE"
                    log "📁 $DIR: $SIZE"
                fi
            done

            echo "" >> "$ANALYSIS_FILE"
            echo "SPAZIO DISCO TOTALE:" >> "$ANALYSIS_FILE"
            df -h / >> "$ANALYSIS_FILE"

            add_to_report "✅ Analisi spazio disco completata → $ANALYSIS_FILE"
        else
            log "Analisi spazio disco: SALTATA (non selezionata)"
            add_to_report "⏭️  Analisi spazio disco saltata (non selezionata)"
        fi
    fi

    log "Analisi salvata in $ANALYSIS_FILE"
}

#############################################
# 2. PULIZIA CACHE UTENTE
#############################################
log "Analisi cache utente..."
{

    CACHE_MB=$(get_dir_size_mb ~/Library/Caches)
    CACHE_BYTES=$(( CACHE_MB * 1048576 ))

    if [ "$DRY_RUN" = true ]; then
        # Registra operazione (NEW v4.2)
        register_operation "op02" "$CACHE_MB" "CLEANUP" "Cache utente (~/ Library/Caches)"

        append_dryrun ""
        append_dryrun "🗑️  CACHE UTENTE (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "Spazio che sarebbe liberato: $CACHE_MB MB"
        append_dryrun "Percorso: ~/Library/Caches/*"
        # v5.0 (da MyPureMac): discovery dinamica — mostra le 10 cache più grandi
        append_dryrun "Cache più grandi rilevate (discovery dinamica):"
        du -sm ~/Library/Caches/*/ 2>/dev/null | sort -rn | head -10 | while read -r _sz _path; do
            append_dryrun "    • $(basename "$_path"): ${_sz} MB"
        done
        calculate_freed "$CACHE_BYTES" "Cache Utente"
    else
        # Verifica se operazione è abilitata (NEW v4.2)
        if is_operation_enabled "op02"; then
            for _cache_dir in ~/Library/Caches/*/; do
                safe_remove "$_cache_dir"
            done
            calculate_freed "$CACHE_BYTES" "Cache Utente"
            add_to_report "✅ Cache utente pulita ($CACHE_MB MB)"
        else
            log "Cache utente: SALTATA (non selezionata)"
            add_to_report "⏭️  Cache utente saltata (non selezionata)"
        fi
    fi

    log "Cache utente analizzata: $CACHE_MB MB"
}

#############################################
# 3. PULIZIA CACHE SISTEMA
#############################################
log "Analisi cache sistema..."
{

    SYSCACHE_MB=$(get_dir_size_mb /Library/Caches)
    SYSCACHE_BYTES=$(( SYSCACHE_MB * 1048576 ))

    if [ "$DRY_RUN" = true ]; then
        register_operation "op03" "$SYSCACHE_MB" "CLEANUP" "Cache sistema (/Library/Caches)"

        append_dryrun ""
        append_dryrun "🗑️  CACHE SISTEMA (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "Spazio che sarebbe liberato: $SYSCACHE_MB MB"
        append_dryrun "Percorso: /Library/Caches/*"
        calculate_freed "$SYSCACHE_BYTES" "Cache Sistema"
    else
        if is_operation_enabled "op03"; then
            sudo rm -rf /Library/Caches/* 2>/dev/null
            calculate_freed "$SYSCACHE_BYTES" "Cache Sistema"
            add_to_report "✅ Cache sistema pulita ($SYSCACHE_MB MB)"
        else
            log "Cache sistema: SALTATA (non selezionata)"
            add_to_report "⏭️  Cache sistema saltata (non selezionata)"
        fi
    fi

    log "Cache sistema analizzata: $SYSCACHE_MB MB"
}

#############################################
# 4. PULIZIA LOG
#############################################
log "Analisi file di log..."
{

    LOG_COUNT=$(find ~/Library/Logs -type f 2>/dev/null | wc -l | tr -d ' ')
    LOG_MB=$(get_dir_size_mb ~/Library/Logs)
    LOG_BYTES=$(( LOG_MB * 1048576 ))

    if [ "$DRY_RUN" = true ]; then
        register_operation "op04" "$LOG_MB" "CLEANUP" "File di log (system + user)"

        append_dryrun ""
        append_dryrun "📝 FILE DI LOG (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "File da eliminare: $LOG_COUNT"
        append_dryrun "Spazio che sarebbe liberato: $LOG_MB MB"
        append_dryrun "Percorsi: ~/Library/Logs/*, /private/var/log/*"
        calculate_freed "$LOG_BYTES" "File Log"
    else
        if is_operation_enabled "op04"; then
            sudo rm -rf /private/var/log/* 2>/dev/null
            rm -rf ~/Library/Logs/* 2>/dev/null
            calculate_freed "$LOG_BYTES" "File Log"
            add_to_report "✅ File di log rimossi ($LOG_COUNT file)"
        else
            log "File di log: SALTATI (non selezionati)"
            add_to_report "⏭️  File di log saltati (non selezionati)"
        fi
    fi

    log "File di log analizzati: $LOG_COUNT file — $LOG_MB MB"
}

#############################################
# 5. PULIZIA CACHE SAFARI
#############################################
log "Analisi Safari..."
{

    SAFARI_MB=0
    [ -f ~/Library/Safari/History.db ] && SAFARI_MB=$(( SAFARI_MB + $(get_dir_size_mb ~/Library/Safari/History.db) ))
    [ -f ~/Library/Cookies/Cookies.binarycookies ] && SAFARI_MB=$(( SAFARI_MB + $(get_dir_size_mb ~/Library/Cookies/Cookies.binarycookies) ))
    SAFARI_BYTES=$(( SAFARI_MB * 1048576 ))

    if [ "$DRY_RUN" = true ]; then
        register_operation "op05" "$SAFARI_MB" "CLEANUP" "Cache Safari (cronologia, cookie, session)"

        append_dryrun ""
        append_dryrun "🧭 SAFARI CACHE (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "Spazio che sarebbe liberato: $SAFARI_MB MB"
        append_dryrun "Elementi: Cronologia, Cookie, Session"
        calculate_freed "$SAFARI_BYTES" "Safari Cache"
    else
        if is_operation_enabled "op05"; then
            rm -rf ~/Library/Safari/History.db* 2>/dev/null
            rm -rf ~/Library/Safari/TopSites.plist 2>/dev/null
            rm -rf ~/Library/Cookies/Cookies.binarycookies 2>/dev/null
            rm -rf ~/Library/Safari/LastSession.plist 2>/dev/null
            calculate_freed "$SAFARI_BYTES" "Safari Cache"
            add_to_report "✅ Cache Safari pulita ($SAFARI_MB MB)"
        else
            log "Safari cache: SALTATA (non selezionata)"
            add_to_report "⏭️  Safari cache saltata (non selezionata)"
        fi
    fi

    log "Safari analizzato: $SAFARI_MB MB"
}

#############################################
# 6. PULIZIA RESIDUI XCODE (ESTESA v4.1)
#############################################
log "Analisi Xcode..."
{

    DERIVED_MB=$(get_dir_size_mb ~/Library/Developer/Xcode/DerivedData)
    ARCHIVES_MB=$(get_dir_size_mb ~/Library/Developer/Xcode/Archives)
    SIMULATOR_MB=$(get_dir_size_mb ~/Library/Developer/CoreSimulator)

    XCODE_MB=$(( DERIVED_MB + ARCHIVES_MB + SIMULATOR_MB ))
    XCODE_BYTES=$(( XCODE_MB * 1048576 ))

    if [ "$DRY_RUN" = true ]; then
        register_operation "op06" "$XCODE_MB" "CLEANUP" "Xcode (DerivedData + Archives + Simulator)"

        append_dryrun ""
        append_dryrun "⚙️  XCODE (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "DerivedData: $DERIVED_MB MB"
        append_dryrun "Archives: $ARCHIVES_MB MB"
        append_dryrun "CoreSimulator: $SIMULATOR_MB MB"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "Spazio totale liberabile: $XCODE_MB MB"
        calculate_freed "$XCODE_BYTES" "Xcode"
    else
        if is_operation_enabled "op06"; then
            safe_remove ~/Library/Developer/Xcode/DerivedData
            safe_remove ~/Library/Developer/Xcode/Archives
            safe_remove ~/Library/Developer/CoreSimulator
            calculate_freed "$XCODE_BYTES" "Xcode"
            add_to_report "✅ Xcode pulito: DerivedData, Archives, CoreSimulator ($XCODE_MB MB)"
        else
            log "Xcode: SALTATO (non selezionato)"
            add_to_report "⏭️  Xcode saltato (non selezionato)"
        fi
    fi

    log "Xcode analizzato: $XCODE_MB MB (DerivedData: $DERIVED_MB, Archives: $ARCHIVES_MB, Simulator: $SIMULATOR_MB)"
}

#############################################
# 7. ELIMINAZIONE FILE .DS_Store
#############################################
log "Analisi .DS_Store..."
{

    DS_COUNT=$(find ~ -name ".DS_Store" 2>/dev/null | wc -l | tr -d ' ')
    # .DS_Store sono piccoli (~8KB ciascuno)
    DS_MB=$(( DS_COUNT * 8 / 1024 ))
    DS_BYTES=$(( DS_COUNT * 8192 ))

    if [ "$DRY_RUN" = true ]; then
        register_operation "op07" "$DS_MB" "CLEANUP" "File .DS_Store"

        append_dryrun ""
        append_dryrun "📦 FILE .DS_STORE (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "File da eliminare: $DS_COUNT"
        append_dryrun "Spazio che sarebbe liberato: ~$DS_MB MB"
        calculate_freed "$DS_BYTES" ".DS_Store"
    else
        if is_operation_enabled "op07"; then
            find ~ -name ".DS_Store" -delete 2>/dev/null
            calculate_freed "$DS_BYTES" ".DS_Store"
            add_to_report "✅ File .DS_Store rimossi ($DS_COUNT file)"
        else
            log ".DS_Store: SALTATI (non selezionati)"
            add_to_report "⏭️  File .DS_Store saltati (non selezionati)"
        fi
    fi

    log ".DS_Store analizzati: $DS_COUNT file"
}

#############################################
# 8. PULIZIA CARTELLE TEMPORANEE
#############################################
log "Analisi cartelle temporanee..."
{

    TMP_MB=$(get_dir_size_mb /private/var/tmp)
    TMP_BYTES=$(( TMP_MB * 1048576 ))
    TMP_COUNT=$(find /private/var/tmp -type f 2>/dev/null | wc -l | tr -d ' ')

    if [ "$DRY_RUN" = true ]; then
        register_operation "op08" "$TMP_MB" "CLEANUP" "Temp folders"
        append_dryrun ""
        append_dryrun "🌡️  CARTELLE TEMPORANEE (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "File da eliminare: $TMP_COUNT"
        append_dryrun "Spazio che sarebbe liberato: $TMP_MB MB"
        append_dryrun "Percorso: /private/var/tmp/*"
        calculate_freed "$TMP_BYTES" "Temporanei"
    else
        if is_operation_enabled "op08"; then
            sudo rm -rf /private/var/tmp/* 2>/dev/null
            calculate_freed "$TMP_BYTES" "Temporanei"
            add_to_report "✅ Cartelle temporanee ripulite ($TMP_MB MB)"
        else
            log "Cartelle temporanee: SALTATE (non selezionate)"
            add_to_report "⏭️  Cartelle temporanee saltate (non selezionate)"
        fi
    fi

    log "Cartelle temporanee analizzate: $TMP_MB MB"
}

#############################################
# 9. PULIZIA TRASH
#############################################
log "Analisi Trash..."
{

    TRASH_MB=$(get_dir_size_mb ~/.Trash)
    TRASH_BYTES=$(( TRASH_MB * 1048576 ))
    TRASH_COUNT=$(find ~/.Trash -type f 2>/dev/null | wc -l | tr -d ' ')

    if [ "$DRY_RUN" = true ]; then
        register_operation "op09" "$TRASH_MB" "CLEANUP" "Trash"
        append_dryrun ""
        append_dryrun "🗑️  CESTINO (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "File nel cestino: $TRASH_COUNT"
        append_dryrun "Spazio che sarebbe liberato: $TRASH_MB MB"
        append_dryrun "Percorso: ~/.Trash/*"
        calculate_freed "$TRASH_BYTES" "Trash"
    else
        if is_operation_enabled "op09"; then
            for _trash_item in ~/.Trash/*; do
                safe_remove "$_trash_item"
            done
            calculate_freed "$TRASH_BYTES" "Trash"
            add_to_report "✅ Cestino svuotato ($TRASH_MB MB)"
        else
            log "Cestino: SALTATO (non selezionato)"
            add_to_report "⏭️  Cestino saltato (non selezionato)"
        fi
    fi

    log "Cestino analizzato: $TRASH_MB MB"
}

#############################################
# 10. ANALISI FILE GRANDI (>500MB)
#############################################
log "Scansione file grandi..."
{

    BIG_FILES="$REPORTS_DIR/large_files_${TIMESTAMP}.txt"

    if [ "$DRY_RUN" = true ]; then
        register_operation "op10" "0" "ANALYSIS" "Large files >500MB"

        echo "═══════════════════════════════════════════" > "$BIG_FILES"
        echo "FILE GRANDI (>500 MB)"  >> "$BIG_FILES"
        echo "$(date)" >> "$BIG_FILES"
        echo "═══════════════════════════════════════════" >> "$BIG_FILES"
        echo "" >> "$BIG_FILES"

        BIG_COUNT=0
        while IFS= read -r file; do
            if [ -n "$file" ]; then
                SIZE=$(du -sh "$file" 2>/dev/null | cut -f1)
                echo "📦 $file — $SIZE" >> "$BIG_FILES"
                BIG_COUNT=$(( BIG_COUNT + 1 ))
            fi
        done < <(find ~ -type f -size +500M 2>/dev/null)

        append_dryrun ""
        append_dryrun "📊 FILE GRANDI >500MB (ANALISI - NON ELIMINABILI)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "File trovati: $BIG_COUNT"
        append_dryrun "Dettagli completi in: $BIG_FILES"
        append_dryrun "⚠️  Questi file NON saranno eliminati automaticamente"
        append_dryrun "    (richiedono valutazione manuale)"
    else
        if is_operation_enabled "op10"; then
            echo "═══════════════════════════════════════════" > "$BIG_FILES"
            echo "FILE GRANDI (>500 MB)"  >> "$BIG_FILES"
            echo "$(date)" >> "$BIG_FILES"
            echo "═══════════════════════════════════════════" >> "$BIG_FILES"
            echo "" >> "$BIG_FILES"

            BIG_COUNT=0
            while IFS= read -r file; do
                if [ -n "$file" ]; then
                    SIZE=$(du -sh "$file" 2>/dev/null | cut -f1)
                    echo "📦 $file — $SIZE" >> "$BIG_FILES"
                    BIG_COUNT=$(( BIG_COUNT + 1 ))
                fi
            done < <(find ~ -type f -size +500M 2>/dev/null)

            add_to_report "✅ File grandi analizzati ($BIG_COUNT file) → $BIG_FILES"
        else
            log "Scansione file grandi: SALTATA (non selezionata)"
            add_to_report "⏭️  Scansione file grandi saltata (non selezionata)"
        fi
    fi

    log "Scansione file grandi completata → $BIG_FILES"
}

#############################################
# 11. RIMOZIONE FILE .LOCALIZED E SYSTEM JUNK
#############################################
log "Analisi file .localized e system junk..."
{

    LOCALIZED_COUNT=$(find ~ -name ".localized" 2>/dev/null | wc -l | tr -d ' ')
    TEMP_COUNT=$(find ~ \( -name "*.tmp" -o -name "*.temp" \) 2>/dev/null | wc -l | tr -d ' ')
    LOCK_COUNT=$(find ~ -name ".lock" -mtime +7 2>/dev/null | wc -l | tr -d ' ')
    EMPTY_COUNT=$(find ~ -type d -empty 2>/dev/null | wc -l | tr -d ' ')

    JUNK_COUNT=$(( LOCALIZED_COUNT + TEMP_COUNT + LOCK_COUNT ))
    JUNK_MB=$(( JUNK_COUNT / 100 ))  # Stima conservativa
    JUNK_BYTES=$(( JUNK_MB * 1048576 ))

    if [ "$DRY_RUN" = true ]; then
        register_operation "op11" "$JUNK_MB" "CLEANUP" "Junk files"
        append_dryrun ""
        append_dryrun "🧹 FILE .LOCALIZED E SYSTEM JUNK (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun ".localized file: $LOCALIZED_COUNT"
        append_dryrun ".tmp/.temp file: $TEMP_COUNT"
        append_dryrun ".lock file (>7gg): $LOCK_COUNT"
        append_dryrun "Cartelle vuote: $EMPTY_COUNT"
        append_dryrun "Spazio stimato liberato: ~$JUNK_MB MB"
        calculate_freed "$JUNK_BYTES" "System Junk"
    else
        if is_operation_enabled "op11"; then
            find ~ -name ".localized" -delete 2>/dev/null
            find ~ -name "*.tmp" -delete 2>/dev/null
            find ~ -name "*.temp" -delete 2>/dev/null
            find ~ -name ".lock" -mtime +7 -delete 2>/dev/null
            find ~ -type d -empty -delete 2>/dev/null
            calculate_freed "$JUNK_BYTES" "System Junk"
            add_to_report "✅ File .localized, temporanei e cartelle vuote ripuliti"
        else
            log "File .localized e junk: SALTATI (non selezionati)"
            add_to_report "⏭️  File .localized e junk saltati (non selezionati)"
        fi
    fi

    log "System junk analizzato"
}

#############################################
# 12. PULIZIA CACHE APP (ESTESA v4.0)
#############################################
log "Analisi cache app..."
{

    APP_MB=0

    # Slack
    SLACK_MB=$(get_dir_size_mb ~/Library/Application\ Support/Slack/Cache)
    APP_MB=$(( APP_MB + SLACK_MB ))

    # Discord
    DISCORD_MB=$(get_dir_size_mb ~/Library/Application\ Support/discord/Cache)
    APP_MB=$(( APP_MB + DISCORD_MB ))

    # VSCode
    VSCODE_MB=$(get_dir_size_mb ~/Library/Application\ Support/Code/Cache)
    VSCODE_MB=$(( VSCODE_MB + $(get_dir_size_mb ~/Library/Application\ Support/Code/CachedData) ))
    APP_MB=$(( APP_MB + VSCODE_MB ))

    # Figma
    FIGMA_MB=$(get_dir_size_mb ~/Library/Application\ Support/Figma/Cache)
    APP_MB=$(( APP_MB + FIGMA_MB ))

    # Chrome
    CHROME_MB=$(get_dir_size_mb ~/Library/Application\ Support/Google/Chrome/Default/Cache)
    APP_MB=$(( APP_MB + CHROME_MB ))

    # Firefox (NEW v4.0)
    FIREFOX_MB=$(get_dir_size_mb ~/Library/Caches/Firefox)
    APP_MB=$(( APP_MB + FIREFOX_MB ))

    # Spotify (NEW v4.0)
    SPOTIFY_MB=$(get_dir_size_mb ~/Library/Caches/com.spotify.client)
    APP_MB=$(( APP_MB + SPOTIFY_MB ))

    # Microsoft Teams (NEW v4.0)
    TEAMS_MB=$(get_dir_size_mb ~/Library/Application\ Support/Microsoft/Teams/Cache)
    TEAMS_MB=$(( TEAMS_MB + $(get_dir_size_mb ~/Library/Application\ Support/Microsoft/Teams/Service\ Worker/CacheStorage) ))
    APP_MB=$(( APP_MB + TEAMS_MB ))

    # Zoom (NEW v4.0)
    ZOOM_MB=$(get_dir_size_mb ~/Library/Application\ Support/zoom.us/data)
    APP_MB=$(( APP_MB + ZOOM_MB ))

    # Telegram (NEW v4.0)
    TELEGRAM_MB=0
    for tg_dir in ~/Library/Group\ Containers/*.telegram*/; do
        if [ -d "$tg_dir" ]; then
            TELEGRAM_MB=$(( TELEGRAM_MB + $(get_dir_size_mb "$tg_dir") ))
        fi
    done
    APP_MB=$(( APP_MB + TELEGRAM_MB ))

    # Notion (NEW v4.0)
    NOTION_MB=$(get_dir_size_mb ~/Library/Application\ Support/Notion/Cache)
    APP_MB=$(( APP_MB + NOTION_MB ))

    # WhatsApp (NEW v4.0)
    WHATSAPP_MB=$(get_dir_size_mb ~/Library/Application\ Support/WhatsApp/Cache)
    APP_MB=$(( APP_MB + WHATSAPP_MB ))

    APP_BYTES=$(( APP_MB * 1048576 ))

    if [ "$DRY_RUN" = true ]; then
        register_operation "op12" "$APP_MB" "CLEANUP" "App cache"
        append_dryrun ""
        append_dryrun "📱 CACHE APP (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "Slack cache: $SLACK_MB MB"
        append_dryrun "Discord cache: $DISCORD_MB MB"
        append_dryrun "VSCode cache: $VSCODE_MB MB"
        append_dryrun "Figma cache: $FIGMA_MB MB"
        append_dryrun "Chrome cache: $CHROME_MB MB"
        append_dryrun "Firefox cache: $FIREFOX_MB MB"
        append_dryrun "Spotify cache: $SPOTIFY_MB MB"
        append_dryrun "Teams cache: $TEAMS_MB MB"
        append_dryrun "Zoom cache: $ZOOM_MB MB"
        append_dryrun "Telegram cache: $TELEGRAM_MB MB"
        append_dryrun "Notion cache: $NOTION_MB MB"
        append_dryrun "WhatsApp cache: $WHATSAPP_MB MB"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "Totale spazio liberabile: $APP_MB MB"
        calculate_freed "$APP_BYTES" "App Cache"
    else
        if is_operation_enabled "op12"; then
            safe_remove ~/Library/Application\ Support/Slack/Cache
            safe_remove ~/Library/Application\ Support/discord/Cache
            safe_remove ~/Library/Application\ Support/Code/Cache
            safe_remove ~/Library/Application\ Support/Code/CachedData
            safe_remove ~/Library/Application\ Support/Figma/Cache
            safe_remove ~/Library/Application\ Support/Google/Chrome/Default/Cache
            safe_remove ~/Library/Caches/Firefox
            safe_remove ~/Library/Caches/com.spotify.client
            safe_remove ~/Library/Application\ Support/Microsoft/Teams/Cache
            safe_remove ~/Library/Application\ Support/Microsoft/Teams/Service\ Worker/CacheStorage
            safe_remove ~/Library/Application\ Support/zoom.us/data
            for tg_dir in ~/Library/Group\ Containers/*.telegram*/; do
                safe_remove "$tg_dir/cache"
            done
            safe_remove ~/Library/Application\ Support/Notion/Cache
            safe_remove ~/Library/Application\ Support/WhatsApp/Cache
            calculate_freed "$APP_BYTES" "App Cache"
            add_to_report "✅ Cache app pulite ($APP_MB MB)"
        else
            log "Cache app: SALTATE (non selezionate)"
            add_to_report "⏭️  Cache app saltate (non selezionate)"
        fi
    fi

    log "Cache app analizzate: $APP_MB MB"
}

#############################################
# 13. COMPRESSIONE LOG VECCHI
#############################################
log "Analisi log da comprimere..."
{

    OLD_LOG_COUNT=$(find ~/Library/Logs -type f -mtime +7 -name "*.log" 2>/dev/null | wc -l | tr -d ' ')
    # Stima spazio liberabile: ~30% del totale
    OLD_LOG_MB=0
    while IFS= read -r logfile; do
        if [ -n "$logfile" ]; then
            FILE_MB=$(get_dir_size_mb "$logfile")
            OLD_LOG_MB=$(( OLD_LOG_MB + FILE_MB ))
        fi
    done < <(find ~/Library/Logs -type f -mtime +7 -name "*.log" 2>/dev/null)
    OLD_LOG_SAVINGS=$(( OLD_LOG_MB * 30 / 100 ))

    if [ "$DRY_RUN" = true ]; then
        register_operation "op13" "$OLD_LOG_SAVINGS" "CLEANUP" "Old logs"
        append_dryrun ""
        append_dryrun "📋 LOG VECCHI DA COMPRIMERE (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "File log >7 giorni: $OLD_LOG_COUNT"
        append_dryrun "(Compressione ridurrà dimensioni ~30-50%)"
    else
        if is_operation_enabled "op13"; then
            find ~/Library/Logs -type f -mtime +7 -name "*.log" 2>/dev/null | while read logfile; do
                gzip "$logfile" 2>/dev/null
            done
            add_to_report "✅ Log vecchi compressi ($OLD_LOG_COUNT file)"
        else
            log "Log vecchi: SALTATI (non selezionati)"
            add_to_report "⏭️  Log vecchi saltati (non selezionati)"
        fi
    fi

    log "Log vecchi analizzati: $OLD_LOG_COUNT file"
}

#############################################
# 14. PULIZIA DOWNLOAD VECCHI
#############################################
log "Analisi Download vecchi..."
{

    OLD_DOWNLOADS=$(find ~/Downloads -type f -mtime +30 2>/dev/null | wc -l | tr -d ' ')

    # Calcola dimensione totale
    OLD_DL_MB=0
    while IFS= read -r f; do
        if [ -n "$f" ]; then
            FILE_MB=$(get_dir_size_mb "$f")
            OLD_DL_MB=$(( OLD_DL_MB + FILE_MB ))
        fi
    done < <(find ~/Downloads -type f -mtime +30 2>/dev/null)
    OLD_DL_BYTES=$(( OLD_DL_MB * 1048576 ))

    if [ "$DRY_RUN" = true ]; then
        register_operation "op14" "$OLD_DL_MB" "CLEANUP" "Old downloads"
        append_dryrun ""
        append_dryrun "📥 FILE DOWNLOAD VECCHI >30GG (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "File da eliminare: $OLD_DOWNLOADS"
        append_dryrun "Spazio che sarebbe liberato: $OLD_DL_MB MB"
        calculate_freed "$OLD_DL_BYTES" "Download Vecchi"
    else
        if is_operation_enabled "op14"; then
            if [ "$OLD_DOWNLOADS" -gt 0 ]; then
                find ~/Downloads -type f -mtime +30 -delete 2>/dev/null
                calculate_freed "$OLD_DL_BYTES" "Download Vecchi"
                add_to_report "✅ Download vecchi rimossi ($OLD_DOWNLOADS file, $OLD_DL_MB MB)"
            fi
        else
            log "Download vecchi: SALTATI (non selezionati)"
            add_to_report "⏭️  Download vecchi saltati (non selezionati)"
        fi
    fi

    log "Download vecchi analizzati: $OLD_DOWNLOADS file, $OLD_DL_MB MB"
}

#############################################
# 15. PULIZIA APP NON UTILIZZATE (FIX v4.0 + whitelist v4.3)
#############################################

# Whitelist app di sistema Apple — da NON segnalare mai come "non usate"
# Ispirato da MyPureMac (27 app protette)
APPLE_SYSTEM_APPS=(
    "Safari.app" "Mail.app" "Calendar.app" "Contacts.app" "Notes.app"
    "Reminders.app" "Messages.app" "FaceTime.app" "Photos.app" "Music.app"
    "Podcasts.app" "News.app" "TV.app" "Books.app" "Maps.app"
    "Weather.app" "Clock.app" "Calculator.app" "Dictionary.app" "Finder.app"
    "App Store.app" "System Preferences.app" "System Settings.app" "Terminal.app"
    "Preview.app" "TextEdit.app" "Automator.app" "Script Editor.app"
    "Activity Monitor.app" "Disk Utility.app" "Keychain Access.app"
    "Font Book.app" "Image Capture.app" "Migration Assistant.app"
)

is_system_app() {
    local appname="$1"
    for sys_app in "${APPLE_SYSTEM_APPS[@]}"; do
        [ "$appname" = "$sys_app" ] && return 0
    done
    return 1
}

log "Analisi app non utilizzate..."
{

    APPS_FILE="$REPORTS_DIR/unused_apps_${TIMESTAMP}.txt"

    if [ "$DRY_RUN" = true ]; then
        register_operation "op15" "0" "ANALYSIS" "Unused apps (>30 days)"

        echo "═══════════════════════════════════════════" > "$APPS_FILE"
        echo "APP NON UTILIZZATE (ultimi 30 giorni)"  >> "$APPS_FILE"
        echo "$(date)" >> "$APPS_FILE"
        echo "═══════════════════════════════════════════" >> "$APPS_FILE"
        echo "" >> "$APPS_FILE"

        UNUSED_COUNT=0
        while IFS= read -r app; do
            if [ -n "$app" ]; then
                # v4.3: skip Apple system apps (whitelist da MyPureMac)
                APP_BASENAME=$(basename "$app")
                is_system_app "$APP_BASENAME" && continue
                # FIX: Uso corretto di stat su macOS
                LAST_USED=$(stat -f %a "$app" 2>/dev/null)
                if [ -n "$LAST_USED" ]; then
                    NOW=$(date +%s)
                    DAYS_AGO=$(( (NOW - LAST_USED) / 86400 ))

                    if [ "$DAYS_AGO" -gt 30 ]; then
                        # FIX: Uso corretto di date su macOS
                        LAST_USED_DATE=$(date -r "$LAST_USED" +"%Y-%m-%d" 2>/dev/null)
                        echo "⚠️  $(basename "$app") — Non usata da $DAYS_AGO giorni (ultimo accesso: $LAST_USED_DATE)" >> "$APPS_FILE"
                        UNUSED_COUNT=$(( UNUSED_COUNT + 1 ))
                    fi
                fi
            fi
        done < <(find /Applications -maxdepth 1 -type d -name "*.app" 2>/dev/null)

        echo "" >> "$APPS_FILE"
        echo "Totale app non utilizzate: $UNUSED_COUNT" >> "$APPS_FILE"
    else
        if is_operation_enabled "op15"; then
            echo "═══════════════════════════════════════════" > "$APPS_FILE"
            echo "APP NON UTILIZZATE (ultimi 30 giorni)"  >> "$APPS_FILE"
            echo "$(date)" >> "$APPS_FILE"
            echo "═══════════════════════════════════════════" >> "$APPS_FILE"
            echo "" >> "$APPS_FILE"

            UNUSED_COUNT=0
            while IFS= read -r app; do
                if [ -n "$app" ]; then
                    # v4.3: skip Apple system apps (whitelist da MyPureMac)
                    APP_BASENAME=$(basename "$app")
                    is_system_app "$APP_BASENAME" && continue
                    # FIX: Uso corretto di stat su macOS
                    LAST_USED=$(stat -f %a "$app" 2>/dev/null)
                    if [ -n "$LAST_USED" ]; then
                        NOW=$(date +%s)
                        DAYS_AGO=$(( (NOW - LAST_USED) / 86400 ))

                        if [ "$DAYS_AGO" -gt 30 ]; then
                            # FIX: Uso corretto di date su macOS
                            LAST_USED_DATE=$(date -r "$LAST_USED" +"%Y-%m-%d" 2>/dev/null)
                            echo "⚠️  $(basename "$app") — Non usata da $DAYS_AGO giorni (ultimo accesso: $LAST_USED_DATE)" >> "$APPS_FILE"
                            UNUSED_COUNT=$(( UNUSED_COUNT + 1 ))
                        fi
                    fi
                fi
            done < <(find /Applications -maxdepth 1 -type d -name "*.app" 2>/dev/null)

            echo "" >> "$APPS_FILE"
            echo "Totale app non utilizzate: $UNUSED_COUNT" >> "$APPS_FILE"

            add_to_report "✅ Analisi app non utilizzate ($UNUSED_COUNT app) → $APPS_FILE"
        else
            log "Analisi app non utilizzate: SALTATA (non selezionata)"
            add_to_report "⏭️  Analisi app non utilizzate saltata (non selezionata)"
        fi
    fi

    log "Analisi app completata → $APPS_FILE"
}

#############################################
# 16. BACKUP CONFIGURAZIONI (UTILITY)
#############################################
log "Backup configurazioni..."
{
    if [ "$DRY_RUN" = true ]; then
        register_operation "op16" "0" "UTILITY" "Backup configurazioni"
    else
        mkdir -p "$BACKUP_DIR"

        cp ~/.bashrc "$BACKUP_DIR/" 2>/dev/null
        cp ~/.zshrc "$BACKUP_DIR/" 2>/dev/null
        cp ~/.gitconfig "$BACKUP_DIR/" 2>/dev/null
        cp ~/.ssh/config "$BACKUP_DIR/" 2>/dev/null

        add_to_report "✅ Backup configurazioni salvato in $BACKUP_DIR"
        log "Backup salvato in $BACKUP_DIR"
    fi
}

#############################################
# 17. RIMOZIONE FILE DUPLICATI
#############################################
log "Scansione file duplicati..."
{

    DUPES_FILE="$REPORTS_DIR/duplicates_${TIMESTAMP}.txt"

    if [ "$DRY_RUN" = true ]; then
        register_operation "op17" "0" "ANALYSIS" "Duplicate files scan"

        echo "═══════════════════════════════════════════" > "$DUPES_FILE"
        echo "FILE DUPLICATI TROVATI"  >> "$DUPES_FILE"
        echo "$(date)" >> "$DUPES_FILE"
        echo "═══════════════════════════════════════════" >> "$DUPES_FILE"
        echo "" >> "$DUPES_FILE"

        # FIX v4.3: grouping corretto — mostra tutti i file di ogni gruppo duplicato
        find ~ -type f -not -path '*/\.*' -size +1k 2>/dev/null | head -1000 | while read file; do
            hash=$(md5 -q "$file" 2>/dev/null)
            [ -n "$hash" ] && echo "$hash $file"
        done | sort | awk '
            $1 == prev {
                if (!shown[prev]++) printf "\n--- Duplicati (hash: %s) ---\n  %s\n", prev, prev_file
                print "  " $2
            }
            { prev=$1; prev_file=$2 }
        ' >> "$DUPES_FILE"

        DUPE_COUNT=$(wc -l < "$DUPES_FILE" | tr -d ' ')
    else
        if is_operation_enabled "op17"; then
            echo "═══════════════════════════════════════════" > "$DUPES_FILE"
            echo "FILE DUPLICATI TROVATI"  >> "$DUPES_FILE"
            echo "$(date)" >> "$DUPES_FILE"
            echo "═══════════════════════════════════════════" >> "$DUPES_FILE"
            echo "" >> "$DUPES_FILE"

            # FIX: Versione compatibile macOS (uniq BSD non supporta -w)
            find ~ -type f -not -path '*/\.*' -size +1k 2>/dev/null | head -1000 | while read file; do
                md5 -q "$file" 2>/dev/null | while read hash; do
                    echo "$hash $file"
                done
            done | sort | awk '{if(prev==$1) print $2; prev=$1}' >> "$DUPES_FILE"

            DUPE_COUNT=$(wc -l < "$DUPES_FILE" | tr -d ' ')
            add_to_report "✅ Duplicati trovati: $DUPE_COUNT file → $DUPES_FILE"
        else
            log "Scansione duplicati: SALTATA (non selezionata)"
            add_to_report "⏭️  Scansione duplicati saltata (non selezionata)"
        fi
    fi

    log "Scansione duplicati completata → $DUPES_FILE"
}

#############################################
# 18. OTTIMIZZAZIONE MEMORIA RAM
#############################################
log "Ottimizzazione memoria..."
{

    if [ "$DRY_RUN" = true ]; then
        register_operation "op18" "0" "PERFORMANCE" "RAM optimize (purge)"

        append_dryrun ""
        append_dryrun "💾 OTTIMIZZAZIONE RAM (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "⚡ Operazione PERFORMANCE (non libera spazio)"
        append_dryrun ""
        append_dryrun "Azione: sudo purge"
        append_dryrun "Benefici:"
        append_dryrun "  • Libera memoria inattiva"
        append_dryrun "  • Migliora performance sistema"
        append_dryrun "  • Utile prima di task intensivi"
    else
        if is_operation_enabled "op18"; then
            sudo purge 2>/dev/null
            add_to_report "✅ Memoria ottimizzata (RAM liberata)"
        else
            log "Ottimizzazione RAM: SALTATA (non selezionata)"
            add_to_report "⏭️  Ottimizzazione RAM saltata (non selezionata)"
        fi
    fi

    log "RAM ottimizzata."
}

#############################################
# 19. RICOSTRUZIONE LAUNCHSERVICES
#############################################
log "Ricostruzione LaunchServices..."
{

    if [ "$DRY_RUN" = true ]; then
        register_operation "op19" "0" "PERFORMANCE" "LaunchServices rebuild"

        append_dryrun ""
        append_dryrun "🔧 LAUNCHSERVICES REBUILD (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "⚡ Operazione PERFORMANCE (non libera spazio)"
        append_dryrun ""
        append_dryrun "Azione: lsregister -kill -seed -r"
        append_dryrun "Benefici:"
        append_dryrun "  • Ripara associazioni file"
        append_dryrun "  • Risolve problemi 'Apri con...'"
        append_dryrun "  • Aggiorna database app installate"
    else
        if is_operation_enabled "op19"; then
            /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
              -kill -seed -r /Applications/* 2>/dev/null
            add_to_report "✅ LaunchServices ricostruito"
        else
            log "LaunchServices rebuild: SALTATO (non selezionato)"
            add_to_report "⏭️  LaunchServices rebuild saltato (non selezionato)"
        fi
    fi

    log "LaunchServices ricostruito."
}

#############################################
# 20. RIPARAZIONE PERMESSI UTENTE
#############################################
log "Riparazione permessi..."
{

    if [ "$DRY_RUN" = true ]; then
        register_operation "op20" "0" "PERFORMANCE" "User permissions repair"

        append_dryrun ""
        append_dryrun "🔐 RIPARAZIONE PERMESSI (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "⚡ Operazione PERFORMANCE (non libera spazio)"
        append_dryrun ""
        append_dryrun "Azione: diskutil resetUserPermissions"
        append_dryrun "Benefici:"
        append_dryrun "  • Ripara permessi home directory"
        append_dryrun "  • Risolve errori accesso file"
        append_dryrun "  • Migliora sicurezza sistema"
    else
        if is_operation_enabled "op20"; then
            diskutil resetUserPermissions / $(id -u) 2>/dev/null
            add_to_report "✅ Permessi utente riparati"
        else
            log "Riparazione permessi: SALTATA (non selezionata)"
            add_to_report "⏭️  Riparazione permessi saltata (non selezionata)"
        fi
    fi

    log "Permessi riparati."
}

#############################################
# 21. FLUSH DNS
#############################################
log "Flush DNS..."
{

    if [ "$DRY_RUN" = true ]; then
        register_operation "op21" "0" "PERFORMANCE" "DNS flush"

        append_dryrun ""
        append_dryrun "🌐 FLUSH DNS (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "⚡ Operazione PERFORMANCE (non libera spazio)"
        append_dryrun ""
        append_dryrun "Azione: dscacheutil -flushcache + restart mDNSResponder"
        append_dryrun "Benefici:"
        append_dryrun "  • Risolve problemi connessione rete"
        append_dryrun "  • Aggiorna cache DNS obsoleta"
        append_dryrun "  • Migliora velocità navigazione"
    else
        if is_operation_enabled "op21"; then
            sudo dscacheutil -flushcache
            sudo killall -HUP mDNSResponder
            add_to_report "✅ Cache DNS resettato"
        else
            log "Flush DNS: SALTATO (non selezionato)"
            add_to_report "⏭️  Flush DNS saltato (non selezionato)"
        fi
    fi

    log "DNS cache resettato."
}

#############################################
# 22. RESET SPOTLIGHT INDEX
#############################################
log "Reset Spotlight index..."
{

    if [ "$DRY_RUN" = true ]; then
        register_operation "op22" "0" "PERFORMANCE" "Spotlight rebuild"

        append_dryrun ""
        append_dryrun "🔍 SPOTLIGHT INDEX REBUILD (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "⚡ Operazione PERFORMANCE (non libera spazio)"
        append_dryrun ""
        append_dryrun "Azione: mdutil -a -i off + mdutil -a -i on"
        append_dryrun "Benefici:"
        append_dryrun "  • Ripara indice ricerca corrotto"
        append_dryrun "  • Migliora velocità ricerca Spotlight"
        append_dryrun "  • Risolve risultati mancanti/errati"
        append_dryrun ""
        append_dryrun "⚠️  La reindicizzazione richiede tempo (in background)"
    else
        if is_operation_enabled "op22"; then
            sudo mdutil -a -i off 2>/dev/null
            sleep 2
            sudo mdutil -a -i on 2>/dev/null
            add_to_report "✅ Spotlight index resettato e reindicizzazione avviata"
        else
            log "Spotlight rebuild: SALTATO (non selezionato)"
            add_to_report "⏭️  Spotlight rebuild saltato (non selezionato)"
        fi
    fi

    log "Spotlight reset completato (reindicizzazione in background)."
}

#############################################
# 23. OTTIMIZZAZIONE FONT CACHE
#############################################
log "Ottimizzazione font cache..."
{

    # FIX v4.3: misura reale invece di 50MB hardcoded
    FONT_MB=0
    FONT_MB=$(( FONT_MB + $(get_dir_size_mb ~/Library/Caches/com.apple.fontd) ))
    FONT_MB=$(( FONT_MB + $(get_dir_size_mb ~/Library/FontCollections) ))
    FONT_MB=$(( FONT_MB + $(get_dir_size_mb ~/Library/Caches/ATS) ))

    if [ "$DRY_RUN" = true ]; then
        register_operation "op23" "$FONT_MB" "CLEANUP" "Font cache"

        append_dryrun ""
        append_dryrun "🔤 FONT CACHE (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "Spazio liberabile: $FONT_MB MB"
        append_dryrun "Percorsi: ~/Library/Caches/com.apple.fontd, ~/Library/FontCollections, ~/Library/Caches/ATS"
        append_dryrun "Azione: Reset font cache e riavvio fontd"

        FONT_BYTES=$(( FONT_MB * 1048576 ))
        calculate_freed "$FONT_BYTES" "Font Cache"
    else
        if is_operation_enabled "op23"; then
            safe_remove ~/Library/Caches/com.apple.fontd
            safe_remove ~/Library/FontCollections
            safe_remove ~/Library/Caches/ATS

            killall fontd 2>/dev/null
            sleep 1

            FONT_BYTES=$(( FONT_MB * 1048576 ))
            calculate_freed "$FONT_BYTES" "Font Cache"
            add_to_report "✅ Font cache ottimizzato (fontd riavviato)"
        else
            log "Font cache: SALTATO (non selezionato)"
            add_to_report "⏭️  Font cache saltato (non selezionato)"
        fi
    fi

    log "Font cache analizzato."
}

#############################################
# 24. PULIZIA CACHE NPM/YARN/PIP (NEW v4.0)
#############################################
log "Analisi cache package manager..."
{

    NPM_MB=$(get_dir_size_mb ~/.npm/_cacache)
    YARN_MB=$(get_dir_size_mb ~/Library/Caches/Yarn)
    PIP_MB=$(get_dir_size_mb ~/Library/Caches/pip)
    PNPM_MB=$(get_dir_size_mb ~/Library/pnpm/store)

    DEV_MB=$(( NPM_MB + YARN_MB + PIP_MB + PNPM_MB ))
    DEV_BYTES=$(( DEV_MB * 1048576 ))

    if [ "$DRY_RUN" = true ]; then
        register_operation "op24" "$DEV_MB" "CLEANUP" "Dev tools cache (npm/yarn/pip/pnpm)"

        append_dryrun ""
        append_dryrun "👨‍💻 CACHE PACKAGE MANAGER (DRY RUN)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "npm cache: $NPM_MB MB"
        append_dryrun "yarn cache: $YARN_MB MB"
        append_dryrun "pip cache: $PIP_MB MB"
        append_dryrun "pnpm store: $PNPM_MB MB"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "Totale spazio liberabile: $DEV_MB MB"
        calculate_freed "$DEV_BYTES" "Dev Cache"
    else
        if is_operation_enabled "op24"; then
            safe_remove ~/.npm/_cacache
            safe_remove ~/Library/Caches/Yarn
            safe_remove ~/Library/Caches/pip
            safe_remove ~/Library/pnpm/store
            calculate_freed "$DEV_BYTES" "Dev Cache"
            add_to_report "✅ Cache package manager pulite ($DEV_MB MB)"
        else
            log "Cache package manager: SALTATE (non selezionate)"
            add_to_report "⏭️  Cache package manager saltate (non selezionate)"
        fi
    fi

    log "Cache package manager analizzate: $DEV_MB MB"
}

#############################################
# 25. PULIZIA DOCKER (NEW v4.0)
#############################################
log "Analisi Docker..."
{

    # Verifica se Docker è installato e in esecuzione
    if command -v docker &> /dev/null && docker info &> /dev/null; then

        # FIX v4.3: parsing robusto con awk (evita sed+bc fragile)
        DOCKER_MB=$(docker system df 2>/dev/null | awk '
            NR>1 {
                rec = $NF
                gsub(/\([^)]*\)/, "", rec)
                gsub(/ /, "", rec)
                if (rec ~ /GB/) { v=rec; gsub(/GB/,"",v); mb+=int(v*1024) }
                else if (rec ~ /MB/) { v=rec; gsub(/MB/,"",v); mb+=int(v) }
                else if (rec ~ /kB/) { v=rec; gsub(/kB/,"",v); mb+=int(v/1024) }
            }
            END { printf "%d", mb+0 }' 2>/dev/null || echo "0")
        DOCKER_MB=${DOCKER_MB:-0}

        # Calcola spazio Docker
        DOCKER_USAGE=$(docker system df 2>/dev/null | tail -n +2)

        if [ "$DRY_RUN" = true ]; then
            register_operation "op25" "$DOCKER_MB" "CLEANUP" "Docker (images, containers, cache)"

            append_dryrun ""
            append_dryrun "🐳 DOCKER (DRY RUN)"
            append_dryrun "────────────────────────────────────────"
            append_dryrun "Stato attuale:"
            append_dryrun "$DOCKER_USAGE"
            append_dryrun ""
            append_dryrun "Spazio stimato liberabile: ~$DOCKER_MB MB"
            append_dryrun ""
            append_dryrun "⚠️  La pulizia rimuoverà:"
            append_dryrun "    - Immagini non utilizzate"
            append_dryrun "    - Container fermi"
            append_dryrun "    - Build cache"
            append_dryrun "    (I volumi NON saranno eliminati per sicurezza)"

            DOCKER_BYTES=$(( DOCKER_MB * 1048576 ))
            calculate_freed "$DOCKER_BYTES" "Docker"
        else
            if is_operation_enabled "op25"; then
                # Pulizia conservativa (senza volumi)
                docker image prune -a -f 2>/dev/null
                docker container prune -f 2>/dev/null
                docker builder prune -f 2>/dev/null

                DOCKER_BYTES=$(( DOCKER_MB * 1048576 ))
                calculate_freed "$DOCKER_BYTES" "Docker"
                add_to_report "✅ Docker: immagini, container e build cache puliti (~$DOCKER_MB MB)"
            else
                log "Docker: SALTATO (non selezionato)"
                add_to_report "⏭️  Docker saltato (non selezionato)"
            fi
        fi

        log "Docker analizzato"
    else
        log "Docker non installato o non in esecuzione, skip"
        if [ "$DRY_RUN" = true ]; then
            append_dryrun ""
            append_dryrun "🐳 DOCKER (DRY RUN)"
            append_dryrun "────────────────────────────────────────"
            append_dryrun "⚠️  Docker non installato o non in esecuzione"
        fi
    fi
}

#############################################
# 26. PULIZIA HOMEBREW (NEW v4.0)
#############################################
log "Analisi Homebrew..."
{

    # Verifica se Homebrew è installato
    if command -v brew &> /dev/null; then

        # v5.0 (da MyPureMac): rileva HOMEBREW_CACHE personalizzato invece di assumere il default.
        # `brew --cache` restituisce il path effettivo (rispetta HOMEBREW_CACHE env var).
        BREW_CACHE_PATH=$(brew --cache 2>/dev/null)
        if [ -z "$BREW_CACHE_PATH" ] || [ ! -d "$BREW_CACHE_PATH" ]; then
            BREW_CACHE_PATH="$HOME/Library/Caches/Homebrew"
        fi
        BREW_CACHE_MB=$(get_dir_size_mb "$BREW_CACHE_PATH")

        if [ "$DRY_RUN" = true ]; then
            register_operation "op26" "$BREW_CACHE_MB" "CLEANUP" "Homebrew (cache + old versions)"

            append_dryrun ""
            append_dryrun "🍺 HOMEBREW (DRY RUN)"
            append_dryrun "────────────────────────────────────────"
            append_dryrun "Cache Homebrew: $BREW_CACHE_MB MB"
            append_dryrun "Percorso cache: $BREW_CACHE_PATH"
            append_dryrun ""
            append_dryrun "La pulizia eseguirà:"
            append_dryrun "    - brew cleanup --prune=all"
            append_dryrun "    - brew autoremove"
            append_dryrun "    (Rimuove versioni vecchie e dipendenze orfane)"

            BREW_BYTES=$(( BREW_CACHE_MB * 1048576 ))
            calculate_freed "$BREW_BYTES" "Homebrew"
        else
            if is_operation_enabled "op26"; then
                brew cleanup --prune=all 2>/dev/null
                brew autoremove 2>/dev/null

                BREW_BYTES=$(( BREW_CACHE_MB * 1048576 ))
                calculate_freed "$BREW_BYTES" "Homebrew"
                add_to_report "✅ Homebrew: cache e versioni obsolete rimosse ($BREW_CACHE_MB MB)"
            else
                log "Homebrew: SALTATO (non selezionato)"
                add_to_report "⏭️  Homebrew saltato (non selezionato)"
            fi
        fi

        log "Homebrew analizzato: $BREW_CACHE_MB MB"
    else
        log "Homebrew non installato, skip"
        if [ "$DRY_RUN" = true ]; then
            append_dryrun ""
            append_dryrun "🍺 HOMEBREW (DRY RUN)"
            append_dryrun "────────────────────────────────────────"
            append_dryrun "⚠️  Homebrew non installato"
        fi
    fi
}

#############################################
# 27. PULIZIA TIME MACHINE SNAPSHOT LOCALI (NEW v4.1)
#############################################
log "Analisi Time Machine snapshot locali..."
{

    # Lista snapshot locali
    SNAPSHOTS=$(tmutil listlocalsnapshots / 2>/dev/null | grep -c "com.apple.TimeMachine" || echo "0")

    if [ "$SNAPSHOTS" -gt 0 ]; then
        # Calcola spazio occupato (stima approssimativa)
        # Gli snapshot possono occupare da 1GB a 80GB+
        TM_MB=$(( SNAPSHOTS * 2048 ))  # Stima conservativa: ~2GB per snapshot

        if [ "$DRY_RUN" = true ]; then
            register_operation "op27" "$TM_MB" "CLEANUP" "Time Machine snapshots"

            append_dryrun ""
            append_dryrun "⏱️  TIME MACHINE SNAPSHOT LOCALI (DRY RUN)"
            append_dryrun "────────────────────────────────────────"
            append_dryrun "Snapshot trovati: $SNAPSHOTS"
            append_dryrun "Spazio stimato liberabile: ~$TM_MB MB"
            append_dryrun ""
            append_dryrun "Comando che sarà eseguito:"
            append_dryrun "  sudo tmutil thinlocalsnapshots / 999999999999 4"
            append_dryrun ""
            append_dryrun "⚠️  Questo comando elimina TUTTI gli snapshot locali."
            append_dryrun "    Assicurati di avere backup esterni se necessario!"

            TM_BYTES=$(( TM_MB * 1048576 ))
            calculate_freed "$TM_BYTES" "TM Snapshots"
        else
            if is_operation_enabled "op27"; then
                log "Eliminazione snapshot locali Time Machine..."
                sudo tmutil thinlocalsnapshots / 999999999999 4 2>/dev/null

                TM_BYTES=$(( TM_MB * 1048576 ))
                calculate_freed "$TM_BYTES" "TM Snapshots"
                add_to_report "✅ Time Machine: snapshot locali eliminati ($SNAPSHOTS snapshot, ~$TM_MB MB)"
            else
                log "Time Machine snapshots: SALTATI (non selezionati)"
                add_to_report "⏭️  Time Machine snapshots saltati (non selezionati)"
            fi
        fi

        log "Time Machine snapshot analizzati: $SNAPSHOTS snapshot trovati"
    else
        log "Time Machine: nessuno snapshot locale trovato"
        if [ "$DRY_RUN" = true ]; then
            append_dryrun ""
            append_dryrun "⏱️  TIME MACHINE SNAPSHOT LOCALI (DRY RUN)"
            append_dryrun "────────────────────────────────────────"
            append_dryrun "✅ Nessuno snapshot locale trovato"
        fi
    fi
}

#############################################
# 28. ANALISI/PULIZIA BACKUP iOS/iPAD (NEW v4.1)
#############################################
log "Analisi backup iOS/iPad..."
{

    IOS_BACKUP_DIR="$HOME/Library/Application Support/MobileSync/Backup"

    if [ -d "$IOS_BACKUP_DIR" ]; then
        IOS_MB=$(get_dir_size_mb "$IOS_BACKUP_DIR")
        IOS_COUNT=$(find "$IOS_BACKUP_DIR" -maxdepth 1 -type d 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')

        if [ "$IOS_COUNT" -gt 0 ] && [ "$IOS_MB" -gt 0 ]; then
            IOS_BYTES=$(( IOS_MB * 1048576 ))

            if [ "$DRY_RUN" = true ]; then
                register_operation "op28" "$IOS_MB" "CLEANUP" "Backup iOS/iPad"

                append_dryrun ""
                append_dryrun "📱 BACKUP iOS/iPAD (DRY RUN)"
                append_dryrun "────────────────────────────────────────"
                append_dryrun "Backup trovati: $IOS_COUNT"
                append_dryrun "Spazio occupato: $IOS_MB MB"
                append_dryrun ""
                append_dryrun "⚠️  ATTENZIONE: Backup iOS saranno eliminati SOLO se:"
                append_dryrun "    1. Hai backup iCloud attivo"
                append_dryrun "    2. O backup recente su disco esterno"
                append_dryrun ""
                append_dryrun "Percorso: ~/Library/Application Support/MobileSync/Backup"
                append_dryrun ""
                append_dryrun "🛡️  RACCOMANDAZIONE: Verifica i tuoi backup prima di eliminare!"

                # NON contiamo questo spazio nel totale per sicurezza (richiede conferma manuale)
                # calculate_freed "$IOS_BYTES" "Backup iOS"
            else
                # Chiedi conferma esplicita per backup iOS
                IOS_CONFIRM=$(osascript <<IOSEOF
                    set dialogText to "⚠️  BACKUP iOS TROVATI\n\n📱 Backup: $IOS_COUNT\n💾 Spazio: $IOS_MB MB\n\n🛡️  ATTENZIONE: Questi backup contengono i dati del tuo iPhone/iPad.\n\nSei sicuro di volerli eliminare?\n(Assicurati di avere backup su iCloud o disco esterno)"
                    display dialog dialogText buttons {"NO, Mantieni", "SÌ, Elimina"} default button "NO, Mantieni" with icon caution
                    return button returned of result
IOSEOF
)

                if [ "$IOS_CONFIRM" = "SÌ, Elimina" ]; then
                    rm -rf "$IOS_BACKUP_DIR"/* 2>/dev/null
                    calculate_freed "$IOS_BYTES" "Backup iOS"
                    add_to_report "✅ Backup iOS/iPad eliminati ($IOS_COUNT backup, $IOS_MB MB)"
                    log "Backup iOS eliminati: $IOS_MB MB"
                else
                    add_to_report "⏭️  Backup iOS/iPad mantenuti (scelta utente)"
                    log "Backup iOS mantenuti (scelta utente)"
                fi
            fi

            log "Backup iOS analizzati: $IOS_COUNT backup, $IOS_MB MB"
        else
            log "Backup iOS: cartella vuota o assente"
            if [ "$DRY_RUN" = true ]; then
                append_dryrun ""
                append_dryrun "📱 BACKUP iOS/iPAD (DRY RUN)"
                append_dryrun "────────────────────────────────────────"
                append_dryrun "✅ Nessun backup locale trovato"
            fi
        fi
    else
        log "Backup iOS: directory non esistente"
        if [ "$DRY_RUN" = true ]; then
            append_dryrun ""
            append_dryrun "📱 BACKUP iOS/iPAD (DRY RUN)"
            append_dryrun "────────────────────────────────────────"
            append_dryrun "✅ Nessun backup locale trovato"
        fi
    fi
}

#############################################
# 29. ANALISI FILE SWAP E SLEEPIMAGE (NEW v4.1)
#############################################
log "Analisi file Swap e Sleepimage..."
{

    VM_DIR="/private/var/vm"

    if [ -d "$VM_DIR" ]; then
        # Calcola dimensione totale file swap
        SWAP_MB=0
        SWAP_COUNT=0
        while IFS= read -r swapfile; do
            if [ -n "$swapfile" ]; then
                FILE_MB=$(get_dir_size_mb "$swapfile")
                SWAP_MB=$(( SWAP_MB + FILE_MB ))
                SWAP_COUNT=$(( SWAP_COUNT + 1 ))
            fi
        done < <(find "$VM_DIR" -name "swapfile*" 2>/dev/null)

        # Sleepimage
        SLEEP_MB=0
        if [ -f "$VM_DIR/sleepimage" ]; then
            SLEEP_MB=$(get_dir_size_mb "$VM_DIR/sleepimage")
        fi

        TOTAL_VM_MB=$(( SWAP_MB + SLEEP_MB ))

        if [ "$DRY_RUN" = true ]; then
            register_operation "op29" "0" "ANALYSIS" "Swap/Sleepimage analysis"

            append_dryrun ""
            append_dryrun "💤 FILE SWAP E SLEEPIMAGE (ANALISI)"
            append_dryrun "────────────────────────────────────────"
            append_dryrun "File swap: $SWAP_COUNT file — $SWAP_MB MB"
            append_dryrun "Sleepimage: $SLEEP_MB MB"
            append_dryrun "────────────────────────────────────────"
            append_dryrun "Totale: $TOTAL_VM_MB MB"
            append_dryrun ""
            append_dryrun "ℹ️  QUESTI FILE NON POSSONO ESSERE ELIMINATI DIRETTAMENTE"
            append_dryrun "   (sono gestiti dal sistema operativo)"
            append_dryrun ""
            if [ "$TOTAL_VM_MB" -gt 10000 ]; then
                append_dryrun "⚠️  DIMENSIONE ELEVATA! (>10 GB)"
                append_dryrun ""
                append_dryrun "💡 SOLUZIONI CONSIGLIATE:"
                append_dryrun "   1. Riavvia il Mac (libera swap automaticamente)"
                append_dryrun "   2. Chiudi app che consumano molta memoria"
                append_dryrun "   3. Valuta upgrade RAM se il problema persiste"
            else
                append_dryrun "✅ Dimensione normale per il sistema"
            fi
        else
            if is_operation_enabled "op29"; then
                # Anche in modalità pulizia, solo report (non eliminabili)
                if [ "$TOTAL_VM_MB" -gt 10000 ]; then
                    add_to_report "⚠️  Swap/Sleepimage: $TOTAL_VM_MB MB (>10GB, riavvia il Mac per liberare)"
                else
                    add_to_report "ℹ️  Swap/Sleepimage: $TOTAL_VM_MB MB (dimensione normale)"
                fi
            else
                log "Analisi Swap/Sleepimage: SALTATA (non selezionata)"
                add_to_report "⏭️  Analisi Swap/Sleepimage saltata (non selezionata)"
            fi
        fi

        log "Swap/Sleepimage analizzati: $TOTAL_VM_MB MB (Swap: $SWAP_MB, Sleep: $SLEEP_MB)"
    else
        log "Directory /private/var/vm non accessibile"
    fi
}

#############################################
# 30. PULIZIA MAIL ATTACHMENTS (NEW v4.3 - da MyPureMac)
#############################################
log "Analisi Mail attachments..."
{
    MAIL_ATTACH_DIR="$HOME/Library/Mail Downloads"
    MAIL_MB=0
    MAIL_COUNT=0

    if [ -d "$MAIL_ATTACH_DIR" ]; then
        MAIL_MB=$(get_dir_size_mb "$MAIL_ATTACH_DIR")
        MAIL_COUNT=$(find "$MAIL_ATTACH_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
        MAIL_BYTES=$(( MAIL_MB * 1048576 ))

        if [ "$DRY_RUN" = true ]; then
            register_operation "op30" "$MAIL_MB" "CLEANUP" "Mail attachments"
            append_dryrun ""
            append_dryrun "📧 MAIL ATTACHMENTS (DRY RUN)"
            append_dryrun "────────────────────────────────────────"
            append_dryrun "File allegati scaricati: $MAIL_COUNT"
            append_dryrun "Spazio liberabile: $MAIL_MB MB"
            append_dryrun "Percorso: ~/Library/Mail Downloads/"
            calculate_freed "$MAIL_BYTES" "Mail Attachments"
        else
            if is_operation_enabled "op30"; then
                safe_remove "$MAIL_ATTACH_DIR"
                calculate_freed "$MAIL_BYTES" "Mail Attachments"
                add_to_report "✅ Mail attachments eliminati ($MAIL_COUNT file, $MAIL_MB MB)"
            else
                log "Mail attachments: SALTATI (non selezionati)"
                add_to_report "⏭️  Mail attachments saltati (non selezionati)"
            fi
        fi
    else
        if [ "$DRY_RUN" = true ]; then
            register_operation "op30" "0" "CLEANUP" "Mail attachments"
            append_dryrun ""
            append_dryrun "📧 MAIL ATTACHMENTS (DRY RUN)"
            append_dryrun "────────────────────────────────────────"
            append_dryrun "✅ Nessun allegato scaricato trovato"
        fi
    fi

    log "Mail attachments analizzati: $MAIL_COUNT file, $MAIL_MB MB"
}

#############################################
# 31. ANALISI SPAZIO APFS PURGEABLE (NEW v4.3 - da MyPureMac)
#############################################
log "Analisi spazio APFS purgeable..."
{
    PURGEABLE_MB=0

    # Prova a leggere spazio purgeable da diskutil info
    DISKUTIL_INFO=$(diskutil info / 2>/dev/null)
    PURGEABLE_BYTES_RAW=$(echo "$DISKUTIL_INFO" | grep -i "Purgeable" | grep -oE '[0-9,]+ Bytes' | head -1 | tr -d ',')

    if [ -n "$PURGEABLE_BYTES_RAW" ]; then
        PURGEABLE_BYTES_NUM="${PURGEABLE_BYTES_RAW%% *}"
        PURGEABLE_MB=$(( PURGEABLE_BYTES_NUM / 1048576 ))
    else
        # Fallback: leggi da diskutil apfs list
        PURGEABLE_RAW=$(diskutil apfs list 2>/dev/null | grep -i "Purgeable" | awk '{print $(NF-1), $NF}' | head -1)
        if echo "$PURGEABLE_RAW" | grep -qi "GB"; then
            PURGEABLE_N=$(echo "$PURGEABLE_RAW" | grep -oE '[0-9]+(\.[0-9]+)?' | head -1)
            PURGEABLE_MB=$(echo "$PURGEABLE_N * 1024" | bc 2>/dev/null | cut -d. -f1 || echo 0)
        elif echo "$PURGEABLE_RAW" | grep -qi "MB"; then
            PURGEABLE_MB=$(echo "$PURGEABLE_RAW" | grep -oE '[0-9]+' | head -1)
        fi
    fi

    PURGEABLE_MB=${PURGEABLE_MB:-0}

    if [ "$DRY_RUN" = true ]; then
        register_operation "op31" "0" "ANALYSIS" "APFS Purgeable Space"
        append_dryrun ""
        append_dryrun "🍎 SPAZIO APFS PURGEABLE (ANALISI)"
        append_dryrun "────────────────────────────────────────"
        if [ "$PURGEABLE_MB" -gt 0 ]; then
            append_dryrun "Spazio purgeable rilevato: $PURGEABLE_MB MB"
            append_dryrun ""
            append_dryrun "ℹ️  Lo spazio 'purgeable' è gestito automaticamente da macOS."
            append_dryrun "   Il sistema lo libera automaticamente sotto pressione disco."
            if [ "$PURGEABLE_MB" -gt 10000 ]; then
                append_dryrun ""
                append_dryrun "💡 Per liberarlo subito: usa l'ottimizzazione RAM (PERFORMANCE)"
            fi
        else
            append_dryrun "✅ Nessuno spazio purgeable rilevato (o accesso non disponibile)"
        fi
    else
        if is_operation_enabled "op31"; then
            if [ "$PURGEABLE_MB" -gt 0 ]; then
                add_to_report "ℹ️  Spazio APFS purgeable: $PURGEABLE_MB MB (gestito automaticamente da macOS)"
            else
                add_to_report "ℹ️  Spazio APFS purgeable: non rilevato"
            fi
        fi
    fi

    log "APFS purgeable analizzato: $PURGEABLE_MB MB"
}

#############################################
# 32. BOOT OPTIMIZATION (NEW v5.0 - da MyPureMac)
# Rileva LaunchAgents/LaunchDaemons noti come problematici + item orfani
# (il cui eseguibile non esiste più). Sicurezza: NON rimuove mai daemon di
# sistema automaticamente; in cleanup mette in quarantena (backup) solo gli
# agent utente noti come problematici, in modo reversibile.
#############################################
log "Analisi boot optimization (launch agents/daemons)..."
{
    BOOT_FILE="$REPORTS_DIR/boot_optimization_${TIMESTAMP}.txt"
    BOOT_QUARANTINE="$REPORTS_DIR/boot_quarantine_${TIMESTAMP}"

    # Liste note (portate da MyPureMac ScanEngine.scanBootOptimization)
    KNOWN_PROBLEMATIC_AGENTS="com.google.keystone.agent.plist com.google.keystone.xpcservice.plist com.google.GoogleUpdater.wake.plist com.valvesoftware.steamclean.plist com.dropbox.DropboxUpdater.wake.plist com.dropbox.dropboxmacupdate.agent.plist com.dropbox.dropboxmacupdate.xpcservice.plist com.macpaw.CleanMyMac4.Updater.plist com.epicgames.launcher.plist"
    KNOWN_PROBLEMATIC_DAEMONS="com.macpaw.CleanMyMac4.Agent.plist com.muse.authservice.plist"

    # Helper: verifica se un launch item è orfano (eseguibile inesistente)
    is_orphan_launch_item() {
        local plist="$1"
        local prog
        prog=$(/usr/libexec/PlistBuddy -c "Print :Program" "$plist" 2>/dev/null)
        if [ -z "$prog" ]; then
            prog=$(/usr/libexec/PlistBuddy -c "Print :ProgramArguments:0" "$plist" 2>/dev/null)
        fi
        [ -z "$prog" ] && return 1        # nessun programma → non classificabile come orfano
        [ -e "$prog" ] && return 1        # eseguibile esiste → non orfano
        return 0                          # orfano
    }

    # Helper: appende all'elenco; matches known → known, altrimenti orphan
    scan_launch_dir() {
        local dir="$1"
        local known_list="$2"
        local scope="$3"   # "user" | "system"
        [ -d "$dir" ] || return 0
        [ -r "$dir" ] || return 0
        for plist in "$dir"/*.plist; do
            [ -e "$plist" ] || continue
            local base
            base=$(basename "$plist")
            local flagged=0
            case " $known_list " in
                *" $base "*)
                    echo "⚠️  [NOTO] $base — $dir (scope: $scope)" >> "$BOOT_FILE"
                    flagged=1
                    if [ "$scope" = "user" ]; then
                        echo "$plist" >> "${BOOT_FILE}.userknown"
                    fi
                    ;;
            esac
            if [ "$flagged" -eq 0 ] && is_orphan_launch_item "$plist"; then
                echo "🔍 [ORFANO] $base — $dir (eseguibile mancante)" >> "$BOOT_FILE"
            fi
        done
    }

    if [ "$DRY_RUN" = true ]; then
        register_operation "op32" "0" "PERFORMANCE" "Boot optimization"
        : > "$BOOT_FILE"
        echo "═══════════════════════════════════════════" >> "$BOOT_FILE"
        echo "BOOT OPTIMIZATION — Launch Agents/Daemons"      >> "$BOOT_FILE"
        echo "$(date)"                                        >> "$BOOT_FILE"
        echo "═══════════════════════════════════════════" >> "$BOOT_FILE"
        echo "" >> "$BOOT_FILE"
        rm -f "${BOOT_FILE}.userknown"

        scan_launch_dir "$HOME/Library/LaunchAgents" "$KNOWN_PROBLEMATIC_AGENTS" "user"
        scan_launch_dir "/Library/LaunchAgents" "$KNOWN_PROBLEMATIC_AGENTS" "system"
        scan_launch_dir "/Library/LaunchDaemons" "$KNOWN_PROBLEMATIC_DAEMONS" "system"

        BOOT_COUNT=$(grep -c -E "^(⚠️|🔍)" "$BOOT_FILE" 2>/dev/null | tr -d ' ')
        BOOT_COUNT=${BOOT_COUNT:-0}
        echo "" >> "$BOOT_FILE"
        echo "Totale elementi segnalati: $BOOT_COUNT" >> "$BOOT_FILE"

        append_dryrun ""
        append_dryrun "🚀 BOOT OPTIMIZATION (ANALISI)"
        append_dryrun "────────────────────────────────────────"
        append_dryrun "Launch item problematici/orfani rilevati: $BOOT_COUNT"
        append_dryrun "Dettaglio: $BOOT_FILE"
        append_dryrun "ℹ️  In pulizia verranno messi in quarantena SOLO gli agent utente noti (reversibile)."
    else
        if is_operation_enabled "op32"; then
            : > "$BOOT_FILE"
            echo "BOOT OPTIMIZATION — $(date)" >> "$BOOT_FILE"
            rm -f "${BOOT_FILE}.userknown"
            scan_launch_dir "$HOME/Library/LaunchAgents" "$KNOWN_PROBLEMATIC_AGENTS" "user"
            scan_launch_dir "/Library/LaunchAgents" "$KNOWN_PROBLEMATIC_AGENTS" "system"
            scan_launch_dir "/Library/LaunchDaemons" "$KNOWN_PROBLEMATIC_DAEMONS" "system"

            QUARANTINED=0
            if [ -f "${BOOT_FILE}.userknown" ]; then
                mkdir -p "$BOOT_QUARANTINE"
                while IFS= read -r plist; do
                    [ -e "$plist" ] || continue
                    # Scarica l'agent prima di spostarlo (best effort)
                    launchctl unload "$plist" 2>/dev/null
                    if mv "$plist" "$BOOT_QUARANTINE/" 2>/dev/null; then
                        QUARANTINED=$(( QUARANTINED + 1 ))
                    fi
                done < "${BOOT_FILE}.userknown"
            fi

            if [ "$QUARANTINED" -gt 0 ]; then
                add_to_report "✅ Boot optimization: $QUARANTINED agent utente noti messi in quarantena → $BOOT_QUARANTINE (reversibile)"
            else
                add_to_report "ℹ️  Boot optimization: nessun agent utente noto da mettere in quarantena (vedi $BOOT_FILE per orfani/sistema)"
            fi
        else
            log "Boot optimization: SALTATO (non selezionato)"
            add_to_report "⏭️  Boot optimization saltato (non selezionato)"
        fi
    fi

    rm -f "${BOOT_FILE}.userknown" 2>/dev/null
    log "Boot optimization analizzato → $BOOT_FILE"
}

#############################################
# 33. ORPHANED FILES FINDER (NEW v5.0 - da MyPureMac)
# Rileva file/cartelle residui in ~/Library appartenenti ad app disinstallate,
# confrontando gli identificatori con quelli delle app effettivamente installate.
# Solo ANALISI (nessuna eliminazione automatica: troppo rischioso per euristica).
#############################################
log "Analisi orphaned files (residui app disinstallate)..."
{
    ORPHAN_FILE="$REPORTS_DIR/orphaned_files_${TIMESTAMP}.txt"
    INSTALLED_IDS=$(mktemp)

    # Costruisci l'insieme degli identificatori installati (bundle id + nome normalizzato)
    while IFS= read -r app; do
        [ -n "$app" ] || continue
        bid=$(/usr/bin/defaults read "$app/Contents/Info" CFBundleIdentifier 2>/dev/null)
        if [ -n "$bid" ]; then
            # Forma normalizzata (solo lettere/numeri minuscoli) per il matching a substring:
            # is_installed_identifier() normalizza il candidato allo stesso modo.
            bidnorm=$(echo "$bid" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')
            [ -n "$bidnorm" ] && echo "$bidnorm" >> "$INSTALLED_IDS"
        fi
        # Nome app normalizzato (solo lettere/numeri minuscoli)
        aname=$(basename "$app" .app | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')
        [ -n "$aname" ] && echo "$aname" >> "$INSTALLED_IDS"
    done < <(find /Applications "$HOME/Applications" -maxdepth 2 -type d -name "*.app" 2>/dev/null)

    # Verifica se un identificatore candidato corrisponde a un'app installata
    is_installed_identifier() {
        local candidate
        candidate=$(echo "$1" | tr '[:upper:]' '[:lower:]')
        local norm
        norm=$(echo "$candidate" | tr -cd 'a-z0-9')
        [ -z "$norm" ] && return 0   # non classificabile → non segnalare
        # match diretto su bundle id o su nome (grep case-insensitive, match parziale)
        if grep -qi -- "$norm" "$INSTALLED_IDS" 2>/dev/null; then
            return 0
        fi
        return 1
    }

    if [ "$DRY_RUN" = true ]; then
        register_operation "op33" "0" "ANALYSIS" "Orphaned files"
    fi

    if { [ "$DRY_RUN" = true ]; } || is_operation_enabled "op33"; then
        : > "$ORPHAN_FILE"
        echo "═══════════════════════════════════════════" >> "$ORPHAN_FILE"
        echo "ORPHANED FILES — residui di app disinstallate"  >> "$ORPHAN_FILE"
        echo "$(date)"                                        >> "$ORPHAN_FILE"
        echo "═══════════════════════════════════════════" >> "$ORPHAN_FILE"
        echo "" >> "$ORPHAN_FILE"
        echo "ℹ️  Elenco euristico: verifica prima di eliminare manualmente." >> "$ORPHAN_FILE"
        echo "" >> "$ORPHAN_FILE"

        ORPHAN_COUNT=0
        ORPHAN_MB=0

        # Robustezza: se la scoperta delle app installate è fallita, non produrre
        # un report fuorviante (segnalerebbe TUTTO come orfano).
        if [ ! -s "$INSTALLED_IDS" ]; then
            echo "⚠️  Impossibile determinare le app installate — analisi orfani saltata." >> "$ORPHAN_FILE"
            if [ "$DRY_RUN" = true ]; then
                append_dryrun ""
                append_dryrun "👻 ORPHANED FILES (ANALISI)"
                append_dryrun "────────────────────────────────────────"
                append_dryrun "⚠️  Scoperta app installate fallita — analisi saltata."
            else
                add_to_report "⚠️  Orphaned files: scoperta app installate fallita, analisi saltata"
            fi
            log "Orphaned files: set app installate vuoto, skip"
        else
            # Preferences: file *.plist nominati per bundle id
            for plist in "$HOME/Library/Preferences"/*.plist; do
                [ -e "$plist" ] || continue
                id=$(basename "$plist" .plist)
                case "$id" in
                    com.apple.*|.GlobalPreferences*|MobileMeAccounts*|loginwindow*) continue ;;
                esac
                if ! is_installed_identifier "$id"; then
                    sz=$(get_dir_size_mb "$plist")
                    echo "🔍 ~/Library/Preferences/$(basename "$plist")  (${sz} MB)" >> "$ORPHAN_FILE"
                    ORPHAN_COUNT=$(( ORPHAN_COUNT + 1 ))
                    ORPHAN_MB=$(( ORPHAN_MB + sz ))
                fi
            done

            # Application Support + Containers + Caches (cartelle top-level)
            for base in "$HOME/Library/Application Support" "$HOME/Library/Containers" "$HOME/Library/Caches"; do
                [ -d "$base" ] || continue
                for entry in "$base"/*; do
                    [ -e "$entry" ] || continue
                    name=$(basename "$entry")
                    case "$name" in
                        com.apple.*|Apple*|CrashReporter*|CloudDocs*) continue ;;
                    esac
                    if ! is_installed_identifier "$name"; then
                        sz=$(get_dir_size_mb "$entry")
                        # Ignora voci minuscole (<1 MB) per ridurre rumore
                        if [ "$sz" -ge 1 ]; then
                            echo "🔍 ${base/#$HOME/~}/$name  (${sz} MB)" >> "$ORPHAN_FILE"
                            ORPHAN_COUNT=$(( ORPHAN_COUNT + 1 ))
                            ORPHAN_MB=$(( ORPHAN_MB + sz ))
                        fi
                    fi
                done
            done

            echo "" >> "$ORPHAN_FILE"
            echo "Totale candidati orfani: $ORPHAN_COUNT (~${ORPHAN_MB} MB)" >> "$ORPHAN_FILE"

            if [ "$DRY_RUN" = true ]; then
                append_dryrun ""
                append_dryrun "👻 ORPHANED FILES (ANALISI)"
                append_dryrun "────────────────────────────────────────"
                append_dryrun "Candidati residui rilevati: $ORPHAN_COUNT (~${ORPHAN_MB} MB)"
                append_dryrun "Dettaglio: $ORPHAN_FILE"
                append_dryrun "ℹ️  Solo analisi: nessun file eliminato automaticamente."
            else
                add_to_report "✅ Analisi orphaned files ($ORPHAN_COUNT candidati, ~${ORPHAN_MB} MB) → $ORPHAN_FILE"
            fi
            log "Orphaned files analizzati: $ORPHAN_COUNT candidati"
        fi
    else
        log "Orphaned files: SALTATO (non selezionato)"
        add_to_report "⏭️  Orphaned files saltato (non selezionato)"
    fi

    rm -f "$INSTALLED_IDS"
}

#############################################
# RIEPILOGO FINALE
#############################################

# Leggi spazio totale dal file temporaneo
SPACE_FREED_MB=$(cat "$SPACE_TEMP_FILE")

echo "" >> "$DRY_RUN_REPORT"
echo "═══════════════════════════════════════════════════════════" >> "$DRY_RUN_REPORT"
echo "📊 RIEPILOGO SPAZIO LIBERABILE" >> "$DRY_RUN_REPORT"
echo "═══════════════════════════════════════════════════════════" >> "$DRY_RUN_REPORT"
echo "" >> "$DRY_RUN_REPORT"
echo "SPAZIO TOTALE LIBERABILE: $SPACE_FREED_MB MB" >> "$DRY_RUN_REPORT"
echo "" >> "$DRY_RUN_REPORT"
echo "BREAKDOWN PER CATEGORIA:" >> "$DRY_RUN_REPORT"
echo "────────────────────────────────────────" >> "$DRY_RUN_REPORT"

# FIX: Leggi categorie da file invece di array associativo (bash 3.x compat)
while IFS=: read -r cat_key cat_val; do
    if [ -n "$cat_key" ] && [ -n "$cat_val" ]; then
        cat_name=$(echo "$cat_key" | tr '_' ' ')
        echo "  • $cat_name: $cat_val MB" >> "$DRY_RUN_REPORT"
    fi
done < "$CATEGORY_TEMP_FILE"

# Calcola totali per categoria (NEW v4.2)
CLEANUP_MB=0
PERFORMANCE_MB=0
ANALYSIS_MB=0

while IFS=: read -r op_id mb_value category description; do
    if [ -n "$op_id" ]; then
        case "$category" in
            CLEANUP)
                CLEANUP_MB=$(( CLEANUP_MB + mb_value ))
                ;;
            PERFORMANCE)
                PERFORMANCE_MB=$(( PERFORMANCE_MB + mb_value ))
                ;;
            ANALYSIS)
                ANALYSIS_MB=$(( ANALYSIS_MB + mb_value ))
                ;;
        esac
    fi
done < "$OPERATIONS_DATA_FILE"

# Cleanup file temporanei
rm -f "$SPACE_TEMP_FILE" "$CATEGORY_TEMP_FILE"

echo "" >> "$DRY_RUN_REPORT"
echo "═══════════════════════════════════════════════════════════" >> "$DRY_RUN_REPORT"

if [ "$DRY_RUN" = true ]; then
    log "═══════════════════════════════════════════════════════════"
    log "✅ DRY RUN COMPLETATO"
    log "═══════════════════════════════════════════════════════════"
    log "📊 Spazio liberabile: ${SPACE_FREED_MB} MB"
    log "📄 Report salvato: $DRY_RUN_REPORT"
    log ""

    # Notifica Notification Center
    send_notification "CleanMac v5.0" "DRY RUN completato. Spazio liberabile: ${SPACE_FREED_MB} MB"

    # NUOVO v4.2: Dialog con selezione categorie (solo se non in CLI mode)
    if [ "$CLI_MODE" = false ]; then
        SELECTION_DIALOG=$(osascript <<EOF
        set dialogText to "🔍 DRY RUN COMPLETATO\n\n📊 SPAZIO TOTALE LIBERABILE: ${SPACE_FREED_MB} MB\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n🗑️  PULIZIA (libera spazio): ${CLEANUP_MB} MB\n⚡ PERFORMANCE (migliora velocità): ${PERFORMANCE_MB} MB\n📊 ANALISI (solo report): ${ANALYSIS_MB} MB\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nVuoi procedere con la pulizia?"
        set choiceButtons to {"Annulla", "Personalizza Selezione", "Esegui Tutto"}
        display dialog dialogText buttons choiceButtons default button "Personalizza Selezione"
        return button returned of result
EOF
)

    if [ "$SELECTION_DIALOG" = "Annulla" ]; then
        osascript -e "display dialog \"📋 Report salvato in:\n\n$DRY_RUN_REPORT\n\nPuoi revisionarlo e eseguire di nuovo per confermare.\" buttons {\"OK\"} default button \"OK\""
        rm -f "$OPERATIONS_DATA_FILE"
        exit 0
    elif [ "$SELECTION_DIALOG" = "Personalizza Selezione" ]; then
        # Dialog selezione categorie (NEW v4.2)
        CATEGORY_SELECTION=$(osascript <<EOF
            set dialogText to "📋 SELEZIONA CATEGORIE DA ESEGUIRE:\n\n🗑️  PULIZIA - ${CLEANUP_MB} MB liberabili\n  (Cache, log, file temporanei, ecc.)\n\n⚡ PERFORMANCE - ${PERFORMANCE_MB} MB\n  (Ottimizzazioni senza liberare spazio)\n  [Pre-selezionato]\n\n📊 ANALISI - ${ANALYSIS_MB} MB\n  (Report e statistiche)\n\nSeleziona quali categorie vuoi eseguire:"
            set categoryChoices to {"🗑️  Pulizia", "⚡ Performance (consigliato)", "📊 Analisi"}
            set selectedCategories to choose from list categoryChoices with prompt dialogText default items {"⚡ Performance (consigliato)"} with multiple selections allowed

            if selectedCategories is false then
                return "CANCEL"
            else
                return selectedCategories as text
            end if
EOF
)

        if [ "$CATEGORY_SELECTION" = "CANCEL" ]; then
            osascript -e "display dialog \"❌ Selezione annullata\" buttons {\"OK\"} default button \"OK\""
            rm -f "$OPERATIONS_DATA_FILE"
            exit 0
        fi

        # Processa selezione
        SELECTIVE_MODE=true
        ENABLE_CLEANUP=0
        ENABLE_PERFORMANCE=0
        ENABLE_ANALYSIS=0

        if echo "$CATEGORY_SELECTION" | grep -q "Pulizia"; then
            ENABLE_CLEANUP=1
            log "Categoria PULIZIA abilitata"
        fi

        if echo "$CATEGORY_SELECTION" | grep -q "Performance"; then
            ENABLE_PERFORMANCE=1
            log "Categoria PERFORMANCE abilitata"
        fi

        if echo "$CATEGORY_SELECTION" | grep -q "Analisi"; then
            ENABLE_ANALYSIS=1
            log "Categoria ANALISI abilitata"
        fi

        log "Modalità selettiva attivata"
        osascript -e 'display dialog "Per eseguire la pulizia con la selezione, esegui nuovamente lo script e scegli \"Pulizia Diretta\".\n\nLe tue preferenze saranno applicate." buttons {"OK"} default button "OK"'
    else
        # "Esegui Tutto"
        log "Procedimento con pulizia completa..."
        osascript -e 'display dialog "Per eseguire la pulizia completa, esegui nuovamente lo script e scegli \"Pulizia Diretta\"." buttons {"OK"} default button "OK"'
    fi

        # Salva preferenze selezione in file temporaneo per prossima esecuzione
        if [ "$SELECTIVE_MODE" = true ]; then
            PREFS_FILE="$REPORTS_DIR/.cleanmac_prefs_${TIMESTAMP}.tmp"
            echo "ENABLE_CLEANUP=$ENABLE_CLEANUP" > "$PREFS_FILE"
            echo "ENABLE_PERFORMANCE=$ENABLE_PERFORMANCE" >> "$PREFS_FILE"
            echo "ENABLE_ANALYSIS=$ENABLE_ANALYSIS" >> "$PREFS_FILE"
            log "Preferenze salvate in: $PREFS_FILE"
        fi
    fi  # Fine if CLI_MODE = false

    rm -f "$OPERATIONS_DATA_FILE"
    exit 0
fi

#############################################
# REPORT HTML FINALE
#############################################
log "Generazione report HTML..."

cat > "$REPORT_HTML" <<HTMLEOF
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CleanMac v5.0 Report</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 40px 20px;
        }

        .container {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }

        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            text-align: center;
        }

        .header h1 {
            font-size: 32px;
            margin-bottom: 10px;
        }

        .header p {
            font-size: 14px;
            opacity: 0.9;
        }

        .content {
            padding: 40px;
        }

        .section {
            margin-bottom: 30px;
        }

        .section h2 {
            font-size: 18px;
            color: #333;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #667eea;
        }

        ul {
            list-style: none;
        }

        li {
            padding: 10px 0;
            padding-left: 30px;
            position: relative;
            color: #555;
            font-size: 14px;
            line-height: 1.6;
        }

        li:before {
            content: "✓";
            position: absolute;
            left: 0;
            color: #667eea;
            font-weight: bold;
            font-size: 16px;
        }

        .stats {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-card {
            background: #f5f7fa;
            padding: 20px;
            border-radius: 8px;
            border-left: 4px solid #667eea;
        }

        .stat-card h3 {
            font-size: 12px;
            color: #999;
            text-transform: uppercase;
            margin-bottom: 8px;
        }

        .stat-card p {
            font-size: 24px;
            color: #333;
            font-weight: 600;
        }

        .stat-card.warning {
            border-left-color: #f39c12;
        }

        .stat-card.warning p {
            color: #f39c12;
        }

        .footer {
            background: #f5f7fa;
            padding: 20px 40px;
            text-align: center;
            font-size: 12px;
            color: #999;
            border-top: 1px solid #e0e0e0;
        }

        .dryrun-badge {
            background: #f39c12;
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 20px;
            display: inline-block;
        }

        .cleanup-badge {
            background: #27ae60;
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 20px;
            display: inline-block;
        }

        @media (max-width: 600px) {
            .stats {
                grid-template-columns: 1fr;
            }

            .header h1 {
                font-size: 24px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧹 CleanMac v5.0 Report</h1>
            <p>Manutenzione e pulizia sistema</p>
        </div>

        <div class="content">
            <div id="badge-container">
                <div class="MODE_BADGE_PLACEHOLDER"></div>
            </div>

            <div class="stats">
                <div class="stat-card">
                    <h3>Data e Ora</h3>
                    <p>DATETIME_PLACEHOLDER</p>
                </div>
                <div class="stat-card">
                    <h3>Spazio Liberato/Liberabile</h3>
                    <p>SPACE_PLACEHOLDER MB</p>
                </div>
            </div>

            <div class="section">
                <h2>📋 Operazioni Eseguite</h2>
                <ul id="operations-list">
                    OPERATIONS_PLACEHOLDER
                </ul>
            </div>

            <div class="section">
                <h2>💡 Consigli e Prossimi Passi</h2>
                <ul>
                    <li>Rivedi il file di report completo (TXT) per dettagli su ogni categoria</li>
                    <li>Se soddisfatto dei risultati, esegui di nuovo lo script e seleziona "Pulizia Diretta"</li>
                    <li>Controlla "large_files_*.txt" per file candidati all'eliminazione manuale</li>
                    <li>Monitora spazio disco regolarmente per evitare congestione</li>
                </ul>
            </div>
        </div>

        <div class="footer">
            <p>CleanMac v5.0 — Report generato automaticamente</p>
        </div>
    </div>
</body>
</html>
HTMLEOF

# FIX: Sostituisci placeholder con valori reali
CURRENT_DATETIME=$(date "+%Y-%m-%d %H:%M:%S")

if [ "$DRY_RUN" = true ]; then
    MODE_BADGE='<div class="dryrun-badge">🔍 MODALITÀ DRY RUN — Nessun file eliminato</div>'
else
    MODE_BADGE='<div class="cleanup-badge">✅ PULIZIA COMPLETATA</div>'
fi

sed -i '' "s|DATETIME_PLACEHOLDER|$CURRENT_DATETIME|g" "$REPORT_HTML"
sed -i '' "s|SPACE_PLACEHOLDER|$SPACE_FREED_MB|g" "$REPORT_HTML"
sed -i '' "s|OPERATIONS_PLACEHOLDER|$OPERATIONS_LOG|g" "$REPORT_HTML"
sed -i '' "s|<div class=\"MODE_BADGE_PLACEHOLDER\"></div>|$MODE_BADGE|g" "$REPORT_HTML"

add_to_report "✅ Report HTML v5.0 generato → $REPORT_HTML"

log "═══════════════════════════════════════════════════════════"
if [ "$DRY_RUN" = true ]; then
    log "✅ ANALISI COMPLETATA (DRY RUN)"
else
    log "✅ PULIZIA COMPLETATA"
    # Notifica Notification Center
    send_notification "CleanMac v5.0" "Pulizia completata! Spazio liberato: ${SPACE_FREED_MB} MB"
    # Cleanup file preferenze temporaneo
    rm -f "$REPORTS_DIR/.cleanmac_prefs_"*.tmp 2>/dev/null
    rm -f "$OPERATIONS_DATA_FILE" 2>/dev/null
fi
log "═══════════════════════════════════════════════════════════"
log "📊 Spazio: ${SPACE_FREED_MB} MB"
log "📝 Report TXT: $DRY_RUN_REPORT"
log "📄 Report HTML: $REPORT_HTML"
log ""

osascript -e "display dialog \"✅ Operazione completata!\n\n📊 Spazio: ${SPACE_FREED_MB} MB\n📄 Report HTML generato\" buttons {\"OK\"} default button \"OK\""

exit 0
