// Tests du repli entre modèles : `npx tsx tests/fallback.test.ts`
import assert from 'node:assert/strict';
import { classify, parseModels, resetCooldowns, withFallback } from '../server/fallback.ts';

const quiet = console.warn;
console.warn = () => {};
const err = (status: number, msg = 'x') => Object.assign(new Error(msg), { status });
const SDK_503 = new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');

// ── classification ──
assert.equal(classify(err(503)).retry, true);
assert.equal(classify(SDK_503).retry, true);                       // erreur du SDK : le code n'est que dans le message
assert.equal(classify(err(429)).cooldownMs, 60_000);
assert.equal(classify(err(404)).cooldownMs, 10 * 60_000);          // modèle retiré : longue pause
assert.equal(classify(err(400)).retry, false);                     // notre requête est mauvaise : inutile de changer de modèle
assert.equal(classify(err(401)).retry, false);
assert.equal(classify(err(403)).retry, false);
assert.equal(classify(new Error('JSON invalide : réponse vide')).retry, true);
assert.equal(classify(new Error('JSON invalide : réponse vide')).cooldownMs, 0); // mauvaise sortie ≠ panne
assert.equal(classify(new Error('fetch failed')).retry, true);
assert.equal(classify(new Error('bug interne')).retry, false);

// ── parseModels ──
assert.deepEqual(parseModels(undefined, undefined, ['a', 'b']), ['a', 'b']);
assert.deepEqual(parseModels('x, y', undefined, ['a']), ['x', 'y']);
assert.deepEqual(parseModels('x,y', 'z', ['a']), ['z', 'x', 'y']);
assert.deepEqual(parseModels('x,y', 'x', ['a']), ['x', 'y']);      // pas de doublon

(async () => {
  // 503 sur le 1er modèle → le 2e répond
  resetCooldowns();
  let calls: string[] = [];
  let r = await withFallback(['m1', 'm2', 'm3'], async m => { calls.push(m); if (m === 'm1') throw SDK_503; return 'ok-' + m; });
  assert.equal(r, 'ok-m2'); assert.deepEqual(calls, ['m1', 'm2']);

  // m1 est en pause : la requête suivante ne le réessaie pas en premier
  calls = [];
  r = await withFallback(['m1', 'm2', 'm3'], async m => { calls.push(m); return 'ok-' + m; });
  assert.equal(r, 'ok-m2'); assert.deepEqual(calls, ['m2']);

  // 400 → arrêt immédiat, pas de repli
  resetCooldowns(); calls = [];
  await assert.rejects(withFallback(['m1', 'm2'], async m => { calls.push(m); throw err(400, 'INVALID_ARGUMENT'); }));
  assert.deepEqual(calls, ['m1']);

  // tous en échec → dernière erreur remontée, tous essayés
  resetCooldowns(); calls = [];
  await assert.rejects(withFallback(['m1', 'm2', 'm3'], async m => { calls.push(m); throw err(503, m); }), /m3/);
  assert.deepEqual(calls, ['m1', 'm2', 'm3']);

  // tous en pause → on réessaie quand même (jamais d'impasse définitive)
  calls = [];
  r = await withFallback(['m1', 'm2', 'm3'], async m => { calls.push(m); return 'ok-' + m; });
  assert.equal(r, 'ok-m1'); assert.deepEqual(calls, ['m1']);

  // sortie JSON inexploitable → modèle suivant, sans mise en pause
  resetCooldowns(); calls = [];
  r = await withFallback(['m1', 'm2'], async m => { calls.push(m); if (m === 'm1') throw new Error('JSON invalide : sélection inexploitable'); return m; });
  assert.equal(r, 'm2');
  calls = [];
  await withFallback(['m1', 'm2'], async m => { calls.push(m); return m; });
  assert.deepEqual(calls, ['m1']);                                  // m1 n'avait pas été mis en pause

  // modèle qui ne répond pas → délai dépassé puis repli
  resetCooldowns();
  r = await withFallback(['slow', 'fast'], m => (m === 'slow' ? new Promise<string>(() => {}) : Promise.resolve('fast!')), { attemptTimeoutMs: 80 });
  assert.equal(r, 'fast!');

  console.warn = quiet;
  console.log('fallback : OK');
})().catch(e => { console.warn = quiet; console.error(e); process.exit(1); });
