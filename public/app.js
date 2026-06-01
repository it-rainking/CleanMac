// CleanMac Web Interface - Client Application
// WebSocket connection
const socket = io();

// State
let isRunning = false;
let startTime = null;
let timerInterval = null;
let stats = {
    spaceSaved: 0,
    operations: 0,
    files: 0,
    cacheCleared: 0
};
let currentAnalysisFiles = null; // Store analysis files for modal access

// Mappa descrizioni umane per ogni op_id
const OP_DESCRIPTIONS = {
    op01: { name: 'Analisi disco', desc: 'Scansiona Desktop, Downloads e Documents per vedere quanto spazio occupano.', icon: '📊' },
    op02: { name: 'Cache utente', desc: 'File temporanei creati dalle app nel tuo profilo utente (~Library/Caches). Sicuro da eliminare.', icon: '🗑️' },
    op03: { name: 'Cache sistema', desc: 'Cache di sistema in /Library/Caches. Le app le ricreano automaticamente.', icon: '🗑️' },
    op04: { name: 'Log di sistema', desc: 'File di log accumulati dal sistema e dalle app. Non servono per il funzionamento normale.', icon: '📄' },
    op05: { name: 'Cache Safari', desc: 'Cronologia, cache e sessioni di Safari. Le pagine web si ricaricheranno più lentamente la prima volta.', icon: '🌐' },
    op06: { name: 'Xcode cache', desc: 'DerivedData, archivi e simulatori iOS di Xcode. Si possono ricreare compilando i progetti.', icon: '🔨' },
    op07: { name: 'File .DS_Store', desc: 'File nascosti creati da Finder per memorizzare preferenze cartelle. Inutili e proliferano ovunque.', icon: '🗂️' },
    op08: { name: 'Cartelle temp', desc: 'File temporanei in /tmp e /private/var/folders. Normalmente si svuotano al riavvio.', icon: '🗑️' },
    op09: { name: 'Cestino', desc: 'Svuota il Cestino di tutti gli utenti. I file eliminati non sono recuperabili.', icon: '🗑️' },
    op10: { name: 'File grandi (>500MB)', desc: 'Individua file che occupano più di 500MB. Non li elimina: apre una lista per scegliere.', icon: '📦' },
    op11: { name: 'File inutili', desc: 'File .pkg, .dmg, .zip, .bak e altri file di installazione ormai inutili.', icon: '🗑️' },
    op12: { name: 'Cache app', desc: 'Cache di Slack, Discord, VSCode, Chrome, Firefox, Spotify, Teams, Zoom, Telegram, Notion, WhatsApp.', icon: '📱' },
    op13: { name: 'Log vecchi', desc: 'File di log più vecchi di 7 giorni. Non servono per il funzionamento normale.', icon: '📄' },
    op14: { name: 'Download vecchi', desc: 'File nella cartella Downloads più vecchi di 30 giorni. Verifica prima di eliminare.', icon: '📥' },
    op15: { name: 'App non usate', desc: 'App non aperte negli ultimi 30 giorni. Non le elimina: apre una lista per scegliere.', icon: '🖥️' },
    op16: { name: 'Backup configurazioni', desc: 'Crea un backup di .zshrc, .gitconfig e .ssh/config prima di qualsiasi pulizia.', icon: '💾' },
    op17: { name: 'File duplicati', desc: 'Cerca file con lo stesso contenuto (stesso hash). Mostra i gruppi trovati.', icon: '👥' },
    op18: { name: 'Ottimizza RAM', desc: 'Libera la memoria RAM inattiva con il comando purge. Effetto temporaneo.', icon: '⚡' },
    op19: { name: 'LaunchServices', desc: 'Ricostruisce il database delle associazioni file. Risolve problemi con "Apri con…".', icon: '⚡' },
    op20: { name: 'Permessi utente', desc: 'Ripara i permessi della cartella home. Risolve problemi di accesso ai file.', icon: '🔒' },
    op21: { name: 'Flush DNS', desc: 'Svuota la cache DNS. Utile dopo cambio DNS o problemi di rete.', icon: '🌐' },
    op22: { name: 'Reset Spotlight', desc: 'Reindicizza Spotlight. La ricerca sarà lenta per qualche minuto dopo.', icon: '🔍' },
    op23: { name: 'Cache font', desc: 'Cache dei font di sistema. Si ricostruisce automaticamente al prossimo avvio.', icon: '🔤' },
    op24: { name: 'Cache sviluppo', desc: 'Cache di npm, yarn, pip e pnpm. Si ricostruisce con la prossima installazione pacchetti.', icon: '💻' },
    op25: { name: 'Docker', desc: 'Immagini, container e volumi Docker non utilizzati. Recupera spazio significativo.', icon: '🐳' },
    op26: { name: 'Homebrew', desc: 'Formula obsolete e cache di download di Homebrew.', icon: '🍺' },
    op27: { name: 'Time Machine', desc: 'Snapshot locali di Time Machine. Si riaccumulano automaticamente.', icon: '⏰' },
    op28: { name: 'Backup iOS', desc: 'Backup iPhone/iPad salvati sul Mac tramite Finder o iTunes.', icon: '📱' },
    op29: { name: 'Swap e Sleepimage', desc: 'File swap e sleepimage. Sleepimage serve per l\'ibernazione: rimuoverlo disabilita l\'ibernazione profonda.', icon: '💤' },
    op30: { name: 'Mail attachments', desc: 'Allegati email scaricati da Mail.app in ~/Library/Mail Downloads.', icon: '📧' },
    op31: { name: 'Spazio APFS Purgeable', desc: 'Spazio APFS occupato da dati recuperabili (snapshot, cache APFS). macOS lo libera automaticamente se necessario.', icon: '💿' },
};

// DOM Elements
const elements = {
    statusIndicator: document.getElementById('statusIndicator'),
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn'),
    clearLogBtn: document.getElementById('clearLogBtn'),
    outputLog: document.getElementById('outputLog'),
    progressContainer: document.getElementById('progressContainer'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    spaceSaved: document.getElementById('spaceSaved'),
    executionTime: document.getElementById('executionTime'),
    operationsCount: document.getElementById('operationsCount'),
    filesProcessed: document.getElementById('filesProcessed'),
    cacheCleared: document.getElementById('cacheCleared'),
    reportsList: document.getElementById('reportsList'),
    refreshReportsBtn: document.getElementById('refreshReportsBtn'),
    deleteAllReportsBtn: document.getElementById('deleteAllReportsBtn'),
    toastContainer: document.getElementById('toastContainer'),
    analyzeBtn: document.getElementById('analyzeBtn'),
    insightsContent: document.getElementById('insightsContent')
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    loadReports();
    checkServerStatus();
    // Load insights on startup if analysis files exist
    analyzeReports();
});

