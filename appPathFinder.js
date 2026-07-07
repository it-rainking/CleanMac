// appPathFinder.js — v5.0 (Synthesis Edition)
// Motore euristico di scoperta file, portato da MyPureMac/AppPathFinder.swift.
// Individua gli artefatti su filesystem appartenenti a una app macOS usando
// matching multi-livello (bundle id, nome, ultimi due componenti, container).
//
// Nota sicurezza: restituisce SOLO percorsi dentro le aree note del Library
// utente + il bundle .app. Chi chiama deve comunque validare/confermare prima
// di eliminare. Nessuna eliminazione avviene in questo modulo.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const HOME = os.homedir();

// Directory standard del Library da NON risalire come "vendor folder"
const STANDARD_LIBRARY_SUBDIRS = new Set([
  'Application Support', 'Caches', 'Preferences', 'Logs', 'Containers',
  'Group Containers', 'Saved Application State', 'WebKit', 'HTTPStorages',
  'Cookies', 'LaunchAgents', 'Application Scripts'
]);

// Location scandagliate (equivalente semplificato di Locations.swift)
function searchLocations() {
  return [
    path.join(HOME, 'Library/Application Support'),
    path.join(HOME, 'Library/Caches'),
    path.join(HOME, 'Library/Preferences'),
    path.join(HOME, 'Library/Logs'),
    path.join(HOME, 'Library/Containers'),
    path.join(HOME, 'Library/Group Containers'),
    path.join(HOME, 'Library/Saved Application State'),
    path.join(HOME, 'Library/HTTPStorages'),
    path.join(HOME, 'Library/WebKit'),
    path.join(HOME, 'Library/Application Scripts'),
    path.join(HOME, 'Library/LaunchAgents'),
  ];
}

