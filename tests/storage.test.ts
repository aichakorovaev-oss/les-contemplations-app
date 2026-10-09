// `npx tsx tests/storage.test.ts`
import assert from 'node:assert/strict';
import {
  alignRecord, appendRecords, buildCommitBody, csvCell, describeConfig, fileOverrides, fmtOf, inspectTable, normalizeRepo,
  parseCsv, pickTargets, readHfConfig, sanitizeFeedback, sanitizeReport,
} from '../server/storage.ts';

const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;

// ── nom du dataset / variables ──
assert.equal(normalizeRepo('https://huggingface.co/datasets/aicha/ds/tree/main'), 'aicha/ds');
assert.equal(normalizeRepo('datasets/aicha/ds/'), 'aicha/ds');
let c = readHfConfig(env({ HUGGINGFACE_TOKEN: 'hf_y', DATASET_ID: 'a/b' }))!;
assert.deepEqual([c.tokenVar, c.repoVar, c.repo], ['HUGGINGFACE_TOKEN', 'DATASET_ID', 'a/b']);
assert.equal(readHfConfig(env({ HF_TOKEN: 'x' })), null);
assert.ok(!JSON.stringify(describeConfig(env({ HF_TOKEN: 'hf_SECRET', HF_DATASET: 'a/b' }))).includes('hf_SECRET'));
assert.deepEqual(fileOverrides(env({ HF_FEEDBACK_FILE: '/feedback.jsonl', REPORTS_FILE: 'r.csv' })), { feedback: 'feedback.jsonl', reports: 'r.csv' });

// ── nettoyage des charges ──
const fb = sanitizeFeedback({ rating: 4, resonated: true, comment: ' Superbe\u0000 ', mood_tags: ['calme', 5, ''], lang: 'en', hack: 1 })!;
assert.equal(fb.comment, 'Superbe'); assert.equal(fb.lang, 'en'); assert.ok(!('hack' in fb));
assert.equal(sanitizeFeedback({}), null);
assert.equal(sanitizeReport({ painting_id: 'venus' }), null);
assert.equal(sanitizeReport({ painting_id: 'venus', reason_category: 'x' })!.painting_id, 'venus');