// Event Listeners
function initEventListeners() {
    elements.startBtn.addEventListener('click', handleStart);
    elements.stopBtn.addEventListener('click', handleStop);
    elements.clearLogBtn.addEventListener('click', clearLog);
    elements.refreshReportsBtn.addEventListener('click', loadReports);
    elements.deleteAllReportsBtn.addEventListener('click', deleteAllReports);
    elements.analyzeBtn.addEventListener('click', analyzeReports);

    // Shutdown completo del server
    const shutdownBtn = document.getElementById('shutdownBtn');
    if (shutdownBtn) {
        shutdownBtn.addEventListener('click', async () => {
            if (!confirm('Fermare CleanMac e spegnere il server?')) return;
            try {
                await fetch('/api/shutdown', { method: 'POST' });
                addLog('warning', 'Server in arresto...');
                setTimeout(() => {
                    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#fff;background:#1a1a2e;font-size:1.5rem;">CleanMac spento. Puoi chiudere questa finestra.</div>';
                }, 800);
            } catch (e) {
                addLog('error', 'Errore shutdown: ' + e.message);
            }
        });
    }

    // WebSocket events
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('execution:start', handleExecutionStart);
    socket.on('execution:stdout', handleStdout);
    socket.on('execution:stderr', handleStderr);
    socket.on('execution:complete', handleExecutionComplete);
    socket.on('execution:error', handleExecutionError);
    socket.on('dryrun:results', ({ ops }) => renderDryRunResults(ops));

    // Pulsanti pannello dry run
    const selectAllOpsBtn = document.getElementById('selectAllOpsBtn');
    const deselectAllOpsBtn = document.getElementById('deselectAllOpsBtn');
    const cleanSelectedBtn = document.getElementById('cleanSelectedBtn');

    if (selectAllOpsBtn) selectAllOpsBtn.addEventListener('click', () => {
        document.querySelectorAll('.op-checkbox:not(:disabled)').forEach(cb => cb.checked = true);
        updateSelectedTotal();
    });
    if (deselectAllOpsBtn) deselectAllOpsBtn.addEventListener('click', () => {
        document.querySelectorAll('.op-checkbox:not(:disabled)').forEach(cb => cb.checked = false);
        updateSelectedTotal();
    });
    if (cleanSelectedBtn) cleanSelectedBtn.addEventListener('click', handleCleanSelected);
}

// Render risultati dry run (lista selezionabile)
function renderDryRunResults(ops) {
    const panel = document.getElementById('dryrunPanel');
    const list = document.getElementById('opsSelectionList');
    if (!panel || !list) return;

    const categories = { CLEANUP: [], PERFORMANCE: [], ANALYSIS: [], UTILITY: [] };
    ops.forEach(op => {
        if (categories[op.category]) categories[op.category].push(op);
    });

    const catLabels = {
        CLEANUP: { label: '🗑️ Pulizia', color: 'var(--danger, #ef4444)' },
        PERFORMANCE: { label: '⚡ Performance', color: '#f59e0b' },
        ANALYSIS: { label: '📊 Analisi', color: '#60a5fa' },
        UTILITY: { label: '💾 Utility', color: '#34d399' },
    };

    let html = '';
    for (const [cat, catOps] of Object.entries(categories)) {
        if (!catOps.length) continue;
        const { label, color } = catLabels[cat];
        html += `<div class="ops-category"><h4 style="color:${color}">${label}</h4>`;
        catOps.forEach(op => {
            const info = OP_DESCRIPTIONS[op.id] || { name: op.desc, desc: '', icon: '⚙️' };
            const isAnalysisOrUtility = cat === 'ANALYSIS' || cat === 'UTILITY';
            const canSelect = (cat === 'CLEANUP' && op.mb > 0) || cat === 'PERFORMANCE';
            const checked = canSelect ? 'checked' : '';
            const disabled = !canSelect ? 'disabled' : '';
            const mbText = op.mb > 0
                ? `<span class="op-mb">${op.mb} MB</span>`
                : `<span class="op-mb muted">–</span>`;
            html += `
                <label class="op-item ${isAnalysisOrUtility ? 'op-analysis' : ''}" title="${escapeHtml(info.desc)}">
                    <input type="checkbox" class="op-checkbox" data-op="${op.id}" data-mb="${op.mb}" data-cat="${cat}" ${checked} ${disabled}>
                    <span class="op-icon">${info.icon}</span>
                    <span class="op-details">
                        <span class="op-name">${escapeHtml(info.name)}</span>
                        <span class="op-desc">${escapeHtml(info.desc)}</span>
                    </span>
                    ${mbText}
                </label>`;
        });
        html += '</div>';
    }

    list.innerHTML = html;
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    list.querySelectorAll('.op-checkbox').forEach(cb => {
        cb.addEventListener('change', updateSelectedTotal);
    });
    updateSelectedTotal();
}

function updateSelectedTotal() {
    const checked = document.querySelectorAll('.op-checkbox:checked:not(:disabled)');
    const total = Array.from(checked).reduce((sum, cb) => sum + (parseInt(cb.dataset.mb) || 0), 0);
    const totalEl = document.getElementById('selectedSpaceTotal');
    const btn = document.getElementById('cleanSelectedBtn');
    if (totalEl) totalEl.textContent = total > 0 ? `${total.toLocaleString()} MB selezionati` : `${checked.length} operazioni selezionate`;
    if (btn) btn.disabled = checked.length === 0;
}

async function handleCleanSelected() {
    const selectedOps = Array.from(document.querySelectorAll('.op-checkbox:checked:not(:disabled)'))
        .map(cb => cb.dataset.op);
    if (!selectedOps.length) return;

    if (!confirm(`Avviare la pulizia di ${selectedOps.length} operazioni selezionate?\n\nQuesta operazione è IRREVERSIBILE.`)) return;

    document.getElementById('dryrunPanel').style.display = 'none';

    // Reset stats
    stats = { spaceSaved: 0, operations: 0, files: 0, cacheCleared: 0 };
    updateStats();

    try {
        const response = await fetch('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dryRun: false, selectedOps })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Errore sconosciuto');
    } catch (error) {
        showToast('error', 'Errore di Avvio', error.message);
    }
}

// WebSocket Handlers
function handleConnect() {
    updateStatus('connected', 'Connesso al Server');
    showToast('success', 'Connessione Stabilita', 'Server raggiunto con successo');
}

function handleDisconnect() {
    updateStatus('error', 'Disconnesso');
    showToast('error', 'Connessione Persa', 'Tentativo di riconnessione...');
}

function handleExecutionStart(data) {
    isRunning = true;
    startTime = new Date();
    startTimer();

    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    elements.progressContainer.style.display = 'block';

    updateStatus('running', 'Esecuzione in corso...');

    const mode = data.dryRun ? 'Dry Run' : 'Pulizia Diretta';
    addLog('info', `Avvio esecuzione in modalità: ${mode}`);

    showToast('info', 'Esecuzione Avviata', `Modalità: ${mode}`);
}

function handleStdout(data) {
    const lines = data.data.split('\n');
    lines.forEach(line => {
        if (line.trim()) {
            parseAndAddLog(line);
        }
    });

    // Auto-scroll to bottom
    elements.outputLog.scrollTop = elements.outputLog.scrollHeight;
}

function handleStderr(data) {
    const lines = data.data.split('\n');
    lines.forEach(line => {
        if (line.trim()) {
            addLog('error', line);
        }
    });
}

function handleExecutionComplete(data) {
    isRunning = false;
    stopTimer();

    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    elements.progressContainer.style.display = 'none';

    updateStatus('connected', 'Completato');

    if (data.success) {
        addLog('success', '═══════════════════════════════════════');
        addLog('success', '✅ ESECUZIONE COMPLETATA CON SUCCESSO');
        addLog('success', '═══════════════════════════════════════');
        showToast('success', 'Completato!', 'Operazione terminata con successo');
    } else {
        addLog('error', '❌ Esecuzione terminata con errori (codice: ' + data.code + ')');
        showToast('error', 'Errore', 'Esecuzione terminata con errori');
    }

    // Reload reports and analyze after completion
    setTimeout(() => {
        loadReports();
        analyzeReports();
    }, 2000);
}

function handleExecutionError(data) {
    isRunning = false;
    stopTimer();

    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    elements.progressContainer.style.display = 'none';

    updateStatus('error', 'Errore');
    addLog('error', `❌ Errore: ${data.error}`);
    showToast('error', 'Errore di Esecuzione', data.error);
}

