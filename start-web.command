#!/bin/bash
# CleanMac Web Interface - Quick Start Script

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="$SCRIPT_DIR/server.log"
PID_FILE="$SCRIPT_DIR/server.pid"

# ── PATH: aggiungi percorsi comuni per node (Homebrew + nvm + volta) ──────────
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# nvm: carica e metti il bin nel PATH
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    source "$NVM_DIR/nvm.sh" --no-use
    # Usa il default nvm, oppure la versione più recente disponibile
    NVM_DEFAULT=$(cat "$NVM_DIR/alias/default" 2>/dev/null | tr -d '\n')
    if [ -n "$NVM_DEFAULT" ]; then
        NVM_NODE_DIR="$NVM_DIR/versions/node/$NVM_DEFAULT/bin"
        [ -d "$NVM_NODE_DIR" ] && export PATH="$NVM_NODE_DIR:$PATH"
    else
        # Prendi la versione più recente installata
        NVM_LATEST=$(ls -1 "$NVM_DIR/versions/node/" 2>/dev/null | sort -V | tail -1)
        [ -n "$NVM_LATEST" ] && export PATH="$NVM_DIR/versions/node/$NVM_LATEST/bin:$PATH"
    fi
fi

# volta
[ -d "$HOME/.volta/bin" ] && export PATH="$HOME/.volta/bin:$PATH"

# ── Cerca node ────────────────────────────────────────────────────────────────
show_dialog() {
    osascript -e "display dialog \"$1\" buttons {\"OK\"} default button \"OK\" with icon note"
}

if ! NODE_BIN=$(command -v node 2>/dev/null); then
    show_dialog "❌ Node.js non trovato!

Per usare l'interfaccia web, installa Node.js da:
https://nodejs.org/

(oppure via Homebrew: brew install node)"
    exit 1
fi

NODE_VERSION=$("$NODE_BIN" --version 2>/dev/null)
NPM_BIN=$(command -v npm 2>/dev/null)

# ── Installa dipendenze se mancanti ──────────────────────────────────────────
if [ ! -d "node_modules" ]; then
    osascript -e 'display dialog "📦 Prima installazione\n\nInstallazione dipendenze in corso..." buttons {"OK"} default button "OK" with icon note giving up after 3'
    "$NPM_BIN" install >> "$LOG_FILE" 2>&1

    if [ ! -d "node_modules" ]; then
        show_dialog "❌ Errore durante l'installazione delle dipendenze

Controlla il file server.log per dettagli."
        exit 1
    fi
fi

# ── Server già in esecuzione → apri solo il browser ──────────────────────────
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        open http://localhost:3000
        exit 0
    else
        rm -f "$PID_FILE"
    fi
fi

# ── Avvia il server (usa node direttamente, path assoluto) ───────────────────
nohup "$NODE_BIN" "$SCRIPT_DIR/server.js" >> "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > "$PID_FILE"

# ── Attendi che la porta sia pronta (max 10 secondi) ─────────────────────────
READY=false
for i in $(seq 1 10); do
    sleep 1
    # Controlla che il processo sia ancora vivo
    if ! ps -p "$SERVER_PID" > /dev/null 2>&1; then
        show_dialog "❌ Il server si è fermato subito dopo l'avvio.

Controlla server.log per i dettagli dell'errore."
        rm -f "$PID_FILE"
        exit 1
    fi
    # Controlla che la porta 3000 sia in ascolto
    if lsof -i :3000 -sTCP:LISTEN > /dev/null 2>&1; then
        READY=true
        break
    fi
done

if [ "$READY" = false ]; then
    show_dialog "⚠️ Il server è avviato ma la porta 3000 non risponde ancora.
Prova ad aprire http://localhost:3000 tra qualche secondo."
fi

# ── Apri browser ─────────────────────────────────────────────────────────────
open http://localhost:3000

osascript -e "display dialog \"✅ CleanMac Web avviato!

🌐 http://localhost:3000
🟢 Node.js $NODE_VERSION

Per fermare il server esegui: stop-web.command\" buttons {\"OK\"} default button \"OK\" with icon note giving up after 4"

exit 0
