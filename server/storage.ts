/**
 * Enregistrement des retours visiteurs (feedback) et signalements d'œuvres.
 *
 * Destination : un dataset Hugging Face, via l'API de commit du Hub (aucune dépendance, juste fetch).
 * Un fichier JSONL par retour (jamais d'écrasement, pas de conflit entre visiteurs simultanés) :
 *     feedback/AAAA-MM-JJ/20261009T101530Z-ab12cd.jsonl
 *     reports/AAAA-MM-JJ/...
 * `datasets.load_dataset("json", data_files={"train": "feedback/**"})` les relit tous.
 *
 * Configuration (variables d'environnement Render) :
 *   HF_TOKEN       jeton Hugging Face AVEC DROIT D'ÉCRITURE sur le dataset
 *   HF_DATASET     « utilisateur/nom-du-dataset » (ou l'URL du dataset ; le nom seul suffit : le
 *                  propriétaire est alors déduit du jeton). Plusieurs noms de variables sont reconnus.
 *   HF_ENDPOINT    (facultatif) https://huggingface.co
 *
 * Sans configuration, les retours sont écrits dans un fichier local (data/*.jsonl), ce qui est
 * éphémère sur Render : un avertissement clair est alors affiché dans les logs.
 */
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

export type Kind = 'feedback' | 'reports';

// ─────────────────────────────────────────────────────────────
// Validation / nettoyage des charges envoyées par le navigateur
// ─────────────────────────────────────────────────────────────
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '');
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const list = (v: unknown, n: number, m: number): string[] =>
  Array.isArray(v) ? v.map(x => str(x, m)).filter(Boolean).slice(0, n) : [];
const intIn = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

export function sanitizeFeedback(b: any) {
  const rec = {
    rating: intIn(b?.rating, 1, 5),
    empty_frame_seen: bool(b?.empty_frame_seen),
    resonated: bool(b?.resonated),
    surprised: bool(b?.surprised),
    would_recommend: bool(b?.would_recommend),
    why_not: str(b?.why_not, 1000),
    comment: str(b?.comment, 2000),
    mood_tags: list(b?.mood_tags, 12, 40),
    painting_count: intIn(b?.painting_count, 0, 500),
    lang: b?.lang === 'en' ? 'en' : 'fr',
    nonce: str(b?.nonce, 64),
  };
  const hasAnswer =
    rec.rating !== null ||
    rec.empty_frame_seen !== null ||
    rec.resonated !== null ||
    rec.surprised !== null ||
    rec.would_recommend !== null ||
    !!rec.comment ||
    !!rec.why_not;
  return hasAnswer ? rec : null;
}

export function sanitizeReport(b: any) {
  const rec = {
    painting_id: str(b?.painting_id, 80) || null,
    painting_title: str(b?.painting_title, 200) || null,
    reason_category: str(b?.reason_category, 60),
    reason_text: str(b?.reason_text, 1000),
    mood_tags: list(b?.mood_tags, 12, 40),
    lang: b?.lang === 'en' ? 'en' : 'fr',
    nonce: str(b?.nonce, 64),
  };
  return rec.reason_category ? rec : null;
}

