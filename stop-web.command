#!/bin/bash
# CleanMac Web Interface - Stop Script

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

PID_FILE="$SCRIPT_DIR/server.pid"

# Nessun PID file → prova a trovare il processo per porta
if [ ! -f "$PID_FILE" ]; then
    # Fallback: cerca processo node su porta 3000
    NODE_PID=$(lsof -ti :3000 2>/dev/null | head -1)
    if [ -n "$NODE_PID" ]; then
        kill -TERM "$NODE_PID" 2>/dev/null
        sleep 1
        kill -KILL "$NODE_PID" 2>/dev/null
        osascript -e 'display dialog "✅ Server fermato (trovato tramite porta 3000)" buttons {"OK"} default button "OK" with icon note giving up after 2'
    else
        osascript -e 'display dialog "ℹ️ Il server non è in esecuzione" buttons {"OK"} default button "OK" with icon note'
    fi
    exit 0
fi

SERVER_PID=$(cat "$PID_FILE")

if ps -p "$SERVER_PID" > /dev/null 2>&1; then
    # Termina il processo e tutti i suoi figli
    kill -TERM "$SERVER_PID" 2>/dev/null
    sleep 1
    # Se ancora vivo, forza kill
    if ps -p "$SERVER_PID" > /dev/null 2>&1; then
        kill -KILL "$SERVER_PID" 2>/dev/null
    fi
    # Pulisci anche eventuali processi node rimasti su porta 3000
    lsof -ti :3000 2>/dev/null | xargs kill -TERM 2>/dev/null
    rm -f "$PID_FILE"
    osascript -e 'display dialog "✅ Server fermato con successo!" buttons {"OK"} default button "OK" with icon note giving up after 2'
else
    rm -f "$PID_FILE"
    # Controlla se c'è ancora qualcosa sulla porta
    NODE_PID=$(lsof -ti :3000 2>/dev/null | head -1)
    if [ -n "$NODE_PID" ]; then
        kill -TERM "$NODE_PID" 2>/dev/null
        osascript -e 'display dialog "✅ Server fermato (processo orfano rimosso)" buttons {"OK"} default button "OK" with icon note giving up after 2'
    else
        osascript -e 'display dialog "ℹ️ Il server non era in esecuzione\n\n(PID file rimosso)" buttons {"OK"} default button "OK" with icon note'
    fi
fi

exit 0
