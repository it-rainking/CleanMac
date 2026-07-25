// appInventory.js — v5.2
//
// Derivato da PureMac (https://github.com/momenbasel/PureMac) — MIT License,
// Copyright (c) 2026 PureMac Contributors. Vedi LICENSE, sezione THIRD-PARTY CODE.
// Sorgente originale: Logic/Scanning/AppInfoFetcher.swift
//
// Inventario delle applicazioni installate con bundle id, dimensione e
// ultimo utilizzo.
//
// Nessuna eliminazione avviene qui: il modulo è di sola lettura.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const HOME = os.homedir();

// App Apple protette: non possono mai essere disinstallate dall'uninstaller.
// Porting di AppInfoFetcher.protectedBundleIDs, allineato alla whitelist bash.
const PROTECTED_BUNDLE_IDS = new Set([
  'com.apple.Safari', 'com.apple.finder', 'com.apple.AppStore',
  'com.apple.systempreferences', 'com.apple.Terminal',
  'com.apple.ActivityMonitor', 'com.apple.dt.Xcode',
  'com.apple.mail', 'com.apple.iCal', 'com.apple.AddressBook',
  'com.apple.Preview', 'com.apple.TextEdit', 'com.apple.calculator',
  'com.apple.MobileSMS', 'com.apple.FaceTime', 'com.apple.Music',
  'com.apple.TV', 'com.apple.Podcasts', 'com.apple.News',
  'com.apple.Maps', 'com.apple.Photos', 'com.apple.Notes',
  'com.apple.reminders', 'com.apple.Stocks', 'com.apple.Home',
  'com.apple.weather', 'com.apple.clock', 'com.apple.Passwords',
  'com.apple.iBooksX', 'com.apple.Dictionary', 'com.apple.Automator',
  'com.apple.ScriptEditor2', 'com.apple.DiskUtility', 'com.apple.keychainaccess',
  'com.apple.FontBook', 'com.apple.Image_Capture', 'com.apple.MigrationAssistant',
  'com.apple.freeform', 'com.apple.VoiceMemos', 'com.apple.shortcuts',
]);

// Location in cui cercare i bundle. /System/Applications è incluso solo per
// riconoscere le app di sistema: non è mai disinstallabile.
const SEARCH_PATHS = [
  { root: '/Applications', removable: true },
  { root: path.join(HOME, 'Applications'), removable: true },
  { root: '/System/Applications', removable: false },
];

function readPlistValue(appPath, key) {
  try {
    const infoPlist = path.join(appPath, 'Contents', 'Info');
    return execFileSync('/usr/bin/defaults', ['read', infoPlist, key], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (e) {
    return '';
  }
}

function bundleSizeBytes(appPath) {
  try {
    const out = execFileSync('/usr/bin/du', ['-sk', appPath], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000,
    });
    return (parseInt(out.trim().split(/\s+/)[0], 10) || 0) * 1024;
  } catch (e) {
    return 0;
  }
}

// Ultimo utilizzo via Spotlight (kMDItemLastUsedDate); fallback su mtime.
function lastUsedISO(appPath) {
  try {
    const out = execFileSync('/usr/bin/mdls', ['-name', 'kMDItemLastUsedDate', '-raw', appPath], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    }).trim();
    if (out && out !== '(null)') {
      const d = new Date(out.replace(' +0000', 'Z').replace(' ', 'T'));
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  } catch (e) { /* Spotlight non disponibile */ }
  try {
    return fs.statSync(appPath).mtime.toISOString();
  } catch (e) {
    return null;
  }
}

function daysSince(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86400000);
}

/**
 * Elenca le applicazioni installate.
 * @param {{withSize?: boolean, withLastUsed?: boolean}} opts
 *   withSize/withLastUsed lanciano `du`/`mdls` per ogni app: più lenti ma
 *   necessari per la vista uninstaller. Default: entrambi attivi.
 * @returns {Array<{name, appPath, bundleId, sizeBytes, lastUsed, daysUnused, protected, removable}>}
 */
function listInstalledApps(opts = {}) {
  const withSize = opts.withSize !== false;
  const withLastUsed = opts.withLastUsed !== false;

  const apps = [];
  const seen = new Set();

  for (const { root, removable } of SEARCH_PATHS) {
    let entries;
    try { entries = fs.readdirSync(root); } catch (e) { continue; }

    for (const entry of entries) {
      if (!entry.endsWith('.app')) continue;
      const appPath = path.join(root, entry);

      let stat;
      try { stat = fs.lstatSync(appPath); } catch (e) { continue; }
      // Mai seguire symlink verso bundle fuori dalle location note
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;

      const bundleId = readPlistValue(appPath, 'CFBundleIdentifier');
      const key = bundleId || appPath;
      if (seen.has(key)) continue;
      seen.add(key);

      const isProtected = PROTECTED_BUNDLE_IDS.has(bundleId) || !removable;
      const lastUsed = withLastUsed ? lastUsedISO(appPath) : null;

      apps.push({
        name: entry.replace(/\.app$/i, ''),
        appPath,
        bundleId,
        sizeBytes: withSize ? bundleSizeBytes(appPath) : 0,
        lastUsed,
        daysUnused: daysSince(lastUsed),
        protected: isProtected,
        removable: removable && !isProtected,
      });
    }
  }

  apps.sort((a, b) => a.name.localeCompare(b.name));
  return apps;
}

module.exports = {
  listInstalledApps,
  PROTECTED_BUNDLE_IDS,
  _internal: { daysSince, readPlistValue },
};