// ─────────────────────────────────────────────────────────────
// Configuration (tolérante sur les noms de variables)
// ─────────────────────────────────────────────────────────────
const TOKEN_KEYS = ['HF_TOKEN', 'HUGGINGFACE_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'HF_API_TOKEN', 'HF_WRITE_TOKEN', 'HUGGINGFACE_API_TOKEN'];
const DATASET_KEYS = [
  'HF_DATASET', 'HF_DATASET_REPO', 'HF_DATASET_ID', 'HF_DATASET_NAME', 'HF_REPO', 'HF_REPO_ID',
  'DATASET', 'DATASET_REPO', 'DATASET_ID', 'DATASET_NAME', 'FEEDBACK_DATASET', 'HF_FEEDBACK_DATASET',
];

export interface HfConfig {
  token: string;
  tokenVar: string;
  repo: string; // « owner/name » ou « name » seul
  repoVar: string;
  endpoint: string;
}

/** Accepte « owner/name », « datasets/owner/name » ou l'URL complète du dataset. */
export function normalizeRepo(raw: string): string {
  let v = raw.trim().replace(/^https?:\/\/[^/]+\//i, '').replace(/^datasets\//i, '');
  v = v.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\/(tree|blob|resolve)\/.*$/i, '');
  return v;
}

export function readHfConfig(env: NodeJS.ProcessEnv = process.env): HfConfig | null {
  const pick = (keys: string[], re: RegExp) => {
    for (const k of keys) if (env[k]?.trim()) return { k, v: env[k]!.trim() };
    for (const k of Object.keys(env)) if (re.test(k) && env[k]?.trim()) return { k, v: env[k]!.trim() };
    return null;
  };
  const tok = pick(TOKEN_KEYS, /^HF_.*TOKEN$/i);
  const ds = pick(DATASET_KEYS, /DATASET/i);
  if (!tok || !ds) return null;
  const repo = normalizeRepo(ds.v);
  if (!repo) return null;
  return {
    token: tok.v,
    tokenVar: tok.k,
    repo,
    repoVar: ds.k,
    endpoint: (env.HF_ENDPOINT || 'https://huggingface.co').replace(/\/+$/, ''),
  };
}

/** Ce que le serveur détecte, sans jamais révéler le jeton (pour le diagnostic). */
export function describeConfig(env: NodeJS.ProcessEnv = process.env) {
  const cfg = readHfConfig(env);
  const tokenKeys = Object.keys(env).filter(k => TOKEN_KEYS.includes(k) || /^HF_.*TOKEN$/i.test(k));
  const datasetKeys = Object.keys(env).filter(k => DATASET_KEYS.includes(k) || /DATASET/i.test(k));
  return {
    configured: !!cfg,
    backend: cfg ? 'huggingface' : 'local-file',
    token_variable: cfg?.tokenVar ?? null,
    dataset_variable: cfg?.repoVar ?? null,
    dataset: cfg?.repo ?? null,
    token_variables_found: tokenKeys,
    dataset_variables_found: datasetKeys,
  };
}

// ─────────────────────────────────────────────────────────────
// Hugging Face Hub
// ─────────────────────────────────────────────────────────────
async function hf(cfg: HfConfig, url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.token}`, ...(init.headers || {}) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

const ownerCache = new Map<string, string>();
/** « owner/name » complet ; si seul le nom est fourni, le propriétaire vient du jeton (whoami). */
export async function resolveRepo(cfg: HfConfig): Promise<string> {
  if (cfg.repo.includes('/')) return cfg.repo;
  const cached = ownerCache.get(cfg.token);
  if (cached) return `${cached}/${cfg.repo}`;
  const res = await hf(cfg, `${cfg.endpoint}/api/whoami-v2`);
  if (!res.ok) throw new Error(`jeton refusé par Hugging Face (whoami ${res.status})`);
  const me: any = await res.json();
  if (!me?.name) throw new Error('whoami: nom d\'utilisateur introuvable');
  ownerCache.set(cfg.token, me.name);
  return `${me.name}/${cfg.repo}`;
}

export function recordPath(kind: Kind, now = new Date()): string {
  const iso = now.toISOString(); // 2026-10-09T10:15:30.123Z
  const day = iso.slice(0, 10);
  const stamp = iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); // 20261009T101530Z
  return `${kind}/${day}/${stamp}-${randomBytes(3).toString('hex')}.jsonl`;
}

/** Corps NDJSON de l'API de commit : un en-tête puis un fichier par ligne. */
export function buildCommitBody(summary: string, files: { path: string; content: string }[]): string {
  const lines = [{ key: 'header', value: { summary } }];
  for (const f of files) {
    lines.push({ key: 'file', value: { path: f.path, content: Buffer.from(f.content, 'utf8').toString('base64'), encoding: 'base64' } } as any);
  }
  return lines.map(l => JSON.stringify(l)).join('\n');
}

async function commitToHub(cfg: HfConfig, kind: Kind, record: object): Promise<string> {
  const repo = await resolveRepo(cfg);
  const filePath = recordPath(kind);
  const body = buildCommitBody(`${kind}: nouveau retour`, [{ path: filePath, content: JSON.stringify(record) + '\n' }]);

  let lastErr: Error = new Error('échec inconnu');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await hf(cfg, `${cfg.endpoint}/api/datasets/${repo}/commit/main`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-ndjson' },
        body,
      });
      if (res.ok) return `${repo}:${filePath}`;
      const text = (await res.text()).slice(0, 300);
      // Erreurs définitives : inutile de réessayer
      if (res.status === 401) throw Object.assign(new Error(`HF 401 : jeton invalide ou expiré (${text})`), { fatal: true });
      if (res.status === 403) throw Object.assign(new Error(`HF 403 : le jeton n'a pas le droit d'ÉCRIRE dans ${repo} (${text})`), { fatal: true });
      if (res.status === 404) throw Object.assign(new Error(`HF 404 : dataset « ${repo} » introuvable, ou invisible avec ce jeton (${text})`), { fatal: true });
      lastErr = new Error(`HF ${res.status}: ${text}`);
    } catch (e: any) {
      if (e?.fatal) throw e;
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
    await new Promise(r => setTimeout(r, 400 * (attempt + 1) + Math.random() * 200));
  }
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────
// Repli local (éphémère sur Render)
// ─────────────────────────────────────────────────────────────
function writeLocal(kind: Kind, record: object): string {
  const dir = path.resolve(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${kind}.jsonl`);
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
  return file;
}

