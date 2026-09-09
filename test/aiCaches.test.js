// test/aiCaches.test.js — v5.3
// Guard-rail sulle operazioni AI di CleanMac.command (op35 / op36).
// Non esegue lo script: ne analizza il sorgente, quindi gira su qualsiasi OS.
//
// Invariante centrale: op35 (CLEANUP, distruttiva) non deve MAI toccare uno
// store di pesi di modelli. Quelli sono di competenza esclusiva di op36, che
// è di sola analisi.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'CleanMac.command'), 'utf8');

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

// Estrae il contenuto di un heredoc dato il suo delimitatore
function heredoc(delimiter) {
  const re = new RegExp(`<< ${delimiter}\\n([\\s\\S]*?)\\n${delimiter}\\n`);
  const m = SCRIPT.match(re);
  assert.ok(m, `heredoc ${delimiter} non trovato in CleanMac.command`);
  return m[1].split('\n').filter(Boolean);
}

// Estrae il corpo di una sezione operazione delimitata dai commenti "# NN."
function section(startMarker, endMarker) {
  const start = SCRIPT.indexOf(startMarker);
  assert.ok(start !== -1, `sezione ${startMarker} non trovata`);
  const end = endMarker ? SCRIPT.indexOf(endMarker, start) : SCRIPT.length;
  assert.ok(end !== -1, `fine sezione ${startMarker} non trovata`);
  return SCRIPT.slice(start, end);
}

const cachePaths = heredoc('AICACHEEOF');
const modelPaths = heredoc('AIMODELEOF').map((line) => line.split('|')[1]);

console.log('CleanMac op35/op36 — guard-rail cache AI');

test('op35 e op36 sono registrate in init_operations_map', () => {
  assert.ok(SCRIPT.includes('echo "op35:0:CLEANUP:Cache AI"'), 'op35 mancante');
  assert.ok(SCRIPT.includes('echo "op36:0:ANALYSIS:Modelli AI"'), 'op36 mancante');
});

test('le liste AI non sono vuote', () => {
  assert.ok(cachePaths.length >= 5, `solo ${cachePaths.length} path di cache`);
  assert.ok(modelPaths.length >= 5, `solo ${modelPaths.length} store di modelli`);
});

test('nessuna cache di op35 coincide con uno store di modelli', () => {
  modelPaths.forEach((model) => {
    assert.ok(!cachePaths.includes(model), `${model} è sia cache che store di modelli`);
  });
});

test('nessuna cache di op35 è contenuta in uno store di modelli', () => {
  cachePaths.forEach((cache) => {
    modelPaths.forEach((model) => {
      assert.ok(
        !cache.startsWith(`${model}/`),
        `${cache} sta dentro lo store di modelli ${model}`
      );
    });
  });
});

test('nessuna cache di op35 contiene uno store di modelli', () => {
  cachePaths.forEach((cache) => {
    modelPaths.forEach((model) => {
      assert.ok(
        !model.startsWith(`${cache}/`),
        `lo store ${model} verrebbe eliminato insieme a ${cache}`
      );
    });
  });
});

test('op35 non elimina radici di store note (hub, models, checkpoints)', () => {
  const vietati = ['/models', '/hub', '/checkpoints', '/.ollama', '/.lmstudio'];
  cachePaths.forEach((cache) => {
    vietati.forEach((suffisso) => {
      assert.ok(
        !cache.endsWith(suffisso),
        `${cache} termina con ${suffisso}: sembra uno store di modelli`
      );
    });
  });
});

test('tutte le cache di op35 stanno dentro la home utente', () => {
  cachePaths.forEach((cache) => {
    assert.ok(cache.startsWith('$HOME/'), `${cache} è fuori dalla home`);
    assert.ok(!cache.includes('..'), `${cache} contiene ..`);
  });
});

test('op36 non esegue alcuna eliminazione', () => {
  const op36 = section('# 36. INVENTARIO MODELLI AI', '# RIEPILOGO FINALE');
  assert.ok(!op36.includes('safe_remove'), 'op36 chiama safe_remove');
  assert.ok(!/\brm -rf\b/.test(op36), 'op36 chiama rm -rf');
  // l'unica rimozione ammessa è quella del file temporaneo con la lista path
  const rimozioni = op36.match(/\brm -f\b[^\n]*/g) || [];
  rimozioni.forEach((r) => {
    assert.ok(
      r.includes('AI_MODEL_PATHS_FILE'),
      `op36 rimuove qualcosa di diverso dal temp file: ${r}`
    );
  });
});

test('op35 elimina solo attraverso safe_remove', () => {
  const op35 = section('# 35. PULIZIA CACHE AI', '# 36. INVENTARIO MODELLI AI');
  assert.ok(op35.includes('safe_remove "$ai_path"'), 'op35 non usa safe_remove');
  assert.ok(!/\brm -rf\b/.test(op35), 'op35 usa rm -rf diretto invece di safe_remove');
});

test('op35 elimina solo se abilitata e mai in dry-run', () => {
  const op35 = section('# 35. PULIZIA CACHE AI', '# 36. INVENTARIO MODELLI AI');
  const guardIdx = op35.indexOf('is_operation_enabled "op35"');
  const removeIdx = op35.indexOf('safe_remove "$ai_path"');
  assert.ok(guardIdx !== -1, 'guard is_operation_enabled mancante');
  assert.ok(removeIdx > guardIdx, 'safe_remove non è protetto dal guard');
  const dryBranch = op35.slice(op35.indexOf('if [ "$DRY_RUN" = true ]'), guardIdx);
  assert.ok(!dryBranch.includes('safe_remove'), 'il ramo dry-run elimina file');
});

console.log('');
console.log(`Risultato: ${passed} passati, ${failed} falliti`);
process.exit(failed > 0 ? 1 : 0);
