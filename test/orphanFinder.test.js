// test/orphanFinder.test.js — v5.2
// Test sulla logica pura del finder di residui e dell'inventario app.
// Eseguibili senza macOS.

'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');

const orphanFinder = require('../orphanFinder');
const { isDeletableOrphan, _internal } = orphanFinder;
const { belongsToInstalledApp, isSkippedReverse } = _internal;
const { normalizeForMatching } = require('../stringNormalization');
const appInventory = require('../appInventory');

const HOME = os.homedir();
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

console.log('orphanFinder — guard-rail di eliminazione');

test('rifiuta path fuori dalle aree utente note', () => {
  assert.strictEqual(isDeletableOrphan('/etc/passwd'), false);
  assert.strictEqual(isDeletableOrphan('/Library/LaunchDaemons/x.plist'), false);
  assert.strictEqual(isDeletableOrphan(`${HOME}/Documents/tesi.pdf`), false);
});

test('rifiuta path relativi e con ..', () => {
  assert.strictEqual(isDeletableOrphan('relativo/x'), false);
  assert.strictEqual(isDeletableOrphan(`${HOME}/Library/Caches/../../.ssh`), false);
});

test('rifiuta sempre i bundle .app', () => {
  assert.strictEqual(isDeletableOrphan(`${HOME}/Library/Caches/Foo.app`), false);
  assert.strictEqual(isDeletableOrphan(`${HOME}/Library/Application Support/Foo.app/x`), false);
});

test('rifiuta la radice stessa di un area consentita (solo i figli)', () => {
  assert.strictEqual(isDeletableOrphan(`${HOME}/Library/Caches`), false);
});

test('rifiuta input non stringa', () => {
  assert.strictEqual(isDeletableOrphan(null), false);
  assert.strictEqual(isDeletableOrphan(42), false);
  assert.strictEqual(isDeletableOrphan(undefined), false);
});

test('le aree consentite sono tutte dentro ~/Library', () => {
  for (const root of orphanFinder.ORPHAN_DELETABLE_ROOTS) {
    assert.ok(root.startsWith(path.join(HOME, 'Library')), `${root} fuori da ~/Library`);
  }
});

console.log('orphanFinder — classificazione');

test('isSkippedReverse salta daemon Apple e SDK condivisi', () => {
  assert.ok(isSkippedReverse(normalizeForMatching('com.apple.something')));
  assert.ok(isSkippedReverse(normalizeForMatching('Sparkle')));
  assert.ok(isSkippedReverse(normalizeForMatching('Chromium')));
  assert.ok(isSkippedReverse(normalizeForMatching('CleanMac')));
});

test('isSkippedReverse non salta un residuo di terze parti', () => {
  assert.ok(!isSkippedReverse(normalizeForMatching('com.vendorxyz.oldapp')));
});

test('isSkippedReverse tratta il nome vuoto come da saltare', () => {
  assert.strictEqual(isSkippedReverse(''), true);
});

test('belongsToInstalledApp riconosce bundle id e nome', () => {
  const ids = ['comvendorxyzcoolapp'];
  const names = ['coolapp'];
  assert.ok(belongsToInstalledApp('comvendorxyzcoolapp', ids, names));
  assert.ok(belongsToInstalledApp('coolappcache', ids, names));
  assert.ok(!belongsToInstalledApp('comaltrovendoraltraapp', ids, names));
});

test('belongsToInstalledApp ignora identificatori troppo corti', () => {
  // un nome di 3 lettere non deve far passare per "installato" mezzo Library
  assert.ok(!belongsToInstalledApp('vlcplayerresidui', ['ab'], ['vlc']));
});

test('findOrphans senza app installate non produce falsi positivi', () => {
  const res = orphanFinder.findOrphans({ apps: [] });
  assert.deepStrictEqual(res.items, []);
  assert.ok(res.error);
});

console.log('appInventory');

test('PROTECTED_BUNDLE_IDS copre le app Apple principali', () => {
  for (const id of ['com.apple.Safari', 'com.apple.finder', 'com.apple.Photos', 'com.apple.dt.Xcode']) {
    assert.ok(appInventory.PROTECTED_BUNDLE_IDS.has(id), `${id} non protetto`);
  }
});

test('daysSince calcola i giorni trascorsi', () => {
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
  assert.strictEqual(appInventory._internal.daysSince(tenDaysAgo), 10);
  assert.strictEqual(appInventory._internal.daysSince(null), null);
  assert.strictEqual(appInventory._internal.daysSince('non-una-data'), null);
});

test('listInstalledApps degrada senza crash fuori da macOS', () => {
  const apps = appInventory.listInstalledApps({ withSize: false, withLastUsed: false });
  assert.ok(Array.isArray(apps));
});

console.log('');
console.log(`Risultato: ${passed} passati, ${failed} falliti`);
process.exit(failed > 0 ? 1 : 0);