// Category Selection (v4.2)
function getSelectedCategories() {
    const checkboxes = document.querySelectorAll('input[name="category"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

function getCategoryDisplayNames(categories) {
    const names = {
        'CLEANUP': '🗑️ Pulizia',
        'PERFORMANCE': '⚡ Performance',
        'ANALYSIS': '📊 Analisi'
    };
    return categories.map(c => names[c] || c).join(', ');
}

// Action Handlers
async function handleStart() {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const dryRun = mode === 'dryrun';

    // Get selected categories (v4.2)
    const categories = getSelectedCategories();

    if (categories.length === 0) {
        showToast('warning', 'Attenzione', 'Seleziona almeno una categoria');
        return;
    }

    if (!dryRun) {
        const confirmed = confirm(
            '⚠️ ATTENZIONE!\n\n' +
            'Stai per avviare una PULIZIA DIRETTA.\n' +
            'I file verranno eliminati permanentemente.\n\n' +
            'Sei sicuro di voler continuare?'
        );

        if (!confirmed) {
            return;
        }
    }

    // Reset stats
    stats = { spaceSaved: 0, operations: 0, files: 0, cacheCleared: 0 };
    updateStats();

    // Nascondi pannello dry run da run precedente
    const dryPanel = document.getElementById('dryrunPanel');
    if (dryPanel) dryPanel.style.display = 'none';

    // Show which categories are selected
    const categoryNames = getCategoryDisplayNames(categories);
    showToast('info', 'Avvio Esecuzione', `Categorie: ${categoryNames}`);

    try {
        const response = await fetch('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dryRun,
                categories  // v4.2: pass selected categories to backend
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Errore sconosciuto');
        }
    } catch (error) {
        showToast('error', 'Errore di Avvio', error.message);
    }
}

async function handleStop() {
    if (!confirm('Sei sicuro di voler interrompere l\'esecuzione?')) {
        return;
    }

    try {
        const response = await fetch('/api/stop', { method: 'POST' });
        const data = await response.json();

        if (response.ok) {
            showToast('warning', 'Interrotto', 'Esecuzione interrotta dall\'utente');
        }
    } catch (error) {
        showToast('error', 'Errore', error.message);
    }
}

// Category MB parsing (v4.2)
function parseCategoryMB(line) {
    // Parse category summary lines from dry run output
    // Example: "🗑️  PULIZIA (libera spazio): 14980 MB"
    const cleanupMatch = line.match(/🗑️\s*PULIZIA.*?:\s*(\d+)\s*MB/i);
    if (cleanupMatch) {
        const mb = parseInt(cleanupMatch[1]);
        const badge = document.getElementById('cleanup-mb');
        if (badge) {
            badge.textContent = `${mb.toLocaleString()} MB`;
        }
        return true;
    }

    const perfMatch = line.match(/⚡\s*PERFORMANCE.*?:\s*(\d+)\s*MB/i);
    if (perfMatch) {
        // Performance is always 0 MB, but we show it
        return true;
    }

    const analysisMatch = line.match(/📊\s*ANALYSIS.*?:\s*(\d+)\s*MB/i);
    if (analysisMatch) {
        // Analysis is always 0 MB, but we show it
        return true;
    }

    return false;
}

// Log Functions
function parseAndAddLog(line) {
    // Parse different log types
    if (line.includes('✅') || line.includes('completata') || line.includes('COMPLETATO')) {
        addLog('success', line);
        stats.operations++;
        updateStats();
    } else if (line.includes('⚠️') || line.includes('WARNING')) {
        addLog('warning', line);
    } else if (line.includes('❌') || line.includes('ERROR')) {
        addLog('error', line);
    } else if (line.includes('═══')) {
        addLog('info', line);
    } else {
        addLog('info', line);
    }

    // Parse category MB badges (v4.2)
    parseCategoryMB(line);

    // Extract space information
    const spaceMatch = line.match(/(\d+)\s*MB/i);
    if (spaceMatch) {
        const mb = parseInt(spaceMatch[1]);
        if (mb > 0) {
            stats.spaceSaved += mb;

            // Track cache-specific operations
            if (line.toLowerCase().includes('cache') ||
                line.toLowerCase().includes('caches')) {
                stats.cacheCleared += mb;
            }

            updateStats();
        }
    }

    // Extract file counts
    const fileMatch = line.match(/(\d+)\s*file/i);
    if (fileMatch) {
        const count = parseInt(fileMatch[1]);
        if (count > 0) {
            stats.files += count;
            updateStats();
        }
    }
}

function addLog(type, message) {
    const time = new Date().toLocaleTimeString('it-IT', { hour12: false });
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;

    entry.innerHTML = `
        <span class="log-time">[${time}]</span>
        <span class="log-message">${escapeHtml(message)}</span>
    `;

    elements.outputLog.appendChild(entry);

    // Keep only last 500 entries
    while (elements.outputLog.children.length > 500) {
        elements.outputLog.removeChild(elements.outputLog.firstChild);
    }
}

function clearLog() {
    elements.outputLog.innerHTML = `
        <div class="log-entry log-info">
            <span class="log-time">[--:--:--]</span>
            <span class="log-message">Log ripulito. In attesa di nuove operazioni...</span>
        </div>
    `;
    stats = { spaceSaved: 0, operations: 0, files: 0, cacheCleared: 0 };
    updateStats();

    // Reset category MB badges (v4.2)
    const cleanupBadge = document.getElementById('cleanup-mb');
    if (cleanupBadge) {
        cleanupBadge.textContent = '-- MB';
    }
}

// Stats & Timer
function updateStats() {
    elements.spaceSaved.textContent = `${stats.spaceSaved.toLocaleString()} MB`;
    elements.operationsCount.textContent = stats.operations;
    elements.filesProcessed.textContent = stats.files.toLocaleString();
    elements.cacheCleared.textContent = `${stats.cacheCleared.toLocaleString()} MB`;
}

function startTimer() {
    timerInterval = setInterval(() => {
        if (startTime) {
            const elapsed = Math.floor((new Date() - startTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            elements.executionTime.textContent =
                `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// Status
function updateStatus(type, text) {
    elements.statusIndicator.className = `status-indicator ${type}`;
    elements.statusIndicator.querySelector('.status-text').textContent = text;
}

// Reports
async function loadReports() {
    try {
        const response = await fetch('/api/reports');
        const reports = await response.json();

        if (reports.length === 0) {
            elements.reportsList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <p>Nessun report disponibile</p>
                    <small>Esegui una scansione per generare il primo report</small>
                </div>
            `;
        } else {
            elements.reportsList.innerHTML = reports.map(report => `
                <div class="report-item">
                    <div class="report-info">
                        <div class="report-name">📄 ${report.name}</div>
                        <div class="report-meta">
                            ${new Date(report.date).toLocaleString('it-IT')} •
                            ${formatFileSize(report.size)}
                        </div>
                    </div>
                    <div class="report-actions">
                        <a href="/api/reports/${report.name}" target="_blank" class="btn-link">
                            👁️ Visualizza
                        </a>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading reports:', error);
        showToast('error', 'Errore', 'Impossibile caricare i report');
    }
}

async function deleteAllReports() {
    // Confirm deletion
    const confirmed = confirm(
        '⚠️ ATTENZIONE!\n\n' +
        'Stai per eliminare TUTTI i report generati da CleanMac.\n' +
        'Questa operazione è IRREVERSIBILE.\n\n' +
        'Vuoi continuare?'
    );

    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch('/api/reports/delete-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const result = await response.json();

        if (response.ok) {
            showToast('success', 'Completato', `${result.deleted} report eliminati`);
            loadReports();
            // Clear insights since reports are gone
            elements.insightsContent.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📈</div>
                    <p>Nessuna analisi disponibile</p>
                    <small>Esegui una scansione per vedere statistiche e raccomandazioni</small>
                </div>
            `;
        } else {
            showToast('error', 'Errore', result.error || 'Impossibile eliminare i report');
        }
    } catch (error) {
        console.error('Error deleting reports:', error);
        showToast('error', 'Errore', 'Impossibile eliminare i report');
    }
}

// Server Status
async function checkServerStatus() {
    try {
        const response = await fetch('/api/status');
        const status = await response.json();

        if (!status.scriptExists) {
            showToast('warning', 'Attenzione', 'Script CleanMac.command non trovato');
        }
    } catch (error) {
        console.error('Error checking status:', error);
    }
}

// Toast Notifications
function showToast(type, title, message) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };

    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || 'ℹ️'}</div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;

    elements.toastContainer.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// Utility Functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Password Modal Management
let passwordResolve = null;
let passwordReject = null;

function showPasswordModal() {
    return new Promise((resolve, reject) => {
        passwordResolve = resolve;
        passwordReject = reject;

        const modal = document.getElementById('passwordModal');
        const input = document.getElementById('passwordInput');
        const errorDiv = document.getElementById('passwordError');
        const submitBtn = document.getElementById('submitPasswordBtn');
        const cancelBtn = document.getElementById('cancelPasswordBtn');

        // Reset
        input.value = '';
        errorDiv.style.display = 'none';
        errorDiv.textContent = '';

        // Show modal
        modal.style.display = 'flex';
        setTimeout(() => input.focus(), 100);

        // Handle submit
        const handleSubmit = () => {
            const password = input.value;
            if (!password) {
                errorDiv.textContent = '⚠️ Inserisci la password';
                errorDiv.style.display = 'block';
                return;
            }
            modal.style.display = 'none';
            resolve(password);
        };

        // Handle cancel
        const handleCancel = () => {
            modal.style.display = 'none';
            reject(new Error('Password request cancelled'));
        };

        // Event listeners (remove old ones first)
        submitBtn.replaceWith(submitBtn.cloneNode(true));
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));

        const newSubmitBtn = document.getElementById('submitPasswordBtn');
        const newCancelBtn = document.getElementById('cancelPasswordBtn');

        newSubmitBtn.addEventListener('click', handleSubmit);
        newCancelBtn.addEventListener('click', handleCancel);

        // Enter key to submit
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleSubmit();
            }
        });
    });
}

