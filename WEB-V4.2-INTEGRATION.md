# 🌐 CleanMac v4.2 - Integrazione Web Interface

**Data**: 2025-12-31
**Versione Script**: 4.2
**Versione Server**: 1.2
**Status**: ✅ Backend Completato | 🚧 Frontend In Progress

---

## 📋 STATO IMPLEMENTAZIONE

### ✅ Completato

1. **Script CLI Parameters** (`CleanMac.command`)
   - Supporto parametri `--dry-run` / `--cleanup`
   - Supporto `--categories=CLEANUP,PERFORMANCE,ANALYSIS`
   - Supporto `--all` per eseguire tutto
   - Bypass dialog se in modalità CLI

2. **Backend API** (`server.js v1.2`)
   - Endpoint `/api/run` aggiornato per accettare `categories[]`
   - Passaggio parametri allo script bash
   - Compatibilità con v4.1 (backward compatible)

### 🚧 Da Completare

3. **Frontend UI** (`public/index.html` + JS/CSS)
   - Checkbox selezione categorie nel pannello control
   - Pre-selezione Performance di default
   - Visualizzazione MB per categoria nel dry run
   - Toast informativo categorie selezionate

---

## 🔧 IMPLEMENTAZIONE TECNICA

### 1. Script Bash - Parametri CLI

**File**: `CleanMac.command` (righe 217-275)

```bash
# Supporto parametri CLI (NEW v4.2 - Web Interface)
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
        --all)
            SELECTIVE_MODE=false
            CLI_MODE=true
            ;;
    esac
done
```

**Uso Esempi**:
```bash
# Dry run completo
./CleanMac.command --dry-run

# Pulizia solo CLEANUP + PERFORMANCE
./CleanMac.command --cleanup --categories=CLEANUP,PERFORMANCE

# Pulizia completa (tutte le 29 ops)
./CleanMac.command --cleanup --all
```

---

### 2. Backend Server - API Aggiornate

**File**: `server.js` (righe 161-176, 336-405)

#### Endpoint POST `/api/run`

**Request Body**:
```json
{
  "dryRun": true,
  "categories": ["CLEANUP", "PERFORMANCE"]
}
```

**Response**:
```json
{
  "status": "started",
  "dryRun": true,
  "categories": ["CLEANUP", "PERFORMANCE"],
  "message": "Script execution started"
}
```

#### Funzione `runCleanMac(dryRun, categories)`

```javascript
async function runCleanMac(dryRun = true, categories = []) {
  // Prepara argomenti CLI
  const scriptArgs = [];

  // Flag dry-run o cleanup
  if (dryRun) {
    scriptArgs.push('--dry-run');
  } else {
    scriptArgs.push('--cleanup');
  }

  // Categorie
  if (categories && categories.length > 0) {
    const categoriesStr = categories.join(',');
    scriptArgs.push(`--categories=${categoriesStr}`);
  } else if (!dryRun) {
    scriptArgs.push('--all');
  }

  console.log('Esecuzione script con argomenti:', scriptArgs);

  // Spawn bash con parametri
  currentExecution = spawn('bash', [SCRIPT_PATH, ...scriptArgs], spawnOptions);
}
```

---

### 3. Frontend UI - TODO

#### 3.1 Pannello Selezione Categorie

**Posizione**: Nel pannello di controllo, dopo i pulsanti Dry Run / Pulizia Diretta

