// test/appPathFinder.test.js — v5.1
// Test unitari sulla logica pura del motore euristico (nessun accesso a
// filesystem macOS: eseguibili anche su Linux/CI con `npm test`).

'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');

const {
  normalizeForMatching,
  strippingTrailingVersion,
  lettersOnly,
  bundleCompanyName,
  bundleLastTwoComponents,
  baseBundleIdentifier,
} = require('../stringNormalization');

const { _internal } = require('../appPathFinder');
const {
  matchesApp, filterSubpaths, shouldSkipItem, normalizedItemName,
  parseTeamIdentifier, parseEntitlementGroups, conditionsFor,
} = _internal;

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

// Costruisce un matcher sintetico (senza leggere il filesystem), replicando
// la logica di buildMatcher a partire da nome app e bundle id noti.
function fakeMatcher(appName, bundleId, opts = {}) {
  const normalizedAppName = normalizeForMatching(appName);
  const stripped = normalizeForMatching(strippingTrailingVersion(appName));
  const base = baseBundleIdentifier(bundleId);
  return {
    appPath: `/Applications/${appName}.app`,
    appName,
    bundleId,
    normalizedBundleID: normalizeForMatching(bundleId),
    normalizedAppName,
    appNameLettersOnly: lettersOnly(appName),
    pathComponentName: normalizedAppName,
    bundleLastTwo: bundleLastTwoComponents(bundleId),
    baseBundleID: base ? normalizeForMatching(base) : '',
    strippedAppName: (stripped && stripped !== normalizedAppName) ? stripped : '',
    companyName: bundleCompanyName(bundleId) || '',
    normalizedEntitlements: (opts.entitlements || []).map(normalizeForMatching),
    normalizedTeamID: normalizeForMatching(opts.teamId || ''),
  };
}

console.log('stringNormalization');

test('normalizeForMatching rimuove spazi, trattini, underscore, punti', () => {
  assert.strictEqual(normalizeForMatching('Com.Apple.DT Xcode-Beta_1'), 'comappledtxcodebeta1');
});

test('strippingTrailingVersion rimuove solo la versione finale', () => {
  assert.strictEqual(strippingTrailingVersion('Foo 3.1.4'), 'Foo');
  assert.strictEqual(strippingTrailingVersion('Foo 2'), 'Foo');
  assert.strictEqual(strippingTrailingVersion('1Password'), '1Password');
});

test('lettersOnly tiene solo le lettere', () => {
  assert.strictEqual(lettersOnly('VLC 3'), 'vlc');
  assert.strictEqual(lettersOnly('1Password 8'), 'password');
});

test('bundleCompanyName solo con esattamente 3 componenti', () => {
  assert.strictEqual(bundleCompanyName('com.company.app'), 'company');
  assert.strictEqual(bundleCompanyName('com.company.suite.app'), null);
  assert.strictEqual(bundleCompanyName('nodots'), null);
});

test('bundleLastTwoComponents concatena e normalizza gli ultimi due', () => {
  assert.strictEqual(bundleLastTwoComponents('com.logi.optionsplus'), 'logioptionsplus');
  assert.strictEqual(bundleLastTwoComponents('com.native-instruments.nativeaccess'), 'nativeinstrumentsnativeaccess');
});

test('baseBundleIdentifier rimuove i suffissi helper/agent/…', () => {
  assert.strictEqual(baseBundleIdentifier('com.foo.app.helper'), 'com.foo.app');
  assert.strictEqual(baseBundleIdentifier('com.foo.app.Updater'), 'com.foo.app');
  assert.strictEqual(baseBundleIdentifier('com.foo.app'), null);
  assert.strictEqual(baseBundleIdentifier('com.foo.helper'), null); // solo 3 componenti
});

console.log('matchesApp — livelli di matching');

test('livello 1: bundle id completo', () => {
  const m = fakeMatcher('Slack', 'com.tinyspeck.slackmacgap');
  assert.ok(matchesApp(m, 'comtinyspeckslackmacgap', 'strict'));
});

test('livello 2: nome app (strict = esatto, enhanced = substring)', () => {
  const m = fakeMatcher('Slack', 'com.tinyspeck.slackmacgap');
  assert.ok(matchesApp(m, 'slack', 'strict'));
  assert.ok(!matchesApp(m, 'slackhelperlogs', 'strict'));
  assert.ok(matchesApp(m, 'slackhelperlogs', 'enhanced'));
});

test('livello 5: ultimi due componenti bundle id solo in enhanced', () => {
  const m = fakeMatcher('MyTool', 'com.vendorxy.mytoolpro');
  assert.ok(!matchesApp(m, 'vendorxymytoolpro', 'strict'));
  assert.ok(matchesApp(m, 'vendorxymytoolpro-cache', 'enhanced'));
});

test('livello 6: base bundle id senza suffisso helper', () => {
  const m = fakeMatcher('CoolApp', 'com.vendor.coolapp.helper');
  assert.ok(matchesApp(m, 'comvendorcoolapp', 'enhanced'));
});

test('livello 7: nome senza versione finale', () => {
  const m = fakeMatcher('SuperEditor 3', 'com.vendor.supereditor3x');
  assert.ok(matchesApp(m, 'supereditorsettings', 'enhanced'));
  assert.ok(!matchesApp(m, 'supereditorsettings', 'strict'));
});

test('livello 8: company name solo in deep', () => {
  const m = fakeMatcher('Widget', 'com.acmecorp.widget');
  assert.ok(!matchesApp(m, 'acmecorplicense', 'enhanced'));
  assert.ok(matchesApp(m, 'acmecorplicense', 'deep'));
});