// Listen for password request from server
socket.on('request:password', async () => {
    try {
        const password = await showPasswordModal();
        socket.emit('password:submit', { password });
    } catch (error) {
        socket.emit('password:cancel');
        showToast('warning', 'Operazione Annullata', 'Password non fornita');
    }
});

socket.on('password:error', (data) => {
    const errorDiv = document.getElementById('passwordError');
    errorDiv.textContent = '❌ ' + (data.message || 'Password non valida');
    errorDiv.style.display = 'block';

    // Re-show modal
    showPasswordModal().then(password => {
        socket.emit('password:submit', { password });
    }).catch(() => {
        socket.emit('password:cancel');
    });
});

// Insights & Analysis
async function analyzeReports() {
    try {
        // Get current stats from the session
        const currentStats = {
            spaceSaved: stats.spaceSaved,
            operations: stats.operations,
            files: stats.files,
            cacheCleared: stats.cacheCleared
        };

        // Fetch analysis files from server
        const response = await fetch('/api/analysis-files');
        const analysisFiles = await response.json();

        // Store analysis files globally for modal access
        currentAnalysisFiles = analysisFiles;

        // Parse analysis data to get stats from reports if session is empty
        const analysisData = parseAnalysisFiles(analysisFiles);

        // Update display stats if we have data from reports and current session is empty
        if (analysisData.stats && stats.spaceSaved === 0) {
            // Update the stats display with data from reports
            elements.spaceSaved.textContent = `${analysisData.stats.spaceSaved.toLocaleString()} MB`;
            elements.operationsCount.textContent = analysisData.stats.operations;
            elements.cacheCleared.textContent = `${analysisData.stats.cacheCleared.toLocaleString()} MB`;
        }

        // Generate insights with analysis data
        const insights = generateInsights(currentStats, analysisFiles);
        displayInsights(insights);

    } catch (error) {
        console.error('Error analyzing reports:', error);
        showToast('error', 'Errore Analisi', 'Impossibile analizzare i dati');
    }
}

