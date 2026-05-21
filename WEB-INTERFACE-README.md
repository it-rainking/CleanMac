# 🧹 CleanMac Web Interface v1.1
**Compatible with CleanMac v4.1**

Interfaccia web moderna per gestire CleanMac.command con funzionalità real-time.

## 📋 Caratteristiche

- ✨ **Interfaccia moderna e intuitiva** - Dashboard visuale con design responsive
- 🔄 **Aggiornamenti in tempo reale** - Log e statistiche aggiornate live via WebSocket
- 🔍 **Modalità Dry Run** - Analizza senza eliminare file
- ⚡ **Esecuzione diretta** - Pulizia effettiva con conferma
- 🔐 **Gestione password sicura** - Dialog password integrato per operazioni sudo (NEW!)
- 🖥️ **Esecuzione in background** - Server senza terminale visibile (NEW!)
- 📊 **Statistiche dettagliate** - Spazio liberato, tempo di esecuzione, operazioni completate
- 📄 **Cronologia report** - Accesso a tutti i report HTML generati
- 🎨 **Design moderno** - Gradiente viola/blu con animazioni fluide

## 🚀 Installazione

### Prerequisiti

- **Node.js** (v14 o superiore) - [Scarica qui](https://nodejs.org/)
- **macOS** con CleanMac.command installato

### Metodo Rapido (CONSIGLIATO) ⚡

1. **Doppio click** su `start-web.command`
2. Il server si avvierà automaticamente in background
3. Il browser si aprirà su `http://localhost:3000`
4. Fatto! 🎉

### Metodo Manuale (alternativo)

1. **Apri il Terminale** e vai nella cartella CleanMac:

```bash
cd /Volumes/Dati/Dropbox/GitHub/CleanMac
```

2. **Installa le dipendenze Node.js** (solo prima volta):

```bash
npm install
```

Questo installerà:
- `express` - Server web
- `socket.io` - WebSocket per comunicazione real-time

3. **Avvia il server:**

```bash
npm start
```

Vedrai:
```
╔════════════════════════════════════════╗
║                                        ║
║   🧹 CleanMac Web Interface v1.0      ║
║                                        ║
║   Server running on:                   ║
║   http://localhost:3000                ║
║                                        ║
╚════════════════════════════════════════╝
```

4. **Apri il browser** e vai su:

```
http://localhost:3000
```

### Fermare il Server

- Se avviato con `start-web.command`: doppio click su `stop-web.command`
- Se avviato da terminale: premi `CTRL+C` nel terminale

## 🎮 Come Usare

### 1. Scegli la Modalità

**🔍 Dry Run** (consigliato per la prima volta)
- Analizza il sistema senza eliminare nulla
- Mostra quanto spazio può essere liberato
- Completamente sicuro

**⚠️ Pulizia Diretta**
- Elimina effettivamente i file trovati
- Richiede conferma esplicita
- Usa dopo aver verificato il dry run

### 2. Avvia la Scansione

Clicca su **"Avvia Scansione"** e osserva:

- **Output Live**: Vedi i log in tempo reale come su terminale
- **Statistiche**: Spazio liberato/analizzato aggiornato live
- **Progresso**: Barra di avanzamento animata
- **Tempo**: Timer che mostra durata esecuzione

### 3. Inserisci Password (solo Pulizia Diretta)

Quando usi la modalità **Pulizia Diretta**, apparirà un dialog modale che ti chiederà:

🔐 **Password macOS**
- Inserisci la password del tuo utente
- La password viene usata per operazioni `sudo`
- Non viene salvata, solo utilizzata per la sessione corrente
- Trasmessa in modo sicuro via WebSocket criptato

Il dialog modale:
- Appare automaticamente all'inizio della pulizia
- Design moderno con animazione
- Supporto tasto INVIO per conferma rapida
- Possibilità di annullare l'operazione

### 4. Visualizza i Report

Dopo l'esecuzione:

- I report HTML vengono generati automaticamente
- Clicca su **"Visualizza"** per aprire un report
- La sezione "Cronologia Report" mostra tutti i report precedenti

### 5. Interrompi (se necessario)

- Clicca su **"Interrompi"** per fermare l'esecuzione in corso
- Conferma l'azione nel dialog

## 📁 Struttura del Progetto

```
CleanMac/
├── CleanMac.command          # Script bash originale
├── start-web.command         # Avvio rapido server (NEW!)
├── stop-web.command          # Ferma server (NEW!)
├── server.js                 # Server Node.js backend
├── package.json              # Dipendenze npm
├── WEB-INTERFACE-README.md   # Questa guida
└── public/                   # Frontend files
    ├── index.html            # Interfaccia principale
    ├── style.css             # Stili CSS (con modal password)
    └── app.js                # JavaScript client (gestione password)
```

## 🔧 API Endpoints

Il server espone queste API REST:

### `GET /api/status`
Ottieni stato del server e dello script
```json
{
  "running": false,
  "scriptPath": "/path/to/CleanMac.command",
  "scriptExists": true
}
```

### `POST /api/run`
Avvia esecuzione CleanMac
```json
{
  "dryRun": true  // true per Dry Run, false per Pulizia Diretta
}
```

### `GET /api/reports`
Lista tutti i report HTML generati
```json
[
  {
    "name": "cleanmac_2025-11-22_14-30-15.html",
    "path": "cleanmac_2025-11-22_14-30-15.html",
    "date": "2025-11-22T14:30:15.000Z",
    "size": 12345
  }
]
```

### `GET /api/reports/:filename`
Scarica/visualizza un report specifico

### `POST /api/stop`
Interrompi esecuzione in corso

## 🌐 WebSocket Events

Il client riceve aggiornamenti real-time via Socket.IO:

**Eventi dal Server → Client:**
- `execution:start` - Esecuzione avviata
- `execution:stdout` - Output standard dello script
- `execution:stderr` - Errori dello script
- `execution:complete` - Esecuzione completata
- `execution:error` - Errore durante esecuzione
- `request:password` - Richiesta password per sudo (NEW!)
- `password:error` - Password non valida (NEW!)

**Eventi dal Client → Server:**
- `password:submit` - Invio password al server (NEW!)
- `password:cancel` - Annullamento richiesta password (NEW!)

## 🎨 Personalizzazione

### Cambiare la Porta

Modifica [server.js](server.js:9):
```javascript
const PORT = 3000;  // Cambia con la porta desiderata
```

### Modificare lo Stile

Modifica [public/style.css](public/style.css) per personalizzare:
- Colori (variabili CSS in `:root`)
- Layout e spaziatura
- Animazioni e transizioni

### Aggiungere Funzionalità

Modifica [public/app.js](public/app.js) per:
- Nuove statistiche
- Grafici e visualizzazioni
- Esportazione dati

## ⚠️ Note Importanti

1. **Permessi sudo**: La modalità **Pulizia Diretta** richiede la password amministratore. Verrà richiesta tramite un dialog modale sicuro all'inizio dell'esecuzione. La password:
   - Non viene salvata su disco
   - Viene usata solo per la sessione corrente
   - Viene trasmessa via WebSocket (localhost)
   - Viene eliminata dalla memoria al termine

2. **Prima esecuzione**: Esegui sempre una **Dry Run** prima di fare una pulizia diretta, per verificare cosa verrà eliminato.

3. **Server in background**: Il server avviato con `start-web.command` gira in background senza finestra terminale visibile. Usa `stop-web.command` per fermarlo.

4. **Report**: I report HTML vengono salvati nella stessa cartella di CleanMac.command con timestamp nel nome.

5. **Sicurezza**: L'interfaccia web è pensata per uso locale (localhost). **Non esporre il server su internet** senza adeguate protezioni (HTTPS, autenticazione, firewall).

6. **Browser supportati**: Testato su Safari, Chrome, Firefox (ultime versioni). Richiede supporto WebSocket.

## 🐛 Risoluzione Problemi

### Il server non parte

```bash
# Verifica versione Node.js
node --version  # Deve essere >= v14

# Re-installa dipendenze
rm -rf node_modules package-lock.json
npm install
```

### "Script not found"

Assicurati che [CleanMac.command](CleanMac.command) sia nella stessa cartella di `server.js`.

### WebSocket non si connette

1. Controlla che il server sia in esecuzione
2. Verifica la porta nel browser (deve corrispondere)
3. Controlla la console browser per errori (F12 → Console)

### L'esecuzione si blocca

- Se appare il dialog password, inserisci la password macOS
- Se annulli la password, l'operazione viene interrotta
- Controlla il terminale dove hai avviato `npm start` (se avviato manualmente)
- Clicca "Interrompi" e riprova

### Il dialog password non appare

- Controlla la console del browser (F12 → Console)
- Verifica che la connessione WebSocket sia attiva
- Ricarica la pagina (⌘+R)

### Il server rimane attivo in background

```bash
# Trova e termina il processo
lsof -ti:3000 | xargs kill -9

# Oppure usa lo script dedicato
./stop-web.command
```

## 🔄 Aggiornamenti

### CleanMac v4.1 Compatibility (2025-12-31)
- ✅ **Supporto 29 operazioni** - Compatibile con CleanMac v4.1
- ✅ **Time Machine Snapshots** - Pulizia snapshot locali TM
- ✅ **Backup iOS/iPad** - Gestione backup iPhone/iPad
- ✅ **Analisi Swap/Sleepimage** - Monitoraggio memoria virtuale
- ✅ **Xcode esteso** - Archives + CoreSimulator

### v1.1 (2025-12-26)
- ✅ **Dialog password integrato** - Gestione sudo tramite web interface
- ✅ **Esecuzione in background** - Server senza terminale visibile
- ✅ **Script start/stop** - Avvio e arresto rapido del server
- ✅ **Miglioramenti sicurezza** - Gestione password in memoria

### v1.0 (2025-11-22)
- ✅ Interfaccia web completa
- ✅ Modalità Dry Run e Pulizia Diretta
- ✅ Log real-time via WebSocket
- ✅ Dashboard statistiche live
- ✅ Cronologia report HTML
- ✅ Design responsive

## 📞 Supporto

Per problemi o domande:
- Controlla i log nel terminale dove hai avviato il server
- Apri la Console del browser (F12) per errori JavaScript
- Verifica che CleanMac.command funzioni correttamente da terminale

## 📄 Licenza

MIT License - Usa liberamente per progetti personali e commerciali

---

**Fatto con ❤️ per rendere CleanMac ancora più facile da usare!**