```html
<!-- Aggiungere in public/index.html dopo #control-panel -->
<div id="category-selection" class="category-panel" style="margin-top: 20px;">
  <h3>🎯 Seleziona Categorie (v4.2)</h3>
  <div class="category-checkboxes">
    <label class="category-checkbox">
      <input type="checkbox" name="category" value="CLEANUP" checked>
      <span class="category-label">
        <span class="category-icon">🗑️</span>
        <span class="category-name">PULIZIA</span>
        <span class="category-desc">Libera spazio disco</span>
        <span class="category-mb" id="cleanup-mb">- MB</span>
      </span>
    </label>

    <label class="category-checkbox default-checked">
      <input type="checkbox" name="category" value="PERFORMANCE" checked>
      <span class="category-label">
        <span class="category-icon">⚡</span>
        <span class="category-name">PERFORMANCE</span>
        <span class="category-desc">Migliora velocità (consigliato)</span>
        <span class="category-mb">0 MB</span>
      </span>
    </label>

    <label class="category-checkbox">
      <input type="checkbox" name="category" value="ANALYSIS" checked>
      <span class="category-label">
        <span class="category-icon">📊</span>
        <span class="category-name">ANALISI</span>
        <span class="category-desc">Genera report</span>
        <span class="category-mb">0 MB</span>
      </span>
    </label>
  </div>

  <div class="category-info">
    <small>
      💡 <strong>Suggerimento</strong>: Performance è pre-selezionata per migliorare velocità senza eliminare file.
    </small>
  </div>
</div>
```

#### 3.2 CSS Styles

```css
.category-panel {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
  border-radius: 12px;
  color: white;
}

.category-panel h3 {
  margin-top: 0;
  margin-bottom: 15px;
  font-size: 18px;
}

.category-checkboxes {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.category-checkbox {
  display: flex;
  align-items: center;
  padding: 12px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.category-checkbox:hover {
  background: rgba(255, 255, 255, 0.15);
}

.category-checkbox.default-checked {
  background: rgba(255, 255, 255, 0.2);
  border: 2px solid rgba(255, 255, 255, 0.5);
}

.category-label {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  margin-left: 10px;
}

.category-icon {
  font-size: 24px;
}

.category-name {
  font-weight: bold;
  min-width: 120px;
}

.category-desc {
  flex: 1;
  opacity: 0.9;
}

.category-mb {
  font-weight: bold;
  background: rgba(0, 0, 0, 0.2);
  padding: 4px 12px;
  border-radius: 12px;
}

.category-info {
  margin-top: 15px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  font-size: 13px;
}
```

#### 3.3 JavaScript Logic

```javascript
// In public/script.js (o index.html <script>)

// Funzione per ottenere categorie selezionate
function getSelectedCategories() {
  const checkboxes = document.querySelectorAll('input[name="category"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

// Modificare funzione runScan per includere categorie
async function runScan(dryRun) {
  const categories = getSelectedCategories();

  // Mostra quali categorie sono selezionate
  const categoryNames = categories.map(c => {
    switch(c) {
      case 'CLEANUP': return '🗑️ Pulizia';
      case 'PERFORMANCE': return '⚡ Performance';
      case 'ANALYSIS': return '📊 Analisi';
      default: return c;
    }
  }).join(', ');

  showToast(`Avvio ${dryRun ? 'analisi' : 'pulizia'} con: ${categoryNames}`, 'info');

  const response = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dryRun,
      categories
    })
  });

  // ... resto logica esistente
}

// Aggiornare MB per categoria dopo dry run
socket.on('execution:complete', (data) => {
  if (data.success && data.dryRun) {
    // Parse log per estrarre MB categorie
    // Esempio: cercare "PULIZIA: 12000 MB" nel log
    parseCategoryMB(logOutput);
  }
});

function parseCategoryMB(logText) {
  const cleanupMatch = logText.match(/PULIZIA.*?(\d+)\s*MB/);
  const perfMatch = logText.match(/PERFORMANCE.*?(\d+)\s*MB/);
  const analysisMatch = logText.match(/ANALISI.*?(\d+)\s*MB/);

  if (cleanupMatch) {
    document.getElementById('cleanup-mb').textContent = `${cleanupMatch[1]} MB`;
  }
  if (perfMatch) {
    // Performance è sempre 0 MB
  }
  if (analysisMatch) {
    // Analysis è sempre 0 MB
  }
}
```

---

## 🎯 WORKFLOW UTENTE WEB v4.2