// Normalizza una stringa per il matching: minuscolo, solo lettere/numeri.
function normalizeForMatching(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Ultimi due componenti di un bundle id (es. com.company.app → companyapp)
function bundleLastTwo(bundleId) {
  const parts = String(bundleId || '').split('.').filter(Boolean);
  if (parts.length < 2) return normalizeForMatching(bundleId);
  return normalizeForMatching(parts.slice(-2).join(''));
}

// Nome "company" da un bundle id (secondo componente, es. com.company.app → company)
function bundleCompanyName(bundleId) {
  const parts = String(bundleId || '').split('.').filter(Boolean);
  if (parts.length >= 2) return normalizeForMatching(parts[1]);
  return '';
}

// Legge il CFBundleIdentifier di un .app tramite `defaults read` (macOS).
function readBundleId(appPath) {
  try {
    const infoPlist = path.join(appPath, 'Contents', 'Info');
    const out = execFileSync('/usr/bin/defaults', ['read', infoPlist, 'CFBundleIdentifier'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    });
    return out.trim();
  } catch (e) {
    return '';
  }
}

// Costruisce il descrittore di matching per una app.
function buildMatcher(appPath) {
  const appName = path.basename(appPath).replace(/\.app$/i, '');
  const bundleId = readBundleId(appPath);
  return {
    appPath,
    appName,
    bundleId,
    normalizedBundleID: normalizeForMatching(bundleId),
    normalizedAppName: normalizeForMatching(appName),
    bundleLastTwo: bundleLastTwo(bundleId),
    companyName: bundleCompanyName(bundleId),
  };
}

// Decide se un nome file normalizzato appartiene all'app (matching multi-livello).
// sensitivity: 'strict' | 'enhanced' | 'deep'
function matchesApp(matcher, normalizedName, sensitivity) {
  if (!normalizedName) return false;
  const strict = sensitivity === 'strict';

  // Livello 1: bundle id completo (richiede >=5 char per evitare falsi positivi)
  if (matcher.normalizedBundleID.length >= 5 && normalizedName.includes(matcher.normalizedBundleID)) {
    return true;
  }
  // Livello 2: nome app
  if (matcher.normalizedAppName.length >= 3) {
    if (strict ? normalizedName === matcher.normalizedAppName
               : normalizedName.includes(matcher.normalizedAppName)) {
      return true;
    }
  }
  if (strict) return false;

  // Livello 3 (enhanced): ultimi due componenti del bundle id
  if (matcher.bundleLastTwo.length >= 5 && normalizedName.includes(matcher.bundleLastTwo)) {
    return true;
  }

  // Livello 4 (deep): nome company
  if (sensitivity === 'deep' && matcher.companyName.length >= 4 &&
      normalizedName.includes(matcher.companyName)) {
    return true;
  }
  return false;
}

// Scansiona una location (1 livello, +1 per la root del Library) cercando match.
function scanLocation(matcher, location, sensitivity, results) {
  let entries;
  try {
    entries = fs.readdirSync(location);
  } catch (e) {
    return;
  }
  for (const item of entries) {
    const full = path.join(location, item);
    let stat;
    try { stat = fs.lstatSync(full); } catch (e) { continue; }
    // Sicurezza: mai seguire symlink
    if (stat.isSymbolicLink()) continue;

    const baseName = item.replace(/\.(plist|savedState)$/i, '');
    const normalized = normalizeForMatching(baseName);

    if (matchesApp(matcher, normalized, sensitivity)) {
      results.add(full);
    }
  }
}

// Scopre i container sandbox (UUID o nominati) via metadata plist.
function discoverContainers(matcher, results) {
  const containersPath = path.join(HOME, 'Library/Containers');
  let dirs;
  try { dirs = fs.readdirSync(containersPath); } catch (e) { return; }

  for (const dir of dirs) {
    const full = path.join(containersPath, dir);
    // Container nominato direttamente col bundle id
    if (normalizeForMatching(dir) === matcher.normalizedBundleID && matcher.normalizedBundleID) {
      results.add(full);
      continue;
    }
    // Container UUID: leggi il metadata plist per l'owning bundle id
    if (dir.length === 36 && dir.includes('-')) {
      const meta = path.join(full, '.com.apple.containermanagerd.metadata.plist');
      try {
        const out = execFileSync('/usr/bin/defaults', ['read', meta.replace(/\.plist$/, ''), 'MCMMetadataIdentifier'], {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
        });
        if (out.trim() === matcher.bundleId && matcher.bundleId) {
          results.add(full);
        }
      } catch (e) { /* non un container gestito */ }
    }
  }
}

// Rimuove i sottopath quando un genitore è già nel set.
function filterSubpaths(urlSet) {
  const sorted = Array.from(urlSet).sort();
  const filtered = [];
  for (const p of sorted) {
    if (!filtered.some(f => p.startsWith(f + path.sep))) {
      filtered.push(p);
    }
  }
  return filtered;
}

function dirSizeBytes(p) {
  try {
    const out = execFileSync('/usr/bin/du', ['-sk', p], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    });
    const kb = parseInt(out.trim().split(/\s+/)[0], 10) || 0;
    return kb * 1024;
  } catch (e) {
    return 0;
  }
}

/**
 * Scopre tutti i file correlati a una app.
 * @param {string} appPath  Percorso assoluto del bundle .app
 * @param {'strict'|'enhanced'|'deep'} sensitivity
 * @returns {{appName, bundleId, files: Array<{path, sizeBytes}>}}
 */
function findRelatedFiles(appPath, sensitivity = 'enhanced') {
  const matcher = buildMatcher(appPath);
  const results = new Set();

  for (const loc of searchLocations()) {
    scanLocation(matcher, loc, sensitivity, results);
  }
  discoverContainers(matcher, results);

  const filtered = filterSubpaths(results);
  const files = filtered.map(p => ({ path: p, sizeBytes: dirSizeBytes(p) }));
  files.sort((a, b) => b.sizeBytes - a.sizeBytes);

  return {
    appName: matcher.appName,
    bundleId: matcher.bundleId,
    files,
  };
}

module.exports = {
  findRelatedFiles,
  // esportati per test unitari
  _internal: { normalizeForMatching, bundleLastTwo, bundleCompanyName, matchesApp, buildMatcher, filterSubpaths },
};
