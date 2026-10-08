/**
 * Moteur « Edge TTS » (voix neurales Microsoft, le même moteur que la version d'origine en Python).
 * Rapide (quelques centaines de ms), sans quota d'API ni clé. Renvoie du MP3.
 *
 * Si ce service est injoignable depuis l'hébergeur, la requête échoue vite et le serveur bascule
 * sur Gemini TTS (voir server/tts.ts) ; le moteur est alors mis en pause quelques minutes.
 */

const VOICE_RE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/;

/** Voix demandée par le client (ex. fr-FR-DeniseNeural) ; valeur sûre par défaut sinon. */
export function edgeVoiceFor(requested: unknown): string {
  const v = typeof requested === 'string' ? requested.trim() : '';
  if (VOICE_RE.test(v)) return v;
  return v.toLowerCase().startsWith('en') ? 'en-US-JennyNeural' : 'fr-FR-DeniseNeural';
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export async function synthesizeEdge(
  text: string,
  requestedVoice: unknown,
  // injectable pour les tests
  loadModule: () => Promise<any> = () => import('msedge-tts')
): Promise<Buffer> {
  // Import à la demande : si le module est absent ou incompatible, seul ce moteur est écarté.
  let mod: any;
  try {
    mod = await loadModule();
  } catch (err: any) {
    throw Object.assign(new Error(`Edge TTS indisponible : module introuvable (${err?.message})`), { status: 503, cooldownMs: 600_000 });
  }
  const { MsEdgeTTS, OUTPUT_FORMAT } = mod.MsEdgeTTS ? mod : mod.default;

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(edgeVoiceFor(requestedVoice), OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    // Mêmes réglages que l'original : un peu plus lent et plus grave, plus posé pour la contemplation.
    const { audioStream } = tts.toStream(escapeXml(text), {
      rate: process.env.EDGE_RATE || '-5%',
      pitch: process.env.EDGE_PITCH || '-3Hz',
    });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on('data', (d: Buffer) => chunks.push(Buffer.from(d)));
      audioStream.on('end', () => resolve());
      audioStream.on('close', () => resolve());
      audioStream.on('error', reject);
    });
    const out = Buffer.concat(chunks);
    if (out.length < 200) throw new Error('Edge TTS: audio vide');
    return out;
  } catch (err: any) {
    // Échec propre au moteur : on le signale comme « indisponible » (repli + pause de 3 minutes)
    throw Object.assign(new Error(`Edge TTS indisponible : ${String(err?.message || err).slice(0, 160)}`), {
      status: 503,
      cooldownMs: 180_000,
    });
  } finally {
    try {
      tts.close();
    } catch (_) {}
  }
}
