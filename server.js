#!/usr/bin/env node
// CleanMac Web Interface Server v1.2
// Compatible with CleanMac v4.2 (29 operations + category selection)

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

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

app.post('/api/uninstall-apps', (req, res) => {
  const { apps } = req.body;

  if (!apps || !Array.isArray(apps) || apps.length === 0) {
    return res.status(400).json({ error: 'No apps specified' });
  }

  let deletedCount = 0;
  const errors = [];

  apps.forEach(appName => {
    try {
      // Security check: ensure app name ends with .app
      if (!appName.endsWith('.app')) {
        errors.push({ app: appName, error: 'Invalid app name' });
        return;
      }

      // Common app locations
      const appPaths = [
        path.join('/Applications', appName),
        path.join(process.env.HOME, 'Applications', appName)
      ];

      let found = false;
      for (const appPath of appPaths) {
        if (fs.existsSync(appPath)) {
          const stat = fs.statSync(appPath);
          if (stat.isDirectory()) {
            // Remove app directory recursively
            fs.rmSync(appPath, { recursive: true, force: true });
            deletedCount++;
            found = true;
            break;
          }
        }
      }

      if (!found) {
        errors.push({ app: appName, error: 'App not found' });
      }
    } catch (error) {
      console.error(`Error uninstalling ${appName}:`, error);
      errors.push({ app: appName, error: error.message });
    }
  });

  if (deletedCount > 0) {
    res.json({
      success: true,
      deleted: deletedCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `${deletedCount} applicazioni disinstallate${errors.length > 0 ? ` (${errors.length} errori)` : ''}`
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
║   🧹 CleanMac Web Interface v1.0      ║
║                                        ║
║   Server running on:                   ║
║   http://localhost:${PORT}                ║
║                                        ║
╚════════════════════════════════════════╝
  `);
});
