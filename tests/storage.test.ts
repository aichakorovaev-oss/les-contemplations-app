// `npx tsx tests/storage.test.ts`
import assert from 'node:assert/strict';
import { buildCommitBody, describeConfig, normalizeRepo, readHfConfig, recordPath, sanitizeFeedback, sanitizeReport } from '../server/storage.ts';

// ── noms de dataset acceptés ──
assert.equal(normalizeRepo('aicha/les-contemplations'), 'aicha/les-contemplations');
assert.equal(normalizeRepo('https://huggingface.co/datasets/aicha/ds'), 'aicha/ds');
assert.equal(normalizeRepo('https://huggingface.co/datasets/aicha/ds/tree/main'), 'aicha/ds');
assert.equal(normalizeRepo('datasets/aicha/ds/'), 'aicha/ds');
assert.equal(normalizeRepo('  mon-dataset  '), 'mon-dataset');

// ── détection tolérante des variables d'environnement ──
const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;
let c = readHfConfig(env({ HF_TOKEN: 'hf_x', HF_DATASET: 'a/b' }))!;
assert.deepEqual([c.token, c.repo, c.tokenVar, c.repoVar], ['hf_x', 'a/b', 'HF_TOKEN', 'HF_DATASET']);
c = readHfConfig(env({ HUGGINGFACE_TOKEN: 'hf_y', DATASET_ID: 'a/b' }))!;
assert.deepEqual([c.tokenVar, c.repoVar], ['HUGGINGFACE_TOKEN', 'DATASET_ID']);
c = readHfConfig(env({ HF_TOKEN: 'hf_z', MY_FEEDBACK_DATASET: 'https://huggingface.co/datasets/a/b' }))!;   // nom inattendu contenant « DATASET »
assert.equal(c.repo, 'a/b');
c = readHfConfig(env({ HF_WRITE_TOKEN: 'hf_w', HF_DATASET: 'a/b' }))!;
assert.equal(c.tokenVar, 'HF_WRITE_TOKEN');
assert.equal(readHfConfig(env({ HF_TOKEN: 'hf_x' })), null);                  // dataset manquant
assert.equal(readHfConfig(env({ HF_DATASET: 'a/b' })), null);                 // jeton manquant
assert.equal(readHfConfig(env({ HF_TOKEN: '  ', HF_DATASET: 'a/b' })), null); // valeur vide
assert.equal(readHfConfig(env({ HF_TOKEN: 'x', HF_DATASET: 'a/b' }))!.endpoint, 'https://huggingface.co');
// le diagnostic ne révèle jamais le jeton
assert.ok(!JSON.stringify(describeConfig(env({ HF_TOKEN: 'hf_SECRET', HF_DATASET: 'a/b' }))).includes('hf_SECRET'));

// ── nettoyage du feedback ──
const fb = sanitizeFeedback({ rating: 4, empty_frame_seen: false, resonated: true, surprised: null, would_recommend: true, why_not: '', comment: ' Superbe\u0000 ', mood_tags: ['calme', 5, '', 'x'.repeat(100)], painting_count: 10, lang: 'en', nonce: 'abc', hack: 'ignoré' })!;
assert.equal(fb.rating, 4); assert.equal(fb.comment, 'Superbe'); assert.equal(fb.lang, 'en');
assert.deepEqual(fb.mood_tags, ['calme', 'x'.repeat(40)]);
assert.ok(!('hack' in fb));
assert.equal(sanitizeFeedback({ rating: 9 })?.rating ?? 'rien', 'rien');       // note hors 1-5 → pas de réponse valable
assert.equal(sanitizeFeedback({ rating: 9, resonated: 'yes' }), null);           // 'yes' (chaîne) n'est pas un booléen
assert.equal(sanitizeFeedback({}), null);
assert.equal(sanitizeFeedback(null), null);
assert.equal(sanitizeFeedback({ comment: 'x'.repeat(5000) })!.comment.length, 2000);
assert.equal(sanitizeFeedback({ rating: 3, lang: 'de' })!.lang, 'fr');

// ── signalement ──
const rp = sanitizeReport({ painting_id: 'venus', painting_title: 'Vénus', reason_category: 'inappropriate', reason_text: 'x', mood_tags: ['a'], lang: 'fr', nonce: 'n' })!;
assert.equal(rp.painting_id, 'venus'); assert.equal(rp.reason_category, 'inappropriate');
assert.equal(sanitizeReport({ painting_id: 'venus' }), null);                   // motif obligatoire
assert.equal(sanitizeReport(undefined), null);

// ── chemin et corps du commit ──
const p = recordPath('feedback', new Date('2026-10-09T10:15:30.123Z'));
assert.match(p, /^feedback\/2026-10-09\/20261009T101530Z-[0-9a-f]{6}\.jsonl$/);
assert.notEqual(recordPath('reports'), recordPath('reports'));                  // jamais deux fois le même fichier
const lines = buildCommitBody('résumé', [{ path: 'feedback/x.jsonl', content: '{"a":"é"}\n' }]).split('\n').map(l => JSON.parse(l));
assert.equal(lines[0].key, 'header'); assert.equal(lines[0].value.summary, 'résumé');
assert.equal(lines[1].key, 'file'); assert.equal(lines[1].value.path, 'feedback/x.jsonl'); assert.equal(lines[1].value.encoding, 'base64');
assert.equal(Buffer.from(lines[1].value.content, 'base64').toString('utf8'), '{"a":"é"}\n');
console.log('storage : OK');
