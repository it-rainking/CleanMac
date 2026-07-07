#!/usr/bin/env node
// CleanMac Web Interface Server v5.0 (Synthesis Edition)
// Compatible with CleanMac v5.0 (33 operations + category selection)
// Include uninstaller euristico multi-livello (porting AppPathFinder da MyPureMac)

const express = require('express');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { Server } = require('socket.io');
const appPathFinder = require('./appPathFinder');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;
const HOME_DIR = os.homedir();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Path allo script bash
const SCRIPT_PATH = path.join(__dirname, 'CleanMac.command');
const REPORTS_DIR = path.join(__dirname, 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

// Stato corrente dell'esecuzione
let currentExecution = null;
let sudoPassword = null;
let passwordPromise = null;

// API Endpoints
app.get('/api/status', (req, res) => {
  res.json({
    running: currentExecution !== null,
    scriptPath: SCRIPT_PATH,
    scriptExists: fs.existsSync(SCRIPT_PATH)
  });
});

app.get('/api/reports', (req, res) => {
  const reports = [];
  if (!fs.existsSync(REPORTS_DIR)) return res.json([]);
  const files = fs.readdirSync(REPORTS_DIR);

  files.forEach(file => {
    if ((file.startsWith('cleanmac_') && file.endsWith('.html')) ||
        (file.startsWith('dryrun_report_') && file.endsWith('.txt'))) {
      const stat = fs.statSync(path.join(REPORTS_DIR, file));
      reports.push({ name: file, path: file, date: stat.mtime, size: stat.size });
    }
  });

  reports.sort((a, b) => b.date - a.date);
  res.json(reports);
});

app.get('/api/reports/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(REPORTS_DIR, filename);

  if (fs.existsSync(filepath) &&
      (filename.startsWith('cleanmac_') || filename.startsWith('dryrun_report_'))) {
    res.sendFile(filepath);
  } else {
    res.status(404).json({ error: 'Report not found' });
  }
});

app.post('/api/reports/delete-all', (req, res) => {
  try {
    if (!fs.existsSync(REPORTS_DIR)) return res.json({ success: true, deleted: 0, message: '0 file eliminati' });
    const files = fs.readdirSync(REPORTS_DIR);
    let deletedCount = 0;

    const patterns = [
      /^cleanmac_.*\.html$/,
      /^cleanmac_.*\.log$/,
      /^dryrun_report_.*\.txt$/,
      /^disk_analysis_.*\.txt$/,
      /^duplicates_.*\.txt$/,
      /^large_files_.*\.txt$/,
      /^unused_apps_.*\.txt$/,
      /^config_backup_.*/
    ];

    files.forEach(file => {
      if (patterns.some(p => p.test(file))) {
        const filepath = path.join(REPORTS_DIR, file);
        try {
          const stat = fs.statSync(filepath);
          if (stat.isFile()) { fs.unlinkSync(filepath); deletedCount++; }
          else { fs.rmSync(filepath, { recursive: true, force: true }); deletedCount++; }
        } catch (e) { console.error(`Error deleting ${file}:`, e); }
      }
    });

    res.json({ success: true, deleted: deletedCount, message: `${deletedCount} file/cartelle eliminati` });
  } catch (error) {
    console.error('Error deleting reports:', error);
    res.status(500).json({ error: 'Errore durante l\'eliminazione dei report' });
  }
});

app.get('/api/analysis-files', (req, res) => {
  const analysisData = {};
  if (!fs.existsSync(REPORTS_DIR)) return res.json(analysisData);
  const files = fs.readdirSync(REPORTS_DIR);

  const analysisTypes = {
    disk_analysis: /^disk_analysis_.*\.txt$/,
    duplicates: /^duplicates_.*\.txt$/,
    large_files: /^large_files_.*\.txt$/,
    unused_apps: /^unused_apps_.*\.txt$/,
    dryrun_report: /^dryrun_report_.*\.txt$/
  };

  Object.keys(analysisTypes).forEach(type => {
    const matchingFiles = files.filter(f => analysisTypes[type].test(f));
    if (matchingFiles.length > 0) {
      const sorted = matchingFiles.sort((a, b) => {
        const statA = fs.statSync(path.join(REPORTS_DIR, a));
        const statB = fs.statSync(path.join(REPORTS_DIR, b));
        return statB.mtime - statA.mtime;
      });

      const filepath = path.join(REPORTS_DIR, sorted[0]);
      try {
        const content = fs.readFileSync(filepath, 'utf8');
        analysisData[type] = { filename: sorted[0], content, date: fs.statSync(filepath).mtime };
      } catch (e) {
        console.error(`Error reading ${type}:`, e);
      }
    }
  });

  res.json(analysisData);
});