function generateInsights(stats, analysisFiles = {}) {
    const insights = {
        cards: [],
        recommendations: []
    };

    // Parse analysis files for additional insights
    const analysisData = parseAnalysisFiles(analysisFiles);

    // Use stats from analysis files if current session has no data
    if (analysisData.stats && stats.spaceSaved === 0) {
        stats = {
            spaceSaved: analysisData.stats.spaceSaved,
            operations: analysisData.stats.operations,
            files: stats.files,
            cacheCleared: analysisData.stats.cacheCleared
        };
    }

    // Spazio liberato insight
    if (stats.spaceSaved > 0) {
        let type = 'info';
        let icon = '💾';
        let description = 'Spazio recuperato nella sessione corrente';

        if (stats.spaceSaved > 5000) {
            type = 'success';
            icon = '🎉';
            description = 'Ottimo! Grande quantità di spazio recuperato';
        } else if (stats.spaceSaved > 1000) {
            type = 'success';
            icon = '✨';
            description = 'Buon risultato di pulizia';
        }

        insights.cards.push({
            type,
            icon,
            title: 'Spazio Totale',
            value: `${stats.spaceSaved.toLocaleString()} MB`,
            description
        });
    }

    // Cache insight
    if (stats.cacheCleared > 0) {
        const cachePercent = Math.round((stats.cacheCleared / stats.spaceSaved) * 100);

        insights.cards.push({
            type: cachePercent > 60 ? 'warning' : 'info',
            icon: '🗑️',
            title: 'Cache Pulita',
            value: `${stats.cacheCleared.toLocaleString()} MB`,
            description: `${cachePercent}% dello spazio liberato proviene da cache`
        });

        if (cachePercent > 70) {
            insights.recommendations.push(
                'Le cache si riempiono rapidamente. Considera di eseguire pulizie regolari ogni 1-2 settimane.'
            );
        }
    }

    // File processati insight
    if (stats.files > 0) {
        let type = 'info';
        let icon = '📄';

        if (stats.files > 10000) {
            type = 'warning';
            icon = '📚';
        }

        insights.cards.push({
            type,
            icon,
            title: 'File Processati',
            value: stats.files.toLocaleString(),
            description: 'File analizzati o eliminati'
        });

        if (stats.files > 10000) {
            insights.recommendations.push(
                'Alto numero di file processati. Valuta di organizzare meglio i dati per ridurre file temporanei.'
            );
        }
    }

    // Efficienza operazioni
    if (stats.operations > 0 && stats.spaceSaved > 0) {
        const efficiency = Math.round(stats.spaceSaved / stats.operations);

        insights.cards.push({
            type: efficiency > 100 ? 'success' : 'info',
            icon: '⚡',
            title: 'Efficienza',
            value: `${efficiency} MB/op`,
            description: 'Spazio medio liberato per operazione'
        });
    }

    // File duplicati insight
    if (analysisData.duplicates && analysisData.duplicates.count > 0) {
        insights.cards.push({
            type: analysisData.duplicates.wastedSpace > 1000 ? 'warning' : 'info',
            icon: '📑',
            title: 'File Duplicati',
            value: `${analysisData.duplicates.count}`,
            description: `${analysisData.duplicates.wastedSpace} MB di spazio sprecato`
        });

        if (analysisData.duplicates.wastedSpace > 1000) {
            insights.recommendations.push(
                `Trovati ${analysisData.duplicates.count} file duplicati che occupano ${analysisData.duplicates.wastedSpace} MB. Considera di rimuoverli manualmente.`
            );
        }
    }

    // File grandi insight
    if (analysisData.largeFiles && analysisData.largeFiles.count > 0) {
        insights.cards.push({
            type: analysisData.largeFiles.totalSize > 5000 ? 'warning' : 'info',
            icon: '📦',
            title: 'File Grandi',
            value: `${analysisData.largeFiles.count}`,
            description: `${analysisData.largeFiles.totalSize} MB totali (>500MB)`
        });

        if (analysisData.largeFiles.totalSize > 5000) {
            insights.recommendations.push(
                `File grandi occupano ${analysisData.largeFiles.totalSize} MB. Verifica se puoi archiviarli o eliminarli.`
            );
        }
    }

    // App non utilizzate insight
    if (analysisData.unusedApps && analysisData.unusedApps.count > 0) {
        insights.cards.push({
            type: analysisData.unusedApps.count > 10 ? 'warning' : 'info',
            icon: '📱',
            title: 'App Non Usate',
            value: `${analysisData.unusedApps.count}`,
            description: `Non utilizzate da oltre ${analysisData.unusedApps.daysThreshold} giorni`
        });

        if (analysisData.unusedApps.count > 5) {
            insights.recommendations.push(
                `${analysisData.unusedApps.count} app non utilizzate da tempo. Considera di disinstallarle per liberare spazio.`
            );
        }
    }

    // Disk usage insight
    if (analysisData.diskUsage && analysisData.diskUsage.largestFolder) {
        insights.cards.push({
            type: 'info',
            icon: '📂',
            title: 'Cartella Più Grande',
            value: analysisData.diskUsage.largestFolder.name,
            description: `${analysisData.diskUsage.largestFolder.size} MB`
        });

        if (analysisData.diskUsage.largestFolder.size > 10000) {
            insights.recommendations.push(
                `La cartella "${analysisData.diskUsage.largestFolder.name}" occupa ${analysisData.diskUsage.largestFolder.size} MB. Verifica il contenuto.`
            );
        }
    }

    // Raccomandazioni generali
    if (stats.spaceSaved < 500) {
        insights.recommendations.push(
            'Sistema relativamente pulito. Puoi programmare la prossima pulizia tra qualche settimana.'
        );
    }

    if (stats.spaceSaved > 5000) {
        insights.recommendations.push(
            'Considera di verificare le app che generano più dati cache e valuta alternative più efficienti.'
        );
    }

    if (stats.operations > 15) {
        insights.recommendations.push(
            'Molte operazioni eseguite. Per mantenere il sistema pulito, esegui CleanMac settimanalmente.'
        );
    }

    // Raccomandazione sempre presente
    insights.recommendations.push(
        'Backup regolari sono essenziali. Verifica che Time Machine o un altro sistema di backup sia attivo.'
    );

    return insights;
}

