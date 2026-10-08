// `npx tsx tests/edge.test.ts` — logique du moteur Edge (sans réseau : le module Microsoft est simulé)
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { edgeVoiceFor, escapeXml, synthesizeEdge } from '../server/edge.ts';
import { classify } from '../server/fallback.ts';

assert.equal(edgeVoiceFor('fr-FR-DeniseNeural'), 'fr-FR-DeniseNeural');
assert.equal(edgeVoiceFor('en-US-JennyNeural'), 'en-US-JennyNeural');
assert.equal(edgeVoiceFor('fr-FR-X"><evil/>'), 'fr-FR-DeniseNeural');   // injection SSML refusée
assert.equal(edgeVoiceFor('en-GB'), 'en-US-JennyNeural');
assert.equal(edgeVoiceFor(undefined), 'fr-FR-DeniseNeural');
assert.equal(escapeXml(`<a href="x">Tom & Jerry's</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;');

(async () => {
  // Succès : les morceaux de la flux sont assemblés, voix / format / prosodie transmis, SSML échappé
  let seen: any = {};
  class Fake {
    async setMetadata(v: string, f: string) { seen.voice = v; seen.format = f; }
    toStream(input: string, opts: any) {
      seen.input = input; seen.opts = opts;
      return { audioStream: Readable.from([Buffer.alloc(150, 1), Buffer.alloc(150, 2)]) };
    }
    close() { seen.closed = true; }
  }
  const mp3 = await synthesizeEdge('Tom & Jerry <3', 'en-US-JennyNeural', async () => ({ MsEdgeTTS: Fake, OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'mp3-24k' } }));
  assert.equal(mp3.length, 300);
  assert.equal(seen.voice, 'en-US-JennyNeural');
  assert.equal(seen.format, 'mp3-24k');
  assert.equal(seen.input, 'Tom &amp; Jerry &lt;3');
  assert.deepEqual(seen.opts, { rate: '-5%', pitch: '-3Hz' });
  assert.equal(seen.closed, true);

  // Compatibilité CommonJS : exports sous `default`
  const viaDefault = await synthesizeEdge('x', 'fr-FR-DeniseNeural', async () => ({ default: { MsEdgeTTS: Fake, OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'm' } } }));
  assert.equal(viaDefault.length, 300);

  // Échec réseau : erreur « repli + pause 3 min »
  class Broken { async setMetadata() { throw new Error('getaddrinfo ENOTFOUND'); } toStream() { return { audioStream: Readable.from([]) }; } close() {} }
  await assert.rejects(synthesizeEdge('x', 'fr-FR-DeniseNeural', async () => ({ MsEdgeTTS: Broken, OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'm' } })), (e: any) => {
    const v = classify(e); return v.retry === true && v.cooldownMs === 180_000;
  });
  // Audio vide → échec (pas de MP3 muet mis en cache)
  class Empty { async setMetadata() {} toStream() { return { audioStream: Readable.from([Buffer.alloc(10)]) }; } close() {} }
  await assert.rejects(synthesizeEdge('x', 'fr-FR-DeniseNeural', async () => ({ MsEdgeTTS: Empty, OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'm' } })));
  // Module absent
  await assert.rejects(synthesizeEdge('x', 'fr-FR-DeniseNeural', async () => { throw new Error('Cannot find module'); }), (e: any) => classify(e).cooldownMs === 600_000);
  console.log('edge : OK');
})().catch(e => { console.error(e); process.exit(1); });