### Scenario 1: Dry Run + Selezione Personalizzata

1. Utente apre web interface (`http://localhost:3000`)
2. Vede pannello con 3 checkbox:
   - ☑ 🗑️ PULIZIA (checked)
   - ☑ ⚡ PERFORMANCE (checked, consigliato)
   - ☑ 📊 ANALISI (checked)
3. Click "Avvia Dry Run"
4. Log in tempo reale mostra:
   ```
   🔍 DRY RUN COMPLETATO
   📊 SPAZIO TOTALE: 15234 MB
   🗑️ PULIZIA: 14980 MB
   ⚡ PERFORMANCE: 0 MB
   📊 ANALISI: 0 MB
   ```
5. MB appaiono nei badge delle categorie
6. Utente deseleziona "ANALISI"
7. Click "Avvia Pulizia Diretta"
8. Dialog password
9. Script eseguito con `--categories=CLEANUP,PERFORMANCE`
10. Solo operazioni selezionate eseguite

### Scenario 2: Solo Performance (Velocità)

1. Deseleziona PULIZIA e ANALISI
2. Lascia solo ⚡ PERFORMANCE
3. Click "Avvia Pulizia Diretta"
4. Script eseguito con `--categories=PERFORMANCE`
5. Risultato:
   - RAM ottimizzata
   - Spotlight ricostruito
   - DNS flush
   - LaunchServices rebuild
   - Permessi riparati
   - **Nessun file eliminato**

---

## 🧪 TESTING

### Test Backend
```bash
# Terminal 1 - Start server
cd /Volumes/Dati/Dropbox/GitHub/CleanMac
node server.js

# Terminal 2 - Test API
curl -X POST http://localhost:3000/api/run \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true, "categories": ["CLEANUP", "PERFORMANCE"]}'
```

### Test Script CLI
```bash
# Test dry run con categorie
./CleanMac.command --dry-run --categories=CLEANUP,PERFORMANCE

# Verifica log output:
# - "Modalità CLI: DRY RUN" ✅
# - "Categorie abilitate via CLI: CLEANUP,PERFORMANCE" ✅
# - Nessun dialog interattivo ✅
```

### Test Frontend (dopo implementazione UI)
1. Aprire `http://localhost:3000`
2. Verificare pannello categorie visibile
3. Click checkbox → verifica stato saved
4. Dry Run → verifica MB aggiornati
5. Pulizia Diretta → verifica categorie passate correttamente
6. Log → verifica ops saltate mostrano "non selezionata"

---

## 📊 COMPATIBILITÀ

### Backward Compatible con v4.1
✅ Web interface senza categorie funziona ancora:
```javascript
// Request senza categories
{ "dryRun": true }

// Script eseguito:
./CleanMac.command --dry-run
// = Tutte le 29 operazioni in dry run (comportamento v4.1)
```

### Forward Compatible
✅ GUI tradizionale funziona ancora normalmente
✅ Script eseguito senza parametri → dialog interattivi
✅ Script eseguito con CLI → bypass dialog

---

## 🚀 PROSSIMI STEP

1. **Frontend UI** (priorità alta)
   - [ ] Aggiungere HTML categorie in `public/index.html`
   - [ ] Aggiungere CSS in `public/styles.css` o inline
   - [ ] Aggiornare JS in `public/script.js` per gestire checkbox
   - [ ] Implementare parsing MB da log per aggiornare badge

2. **Testing**
   - [ ] Test completo workflow web
   - [ ] Test tutte le combinazioni categorie
   - [ ] Test password dialog con categorie
   - [ ] Test backward compatibility (senza categorie)

3. **Documentazione**
   - [ ] Screenshot UI v4.2
   - [ ] Video demo (opzionale)
   - [ ] Aggiornare `WEB-INTERFACE-README.md`

---

**Autore**: Claude Code Assistant
**Data**: 2025-12-31
**Versione**: 4.2 Web Integration