test('livello 9: team id solo in deep', () => {
  const m = fakeMatcher('Widget', 'com.acmecorp.widget', { teamId: 'AB12CD34EF' });
  assert.ok(matchesApp(m, 'ab12cd34efdata', 'deep'));
  assert.ok(!matchesApp(m, 'ab12cd34efdata', 'enhanced'));
});

test('entitlements (application-groups) matchano in enhanced', () => {
  const m = fakeMatcher('Widget', 'com.acmecorp.widget', { entitlements: ['group.com.acmecorp.shared'] });
  assert.ok(matchesApp(m, 'groupcomacmecorpshared', 'enhanced'));
});

test('nomi corti/generici non matchano (guardie di lunghezza)', () => {
  const m = fakeMatcher('Go', 'a.b');
  assert.ok(!matchesApp(m, 'godaddy', 'enhanced'));
  assert.ok(!matchesApp(m, '', 'deep'));
});

console.log('Condizioni per-app (Conditions.swift)');

test('Chrome: excludeTerms vincono (iterm non è di Chrome)', () => {
  const m = fakeMatcher('Google Chrome', 'com.google.chrome');
  assert.ok(!matchesApp(m, 'com.googlecode.iterm2'.replace(/\./g, ''), 'deep'));
  assert.ok(!matchesApp(m, 'iterm2state', 'deep'));
});

test('Chrome: includeTerms forzano il match (google)', () => {
  const m = fakeMatcher('Google Chrome', 'com.google.chrome');
  assert.ok(matchesApp(m, 'googlesoftwareupdate', 'strict'));
});

test('Zoom: includeTerm "zoom" nonostante bundle us.zoom.xos', () => {
  const m = fakeMatcher('zoom.us', 'us.zoom.xos');
  assert.ok(matchesApp(m, 'zoomussage', 'strict'));
});

test('Logi Options+: esclude login/logic, include logi', () => {
  const m = fakeMatcher('Logi Options+', 'com.logi.optionsplus');
  assert.ok(!matchesApp(m, 'loginwindowstate', 'deep'));
  assert.ok(!matchesApp(m, 'logicproprefs', 'deep'));
  assert.ok(matchesApp(m, 'logipluginservicelogs', 'strict'));
});

test('conditionsFor trova le regole per bundle id parziale (jetbrains)', () => {
  const m = fakeMatcher('IntelliJ IDEA', 'com.jetbrains.intellij');
  const conds = conditionsFor(m);
  assert.ok(conds.length >= 1);
  assert.ok(conds[0].includeTerms.includes('jcef'));
});

console.log('Skip logic');

test('shouldSkipItem: dsstore e mobiledocuments sono skippati', () => {
  assert.ok(shouldSkipItem('dsstore', `${HOME}/Library/Caches/x`));
  assert.ok(shouldSkipItem('mobiledocumentsfoo', `${HOME}/Library/x`));
});

test('shouldSkipItem: allowPrefixes vince (comappledt)', () => {
  assert.ok(!shouldSkipItem('comappledtxcode', `${HOME}/Library/Caches/com.apple.dt.Xcode`));
});

test('shouldSkipItem: path nel Cestino sempre skippato', () => {
  assert.ok(shouldSkipItem('qualcosa', `${HOME}/.Trash/qualcosa`));
});

console.log('Post-processing');

test('filterSubpaths: il genitore assorbe i figli', () => {
  const out = filterSubpaths(new Set([
    '/a/b', '/a/b/c', '/a/b/c/d', '/x/y',
  ]));
  assert.deepStrictEqual(out, ['/a/b', '/x/y']);
});

test('filterSubpaths: non confonde prefissi di nome (/a/bb non è figlio di /a/b)', () => {
  const out = filterSubpaths(new Set(['/a/b', '/a/bb']));
  assert.deepStrictEqual(out, ['/a/b', '/a/bb']);
});

test('filterSubpaths: un risultato composto dal solo Cestino è scartato', () => {
  const out = filterSubpaths(new Set([`${HOME}/.Trash/OldApp`]));
  assert.deepStrictEqual(out, []);
});

console.log('Parser metadata');

test('normalizedItemName: directory intere, file senza estensione', () => {
  assert.strictEqual(normalizedItemName('com.foo.bar.plist', false), 'comfoobar');
  assert.strictEqual(normalizedItemName('com.foo.bar', true), 'comfoobar');
  assert.strictEqual(normalizedItemName('Foo App.savedState', false), 'fooapp');
});

test('parseTeamIdentifier estrae il team dalla output codesign', () => {
  const txt = 'Identifier=com.foo\nTeamIdentifier=ABCDE12345\nSealed Resources...';
  assert.strictEqual(parseTeamIdentifier(txt), 'ABCDE12345');
  assert.strictEqual(parseTeamIdentifier('TeamIdentifier=not set'), '');
  assert.strictEqual(parseTeamIdentifier(''), '');
});

test('parseEntitlementGroups estrae application-groups e keychain-access-groups', () => {
  const xml = `<?xml version="1.0"?><plist><dict>
    <key>com.apple.security.application-groups</key>
    <array><string>group.com.foo.shared</string><string>group.com.foo.sync</string></array>
    <key>keychain-access-groups</key>
    <array><string>TEAM.com.foo</string></array>
    <key>other</key><array><string>ignorami</string></array>
  </dict></plist>`;
  assert.deepStrictEqual(parseEntitlementGroups(xml),
    ['group.com.foo.shared', 'group.com.foo.sync', 'TEAM.com.foo']);
});

console.log('');
console.log(`Risultato: ${passed} passati, ${failed} falliti`);
process.exit(failed > 0 ? 1 : 0);
