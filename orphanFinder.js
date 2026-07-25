// orphanFinder.js — v5.2
//
// Derivato da PureMac (https://github.com/momenbasel/PureMac) — MIT License,
// Copyright (c) 2026 PureMac Contributors. Vedi LICENSE, sezione THIRD-PARTY CODE.
// Sorgente originale: ViewModels/AppState.swift (findOrphans)
//
// Ricerca inversa dei residui + guard-rail di sicurezza.
// Ricerca inversa: enumera le location note e segnala gli item che non
// appartengono ad alcuna app installata (residui di app disinstallate).
//
// Il modulo NON elimina nulla: marca ogni candidato con `deletable` e lascia
// la decisione al chiamante (server.js), che valida di nuovo prima di rimuovere.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { normalizeForMatching } = require('./stringNormalization');
const { skipReverse, reverseSearchPaths } = require('./conditions');
const { listInstalledApps } = require('./appInventory');

const HOME = os.homedir();

// Aree in cui un orfano può essere eliminato. Deliberatamente più strette
// delle location scandite: `/Library` e i PrivilegedHelperTools di sistema
// vengono segnalati ma mai rimossi automaticamente.
const ORPHAN_DELETABLE_ROOTS = [
  path.join(HOME, 'Library/Application Scripts'),
  path.join(HOME, 'Library/Application Support'),
  path.join(HOME, 'Library/Caches'),
  path.join(HOME, 'Library/Containers'),
  path.join(HOME, 'Library/HTTPStorages'),
  path.join(HOME, 'Library/Logs'),
  path.join(HOME, 'Library/Preferences'),
  path.join(HOME, 'Library/Saved Application State'),
  path.join(HOME, 'Library/WebKit'),
];

function isDeletableOrphan(p) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.includes('..')) return false;
  const inRoot = ORPHAN_DELETABLE_ROOTS.some(root => p.startsWith(root + path.sep));
  if (!inRoot) return false;
  // Mai un bundle .app: la disinstallazione delle app passa dall'uninstaller.
  if (/\.app(\/|$)/i.test(p)) return false;
  try {
    const real = fs.realpathSync(p);
    return ORPHAN_DELETABLE_ROOTS.some(root => real.startsWith(root + path.sep));
  } catch (e) {
    return false; // symlink rotto o non risolvibile
  }
}

function itemSizeBytes(p) {
  try {
    const out = execFileSync('/usr/bin/du', ['-sk', p], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000,
    });
    return (parseInt(out.trim().split(/\s+/)[0], 10) || 0) * 1024;
  } catch (e) {
    return 0;
  }
}

// Un item appartiene a un'app installata se il suo nome normalizzato contiene
// il bundle id o il nome di una app presente sul sistema.
function belongsToInstalledApp(normalized, knownIds, knownNames) {
  for (const id of knownIds) {
    if (id.length >= 5 && normalized.includes(id)) return true;
  }
  for (const name of knownNames) {
    if (name.length >= 4 && normalized.includes(name)) return true;
  }
  return false;
}

// I prefissi di `skipReverse` si applicano all'inizio del nome normalizzato:
// un item "com.apple.X" diventa "comappleX" e NON viene intercettato dal
// prefisso "apple". L'op33 bash ha un `case com.apple.*` esplicito; qui serve
// la stessa guardia, altrimenti ogni file di sistema Apple risulta orfano.
const SYSTEM_NAME_PREFIXES = ['comapple', 'apple', 'comappleplatform'];

function isSkippedReverse(normalized) {
  if (!normalized) return true;
  if (SYSTEM_NAME_PREFIXES.some(prefix => normalized.startsWith(prefix))) return true;
  return skipReverse.some(prefix => prefix && normalized.startsWith(prefix));
}

/**
 * Cerca i residui di app disinstallate.
 * @param {{minSizeBytes?: number, apps?: Array}} opts
 * @returns {{scannedLocations, installedApps, items: Array<{path, name, sizeBytes, deletable}>}}
 */
function findOrphans(opts = {}) {
  const minSize = typeof opts.minSizeBytes === 'number' ? opts.minSizeBytes : 1024 * 1024; // 1 MB
  const apps = opts.apps || listInstalledApps({ withSize: false, withLastUsed: false });

  // Robustezza (come nell'op33 bash): senza l'inventario delle app installate
  // ogni item risulterebbe orfano — meglio non produrre nulla.
  if (!apps.length) {
    return { scannedLocations: 0, installedApps: 0, items: [], error: 'Inventario app installate vuoto: analisi saltata' };
  }

  const knownIds = apps.map(a => normalizeForMatching(a.bundleId)).filter(Boolean);
  const knownNames = apps.map(a => normalizeForMatching(a.name)).filter(Boolean);

  const seen = new Set();
  const items = [];
  let scannedLocations = 0;

  for (const location of reverseSearchPaths()) {
    let entries;
    try { entries = fs.readdirSync(location); } catch (e) { continue; }
    scannedLocations++;

    for (const entry of entries) {
      const full = path.join(location, entry);
      if (seen.has(full)) continue;

      let stat;
      try { stat = fs.lstatSync(full); } catch (e) { continue; }
      if (stat.isSymbolicLink()) continue; // mai seguire symlink

      // Il nome perde l'estensione solo per i file (come nello scan diretto)
      const ext = stat.isDirectory() ? '' : path.extname(entry);
      const base = ext ? entry.slice(0, -ext.length) : entry;
      const normalized = normalizeForMatching(base);

      if (isSkippedReverse(normalized)) continue;
      if (belongsToInstalledApp(normalized, knownIds, knownNames)) continue;

      const sizeBytes = itemSizeBytes(full);
      if (sizeBytes < minSize) continue;

      seen.add(full);
      items.push({
        path: full,
        name: entry,
        location,
        sizeBytes,
        deletable: isDeletableOrphan(full),
      });
    }
  }

  items.sort((a, b) => b.sizeBytes - a.sizeBytes);
  return { scannedLocations, installedApps: apps.length, items };
}

module.exports = {
  findOrphans,
  isDeletableOrphan,
  ORPHAN_DELETABLE_ROOTS,
  _internal: { belongsToInstalledApp, isSkippedReverse },
};