export interface SaveResult {
  backend: 'huggingface' | 'local-file';
  where: string;
}

/** Enregistre un retour. Lève une erreur si Hugging Face est configuré mais que l'écriture échoue. */
export async function saveRecord(kind: Kind, data: object): Promise<SaveResult> {
  const record = { id: randomBytes(8).toString('hex'), kind, created_at: new Date().toISOString(), ...data };
  const cfg = readHfConfig();
  if (cfg) return { backend: 'huggingface', where: await commitToHub(cfg, kind, record) };
  const where = writeLocal(kind, record);
  console.warn(
    `[Storage] Hugging Face NON configuré (HF_TOKEN + HF_DATASET attendus) : ${kind} écrit dans ${where}, ` +
      `fichier éphémère sur Render. Voir GET /api/storage-status.`
  );
  return { backend: 'local-file', where };
}

/** Diagnostic actif : le jeton est-il valide, le dataset visible, l'écriture permise ? */
export async function checkStorage() {
  const info: any = describeConfig();
  const cfg = readHfConfig();
  if (!cfg) return { ...info, ok: false, problem: 'HF_TOKEN et/ou le dataset ne sont pas détectés par le serveur.' };
  try {
    const repo = await resolveRepo(cfg);
    info.dataset = repo;
    const res = await hf(cfg, `${cfg.endpoint}/api/datasets/${repo}`);
    if (res.status === 404) return { ...info, ok: false, problem: `Dataset « ${repo} » introuvable (ou privé et jeton sans accès).` };
    if (!res.ok) return { ...info, ok: false, problem: `Lecture du dataset refusée (HTTP ${res.status}).` };
    const meta: any = await res.json();
    const who = await hf(cfg, `${cfg.endpoint}/api/whoami-v2`);
    const me: any = who.ok ? await who.json() : null;
    const role = me?.auth?.accessToken?.role; // 'write' | 'read' | 'fineGrained'…
    return {
      ...info,
      ok: true,
      private: !!meta?.private,
      token_role: role ?? 'inconnu',
      warning: role === 'read' ? "Le jeton est en LECTURE seule : l'écriture échouera (créez un jeton « Write »)." : undefined,
    };
  } catch (e: any) {
    return { ...info, ok: false, problem: String(e?.message || e) };
  }
}
