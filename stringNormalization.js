// stringNormalization.js — v5.1
// Porting 1:1 di StringNormalization.swift (MyPureMac).
// Helper puri di normalizzazione stringhe usati dal motore euristico.

'use strict';

// Minuscolo + rimozione di spazi, trattini, underscore e punti (come Swift).
function normalizeForMatching(s) {
  return String(s || '').toLowerCase().replace(/[ \-_.]/g, '');
}

// Rimuove una versione numerica finale ("Foo 2", "Foo 3.1.4" → "Foo").
function strippingTrailingVersion(s) {
  return String(s || '').replace(/\s+\d+(\.\d+)*\s*$/, '').trim();
}

// Solo lettere, minuscole ("VLC 3" → "vlc").
function lettersOnly(s) {
  return String(s || '').replace(/[^a-zA-Z]/g, '').toLowerCase();
}

// Company dal bundle id, solo se ha esattamente 3 componenti
// (com.company.app → "company"), come in Swift.
function bundleCompanyName(bundleId) {
  const parts = String(bundleId || '').split('.');
  if (parts.length !== 3) return null;
  const company = parts[1];
  return company ? normalizeForMatching(company) : null;
}

// Ultimi due componenti del bundle id concatenati e normalizzati
// (com.company.app → "companyapp").
function bundleLastTwoComponents(bundleId) {
  const parts = String(bundleId || '').split('.')
    .filter(c => c && c !== '-')
    .map(c => c.toLowerCase());
  return normalizeForMatching(parts.slice(-2).join(''));
}

// Bundle id senza suffisso helper/agent/daemon/…
// (com.foo.app.helper → com.foo.app). Null se non c'è un suffisso noto.
const HELPER_SUFFIXES = new Set([
  'helper', 'agent', 'daemon', 'service', 'xpc',
  'launcher', 'updater', 'installer', 'uninstaller',
  'login', 'extension', 'plugin',
]);
function baseBundleIdentifier(bundleId) {
  const parts = String(bundleId || '').split('.');
  if (parts.length < 4) return null;
  const last = parts[parts.length - 1].toLowerCase();
  if (!HELPER_SUFFIXES.has(last)) return null;
  return parts.slice(0, -1).join('.');
}

module.exports = {
  normalizeForMatching,
  strippingTrailingVersion,
  lettersOnly,
  bundleCompanyName,
  bundleLastTwoComponents,
  baseBundleIdentifier,
};