function displayInsights(insights) {
    if (!insights.cards.length && !insights.recommendations.length) {
        elements.insightsContent.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📈</div>
                <p>Nessuna analisi disponibile</p>
                <small>Esegui una scansione per vedere statistiche e raccomandazioni</small>
            </div>
        `;
        return;
    }

    let html = '';

    // Cards
    if (insights.cards.length > 0) {
        html += '<div class="insight-grid">';
        insights.cards.forEach(card => {
            const isClickable = card.title === 'File Grandi' || card.title === 'App Non Usate';
            const clickHandler = card.title === 'File Grandi' ? 'onclick="showLargeFilesModal()"' :
                                 card.title === 'App Non Usate' ? 'onclick="showUnusedAppsModal()"' : '';
            const cursorStyle = isClickable ? 'style="cursor: pointer;"' : '';

            html += `
                <div class="insight-card ${card.type}" ${clickHandler} ${cursorStyle}>
                    <div class="insight-header">
                        <span class="insight-icon">${card.icon}</span>
                        <span class="insight-title">${card.title}</span>
                    </div>
                    <div class="insight-value">${card.value}</div>
                    <div class="insight-description">${card.description}</div>
                </div>
            `;
        });
        html += '</div>';
    }

    // Recommendations
    if (insights.recommendations.length > 0) {
        html += `
            <div class="recommendations">
                <h4>💡 Raccomandazioni</h4>
                <ul class="recommendation-list">
                    ${insights.recommendations.map(rec => `<li>${rec}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    elements.insightsContent.innerHTML = html;
}

function parseAnalysisFiles(analysisFiles) {
    const data = {};

    // Parse dryrun report for statistics
    if (analysisFiles.dryrun_report) {
        const content = analysisFiles.dryrun_report.content;
        const lines = content.split('\n');

        let totalSpaceSaved = 0;
        let operations = 0;
        let cacheCleared = 0;

        lines.forEach((line, index) => {
            // Match lines like "Spazio che sarebbe liberato: 1161 MB"
            const spaceMatch = line.match(/Spazio che sarebbe liberato:\s+(\d+)\s+MB/i);
            if (spaceMatch) {
                const mb = parseInt(spaceMatch[1]);
                totalSpaceSaved += mb;
                operations++;

                // Check if it's cache related by looking at previous lines
                const prevLines = lines.slice(Math.max(0, index - 10), index);
                const context = prevLines.join('\n').toLowerCase();
                if (context.includes('cache')) {
                    cacheCleared += mb;
                }
            }
        });

        data.stats = {
            spaceSaved: totalSpaceSaved,
            operations,
            cacheCleared
        };
    }

    // Parse duplicates file
    if (analysisFiles.duplicates) {
        const content = analysisFiles.duplicates.content;
        const lines = content.split('\n');

        let count = 0;
        let wastedSpace = 0;

        lines.forEach(line => {
            // Count duplicate groups (lines starting with hash)
            if (line.match(/^[a-f0-9]{32}/)) {
                count++;
            }
            // Extract size from lines like "  1.2 MB - /path/to/file"
            const sizeMatch = line.match(/\s+([\d.]+)\s+(KB|MB|GB)\s+-/);
            if (sizeMatch) {
                let size = parseFloat(sizeMatch[1]);
                const unit = sizeMatch[2];

                if (unit === 'KB') size = size / 1024;
                else if (unit === 'GB') size = size * 1024;

                wastedSpace += size;
            }
        });

        data.duplicates = {
            count: Math.floor(count / 2), // Each duplicate pair counted twice
            wastedSpace: Math.round(wastedSpace)
        };
    }

    // Parse large files
    if (analysisFiles.large_files) {
        const content = analysisFiles.large_files.content;
        const lines = content.split('\n');

        let count = 0;
        let totalSize = 0;

        lines.forEach(line => {
            // Extract size from lines like "📦 /path — 637M" or "📦 /path — 1,5G"
            const sizeMatch = line.match(/—\s+([\d,\.]+)([KMGTB])/);
            if (sizeMatch) {
                count++;
                // Replace comma with dot for parsing (Italian format)
                let size = parseFloat(sizeMatch[1].replace(',', '.'));
                const unit = sizeMatch[2];

                // Convert to MB
                if (unit === 'K') size = size / 1024;
                else if (unit === 'G') size = size * 1024;
                else if (unit === 'T') size = size * 1024 * 1024;
                else if (unit === 'B') size = size / 1024 / 1024;
                // M is already in MB

                totalSize += size;
            }
        });

        data.largeFiles = {
            count,
            totalSize: Math.round(totalSize)
        };
    }

    // Parse unused apps
    if (analysisFiles.unused_apps) {
        const content = analysisFiles.unused_apps.content;
        const lines = content.split('\n');

        let count = 0;
        let daysThreshold = 30; // Default

        // Extract threshold from header line like "App non utilizzate da oltre 30 giorni:"
        const thresholdMatch = content.match(/oltre (\d+) giorni/);
        if (thresholdMatch) {
            daysThreshold = parseInt(thresholdMatch[1]);
        }

        lines.forEach(line => {
            // Count lines with app info (containing .app) and "Non usata da"
            if (line.includes('.app') && (line.includes('giorni fa') || line.includes('Non usata da'))) {
                count++;
            }
        });

        // Also try to extract total from summary line "Totale app non utilizzate: 17"
        const totalMatch = content.match(/Totale app non utilizzate:\s+(\d+)/);
        if (totalMatch) {
            count = parseInt(totalMatch[1]);
        }

        data.unusedApps = {
            count,
            daysThreshold
        };
    }

    // Parse disk analysis
    if (analysisFiles.disk_analysis) {
        const content = analysisFiles.disk_analysis.content;
        const lines = content.split('\n');

        let largestFolder = null;
        let largestSize = 0;

        lines.forEach(line => {
            // Extract folder size from lines like "📁 /Users/nf/Desktop:  21M"
            const match = line.match(/📁\s+(.+?):\s+([\d,\.]+)([KMGT])/);
            if (match) {
                const folderPath = match[1].trim();
                let size = parseFloat(match[2].replace(',', '.'));
                const unit = match[3];

                // Convert to MB
                if (unit === 'K') size = size / 1024;
                else if (unit === 'G') size = size * 1024;
                else if (unit === 'T') size = size * 1024 * 1024;
                // M is already in MB

                if (size > largestSize) {
                    largestSize = size;
                    // Extract folder name from path
                    const folderName = folderPath.split('/').pop() || folderPath;
                    largestFolder = {
                        name: folderName,
                        size: Math.round(size)
                    };
                }
            }
        });

        if (largestFolder) {
            data.diskUsage = { largestFolder };
        }
    }

    return data;
}

// ============================================================================
// MODAL FUNCTIONS - Large Files & Unused Apps
// ============================================================================

function showLargeFilesModal() {
    if (!currentAnalysisFiles || !currentAnalysisFiles.large_files) {
        showToast('error', 'Errore', 'Nessun dato sui file grandi disponibile');
        return;
    }

    const content = currentAnalysisFiles.large_files.content;
    const lines = content.split('\n');
    const filesList = document.getElementById('largeFilesList');
    const modal = document.getElementById('largeFilesModal');

    // Parse files from content
    const files = [];
    lines.forEach(line => {
        // Match lines like "📦 /path/to/file — 637M" or "📦 /path — 1,5G"
        const match = line.match(/📦\s+(.+?)\s+—\s+([\d,\.]+)([KMGTB])/);
        if (match) {
            const path = match[1].trim();
            const sizeStr = match[2].replace(',', '.');
            const unit = match[3];
            const sizeNum = parseFloat(sizeStr);

            // Skip files with 0 size (likely cloud files not downloaded)
            if (sizeNum === 0 || unit === 'B') {
                return;
            }

            files.push({ path, size: sizeStr + unit });
        }
    });

    if (files.length === 0) {
        filesList.innerHTML = '<p style="text-align: center; color: var(--muted); padding: 20px;">Nessun file grande trovato</p>';
    } else {
        filesList.innerHTML = files.map((file, index) => {
            const fileName = file.path.split('/').pop();
            return `
                <div class="file-item" data-index="${index}">
                    <input type="checkbox" class="file-checkbox" data-path="${escapeHtml(file.path)}"
                           onchange="updateFileSelection()">
                    <div class="file-info">
                        <div class="file-name">${escapeHtml(fileName)}</div>
                        <div class="file-path">${escapeHtml(file.path)}</div>
                    </div>
                    <div class="file-size">${file.size}</div>
                </div>
            `;
        }).join('');
    }

    // Show modal
    modal.style.display = 'flex';

    // Update selection count
    updateFileSelection();
}

function showUnusedAppsModal() {
    if (!currentAnalysisFiles || !currentAnalysisFiles.unused_apps) {
        showToast('error', 'Errore', 'Nessun dato sulle app non usate disponibile');
        return;
    }

    const content = currentAnalysisFiles.unused_apps.content;
    const lines = content.split('\n');
    const appsList = document.getElementById('unusedAppsList');
    const modal = document.getElementById('unusedAppsModal');

    // Parse apps from content
    const apps = [];
    lines.forEach(line => {
        // Match lines like "⚠️  VLC.app — Non usata da 637 giorni (ultimo accesso: 2024-03-28)"
        const match = line.match(/⚠️\s+(.+?\.app)\s+—\s+Non usata da (\d+) giorni\s+\(ultimo accesso:\s+([^)]+)\)/);
        if (match) {
            const name = match[1].trim();
            const days = match[2];
            const lastAccess = match[3];
            apps.push({ name, days, lastAccess });
        }
    });

    if (apps.length === 0) {
        appsList.innerHTML = '<p style="text-align: center; color: var(--muted); padding: 20px;">Nessuna app non utilizzata trovata</p>';
    } else {
        appsList.innerHTML = apps.map((app, index) => {
            return `
                <div class="app-item" data-index="${index}">
                    <input type="checkbox" class="file-checkbox" data-app="${escapeHtml(app.name)}"
                           onchange="updateAppSelection()">
                    <div class="app-info">
                        <div class="app-name">${escapeHtml(app.name)}</div>
                        <div class="app-details">Ultimo accesso: ${escapeHtml(app.lastAccess)}</div>
                    </div>
                    <div class="app-days">${app.days}d</div>
                </div>
            `;
        }).join('');
    }

    // Show modal
    modal.style.display = 'flex';

    // Update selection count
    updateAppSelection();
}

function closeLargeFilesModal() {
    document.getElementById('largeFilesModal').style.display = 'none';
    // Deselect all
    document.querySelectorAll('#largeFilesList .file-checkbox').forEach(cb => cb.checked = false);
    updateFileSelection();
}

function closeUnusedAppsModal() {
    document.getElementById('unusedAppsModal').style.display = 'none';
    // Deselect all
    document.querySelectorAll('#unusedAppsList .file-checkbox').forEach(cb => cb.checked = false);
    updateAppSelection();
}

function updateFileSelection() {
    const checkboxes = document.querySelectorAll('#largeFilesList .file-checkbox');
    const selectedCount = Array.from(checkboxes).filter(cb => cb.checked).length;

    document.getElementById('fileSelectionCount').textContent = `${selectedCount} selezionati`;
    document.getElementById('deleteSelectedFilesBtn').disabled = selectedCount === 0;

    // Update visual selection
    checkboxes.forEach(cb => {
        const item = cb.closest('.file-item');
        if (cb.checked) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
}

function updateAppSelection() {
    const checkboxes = document.querySelectorAll('#unusedAppsList .file-checkbox');
    const selectedCount = Array.from(checkboxes).filter(cb => cb.checked).length;

    document.getElementById('appSelectionCount').textContent = `${selectedCount} selezionati`;
    document.getElementById('uninstallSelectedAppsBtn').disabled = selectedCount === 0;

    // Update visual selection
    checkboxes.forEach(cb => {
        const item = cb.closest('.app-item');
        if (cb.checked) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Event listeners for modal buttons
document.addEventListener('DOMContentLoaded', () => {
    // Large Files Modal
    document.getElementById('selectAllFilesBtn').addEventListener('click', () => {
        document.querySelectorAll('#largeFilesList .file-checkbox').forEach(cb => cb.checked = true);
        updateFileSelection();
    });

    document.getElementById('deselectAllFilesBtn').addEventListener('click', () => {
        document.querySelectorAll('#largeFilesList .file-checkbox').forEach(cb => cb.checked = false);
        updateFileSelection();
    });

    document.getElementById('closeLargeFilesBtn').addEventListener('click', closeLargeFilesModal);

    document.getElementById('deleteSelectedFilesBtn').addEventListener('click', async () => {
        const selected = Array.from(document.querySelectorAll('#largeFilesList .file-checkbox:checked'))
            .map(cb => cb.dataset.path);

        if (selected.length === 0) return;

        const confirmed = confirm(`Sei sicuro di voler eliminare ${selected.length} file?\n\nQuesta operazione è irreversibile!`);
        if (!confirmed) return;

        try {
            const response = await fetch('/api/delete-files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: selected })
            });

            const result = await response.json();

            if (result.success) {
                let message = `${result.deleted} file eliminati con successo`;
                if (result.errors && result.errors.length > 0) {
                    message += `\n${result.errors.length} errori durante l'eliminazione`;
                    console.log('Errori eliminazione file:', result.errors);
                }
                showToast('success', 'File Eliminati', message);
                closeLargeFilesModal();
                // Refresh analysis
                setTimeout(() => analyzeReports(), 1000);
            } else {
                let errorMsg = result.error || 'Impossibile eliminare i file';
                if (result.errors && result.errors.length > 0) {
                    console.error('Dettagli errori:', result.errors);
                    errorMsg += `\nVerifica la console per dettagli`;
                }
                showToast('error', 'Errore', errorMsg);
            }
        } catch (error) {
            console.error('Error deleting files:', error);
            showToast('error', 'Errore', 'Impossibile eliminare i file');
        }
    });

    // Unused Apps Modal
    document.getElementById('selectAllAppsBtn').addEventListener('click', () => {
        document.querySelectorAll('#unusedAppsList .file-checkbox').forEach(cb => cb.checked = true);
        updateAppSelection();
    });

    document.getElementById('deselectAllAppsBtn').addEventListener('click', () => {
        document.querySelectorAll('#unusedAppsList .file-checkbox').forEach(cb => cb.checked = false);
        updateAppSelection();
    });

    document.getElementById('closeUnusedAppsBtn').addEventListener('click', closeUnusedAppsModal);

    document.getElementById('uninstallSelectedAppsBtn').addEventListener('click', async () => {
        const selected = Array.from(document.querySelectorAll('#unusedAppsList .file-checkbox:checked'))
            .map(cb => cb.dataset.app);

        if (selected.length === 0) return;

        const confirmed = confirm(`Sei sicuro di voler disinstallare ${selected.length} applicazioni?\n\nQuesta operazione è irreversibile!`);
        if (!confirmed) return;

        try {
            const response = await fetch('/api/uninstall-apps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apps: selected })
            });

            const result = await response.json();

            if (result.success) {
                let message = `${result.deleted} applicazioni disinstallate con successo`;
                if (result.errors && result.errors.length > 0) {
                    message += `\n${result.errors.length} errori durante la disinstallazione`;
                    console.log('Errori disinstallazione app:', result.errors);
                }
                showToast('success', 'App Disinstallate', message);
                closeUnusedAppsModal();
                // Refresh analysis
                setTimeout(() => analyzeReports(), 1000);
            } else {
                let errorMsg = result.error || 'Impossibile disinstallare le applicazioni';
                if (result.errors && result.errors.length > 0) {
                    console.error('Dettagli errori:', result.errors);
                    errorMsg += `\nVerifica la console per dettagli`;
                }
                showToast('error', 'Errore', errorMsg);
            }
        } catch (error) {
            console.error('Error uninstalling apps:', error);
            showToast('error', 'Errore', 'Impossibile disinstallare le applicazioni');
        }
    });

    // Close modals when clicking overlay
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeLargeFilesModal();
                closeUnusedAppsModal();
            }
        });
    });

    // ── Smart Offload ──────────────────────────────────────────
    initOffloadModule();
});

