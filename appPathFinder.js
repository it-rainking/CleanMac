// appPathFinder.js — v5.1 (Synthesis Edition)
//
// Derivato da PureMac (https://github.com/momenbasel/PureMac) — MIT License,
// Copyright (c) 2026 PureMac Contributors. Vedi LICENSE, sezione THIRD-PARTY CODE.
// Sorgente originale: Logic/Scanning/AppPathFinder.swift
//
// Motore euristico di scoperta file, porting completo di
// AppPathFinder.swift (matching a 9 livelli + condizioni per-app).
// Individua gli artefatti su filesystem appartenenti a una app macOS.
//
// Livelli di matching (per sensitivity crescente):
//   strict:   1) bundle id completo  2) nome app (esatto)
//             3) nome directory .app (esatto)  4) nome solo-lettere (esatto)
//             + entitlements (esatti)
//   enhanced: come strict ma a substring, più
//             5) ultimi due componenti bundle id
//             6) base bundle id (senza suffisso .helper/.agent/…)
//             7) nome app senza versione finale ("Foo 2" → "foo")
//   deep:     8) company dal bundle id  9) Team ID della firma codice
//
// Nota sicurezza: questo modulo NON elimina nulla. Chi chiama (server.js)
// valida ogni path con isSafeRelatedPath prima di qualsiasi eliminazione.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const {
  normalizeForMatching,
  strippingTrailingVersion,
  lettersOnly,
  bundleCompanyName,
  bundleLastTwoComponents,
  baseBundleIdentifier,
} = require('./stringNormalization');

const {
  appConditions,
  skipConditions,
  skipDeepSearch,
  standardLibrarySubdirectories,
  appSearchPaths,
} = require('./conditions');

const HOME = os.homedir();
const LIBRARY_ROOTS = new Set([path.join(HOME, 'Library'), '/Library']);

// ---------------------------------------------------------------------------
// Lettura metadata dell'app (bundle id, firma codice, entitlements)
// ---------------------------------------------------------------------------

