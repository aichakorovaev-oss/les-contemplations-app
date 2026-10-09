// `npx tsx tests/storage.test.ts`
import assert from 'node:assert/strict';
import {
  PyFloat, alignRecord, appendRecords, buildCommitBody, buildRecord, csvCell, describeConfig, fileOverrides, fmtOf, inspectTable,
  isoSeconds, normalizeRepo, parseCsv, pickTargets, pyJson, readHfConfig, sanitizeFeedback, sanitizeReport,
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

// ── Format EXACT de l'ancienne version (lignes réelles relevées dans le dataset) ──
const OLD_FB = [
  '{"id": "ea6af0d8-d627-4def-b910-febf4f77c7e6", "ts": 1790576772.6201935, "type": "app_feedback", "rating": 5, "empty_frame_seen": false, "resonated": true, "surprised": true, "would_recommend": true, "why_not": "", "comment": "Test", "mood_tags": ["tired"], "painting_count": 10, "lang": "en", "nonce": "a64e3d46-f6d4-4101-b7c4-603798da5f80"}',
  '{"id": "321a56f7-c744-4841-8aca-c16b005c5875", "ts": 1790834519.9310412, "date": "2026-10-01T06:01:59+00:00", "type": "app_feedback", "rating": 5, "empty_frame_seen": false, "resonated": true, "surprised": false, "would_recommend": true, "why_not": "", "comment": "Test iPhone", "mood_tags": ["apaisé", "curieux"], "painting_count": 10, "lang": "fr", "nonce": "c209405c-8a2d-4c6f-8bf6-94c6e83f997b"}',
];
const OLD_RP = [
  '{"id": "3d1401bc-1ce3-4210-9f6f-82286a0f42fb", "ts": 1790576662.0407686, "type": "report", "painting_id": "starry_night", "painting_title": "The Starry Night", "reason_category": "triggering", "reason_text": "Test", "mood_tags": ["tired"], "lang": "en", "nonce": "a64e3d46-f6d4-4101-b7c4-603798da5f80"}',
  '{"id": "d2121e2d-8296-4bd8-91f4-07745fa18f59", "ts": 1790834757.587602, "date": "2026-10-01T06:05:57+00:00", "type": "report", "painting_id": "kiss", "painting_title": "Le Baiser", "reason_category": "triggering", "reason_text": "Test iPhone", "mood_tags": ["apaisé", "curieux"], "lang": "fr", "nonce": "d2121e2d-8296-4bd8-91f4-07745fa18f59"}',
];
// « squelette » d'une ligne : toutes les valeurs remplacées, la ponctuation et l'ordre des clés restent
const skeleton = (line: string) => line.replace(/"(?:[^"\\]|\\.)*"(?=:)/g, 'K').replace(/"(?:[^"\\]|\\.)*"/g, 'S').replace(/-?\d+\.\d+/g, 'F').replace(/-?\d+/g, 'N').replace(/\b(true|false|null)\b/g, 'V');
const at = new Date('2026-10-09T22:30:43.886Z');

assert.equal(pyJson({ a: 1, b: ['é', 'x'], c: null, d: true, e: [] , f: new PyFloat(5) }), '{"a": 1, "b": ["é", "x"], "c": null, "d": true, "e": [], "f": 5.0}');
assert.equal(isoSeconds(at), '2026-10-09T22:30:43+00:00');
assert.equal(new PyFloat(1790576772.6201935).toString(), '1790576772.6201935');
// round-trip : nos lignes relues puis réécrites à la Python restent identiques au caractère près
for (const l of [...OLD_FB, ...OLD_RP]) assert.equal(pyJson(JSON.parse(l)).replace(/(\d{10})(?=[,}])/g, '$1'), pyJson(JSON.parse(l)));

const fbData = sanitizeFeedback({ rating: 5, empty_frame_seen: false, resonated: true, surprised: false, would_recommend: true, comment: 'Nouveau', mood_tags: ['apaisé', 'curieux'], painting_count: 10, lang: 'fr', nonce: 'c209405c-8a2d-4c6f-8bf6-94c6e83f997b' })!;
const fbRec = buildRecord('feedback', fbData, at);
assert.deepEqual(Object.keys(fbRec), Object.keys(JSON.parse(OLD_FB[1])));              // mêmes clés, même ordre que l'ancienne version
const existingFb = OLD_FB.join('\n') + '\n';
const outFb = appendRecords('jsonl', existingFb, [fbRec], at);
assert.ok(outFb.startsWith(existingFb));                                                // l'existant est intact
const newFb = outFb.slice(existingFb.length).trimEnd();
assert.equal(skeleton(newFb), skeleton(OLD_FB[1]));                                     // même forme que la dernière ligne ancienne
assert.match(newFb, /^\{"id": "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", "ts": 1791585043\.886, "date": "2026-10-09T22:30:43\+00:00", "type": "app_feedback", "rating": 5, /);
assert.ok(newFb.includes('"mood_tags": ["apaisé", "curieux"]'));                       // accents non échappés, séparateurs à la Python

const rpData = sanitizeReport({ painting_id: 'kiss', painting_title: 'Le Baiser', reason_category: 'triggering', reason_text: 'Nouveau', mood_tags: ['apaisé', 'curieux'], lang: 'fr', nonce: 'x' })!;
const rpRec = buildRecord('reports', rpData, at);
assert.deepEqual(Object.keys(rpRec), Object.keys(JSON.parse(OLD_RP[1])));
const existingRp = OLD_RP.join('\n') + '\n';
const newRp = appendRecords('jsonl', existingRp, [rpRec], at).slice(existingRp.length).trimEnd();
assert.equal(skeleton(newRp), skeleton(OLD_RP[1]));
assert.match(newRp, /"type": "report", "painting_id": "kiss"/);

// ts entier en millisecondes pile : toujours écrit avec une décimale (float Python)
assert.match(pyJson(buildRecord('feedback', fbData, new Date('2026-10-09T22:30:43.000Z'))), /"ts": 1791585043\.0,/);
// liste vide, valeurs absentes
const bare = buildRecord('feedback', sanitizeFeedback({ rating: 3 })!, at);
assert.match(pyJson(bare), /"empty_frame_seen": null, .*"why_not": "", "comment": "", "mood_tags": \[\], "painting_count": null, "lang": "fr", "nonce": ""\}$/);
// dernière ligne sans retour à la ligne + plusieurs lignes d'un coup + fichier vide
assert.equal(appendRecords('jsonl', OLD_FB.join('\n'), [fbRec], at).trimEnd().split('\n').length, 3);
assert.equal(appendRecords('jsonl', existingFb, [fbRec, fbRec, fbRec], at).trim().split('\n').length, 5);
assert.equal(appendRecords('jsonl', '', [fbRec], at).split('\n').length, 2);
// des enregistrements différents ont des identifiants différents
assert.notEqual(buildRecord('feedback', fbData).id, buildRecord('feedback', fbData).id);

// données pour les formats CSV / JSON (autres jeux de données que le vôtre)
const rec = { id: 'abc', kind: 'feedback', created_at: '2026-10-09T10:15:30.000Z', rating: 4, comment: 'nouveau', would_recommend: true, lang: 'fr', mood_tags: ['calme'] };
const now = new Date('2026-10-09T10:15:30.000Z');
let out: string;

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
