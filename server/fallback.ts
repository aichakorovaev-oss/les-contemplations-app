/**
 * Repli automatique entre plusieurs modèles Gemini.
 *
 * Quand un modèle répond « 503 high demand » (ou 429, 500, délai dépassé, JSON inexploitable…),
 * on passe au suivant de la liste. Un modèle en échec est mis « en pause » quelques dizaines de
 * secondes pour que les visiteurs suivants ne paient pas son délai d'attente.
 *
 * Les erreurs qui viennent de NOTRE requête (400, 401, 403) ne déclenchent pas de repli :
 * un autre modèle échouerait de la même façon.
 */

// Les modèles « lite » d'abord : c'est celui de la version d'origine (gemini-3.1-flash-lite), nettement
// plus rapide que gemini-3.8-flash, gardé en dernier recours pour la qualité.
export const DEFAULT_TEXT_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-2.5-flash-lite',
];

export const DEFAULT_TTS_MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];

/** Liste ordonnée, sans doublons : `single` (variable historique) d'abord, puis `list`, puis les défauts. */
export function parseModels(list: string | undefined, single: string | undefined, defaults: string[]): string[] {
  const fromList = (list || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const first = single?.trim() ? [single.trim()] : [];
  const rest = fromList.length ? fromList : defaults;
  return [...new Set([...first, ...rest])];
}

export function statusOf(err: any): number | undefined {
  const s = err?.status ?? err?.code ?? err?.error?.code ?? err?.response?.status;
  if (typeof s === 'number') return s;
  const m = String(err?.message || '').match(/\b([45]\d\d)\b/);
  return m ? Number(m[1]) : undefined;
}

const RETRY_STATUS = new Set([404, 408, 429, 500, 502, 503, 504]);
const RETRY_TEXT =
  /UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|DEADLINE|time(d)? ?out|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|socket hang up|JSON invalide|Unexpected token|not found|is not supported/i;

export interface Verdict {
  /** true : essayer le modèle suivant */
  retry: boolean;
  /** durée pendant laquelle ce modèle est évité (ms) */
  cooldownMs: number;
}

export function classify(err: any): Verdict {
  // Une erreur peut imposer sa propre durée de pause (ex. moteur vocal injoignable)
  if (typeof err?.cooldownMs === 'number') return { retry: true, cooldownMs: err.cooldownMs };
  const status = statusOf(err);
  const text = String(err?.message || err || '');
  if (status === 404) return { retry: true, cooldownMs: 10 * 60_000 }; // modèle retiré / inconnu
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(text)) return { retry: true, cooldownMs: 60_000 };
  if (status && RETRY_STATUS.has(status)) return { retry: true, cooldownMs: 45_000 };
  if (status && status >= 400 && status < 500) return { retry: false, cooldownMs: 0 }; // 400 / 401 / 403…
  // Un modèle qui répond dans la mauvaise langue recommencera probablement : courte pause
  if (/langue incorrecte/i.test(text)) return { retry: true, cooldownMs: 120_000 };
  if (/JSON invalide|Unexpected token/i.test(text)) return { retry: true, cooldownMs: 0 }; // mauvaise sortie, pas une panne
  if (RETRY_TEXT.test(text)) return { retry: true, cooldownMs: 45_000 };
  return { retry: false, cooldownMs: 0 };
}

const cooldown = new Map<string, number>();
export function resetCooldowns() {
  cooldown.clear();
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timeout après ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export interface FallbackOptions {
  /** délai maximal pour UN modèle (défaut 25 s) */
  attemptTimeoutMs?: number;
  /** délai propre à chaque modèle (prioritaire sur attemptTimeoutMs) */
  timeoutFor?: (model: string) => number | undefined;
  /** on n'ouvre plus de nouvel essai passé ce délai total (défaut 60 s) */
  budgetMs?: number;
  /** pour les logs */
  label?: string;
}

export async function withFallback<T>(
  models: string[],
  run: (model: string) => Promise<T>,
  opts: FallbackOptions = {}
): Promise<T> {
  const { attemptTimeoutMs = 25_000, budgetMs = 60_000, label = 'Gemini' } = opts;
  const start = Date.now();
  // Les modèles en pause passent en dernier recours, jamais exclus pour de bon.
  const ready = models.filter(m => (cooldown.get(m) ?? 0) <= start);
  const paused = models.filter(m => !ready.includes(m));
  const order = [...ready, ...paused];

  let lastErr: any;
  for (let i = 0; i < order.length; i++) {
    const model = order[i];
    if (i > 0 && Date.now() - start > budgetMs) break;
    try {
      const result = await withTimeout(run(model), opts.timeoutFor?.(model) ?? attemptTimeoutMs, model);
      if (i > 0) console.warn(`[${label}] réponse obtenue avec le modèle de repli ${model}`);
      return result;
    } catch (err: any) {
      lastErr = err;
      const verdict = classify(err);
      const status = statusOf(err);
      const next = order[i + 1];
      console.warn(
        `[${label}] ${model} en échec (${status ?? 'sans code'}: ${String(err?.message || err).slice(0, 120)})` +
          (verdict.retry && next ? ` → repli sur ${next}` : '')
      );
      if (!verdict.retry) throw err;
      if (verdict.cooldownMs) cooldown.set(model, Date.now() + verdict.cooldownMs);
    }
  }
  throw lastErr ?? new Error(`${label}: aucun modèle disponible`);
}
