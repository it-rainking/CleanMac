#!/bin/bash
# schedule.command — v5.0 (Synthesis Edition)
# Scheduler di pulizia automatica per CleanMac.
# Porting di MyPureMac/SchedulerService (installLaunchAgent/uninstallLaunchAgent):
# installa un LaunchAgent utente che esegue CleanMac.command a intervalli regolari.
#
# Uso:
#   ./schedule.command install [daily|weekly|monthly] [CATEGORIE]
#   ./schedule.command uninstall
#   ./schedule.command status
#
# Esempi:
#   ./schedule.command install weekly CLEANUP
#   ./schedule.command install daily CLEANUP,PERFORMANCE
#
# Nota: il LaunchAgent gira in sessione utente (no sudo), quindi vengono eseguite
# solo le operazioni che non richiedono privilegi di root.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLEANMAC="$SCRIPT_DIR/CleanMac.command"
PLIST_LABEL="com.cleanmac.scheduler"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

interval_seconds() {
    case "$1" in
        daily)   echo 86400 ;;
        weekly)  echo 604800 ;;
        monthly) echo 2592000 ;;
        *)       echo "" ;;
    esac
}

cmd_install() {
    local when="${1:-weekly}"
    local categories="${2:-CLEANUP}"
    local secs
    secs=$(interval_seconds "$when")

    if [ -z "$secs" ]; then
        echo "❌ Intervallo non valido: '$when' (usa daily|weekly|monthly)" >&2
        exit 1
    fi
    if [ ! -f "$CLEANMAC" ]; then
        echo "❌ CleanMac.command non trovato in $SCRIPT_DIR" >&2
        exit 1
    fi

    mkdir -p "$HOME/Library/LaunchAgents"

    # Scarica una eventuale versione precedente prima di riscrivere
    launchctl unload "$PLIST_PATH" 2>/dev/null || true

    cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${CLEANMAC}</string>
        <string>--cleanup</string>
        <string>--categories=${categories}</string>
    </array>
    <key>StartInterval</key>
    <integer>${secs}</integer>
    <key>RunAtLoad</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${SCRIPT_DIR}/reports/scheduler.log</string>
    <key>StandardErrorPath</key>
    <string>${SCRIPT_DIR}/reports/scheduler.err</string>
</dict>
</plist>
PLIST

    launchctl load "$PLIST_PATH"
    echo "✅ Scheduler installato: $when (ogni ${secs}s) — categorie: ${categories}"
    echo "   LaunchAgent: $PLIST_PATH"
}

cmd_uninstall() {
    if [ -f "$PLIST_PATH" ]; then
        launchctl unload "$PLIST_PATH" 2>/dev/null || true
        rm -f "$PLIST_PATH"
        echo "✅ Scheduler disinstallato"
    else
        echo "ℹ️  Nessuno scheduler installato"
    fi
}

cmd_status() {
    if [ -f "$PLIST_PATH" ]; then
        echo "✅ Scheduler ATTIVO"
        echo "   LaunchAgent: $PLIST_PATH"
        if launchctl list 2>/dev/null | grep -q "$PLIST_LABEL"; then
            echo "   Stato launchctl: caricato"
        else
            echo "   Stato launchctl: NON caricato (esegui 'install' per ricaricare)"
        fi
    else
        echo "ℹ️  Scheduler non installato"
    fi
}

case "${1:-status}" in
    install)   cmd_install "${2:-weekly}" "${3:-CLEANUP}" ;;
    uninstall) cmd_uninstall ;;
    status)    cmd_status ;;
    *)
        echo "Uso: $0 {install [daily|weekly|monthly] [CATEGORIE] | uninstall | status}" >&2
        exit 1
        ;;
esac