// ── CHOIX DU FICHIER : on ne crée jamais, on retrouve l'existant ──
const old = ['README.md', '.gitattributes', 'feedback.jsonl', 'reports.jsonl'];
let t = pickTargets(old);
assert.equal(t.feedback.path, 'feedback.jsonl'); assert.equal(t.reports.path, 'reports.jsonl');
t = pickTargets(['data/feedbacks.csv', 'data/report_log.json', 'README.md']);
assert.equal(t.feedback.path, 'data/feedbacks.csv'); assert.equal(t.reports.path, 'data/report_log.json');
// restes de la version « un fichier par retour » : jamais pris pour cible
t = pickTargets(['feedback.jsonl', 'reports.jsonl', 'feedback/2026-10-09/20261009T101530Z-ab12cd.jsonl', 'reports/2026-10-09/x.jsonl']);
assert.equal(t.feedback.path, 'feedback.jsonl'); assert.equal(t.reports.path, 'reports.jsonl');
// aucun fichier → pas de cible (donc rien n'est créé)
t = pickTargets(['README.md']);
assert.equal(t.feedback.path, undefined); assert.match(t.feedback.problem!, /HF_FEEDBACK_FILE/);
// ambigu → pas de cible…
t = pickTargets(['feedback_2025.jsonl', 'feedback_2026.jsonl']);
assert.equal(t.feedback.path, undefined); assert.match(t.feedback.problem!, /plusieurs/);
// … sauf un nom exact
t = pickTargets(['feedback.jsonl', 'feedback_old.jsonl']);
assert.equal(t.feedback.path, 'feedback.jsonl');
// fichier imposé : doit exister (sinon pas de création)…
t = pickTargets(['feedback.jsonl'], { feedback: 'autre.jsonl' });
assert.equal(t.feedback.path, undefined); assert.match(t.feedback.problem!, /n'existe pas/);
// … sauf autorisation explicite
t = pickTargets(['feedback.jsonl'], { feedback: 'autre.jsonl' }, true);
assert.equal(t.feedback.path, 'autre.jsonl'); assert.equal(t.feedback.create, true);
assert.equal(pickTargets(['x'], { feedback: 'a.parquet' }).feedback.path, undefined);
assert.equal(fmtOf('a/b.JSONL'), 'jsonl'); assert.equal(fmtOf('x.parquet'), null);

// ── JSONL : on AJOUTE, le contenu existant n'est pas modifié, les colonnes sont celles de l'ancienne version ──
const oldJsonl = '{"timestamp":"2026-09-01T10:00:00+00:00","rating":5,"comment":"ancien 1","would_recommend":true}\n{"timestamp":"2026-09-02T10:00:00+00:00","rating":3,"comment":"ancien 2","would_recommend":false}\n';
const rec = { id: 'abc', kind: 'feedback', created_at: '2026-10-09T10:15:30.000Z', rating: 4, comment: 'nouveau', would_recommend: true, lang: 'fr', mood_tags: ['calme'] };
const now = new Date('2026-10-09T10:15:30.000Z');
let out = appendRecords('jsonl', oldJsonl, [rec], now);
assert.ok(out.startsWith(oldJsonl));                                  // l'existant est intact
const added = JSON.parse(out.slice(oldJsonl.length));
assert.deepEqual(Object.keys(added), ['timestamp', 'rating', 'comment', 'would_recommend']);   // mêmes colonnes qu'avant
assert.equal(added.timestamp, '2026-10-09T10:15:30.000Z'); assert.equal(added.comment, 'nouveau'); assert.equal(added.would_recommend, true);
// dernière ligne sans retour à la ligne
out = appendRecords('jsonl', oldJsonl.trimEnd(), [rec], now);
assert.equal(out.trimEnd().split('\n').length, 3);
// horodatage numérique imité
out = appendRecords('jsonl', '{"ts":1760000000,"rating":5}\n', [rec], now);
assert.equal(JSON.parse(out.trim().split('\n')[1]).ts, 1791540930);
// fichier vide → colonnes par défaut
out = appendRecords('jsonl', '', [rec], now);
assert.deepEqual(Object.keys(JSON.parse(out.trim())).slice(0, 3), ['id', 'kind', 'created_at']);
// plusieurs lignes d'un coup
assert.equal(appendRecords('jsonl', oldJsonl, [rec, rec, rec], now).trim().split('\n').length, 5);

// ── CSV : en-tête respecté, guillemets / virgules / retours à la ligne protégés, style des booléens imité ──
const oldCsv = 'timestamp,rating,comment,would_recommend\n2026-09-01 10:00:00,5,"super, vraiment",True\n2026-09-02 10:00:00,3,bof,False\n';
out = appendRecords('csv', oldCsv, [{ ...rec, comment: 'Il a dit "génial",\nmerci' }], now);
assert.ok(out.startsWith(oldCsv));
const rows = parseCsv(out);
assert.equal(rows.length, 4);
assert.deepEqual(rows[3], ['2026-10-09 10:15:30', '4', 'Il a dit "génial",\nmerci', 'True']);   // « True » comme avant, date au même format
// listes : style Python ['a', 'b'] imité si le fichier existant l'utilise
const oldPy = 'timestamp,rating,mood_tags\n2026-09-01 10:00:00,5,"[\'calme\']"\n';
assert.deepEqual(parseCsv(appendRecords('csv', oldPy, [{ ...rec, mood_tags: ['calme', 'joyeux'] }], now))[2], ['2026-10-09 10:15:30', '4', "['calme', 'joyeux']"]);
assert.deepEqual(parseCsv(appendRecords('csv', 'timestamp,rating,mood_tags\n2026-09-01 10:00:00,5,"[]"\n', [{ ...rec, mood_tags: ['a'] }], now))[2][2], '["a"]');
assert.equal(csvCell('a,b'), '"a,b"'); assert.equal(csvCell('simple'), 'simple');
assert.deepEqual(parseCsv('\uFEFFa,b\r\n1,2\r\n')[0][1], 'b');
out = appendRecords('csv', oldCsv.replace(/\n/g, '\r\n'), [rec], now);
assert.ok(out.includes('\r\n') && !/[^\r]\n/.test(out));                                          // fins de ligne conservées
// colonnes manquantes → cellule vide ; alias de colonnes
out = appendRecords('csv', 'date,stars,text,extra\n', [rec], now);
const r2 = parseCsv(out);
assert.deepEqual(r2[1], ['2026-10-09T10:15:30.000Z', '4', 'nouveau', '']);

// ── JSON (liste) ──
const oldJson = '[\n  {"timestamp": "2026-09-01", "reason_category": "x"}\n]\n';
out = appendRecords('json', oldJson, [{ id: 'z', kind: 'reports', created_at: 'n', reason_category: 'inappropriate', painting_id: 'venus' }], now);
const arr = JSON.parse(out); assert.equal(arr.length, 2); assert.deepEqual(Object.keys(arr[1]), ['timestamp', 'reason_category']);
assert.throws(() => inspectTable('json', '{"a":1}'));

// ── alignement direct ──
const tbl = inspectTable('jsonl', '{"when":"x","stars":1,"unknown":"u"}\n')!;
assert.deepEqual(alignRecord({ rating: 5 }, tbl, now), { when: null, stars: 5, unknown: null });   // « when » n'est pas un nom d'horodatage connu

// ── corps du commit ──
const lines = buildCommitBody('résumé', [{ path: 'feedback.jsonl', content: '{"a":"é"}\n' }], 'sha123').split('\n').map(l => JSON.parse(l));
assert.equal(lines[0].value.parentCommit, 'sha123'); assert.equal(lines[1].value.path, 'feedback.jsonl');
assert.equal(Buffer.from(lines[1].value.content, 'base64').toString('utf8'), '{"a":"é"}\n');
assert.ok(!('parentCommit' in JSON.parse(buildCommitBody('x', [])) .value));
console.log('storage : OK');