// ── Smart Offload Module ───────────────────────────────────────

// FIX: helper per HTML attribute escaping — usare SEMPRE per valori dinamici in innerHTML
function escAttr(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escText(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function initOffloadModule() {
    loadOffloadVolumes();
    loadOffloadRegistry();
    checkOffloadHealth();

    document.getElementById('offloadScanBtn').addEventListener('click', runOffloadScan);

    // FIX: event delegation invece di onclick inline — nessun dato interpolato in attributi JS
    document.getElementById('offloadTableBody').addEventListener('click', handleOffloadTableClick);
    document.getElementById('offloadRegistryBody').addEventListener('click', handleRegistryTableClick);

    socket.on('offload:progress', ({ targetPath, message }) => {
        appendOffloadLog(message);
    });

    socket.on('offload:complete', ({ targetPath, message, restored }) => {
        appendOffloadLog(`✅ ${message}`);
        setTimeout(() => {
            runOffloadScan();
            loadOffloadRegistry();
        }, 800);
    });

    socket.on('offload:error', ({ targetPath, message }) => {
        appendOffloadLog(`❌ ${message}`);
        showToast(message, 'error');
    });
}

async function loadOffloadVolumes() {
    try {
        const volumes = await fetch('/api/offload/volumes').then(r => r.json());
        const sel = document.getElementById('offloadVolumeSelect');
        sel.innerHTML = '<option value="">— Seleziona volume —</option>';
        volumes.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.path;
            opt.textContent = v.name;
            sel.appendChild(opt);
        });
        // Auto-seleziona se c'è un solo volume esterno
        if (volumes.length === 1) sel.value = volumes[0].path;
    } catch (e) {
        console.error('loadOffloadVolumes:', e);
    }
}