app.post('/api/run', (req, res) => {
  if (currentExecution) {
    return res.status(400).json({ error: 'Script already running' });
  }

  const { dryRun = true, categories = [], selectedOps = [] } = req.body;

  res.json({
    status: 'started',
    dryRun,
    categories,
    selectedOps,
    message: 'Script execution started'
  });

  runCleanMac(dryRun, categories, selectedOps);
});

app.post('/api/stop', (req, res) => {
  if (!currentExecution) {
    return res.status(400).json({ error: 'No script running' });
  }

  currentExecution.kill('SIGTERM');
  currentExecution = null;
  sudoPassword = null;

  // Notify clients that execution was stopped
  io.emit('execution:complete', {
    code: -1,
    timestamp: new Date(),
    success: false,
    stopped: true
  });

  res.json({ status: 'stopped' });
});

app.post('/api/delete-files', (req, res) => {
  const { files } = req.body;

  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files specified' });
  }

  console.log(`Richiesta eliminazione di ${files.length} file`);

  let deletedCount = 0;
  const errors = [];

  files.forEach((filepath, index) => {
    console.log(`[${index + 1}/${files.length}] Tentativo eliminazione: ${filepath}`);

    try {
      // Security check: ensure filepath is absolute and doesn't contain suspicious patterns
      if (!filepath.startsWith('/') || filepath.includes('..')) {
        console.error(`  ✗ Path non valido`);
        errors.push({ file: filepath, error: 'Invalid file path' });
        return;
      }

      if (fs.existsSync(filepath)) {
        const stat = fs.statSync(filepath);
        if (stat.isFile()) {
          fs.unlinkSync(filepath);
          console.log(`  ✓ File eliminato con successo`);
          deletedCount++;
        } else {
          console.error(`  ✗ Non è un file (è una directory)`);
          errors.push({ file: filepath, error: 'Not a file' });
        }
      } else {
        console.error(`  ✗ File non trovato`);
        errors.push({ file: filepath, error: 'File not found' });
      }
    } catch (error) {
      console.error(`  ✗ Errore: ${error.message}`);
      errors.push({ file: filepath, error: error.message });
    }
  });

  if (deletedCount > 0) {
    res.json({
      success: true,
      deleted: deletedCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `${deletedCount} file eliminati${errors.length > 0 ? ` (${errors.length} errori)` : ''}`
    });
  } else {
    res.status(500).json({
      success: false,
      error: 'Nessun file eliminato',
      errors
    });
  }
});

// Risolve il percorso di un'app dal suo nome (solo location note).
function resolveAppPath(appName) {
  if (!appName.endsWith('.app') || appName.includes('/') || appName.includes('..')) return null;
  const candidates = [
    path.join('/Applications', appName),
    path.join(HOME_DIR, 'Applications', appName)
  ];
  for (const c of candidates) {
    try {
      if (fs.lstatSync(c).isDirectory()) return c;
    } catch (e) { /* not here */ }
  }
  return null;
}

// Aree in cui è consentito eliminare file correlati durante l'uninstall.
const UNINSTALL_SAFE_ROOTS = [
  path.join(HOME_DIR, 'Library') + path.sep,
  '/Applications' + path.sep,
  path.join(HOME_DIR, 'Applications') + path.sep,
];

// Valida che un percorso correlato sia sicuro da eliminare: dentro un'area nota,
// senza componenti '..', e senza attraversare symlink verso l'esterno.
function isSafeRelatedPath(p) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.includes('..')) return false;
  const inSafeRoot = UNINSTALL_SAFE_ROOTS.some(root => p.startsWith(root));
  if (!inSafeRoot) return false;
  try {
    const real = fs.realpathSync(p);
    // Dopo la risoluzione dei symlink, deve restare in un'area sicura.
    return UNINSTALL_SAFE_ROOTS.some(root => (real + path.sep).startsWith(root) || real.startsWith(root));
  } catch (e) {
    // Se non risolvibile (es. broken symlink) non eliminare.
    return false;
  }
}