function readBundleId(appPath) {
  try {
    const infoPlist = path.join(appPath, 'Contents', 'Info');
    const out = execFileSync('/usr/bin/defaults', ['read', infoPlist, 'CFBundleIdentifier'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim();
  } catch (e) {
    return '';
  }
}

// Team ID dalla firma codice (usato solo in modalità deep).
function readTeamIdentifier(appPath) {
  try {
    const out = execFileSync('/usr/bin/codesign', ['-dv', '--verbose=4', appPath], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseTeamIdentifier(out);
  } catch (e) {
    // codesign scrive su stderr: in caso di exit 0 con output su stderr
    // execFileSync lancia solo per exit != 0; recupera stderr se presente.
    const err = (e && (e.stderr || e.stdout)) || '';
    return parseTeamIdentifier(String(err));
  }
}

function parseTeamIdentifier(text) {
  const m = /TeamIdentifier=([A-Z0-9]{4,})/.exec(text || '');
  return m && m[1] !== 'not' ? m[1] : '';
}

// Estrae identificatori "file-like" dagli entitlements (application-groups,
// keychain-access-groups): sono i valori che compaiono come nomi di cartelle
// in Group Containers e simili.
function readEntitlementGroups(appPath) {
  try {
    const xml = execFileSync('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', appPath], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseEntitlementGroups(xml);
  } catch (e) {
    return [];
  }
}

function parseEntitlementGroups(xml) {
  const groups = [];
  const keyRe = /<key>(com\.apple\.security\.application-groups|keychain-access-groups)<\/key>\s*<array>([\s\S]*?)<\/array>/g;
  let m;
  while ((m = keyRe.exec(String(xml || ''))) !== null) {
    const strRe = /<string>([^<]+)<\/string>/g;
    let s;
    while ((s = strRe.exec(m[2])) !== null) {
      groups.push(s[1].trim());
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

function buildMatcher(appPath, sensitivity) {
  const appName = path.basename(appPath).replace(/\.app$/i, '');
  const bundleId = readBundleId(appPath);

  const normalizedAppName = normalizeForMatching(appName);
  const stripped = normalizeForMatching(strippingTrailingVersion(appName));
  const base = baseBundleIdentifier(bundleId);

  const entitlements = (sensitivity === 'strict') ? [] : readEntitlementGroups(appPath);
  const teamId = (sensitivity === 'deep') ? readTeamIdentifier(appPath) : '';

  return {
    appPath,
    appName,
    bundleId,
    normalizedBundleID: normalizeForMatching(bundleId),
    normalizedAppName,
    appNameLettersOnly: lettersOnly(appName),
    pathComponentName: normalizeForMatching(path.basename(appPath).replace(/\.app$/i, '')),
    bundleLastTwo: bundleLastTwoComponents(bundleId),
    baseBundleID: base ? normalizeForMatching(base) : '',
    strippedAppName: (stripped && stripped !== normalizedAppName) ? stripped : '',
    companyName: bundleCompanyName(bundleId) || '',
    normalizedEntitlements: entitlements.map(normalizeForMatching).filter(e => e.length >= 5),
    normalizedTeamID: normalizeForMatching(teamId),
  };
}

// Condizioni per-app applicabili a questo matcher.
function conditionsFor(matcher) {
  return appConditions.filter(c => c.bundleID && matcher.normalizedBundleID.includes(c.bundleID));
}

// Decide se un nome file normalizzato appartiene all'app.
function matchesApp(matcher, normalizedName, sensitivity) {
  if (!normalizedName) return false;
  const strict = sensitivity === 'strict';

  // Override per-app: exclude vince, include forza il match.
  for (const c of conditionsFor(matcher)) {
    if (c.excludeTerms.some(t => t && normalizedName.includes(t))) return false;
    if (c.includeTerms.some(t => t && normalizedName.includes(t))) return true;
  }

  // Entitlements (application-groups / keychain-access-groups)
  for (const ent of matcher.normalizedEntitlements) {
    if (strict ? normalizedName === ent : normalizedName.includes(ent)) return true;
  }

  // Livello 1: bundle id completo (>=5 char per evitare falsi positivi)
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
  // Livello 3: nome della directory .app
  if (matcher.pathComponentName.length >= 3 && matcher.pathComponentName !== matcher.normalizedAppName) {
    if (strict ? normalizedName === matcher.pathComponentName
               : normalizedName.includes(matcher.pathComponentName)) {
      return true;
    }
  }
  // Livello 4: nome solo-lettere ("VLC 3" → "vlc")
  if (matcher.appNameLettersOnly.length >= 3 && matcher.appNameLettersOnly !== matcher.normalizedAppName) {
    if (strict ? normalizedName === matcher.appNameLettersOnly
               : normalizedName.includes(matcher.appNameLettersOnly)) {
      return true;
    }
  }
  if (strict) return false;

  // Livello 5 (enhanced): ultimi due componenti del bundle id
  if (matcher.bundleLastTwo.length >= 5 && normalizedName.includes(matcher.bundleLastTwo)) {
    return true;
  }
  // Livello 6 (enhanced): base bundle id senza suffisso helper/agent/…
  if (matcher.baseBundleID.length >= 5 && normalizedName.includes(matcher.baseBundleID)) {
    return true;
  }
  // Livello 7 (enhanced): nome app senza versione finale
  if (matcher.strippedAppName.length >= 3 && normalizedName.includes(matcher.strippedAppName)) {
    return true;
  }

  if (sensitivity !== 'deep') return false;

  // Livello 8 (deep): company dal bundle id
  if (matcher.companyName.length >= 4 && normalizedName.includes(matcher.companyName)) {
    return true;
  }
  // Livello 9 (deep): Team ID della firma codice
  if (matcher.normalizedTeamID.length >= 6 && normalizedName.includes(matcher.normalizedTeamID)) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Skip logic (regole di sistema)
// ---------------------------------------------------------------------------

function shouldSkipItem(normalizedName, fullPath) {
  for (const skip of skipConditions) {
    for (const p of skip.skipPaths) {
      if (fullPath.startsWith(p)) return true;
    }
    if (skip.skipPrefixes.some(pre => normalizedName.startsWith(pre))) {
      if (!skip.allowPrefixes.some(pre => normalizedName.startsWith(pre))) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Scansione location (con deep search a depth 2 per i Library root)
// ---------------------------------------------------------------------------

// Nome normalizzato di un item: le directory e i file senza estensione usano
// il nome intero, gli altri file perdono l'estensione (come in Swift).
function normalizedItemName(item, isDir) {
  const ext = path.extname(item);
  const base = (isDir || !ext) ? item : item.slice(0, -ext.length);
  return normalizeForMatching(base);
}

function processLocation(matcher, location, currentDepth, maxDepth, isLibraryRootSearch, sensitivity, results) {
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
    const isDir = stat.isDirectory();

    const normalized = normalizedItemName(item, isDir);
    if (shouldSkipItem(normalized, full)) continue;

    if (matchesApp(matcher, normalized, sensitivity)) {
      // Per i match a depth 2 dentro un Library root, se il genitore è una
      // "vendor folder" (non una sottodirectory standard del Library) va
      // incluso il genitore intero (es. ~/Library/Application Support/Vendor).
      if (isLibraryRootSearch && currentDepth === 2) {
        const parent = path.dirname(full);
        const parentName = path.basename(parent);
        results.add(standardLibrarySubdirectories.has(parentName) ? full : parent);
      } else {
        results.add(full);
      }
    }

    // Ricorsione fino a maxDepth; al primo livello dei Library root vengono
    // escluse le directory di sistema note (skipDeepSearch).
    if (isDir && currentDepth < maxDepth) {
      if (isLibraryRootSearch && currentDepth === 0 && skipDeepSearch.has(item)) {
        continue;
      }
      processLocation(matcher, full, currentDepth + 1, maxDepth, isLibraryRootSearch, sensitivity, results);
    }
  }
}

// ---------------------------------------------------------------------------
// Container sandbox
// ---------------------------------------------------------------------------

function discoverContainers(matcher, results) {
  const containersPath = path.join(HOME, 'Library/Containers');
  let dirs;
  try { dirs = fs.readdirSync(containersPath); } catch (e) { return; }

  for (const dir of dirs) {
    const full = path.join(containersPath, dir);
    // Container nominato direttamente col bundle id
    if (matcher.normalizedBundleID && normalizeForMatching(dir) === matcher.normalizedBundleID) {
      results.add(full);
      continue;
    }
    // Container UUID: leggi il metadata plist per l'owning bundle id
    if (dir.length === 36 && dir.includes('-')) {
      const meta = path.join(full, '.com.apple.containermanagerd.metadata.plist');
      try {
        const out = execFileSync('/usr/bin/defaults', ['read', meta.replace(/\.plist$/, ''), 'MCMMetadataIdentifier'], {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        });
        if (matcher.bundleId && out.trim() === matcher.bundleId) {
          results.add(full);
        }
      } catch (e) { /* non un container gestito */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Condizioni per-app: force include/exclude path
// ---------------------------------------------------------------------------

function applyConditions(matcher, results) {
  for (const c of conditionsFor(matcher)) {
    for (const p of c.forceIncludePaths) {
      const clean = p.replace(/\/+$/, '');
      if (fs.existsSync(clean)) results.add(clean);
    }
    for (const p of c.forceExcludePaths) {
      results.delete(p.replace(/\/+$/, ''));
    }
  }
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

// Rimuove i sottopath quando un genitore è già nel set; un risultato composto
// dal solo Cestino non è significativo (come in Swift).
function filterSubpaths(urlSet) {
  const sorted = Array.from(urlSet).sort();
  const filtered = [];
  for (const p of sorted) {
    if (!filtered.some(f => p.startsWith(f + path.sep))) {
      filtered.push(p);
    }
  }
  if (filtered.length === 1 && filtered[0].includes('.Trash')) {
    return [];
  }
  return filtered;
}

function dirSizeBytes(p) {
  try {
    const out = execFileSync('/usr/bin/du', ['-sk', p], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const kb = parseInt(out.trim().split(/\s+/)[0], 10) || 0;
    return kb * 1024;
  } catch (e) {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// API pubblica
// ---------------------------------------------------------------------------

/**
 * Scopre tutti i file correlati a una app (il bundle .app è escluso:
 * server.js lo gestisce separatamente).
 * @param {string} appPath  Percorso assoluto del bundle .app
 * @param {'strict'|'enhanced'|'deep'} sensitivity
 * @returns {{appName, bundleId, files: Array<{path, sizeBytes}>}}
 */
function findRelatedFiles(appPath, sensitivity = 'enhanced') {
  const matcher = buildMatcher(appPath, sensitivity);
  const results = new Set();

  // Location dinamiche: sottocartelle di Application Support (come Locations.swift)
  const locations = appSearchPaths();
  const appSupport = path.join(HOME, 'Library/Application Support');
  try {
    for (const sub of fs.readdirSync(appSupport)) {
      const full = path.join(appSupport, sub);
      try {
        if (fs.lstatSync(full).isDirectory()) locations.push(full);
      } catch (e) { /* ignora */ }
    }
  } catch (e) { /* Application Support non leggibile */ }

  for (const loc of locations) {
    const isLibRoot = LIBRARY_ROOTS.has(loc);
    processLocation(matcher, loc, 0, isLibRoot ? 2 : 1, isLibRoot, sensitivity, results);
  }

  discoverContainers(matcher, results);
  applyConditions(matcher, results);

  // Il bundle stesso non è un "file correlato"
  results.delete(matcher.appPath);

  const filtered = filterSubpaths(results).filter(p => p !== matcher.appPath);
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
  _internal: {
    normalizeForMatching,
    matchesApp,
    buildMatcher,
    filterSubpaths,
    shouldSkipItem,
    normalizedItemName,
    parseTeamIdentifier,
    parseEntitlementGroups,
    conditionsFor,
  },
};