async function runOffloadScan() {
    const btn = document.getElementById('offloadScanBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Scansione…';
    document.getElementById('offloadScanResults').style.display = 'none';
    document.getElementById('offloadEmpty').style.display = 'none';

    try {
        const targets = await fetch('/api/offload/scan').then(r => r.json());

        if (targets.length === 0) {
            document.getElementById('offloadEmpty').style.display = 'block';
            return;
        }

        const tbody = document.getElementById('offloadTableBody');
        const selectedVolume = document.getElementById('offloadVolumeSelect').value;
        tbody.innerHTML = '';

        targets.forEach(t => {
            const tr = document.createElement('tr');
            const sizeClass = t.sizeBytes === 0 ? 'zero' : '';
            const statusBadge = t.isSymlink
                ? `<span class="offload-status-badge offloaded">✓ offloaded</span>`
                : `<span class="offload-status-badge present">presente</span>`;

            // Colonna rischio: delete-safe | caution | risky | safe
            let riskHtml;
            if (t.risk === 'delete-safe') {
                riskHtml = `<span class="offload-risk-delete">🟢 elimina</span>`;
            } else if (t.riskLevel === 'risky') {
                riskHtml = `<span class="offload-risk-risky" title="${t.note || ''}">🔴 rischioso</span>`;
            } else if (t.riskLevel === 'caution') {
                riskHtml = `<span class="offload-risk-caution" title="${t.note || ''}">🟠 attenzione</span>`;
            } else {
                riskHtml = `<span class="offload-risk-symlink">🟡 symlink</span>`;
            }

            // Nota inline se presente — escText per sicurezza
            const noteHtml = t.note
                ? `<br><span class="offload-note">${escText(t.note)}</span>`
                : '';

            // FIX: data attributes invece di onclick inline — nessun valore dinamico in JS string
            let actions = '';
            if (t.isSymlink) {
                actions = `<span style="color:var(--muted);font-size:0.8rem;">—</span>`;
            } else if (t.risk === 'delete-safe') {
                actions = `<div class="offload-actions">
                    <button class="btn offload-delete"
                        data-action="delete"
                        data-path="${escAttr(t.fullPath)}">🗑 Elimina</button>
                </div>`;
            } else {
                const noVol = !selectedVolume;
                const isRisky = t.riskLevel === 'risky';
                const btnClass = isRisky ? 'btn offload-symlink offload-risky' : 'btn offload-symlink';
                actions = `<div class="offload-actions">
                    <button class="${btnClass}"
                        data-action="symlink"
                        data-path="${escAttr(t.fullPath)}"
                        data-risk="${escAttr(t.riskLevel || 'safe')}"
                        data-note="${escAttr(t.note || '')}"
                        ${noVol ? 'disabled title="Seleziona un volume prima"' : ''}>
                        ${isRisky ? '⚠️ Offload' : '💾 Offload'}
                    </button>
                </div>`;
            }

            tr.innerHTML = `
                <td><span class="offload-path" title="${escAttr(t.fullPath)}">${escText(t.label)}</span><br>
                    <span style="font-size:0.72rem;color:var(--muted);">~/${escText(t.relPath)}</span>
                    ${noteHtml}</td>
                <td><span class="offload-size ${sizeClass}">${escText(t.sizeDisplay)}</span></td>
                <td>${riskHtml}</td>
                <td>${statusBadge}</td>
                <td>${actions}</td>`;
            tbody.appendChild(tr);
        });

        document.getElementById('offloadScanResults').style.display = 'block';
    } catch (e) {
        showToast('Errore scansione: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '🔍 Scansiona';
    }
}

function handleOffloadTableClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;
    const path = btn.dataset.path;
    if (action === 'delete') doOffloadDelete(path);
    else if (action === 'symlink') doOffloadSymlink(path, btn.dataset.risk, btn.dataset.note);
}

function handleRegistryTableClick(e) {
    const btn = e.target.closest('[data-action="restore"]');
    if (!btn) return;
    doOffloadRestore(btn.dataset.id, btn.dataset.original);
}

async function doOffloadSymlink(targetPath, riskLevel = 'safe', note = '') {
    const destVolume = document.getElementById('offloadVolumeSelect').value;
    if (!destVolume) { showToast('Seleziona un volume di destinazione', 'warning'); return; }

    // Conferma extra per target rischiosi
    if (riskLevel === 'risky' || riskLevel === 'caution') {
        const msg = note
            ? `⚠️ ${note}\n\nVuoi procedere comunque?`
            : `⚠️ Questo target richiede attenzione. Continuare?`;
        if (!confirm(msg)) return;
    }

    showOffloadProgress();
    appendOffloadLog(`Avvio offload: ${targetPath}`);

    try {
        const res = await fetch('/api/offload/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetPath, destVolume, action: 'symlink' })
        });

        if (res.status === 409) {
            const err = await res.json();
            appendOffloadLog(`❌ ${err.error}`);
            appendOffloadLog(`   → ${err.detail || ''}`);
            showToast(err.error, 'error');
            return;
        }
        if (!res.ok) {
            const err = await res.json();
            appendOffloadLog(`❌ ${err.error}`);
            showToast(err.error || 'Errore offload', 'error');
        }
    } catch (e) {
        appendOffloadLog(`❌ Errore: ${e.message}`);
    }
}

async function doOffloadDelete(targetPath) {
    if (!confirm(`Eliminare definitivamente:\n${targetPath}\n\nQuesta operazione è irreversibile.`)) return;

    showOffloadProgress();
    appendOffloadLog(`Eliminazione: ${targetPath}`);

    try {
        const res = await fetch('/api/offload/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetPath, action: 'delete' })
        }).then(r => r.json());

        if (res.success) {
            appendOffloadLog(`✅ ${res.message}`);
            showToast(res.message, 'success');
            setTimeout(runOffloadScan, 500);
        } else {
            appendOffloadLog(`❌ ${res.error}`);
        }
    } catch (e) {
        appendOffloadLog(`❌ Errore: ${e.message}`);
    }
}

async function doOffloadRestore(id, originalPath) {
    if (!confirm(`Ripristinare ${originalPath} dal disco esterno?\n\nIl symlink verrà rimosso e i dati copiati localmente.`)) return;

    showOffloadProgress();
    appendOffloadLog(`Restore: ${originalPath}`);

    try {
        await fetch('/api/offload/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });
    } catch (e) {
        appendOffloadLog(`❌ Errore: ${e.message}`);
    }
}

async function loadOffloadRegistry() {
    try {
        const registry = await fetch('/api/offload/registry').then(r => r.json());
        const container = document.getElementById('offloadRegistry');
        const tbody = document.getElementById('offloadRegistryBody');

        if (registry.length === 0) { container.style.display = 'none'; return; }

        tbody.innerHTML = '';
        registry.forEach(entry => {
            const name = escText(entry.original.split('/').pop());
            // FIX: usa replace sul path string, non su location.href che include l'URL del browser
            const shortOrig = escText(entry.original.replace(/^\/Users\/[^/]+/, '~'));
            const destShort = escText(entry.dest.replace(/^\/Volumes\//, '').replace('/MacSymlinks/', '/…/'));
            const date = new Date(entry.created).toLocaleDateString('it-IT');
            const isPending = entry.status === 'pending';
            const tr = document.createElement('tr');
            // FIX: data attributes invece di onclick inline
            tr.innerHTML = `
                <td><span class="offload-path">${name}</span><br>
                    <span class="offload-dest-path" title="${escAttr(entry.original)}">${shortOrig}</span></td>
                <td><span class="offload-dest-path" title="${escAttr(entry.dest)}">${destShort}</span></td>
                <td style="white-space:nowrap;color:var(--muted);font-size:0.8rem;">${date}</td>
                <td><span class="offload-status-badge ${isPending ? 'present' : 'offloaded'}">${isPending ? '⏳ pending' : 'attivo'}</span></td>
                <td><button class="btn offload-restore"
                    data-action="restore"
                    data-id="${escAttr(entry.id)}"
                    data-original="${escAttr(entry.original)}"
                    ${isPending ? 'disabled title="Offload incompleto — verifica il path manualmente"' : ''}>
                    ↩ Restore</button></td>`;
            tbody.appendChild(tr);
        });

        container.style.display = 'block';
    } catch (e) {
        console.error('loadOffloadRegistry:', e);
    }
}

async function checkOffloadHealth() {
    try {
        const { checks, healthy } = await fetch('/api/offload/health').then(r => r.json());
        if (checks.length === 0) return;

        const badge = document.getElementById('offloadHealthBadge');
        badge.style.display = 'inline-block';
        if (healthy) {
            badge.className = 'offload-health-badge healthy';
            badge.textContent = `✓ ${checks.length} symlink OK`;
        } else {
            const broken = checks.filter(c => !c.healthy).length;
            badge.className = 'offload-health-badge warning';
            badge.textContent = `⚠ ${broken} symlink rotto${broken > 1 ? 'i' : ''}`;
        }
    } catch (e) { /* silenzioso */ }
}

function showOffloadProgress() {
    document.getElementById('offloadProgress').style.display = 'block';
}

function appendOffloadLog(msg) {
    const log = document.getElementById('offloadProgressLog');
    log.textContent += msg + '\n';
    log.scrollTop = log.scrollHeight;
}