// GET /api/uninstall-scan?app=Foo.app[&sensitivity=enhanced]
// Restituisce il bundle + i file correlati scoperti (senza eliminare nulla).
app.get('/api/uninstall-scan', (req, res) => {
  const appName = req.query.app;
  const sensitivity = ['strict', 'enhanced', 'deep'].includes(req.query.sensitivity)
    ? req.query.sensitivity : 'enhanced';

  if (!appName) return res.status(400).json({ error: 'Parametro "app" mancante' });

  const appPath = resolveAppPath(appName);
  if (!appPath) return res.status(404).json({ error: 'App non trovata nelle location note' });

  try {
    const result = appPathFinder.findRelatedFiles(appPath, sensitivity);
    // Non includere il bundle .app stesso tra i "related"
    result.files = result.files.filter(f => f.path !== appPath);
    let appSize = 0;
    try { appSize = parseInt(require('child_process').execFileSync('/usr/bin/du', ['-sk', appPath], { encoding: 'utf8' }).trim().split(/\s+/)[0], 10) * 1024; } catch (e) {}
    res.json({ app: appName, appPath, appSizeBytes: appSize, ...result });
  } catch (error) {
    console.error(`Errore scan uninstall ${appName}:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/uninstall-apps', (req, res) => {
  const { apps, includeRelated = false, sensitivity = 'enhanced' } = req.body;

  if (!apps || !Array.isArray(apps) || apps.length === 0) {
    return res.status(400).json({ error: 'No apps specified' });
  }

  let deletedCount = 0;
  let relatedDeleted = 0;
  const errors = [];

  apps.forEach(appName => {
    try {
      const appPath = resolveAppPath(appName);
      if (!appPath) {
        errors.push({ app: appName, error: 'App not found or invalid name' });
        return;
      }

      // v5.0: rimuovi anche i file correlati (porting AppPathFinder da MyPureMac)
      if (includeRelated) {
        try {
          const related = appPathFinder.findRelatedFiles(appPath, sensitivity);
          related.files.forEach(f => {
            if (f.path === appPath) return; // il bundle lo gestiamo dopo
            if (isSafeRelatedPath(f.path)) {
              try { fs.rmSync(f.path, { recursive: true, force: true }); relatedDeleted++; }
              catch (e) { errors.push({ app: appName, file: f.path, error: e.message }); }
            }
          });
        } catch (e) {
          console.error(`Errore scoperta file correlati ${appName}:`, e);
        }
      }

      // Rimuovi il bundle .app
      fs.rmSync(appPath, { recursive: true, force: true });
      deletedCount++;
    } catch (error) {
      console.error(`Error uninstalling ${appName}:`, error);
      errors.push({ app: appName, error: error.message });
    }
  });

  if (deletedCount > 0) {
    res.json({
      success: true,
      deleted: deletedCount,
      relatedDeleted,
      errors: errors.length > 0 ? errors : undefined,
      message: `${deletedCount} applicazioni disinstallate${includeRelated ? ` + ${relatedDeleted} file correlati` : ''}${errors.length > 0 ? ` (${errors.length} errori)` : ''}`
    });
  } else {
    res.status(500).json({
      success: false,
      error: 'Nessuna applicazione disinstallata',
      errors
    });
  }
});

// Funzione per richiedere la password al client
function requestPassword() {
  return new Promise((resolve, reject) => {
    // Chiedi la password al client tramite WebSocket
    io.emit('request:password');

    const timeout = setTimeout(() => {
      passwordPromise = null;
      reject(new Error('Password request timeout'));
    }, 60000); // 60 secondi timeout

    passwordPromise = { resolve, reject, timeout };
  });
}

// Funzione per eseguire lo script CleanMac
async function runCleanMac(dryRun = true, categories = [], selectedOps = []) {
  // Reset password
  sudoPassword = null;

  // Mark as running immediately to prevent double execution
  currentExecution = { pending: true };

  // Richiedi password in anticipo se non in dry run
  if (!dryRun) {
    try {
      sudoPassword = await requestPassword();
      console.log('Password ricevuta dal client');
    } catch (error) {
      console.error('Password not provided:', error);
      io.emit('execution:error', { error: 'Password richiesta ma non fornita' });
      currentExecution = null;
      return;
    }
  }

  // Prepara argomenti CLI per v4.2
  const scriptArgs = [];

  // Aggiungi flag dry-run o cleanup
  if (dryRun) {
    scriptArgs.push('--dry-run');
  } else {
    scriptArgs.push('--cleanup');
  }

  // Aggiungi categorie se specificate
  if (categories && categories.length > 0) {
    const categoriesStr = categories.join(',');
    scriptArgs.push(`--categories=${categoriesStr}`);
  } else if (!dryRun && (!selectedOps || selectedOps.length === 0)) {
    // Se non specificato in pulizia diretta, esegui tutto
    scriptArgs.push('--all');
  }

  // Aggiungi singole operazioni se specificate (override categorie)
  if (selectedOps && selectedOps.length > 0) {
    scriptArgs.push(`--ops=${selectedOps.join(',')}`);
  }

  // Path file ops condiviso con lo script bash (per leggere risultati dry run)
  const opsFile = path.join(__dirname, '.cleanmac_ops_latest.txt');

  console.log('Esecuzione script con argomenti:', scriptArgs);

  // Modifica lo script per gestire sudo con password se fornita
  if (sudoPassword) {
    const scriptContent = fs.readFileSync(SCRIPT_PATH, 'utf8');
    // FIX v4.3: sostituisce sudo solo su righe non-commento (evita corruzione)
    const modifiedScript = scriptContent
      .split('\n')
      .map(line => {
        if (line.trim().startsWith('#')) return line;
        return line.replace(/\bsudo\s+/g, 'echo "$SUDO_PASSWORD" | sudo -S ');
      })
      .join('\n');

    const wrapperScript = `#!/bin/bash
SUDO_PASSWORD='${sudoPassword.replace(/'/g, "'\\''")}'
export SUDO_PASSWORD
${modifiedScript}
`;

    const tempScript = path.join(__dirname, '.cleanmac_temp.sh');
    // FIX v4.3: permessi 0o700 (solo owner) — il file contiene la password in chiaro
    fs.writeFileSync(tempScript, wrapperScript, { mode: 0o700 });

    const spawnOptions = {
      cwd: __dirname,
      env: { ...process.env, CLEANMAC_OPS_FILE: opsFile }
    };

    currentExecution = spawn('bash', [tempScript, ...scriptArgs], spawnOptions);
  } else {
    // Dry run senza password
    const spawnOptions = {
      cwd: __dirname,
      env: { ...process.env, CLEANMAC_OPS_FILE: opsFile }
    };

    currentExecution = spawn('bash', [SCRIPT_PATH, ...scriptArgs], spawnOptions);
  }

  io.emit('execution:start', { dryRun, timestamp: new Date() });

  currentExecution.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(output);
    io.emit('execution:stdout', { data: output });
  });

  currentExecution.stderr.on('data', (data) => {
    const output = data.toString();
    console.error(output);
    io.emit('execution:stderr', { data: output });
  });

  currentExecution.on('close', (code) => {
    console.log(`Script terminato con codice ${code}`);

    // Se era un dry run, leggi il file operazioni e invia ai client
    if (dryRun && fs.existsSync(opsFile)) {
      try {
        const lines = fs.readFileSync(opsFile, 'utf8').split('\n').filter(Boolean);
        const ops = lines.map(line => {
          const parts = line.split(':');
          if (parts.length < 4) return null;
          const [id, mb, cat, ...descParts] = parts;
          return {
            id,
            mb: parseInt(mb) || 0,
            category: cat,
            desc: descParts.join(':')
          };
        }).filter(o => o && o.id && o.category);

        // Deduplica: tieni la riga con mb più alto per ogni op_id
        const dedupMap = new Map();
        ops.forEach(op => {
          const existing = dedupMap.get(op.id);
          if (!existing || op.mb > existing.mb) dedupMap.set(op.id, op);
        });
        const uniqueOps = Array.from(dedupMap.values());

        console.log(`Dry run completato: ${uniqueOps.length} operazioni rilevate`);
        io.emit('dryrun:results', { ops: uniqueOps });
      } catch (e) {
        console.error('Errore lettura ops file:', e);
      }
    }

    io.emit('execution:complete', {
      code,
      timestamp: new Date(),
      success: code === 0,
      dryRun
    });

    currentExecution = null;
    sudoPassword = null;

    // Rimuovi lo script temporaneo se esiste
    const tempScript = path.join(__dirname, '.cleanmac_temp.sh');
    if (fs.existsSync(tempScript)) {
      try {
        fs.unlinkSync(tempScript);
      } catch (e) {
        console.error('Error removing temp script:', e);
      }
    }
  });

  currentExecution.on('error', (error) => {
    console.error('Execution error:', error);
    io.emit('execution:error', { error: error.message });
    currentExecution = null;
    sudoPassword = null;
  });
}

// WebSocket connection
io.on('connection', (socket) => {
  console.log('Client connected');

  socket.emit('status', {
    running: currentExecution !== null
  });

  // Handle password submission
  socket.on('password:submit', (data) => {
    console.log('Password submitted by client');
    if (passwordPromise) {
      clearTimeout(passwordPromise.timeout);
      passwordPromise.resolve(data.password);
      passwordPromise = null;
    }
  });

  // Handle password cancellation
  socket.on('password:cancel', () => {
    console.log('Password request cancelled by client');
    if (passwordPromise) {
      clearTimeout(passwordPromise.timeout);
      passwordPromise.reject(new Error('User cancelled password request'));
      passwordPromise = null;
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// FIX v4.3: cleanup temp script su uscita del processo (garantisce rimozione password)
function cleanupTempScript() {
  const tempScript = path.join(__dirname, '.cleanmac_temp.sh');
  try {
    if (fs.existsSync(tempScript)) fs.unlinkSync(tempScript);
  } catch (e) { /* ignore */ }
}
process.on('exit', cleanupTempScript);
process.on('SIGINT', () => { cleanupTempScript(); process.exit(0); });
process.on('SIGTERM', () => { cleanupTempScript(); process.exit(0); });
process.on('uncaughtException', (err) => { cleanupTempScript(); console.error(err); process.exit(1); });

// ─────────────────────────────────────────────────────────────
// SMART OFFLOAD MODULE
// ─────────────────────────────────────────────────────────────

const HOME = os.homedir();
const REGISTRY_DIR = path.join(HOME, '.config', 'cleanmac');
const REGISTRY_FILE = path.join(REGISTRY_DIR, 'symlinks.json');

// riskLevel: 'safe' | 'caution' | 'risky'
// processName: nome processo per pgrep (se necessario chiudere l'app prima)
// note: avviso mostrato all'utente nell'UI
const OFFLOAD_TARGETS = [
  // ── Cache CLI rigenerabili — nessun rischio ──────────────────────────────
  { relPath: 'Library/Caches/ms-playwright',     label: 'Playwright',       type: 'cache',    risk: 'delete-safe',  riskLevel: 'safe' },
  { relPath: 'Library/Caches/ms-playwright-go',  label: 'Playwright Go',    type: 'cache',    risk: 'delete-safe',  riskLevel: 'safe' },
  { relPath: '.cache/node-gyp',                  label: 'node-gyp cache',   type: 'cache',    risk: 'delete-safe',  riskLevel: 'safe' },
  { relPath: 'Library/Caches/pip',               label: 'pip cache',        type: 'cache',    risk: 'delete-safe',  riskLevel: 'safe' },
  { relPath: 'Library/Caches/Homebrew',          label: 'Homebrew cache',   type: 'cache',    risk: 'delete-safe',  riskLevel: 'safe' },
  // Firefox cache in ~/Library/Caches — rigenerabile, sicuro da eliminare
  { relPath: 'Library/Caches/Firefox',           label: 'Firefox cache',    type: 'cache',    risk: 'delete-safe',  riskLevel: 'safe' },

  // ── Dati app — symlink su volume esterno ─────────────────────────────────
  { relPath: '.cache/uv',                        label: 'uv cache',         type: 'cache',    risk: 'symlink-safe', riskLevel: 'safe' },
  { relPath: '.npm',                             label: 'npm cache',        type: 'deps',     risk: 'symlink-safe', riskLevel: 'safe' },
  { relPath: 'Library/Application Support/Steam',   label: 'Steam',        type: 'app-data', risk: 'symlink-safe', riskLevel: 'safe', processName: 'steam_osx' },
  { relPath: 'Library/Application Support/OpenEmu', label: 'OpenEmu',      type: 'app-data', risk: 'symlink-safe', riskLevel: 'safe', processName: 'OpenEmu' },

  // ── Dati app Electron/browser — chiudere l'app prima ─────────────────────
  // VSCode: extensions e workspaceStorage sono safe, ma deve essere chiuso
  { relPath: 'Library/Application Support/Code', label: 'VSCode data',     type: 'app-data', risk: 'symlink-safe', riskLevel: 'caution',
    processName: 'Electron',
    note: 'Chiudi VS Code prima. Il symlink funziona correttamente una volta che il processo è terminato.' },

  // Claude App: IndexedDB/LevelDB — richiede app chiusa + rsync completo
  { relPath: 'Library/Application Support/Claude', label: 'Claude App',    type: 'app-data', risk: 'symlink-safe', riskLevel: 'caution',
    processName: 'Claude',
    note: 'Chiudi Claude prima. LevelDB aperto durante la copia causa corruzione dei dati.' },

  // Firefox Application Support: profiles.ini usa path relativi quindi il symlink funziona,
  // MA Firefox deve essere completamente chiuso (inclusi processi background) durante rsync
  { relPath: 'Library/Application Support/Firefox', label: 'Firefox profilo', type: 'app-data', risk: 'symlink-safe', riskLevel: 'risky',
    processName: 'firefox',
    note: 'ATTENZIONE: muovere il profilo Firefox è rischioso. Preferisci spostare solo la cache (Firefox cache sopra). Se procedi, Firefox deve essere completamente chiuso.' },
];

function loadRegistry() {
  try {
    if (!fs.existsSync(REGISTRY_FILE)) return [];
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch (e) { return []; }
}

function saveRegistry(registry) {
  if (!fs.existsSync(REGISTRY_DIR)) fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

app.get('/api/offload/volumes', (req, res) => {
  // FIX: usa fs.readdirSync invece di exec('ls') — no shell, no injection surface
  try {
    const skip = new Set(['Macintosh HD', 'Macintosh SSD', '']);
    const volumes = fs.readdirSync('/Volumes')
      .filter(v => !skip.has(v))
      .map(v => ({ name: v, path: `/Volumes/${v}` }));
    res.json(volumes);
  } catch (e) {
    res.json([]);
  }
});

app.get('/api/offload/scan', (req, res) => {
  const registry = loadRegistry();
  const results = [];
  let pending = OFFLOAD_TARGETS.length;

  if (pending === 0) return res.json([]);

  OFFLOAD_TARGETS.forEach(target => {
    const fullPath = path.join(HOME, target.relPath);
    let isSymlink = false;
    let exists = false;
    try {
      const stat = fs.lstatSync(fullPath);
      exists = true;
      isSymlink = stat.isSymbolicLink();
    } catch (e) { /* not found */ }

    const finish = () => { if (--pending === 0) res.json(results.sort((a, b) => b.sizeBytes - a.sizeBytes)); };

    if (!exists) { finish(); return; }

    const registryEntry = registry.find(r => r.original === fullPath) || null;

    if (isSymlink) {
      let symlinksTo = '';
      try { symlinksTo = fs.readlinkSync(fullPath); } catch (e) { /* ignore */ }
      results.push({ ...target, fullPath, sizeBytes: 0, sizeDisplay: '—', isSymlink: true, symlinksTo, status: 'offloaded', registryEntry });
      finish(); return;
    }

    exec(`du -sk "${fullPath}" 2>/dev/null | cut -f1`, (err, stdout) => {
      const sizeKB = parseInt(stdout.trim()) || 0;
      const sizeBytes = sizeKB * 1024;
      let sizeDisplay;
      if (sizeBytes >= 1073741824) sizeDisplay = `${(sizeBytes / 1073741824).toFixed(1)} GB`;
      else if (sizeBytes >= 1048576) sizeDisplay = `${(sizeBytes / 1048576).toFixed(0)} MB`;
      else sizeDisplay = `${Math.round(sizeKB / 1024)} MB`;
      results.push({ ...target, fullPath, sizeBytes, sizeDisplay, isSymlink: false, status: 'present', registryEntry });
      finish();
    });
  });
});

// Set dei path in offload attivo — previene esecuzioni concorrenti sullo stesso path
const activeOffloads = new Set();

function checkProcessRunning(processName) {
  return new Promise(resolve => {
    exec(`pgrep -xi "${processName}"`, (err, stdout) => {
      // pgrep exit code 1 = nessun processo → err non-null ma stdout vuoto
      resolve(!!stdout && stdout.trim().length > 0);
    });
  });
}

app.post('/api/offload/execute', async (req, res) => {
  const { targetPath, destVolume, action } = req.body;

  if (!targetPath || !targetPath.startsWith(HOME + '/')) {
    return res.status(400).json({ error: 'Path non valido' });
  }

  // Pre-flight: verifica se l'app associata è in esecuzione
  const targetMeta = OFFLOAD_TARGETS.find(t => path.join(HOME, t.relPath) === targetPath);
  if (targetMeta && targetMeta.processName) {
    const isRunning = await checkProcessRunning(targetMeta.processName);
    if (isRunning) {
      return res.status(409).json({
        error: `${targetMeta.label} è ancora in esecuzione`,
        detail: `Chiudi completamente "${targetMeta.processName}" e riprova. File aperti durante rsync causano copie incomplete o corruzione dei dati.`,
        processName: targetMeta.processName
      });
    }
  }

  if (action === 'delete') {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return res.json({ success: true, message: 'Eliminato con successo' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (!destVolume || !fs.existsSync(destVolume)) {
    return res.status(400).json({ error: 'Volume destinazione non trovato' });
  }

  // FIX: lock concorrenza — blocca esecuzioni simultanee sullo stesso path
  if (activeOffloads.has(targetPath)) {
    return res.status(409).json({ error: 'Offload già in corso per questo path' });
  }
  activeOffloads.add(targetPath);

  const destDir = path.join(destVolume, 'MacSymlinks');
  const targetName = path.basename(targetPath);
  const dest = path.join(destDir, targetName);
  const emit = (msg) => io.emit('offload:progress', { targetPath, message: msg });
  const fail = (msg) => { activeOffloads.delete(targetPath); io.emit('offload:error', { targetPath, message: msg }); };

  // FIX: mkdirSync dentro try-catch — Express 4 non cattura eccezioni sync in handler async
  try {
    fs.mkdirSync(destDir, { recursive: true });
  } catch (e) {
    activeOffloads.delete(targetPath);
    return res.status(500).json({ error: `Impossibile creare directory destinazione: ${e.message}` });
  }

  // Risposta inviata solo dopo che la directory è stata creata con successo
  res.json({ status: 'started', message: 'Offload avviato' });
  emit(`rsync ${targetName} → ${destDir}…`);

  // FIX write-ahead: salva entry 'pending' nel registry PRIMA delle operazioni distruttive
  // Se il processo crasha tra symlink e saveRegistry, la entry 'pending' segnala lo stato
  const entryId = Date.now().toString();
  const pendingRegistry = loadRegistry();
  pendingRegistry.push({ id: entryId, original: targetPath, dest, created: new Date().toISOString(), status: 'pending' });
  saveRegistry(pendingRegistry);

  const rsync = spawn('rsync', ['-a', '--delete', `${targetPath}/`, `${dest}/`]);
  rsync.stderr.on('data', d => emit(`rsync: ${d.toString().trim()}`));

  rsync.on('close', (code) => {
    if (code !== 0) { fail(`rsync fallito (code ${code})`); return; }

    emit('Verifica conteggio file…');
    // FIX: usa find separati per evitare parsing fragile, controlla err prima di stdout
    exec(`find "${targetPath}" | wc -l`, (err1, out1) => {
      if (err1) { fail(`Verifica src fallita: ${err1.message}`); return; }
      exec(`find "${dest}" | wc -l`, (err2, out2) => {
        if (err2) { fail(`Verifica dst fallita: ${err2.message}`); return; }

        const srcCount = parseInt(out1.trim()) || 0;
        const dstCount = parseInt(out2.trim()) || 0;

        if (srcCount !== dstCount) {
          fail(`Verifica fallita: src=${srcCount} dst=${dstCount} — originale intatto`); return;
        }

        emit(`Verifica OK (${srcCount} file). Rimozione originale…`);

        try { fs.rmSync(targetPath, { recursive: true, force: true }); }
        catch (e) { fail(`rm fallito: ${e.message}`); return; }

        try { fs.symlinkSync(dest, targetPath); }
        catch (e) { fail(`symlink fallito: ${e.message}`); return; }

        // FIX: aggiorna entry da 'pending' ad 'active' dopo symlink completato
        const registry = loadRegistry();
        const idx = registry.findIndex(r => r.id === entryId);
        if (idx >= 0) registry[idx].status = 'active';
        else registry.push({ id: entryId, original: targetPath, dest, created: new Date().toISOString(), status: 'active' });
        saveRegistry(registry);

        activeOffloads.delete(targetPath);
        io.emit('offload:complete', { targetPath, dest, message: `${targetName} offload completato` });
      });
    });
  });
});

app.get('/api/offload/registry', (req, res) => res.json(loadRegistry()));

app.post('/api/offload/restore', (req, res) => {
  const { id } = req.body;
  const registry = loadRegistry();
  const entry = registry.find(r => r.id === id);

  if (!entry) return res.status(404).json({ error: 'Entry non trovata nel registry' });
  if (!fs.existsSync(entry.dest)) return res.status(400).json({ error: `Destinazione non trovata: ${entry.dest} (volume smontato?)` });

  // FIX: valida che entry.original sia dentro HOME (difesa da registry corrotto)
  if (!entry.original.startsWith(HOME + '/')) {
    return res.status(400).json({ error: 'Path nel registry non valido' });
  }

  res.json({ status: 'started' });

  const emit = (msg) => io.emit('offload:progress', { targetPath: entry.original, message: msg });
  emit(`Restore ${path.basename(entry.original)}…`);

  // FIX: verifica che sia un symlink prima di rimuoverlo (non una directory reale)
  try {
    const stat = fs.lstatSync(entry.original);
    if (!stat.isSymbolicLink()) {
      io.emit('offload:error', { targetPath: entry.original, message: `Restore annullato: il path non è un symlink ma una ${stat.isDirectory() ? 'directory' : 'file'} reale — operazione non sicura` });
      return;
    }
    fs.unlinkSync(entry.original);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      io.emit('offload:error', { targetPath: entry.original, message: `Impossibile rimuovere symlink: ${e.message}` });
      return;
    }
    // ENOENT: symlink già assente, rsync creerà la directory
  }

  const rsync = spawn('rsync', ['-a', `${entry.dest}/`, `${entry.original}/`]);
  rsync.stderr.on('data', d => emit(`rsync: ${d.toString().trim()}`));

  rsync.on('close', (code) => {
    if (code !== 0) { io.emit('offload:error', { targetPath: entry.original, message: `restore fallito (code ${code})` }); return; }

    saveRegistry(registry.filter(r => r.id !== id));
    io.emit('offload:complete', { targetPath: entry.original, restored: true, message: `${path.basename(entry.original)} ripristinato` });
  });
});

app.get('/api/offload/health', (req, res) => {
  const registry = loadRegistry();
  const checks = registry.map(entry => {
    let symlinkOk = false;
    let destExists = false;
    try { symlinkOk = fs.lstatSync(entry.original).isSymbolicLink(); } catch (e) { /* missing */ }
    destExists = fs.existsSync(entry.dest);
    return { ...entry, symlinkOk, destExists, healthy: symlinkOk && destExists };
  });
  res.json({ checks, healthy: checks.every(c => c.healthy) });
});

// ─────────────────────────────────────────────────────────────

// Shutdown completo: termina processo CleanMac se attivo + server
app.post('/api/shutdown', (req, res) => {
  res.json({ ok: true, message: 'Server in arresto...' });

  // Termina CleanMac se in esecuzione
  if (currentExecution && typeof currentExecution.kill === 'function') {
    try { currentExecution.kill('SIGTERM'); } catch (e) { /* ignore */ }
  }
  currentExecution = null;
  sudoPassword = null;

  // Rimuovi PID file
  const pidFile = path.join(__dirname, 'server.pid');
  try { if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile); } catch (e) { /* ignore */ }

  // Cleanup script temporaneo
  cleanupTempScript();

  // Aspetta 500ms poi termina il server
  setTimeout(() => {
    process.exit(0);
  }, 500);
});

// Avvio server
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║                                        ║
║   🧹 CleanMac Web Interface v5.0      ║
║                                        ║
║   Server running on:                   ║
║   http://localhost:${PORT}                ║
║                                        ║
╚════════════════════════════════════════╝
  `);
});
