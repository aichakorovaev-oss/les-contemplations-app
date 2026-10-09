/**
 * Enregistrement des retours visiteurs (feedback) et signalements d'œuvres dans un dataset Hugging Face.
 *
 * RÈGLE : ne JAMAIS créer de nouveau fichier dans le dataset. Les lignes sont AJOUTÉES aux fichiers qui
 * existent déjà (ceux de l'ancienne version), en respectant leur format (.jsonl, .json ou .csv) et leurs
 * colonnes. Ces fichiers sont retrouvés par leur nom, ou indiqués explicitement :
 *     HF_FEEDBACK_FILE   chemin exact du fichier des feedbacks dans le dataset (ex. « feedback.jsonl »)
 *     HF_REPORT_FILE     chemin exact du fichier des signalements          (ex. « reports.jsonl »)
 * S'il n'y a aucun fichier sûr (introuvable, ou plusieurs candidats), RIEN n'est écrit sur Hugging Face :
 * le retour est gardé dans un fichier local éphémère et un avertissement détaillé est affiché dans les logs.
 * (HF_ALLOW_CREATE=1 autorise explicitement la création d'un fichier dont le nom est configuré.)
 *
 * Écriture sûre : file d'attente (les envois simultanés sont regroupés) + commit rattaché à la version
 * lue (`parentCommit`) ; si quelqu'un d'autre a modifié le dataset entre-temps, on relit et on réessaie.
 *
 * Variables d'environnement : HF_TOKEN (droit d'écriture) et HF_DATASET (« utilisateur/nom » ou URL).
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


// ─────────────────────────────────────────────────────────────
// Fichiers cibles : jamais de création, on retrouve les fichiers existants
// ─────────────────────────────────────────────────────────────
export type Fmt = 'jsonl' | 'json' | 'csv';
export function fmtOf(p: string): Fmt | null {
  const ext = p.toLowerCase().split('.').pop();
  return ext === 'jsonl' ? 'jsonl' : ext === 'json' ? 'json' : ext === 'csv' ? 'csv' : null;
}

const FILE_ENV: Record<Kind, string[]> = {
  feedback: ['HF_FEEDBACK_FILE', 'HF_FEEDBACK_PATH', 'FEEDBACK_FILE', 'FEEDBACKS_FILE'],
  reports: ['HF_REPORT_FILE', 'HF_REPORTS_FILE', 'HF_REPORT_PATH', 'REPORT_FILE', 'REPORTS_FILE'],
};
export function fileOverrides(env: NodeJS.ProcessEnv = process.env): Partial<Record<Kind, string>> {
  const out: Partial<Record<Kind, string>> = {};
  for (const kind of ['feedback', 'reports'] as Kind[]) {
    for (const k of FILE_ENV[kind]) if (env[k]?.trim()) { out[kind] = env[k]!.trim().replace(/^\/+/, ''); break; }
  }
  return out;
}

export interface Target {
  /** chemin du fichier à compléter ; absent si aucun choix sûr */
  path?: string;
  /** vrai si le fichier n'existe pas encore (création explicitement autorisée) */
  create?: boolean;
  /** pourquoi aucun fichier n'a été retenu */
  problem?: string;
  candidates: string[];
}

// Fichiers de la version « un fichier par retour » (feedback/AAAA-MM-JJ/…) : jamais pris pour cible
const LEGACY_PER_RECORD = /^(feedback|reports)\/\d{4}-\d{2}-\d{2}\//;
const NAME_RE: Record<Kind, RegExp> = { feedback: /feedback|avis/i, reports: /report|signal/i };
const EXACT_RE: Record<Kind, RegExp> = { feedback: /^(feedbacks?|avis)$/i, reports: /^(reports?|signalements?)$/i };
const base = (p: string) => p.split('/').pop() || p;
const stem = (p: string) => base(p).replace(/\.[^.]+$/, '');

export function pickTargets(
  files: string[],
  overrides: Partial<Record<Kind, string>> = {},
  allowCreate = false
): Record<Kind, Target> {
  const set = new Set(files);
  const out = {} as Record<Kind, Target>;
  for (const kind of ['feedback', 'reports'] as Kind[]) {
    const supported = files.filter(f => fmtOf(f) && !LEGACY_PER_RECORD.test(f));
    const candidates = supported.filter(f => NAME_RE[kind].test(base(f)));
    const o = overrides[kind];
    if (o) {
      if (!fmtOf(o)) out[kind] = { candidates, problem: `format de « ${o} » non géré (attendu .jsonl, .json ou .csv)` };
      else if (set.has(o)) out[kind] = { path: o, candidates };
      else if (allowCreate) out[kind] = { path: o, create: true, candidates };
      else out[kind] = { candidates, problem: `le fichier « ${o} » n'existe pas dans le dataset (création non autorisée)` };
      continue;
    }
    if (candidates.length === 1) { out[kind] = { path: candidates[0], candidates }; continue; }
    const exact = candidates.filter(f => EXACT_RE[kind].test(stem(f)));
    if (candidates.length > 1 && exact.length === 1) { out[kind] = { path: exact[0], candidates }; continue; }
    out[kind] = {
      candidates,
      problem: candidates.length === 0
        ? 'aucun fichier existant ne ressemble à ce nom (feedback / report) : indiquez-le avec ' + FILE_ENV[kind][0]
        : `plusieurs fichiers possibles (${candidates.join(', ')}) : indiquez le bon avec ${FILE_ENV[kind][0]}`,
    };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Lecture / ajout de lignes en respectant le format et les colonnes existants
// ─────────────────────────────────────────────────────────────
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}
export const csvCell = (v: string) => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export interface Table {
  fmt: Fmt;
  keys: string[];
  sample: Record<string, any>;
  rows: number;
  /** colonne → valeurs lues (CSV) pour imiter le style (booléens, listes) */
  csvBody?: string[][];
}

/** Lit un fichier existant : colonnes, nombre de lignes, dernière ligne (pour imiter le style). */
export function inspectTable(fmt: Fmt, text: string): Table | null {
  const body = text.replace(/^\uFEFF/, '');
  if (!body.trim()) return null;
  if (fmt === 'csv') {
    const rows = parseCsv(body);
    if (!rows.length) return null;
    const keys = rows[0];
    const data = rows.slice(1);
    const last = data[data.length - 1] || [];
    return { fmt, keys, sample: Object.fromEntries(keys.map((k, i) => [k, last[i]])), rows: data.length, csvBody: data };
  }
  let rows: any[];
  if (fmt === 'jsonl') {
    rows = body.split('\n').map(l => l.trim()).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(r => r && typeof r === 'object');
  } else {
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed)) throw new Error('fichier .json qui n\'est pas une liste : format non géré');
    rows = parsed.filter(r => r && typeof r === 'object');
  }
  const keys: string[] = [];
  for (const r of rows.slice(-30)) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  return { fmt, keys, sample: rows[rows.length - 1] || {}, rows: rows.length };
}

const TS_KEYS = ['created_at', 'timestamp', 'ts', 'time', 'date', 'datetime', 'created', 'created_on', 'submitted_at', 'createdat'];
const ALIASES: Record<string, string[]> = {
  rating: ['stars', 'score', 'note'],
  would_recommend: ['recommend', 'recommended', 'wouldrecommend'],
  comment: ['comments', 'message', 'text', 'free_text'],
  why_not: ['why_not_recommend', 'whynot'],
  mood_tags: ['moods', 'tags', 'mood', 'moodtags'],
  empty_frame_seen: ['empty_frame', 'emptyframe'],
  painting_id: ['painting', 'work_id', 'paintingid'],
  painting_title: ['title', 'painting_name', 'paintingtitle'],
  reason_category: ['category', 'reason', 'motif', 'reasoncategory'],
  reason_text: ['details', 'description', 'text', 'reasontext'],
  lang: ['language', 'locale'],
};

function formatTimestamp(sample: unknown, now: Date): string | number {
  if (typeof sample === 'number') return sample > 1e12 ? now.getTime() : Math.floor(now.getTime() / 1000);
  if (typeof sample === 'string') {
    if (/^\d{12,13}$/.test(sample)) return String(now.getTime());
    if (/^\d{9,11}(\.\d+)?$/.test(sample)) return String(Math.floor(now.getTime() / 1000));
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(sample)) return now.toISOString().slice(0, 19).replace('T', ' ');
  }
  return now.toISOString();
}

/** Une ligne dans les colonnes EXISTANTES (valeur absente → null) ; colonnes inconnues ignorées. */
export function alignRecord(rec: Record<string, any>, table: Table, now = new Date()): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of table.keys) {
    const lk = key.toLowerCase();
    if (key in rec) out[key] = rec[key];
    else if (TS_KEYS.includes(lk)) out[key] = formatTimestamp(table.sample[key], now);
    else {
      let v: any = null;
      for (const [mine, alts] of Object.entries(ALIASES)) if (mine in rec && alts.includes(lk)) { v = rec[mine]; break; }
      out[key] = v;
    }
  }
  return out;
}

function csvValue(v: any, sampleCell: string | undefined, boolStyle: 'py' | 'lower' | 'num', listStyle: 'json' | 'py' = 'json'): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return boolStyle === 'py' ? (v ? 'True' : 'False') : boolStyle === 'num' ? (v ? '1' : '0') : v ? 'true' : 'false';
  if (Array.isArray(v)) {
    if (sampleCell !== undefined && sampleCell !== '' && !sampleCell.trim().startsWith('[')) return v.join(', '); // liste « a, b »
    return listStyle === 'py' ? `[${v.map(x => `'${String(x).replace(/'/g, "\\'")}'`).join(', ')}]` : JSON.stringify(v);
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
/** Listes écrites à la Python (['a', 'b']) ou en JSON (["a", "b"]) dans le fichier existant ? */
function csvListStyle(body: string[][] | undefined): 'json' | 'py' {
  return (body || []).flat().some(c => /^\[\s*'/.test(c)) ? 'py' : 'json';
}
function csvBoolStyle(body: string[][] | undefined): 'py' | 'lower' | 'num' {
  const cells = (body || []).flat();
  if (cells.some(c => c === 'True' || c === 'False')) return 'py';
  if (cells.some(c => c === 'true' || c === 'false')) return 'lower';
  return 'lower';
}

/** Contenu complet du fichier après ajout des lignes (le contenu existant est conservé tel quel). */
export function appendRecords(fmt: Fmt, existing: string, records: Record<string, any>[], now = new Date()): string {
  const table = inspectTable(fmt, existing);
  const rows = table ? records.map(r => alignRecord(r, table, now)) : records;
  const keys = table ? table.keys : Object.keys(records[0] || {});

  if (fmt === 'jsonl') {
    const text = existing.endsWith('\n') || !existing ? existing : existing + '\n';
    return text + rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  }
  if (fmt === 'json') {
    const arr: any[] = table ? JSON.parse(existing.replace(/^\uFEFF/, '')) : [];
    arr.push(...rows);
    const indent = /\n\s{4}"/.test(existing) ? 4 : /\n\s{2}["{]/.test(existing) || /\n\s+"/.test(existing) ? 2 : /\n/.test(existing.trim()) ? 2 : 0;
    return JSON.stringify(arr, null, indent || undefined) + '\n';
  }
  // csv
  const eol = /\r\n/.test(existing) ? '\r\n' : '\n';
  const style = csvBoolStyle(table?.csvBody);
  const lstyle = csvListStyle(table?.csvBody);
  const lines = rows.map(r => keys.map(k => csvCell(csvValue(r[k], table?.sample?.[k] as string | undefined, style, lstyle))).join(','));
  if (!table) return [keys.map(csvCell).join(','), ...lines].join(eol) + eol;
  const text = existing.endsWith('\n') || existing.endsWith('\r') ? existing : existing + eol;
  return text + lines.join(eol) + eol;
}

// ─────────────────────────────────────────────────────────────
// Hugging Face : lecture de la version courante, commit rattaché à cette version
// ─────────────────────────────────────────────────────────────
const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');

async function headSha(cfg: HfConfig, repo: string): Promise<string | null> {
  const res = await hf(cfg, `${cfg.endpoint}/api/datasets/${repo}`);
  explain(res.status, repo);
  if (!res.ok) throw new Error(`HF ${res.status} en lisant le dataset`);
  const meta: any = await res.json();
  return typeof meta?.sha === 'string' ? meta.sha : null;
}

async function listFiles(cfg: HfConfig, repo: string, rev: string): Promise<string[]> {
  const res = await hf(cfg, `${cfg.endpoint}/api/datasets/${repo}/tree/${encodeURIComponent(rev)}?recursive=true`);
  if (!res.ok) throw new Error(`HF ${res.status} en listant les fichiers du dataset`);
  const items: any[] = await res.json();
  return items.filter(i => i?.type === 'file' && typeof i.path === 'string').map(i => i.path);
}

async function readFile(cfg: HfConfig, repo: string, rev: string, filePath: string): Promise<string> {
  const res = await hf(cfg, `${cfg.endpoint}/datasets/${repo}/resolve/${encodeURIComponent(rev)}/${enc(filePath)}`);
  if (res.status === 404) return '';
  if (!res.ok) throw new Error(`HF ${res.status} en lisant ${filePath}`);
  return res.text();
}

function explain(status: number, repo: string) {
  if (status === 401) throw Object.assign(new Error('HF 401 : jeton invalide ou expiré'), { fatal: true });
  if (status === 403) throw Object.assign(new Error(`HF 403 : le jeton n'a pas le droit d'ÉCRIRE dans ${repo}`), { fatal: true });
  if (status === 404) throw Object.assign(new Error(`HF 404 : dataset « ${repo} » introuvable, ou invisible avec ce jeton`), { fatal: true });
}

/** Corps NDJSON de l'API de commit : un en-tête puis un fichier par ligne. */
export function buildCommitBody(summary: string, files: { path: string; content: string }[], parentCommit?: string | null): string {
  const header: any = { summary };
  if (parentCommit) header.parentCommit = parentCommit;
  const lines: any[] = [{ key: 'header', value: header }];
  for (const f of files) {
    lines.push({ key: 'file', value: { path: f.path, content: Buffer.from(f.content, 'utf8').toString('base64'), encoding: 'base64' } });
  }
  return lines.map(l => JSON.stringify(l)).join('\n');
}

// ─────────────────────────────────────────────────────────────
// File d'attente : les envois simultanés sont regroupés en un seul commit
// ─────────────────────────────────────────────────────────────
export interface SaveResult {
  backend: 'huggingface' | 'local-file';
  where: string;
  note?: string;
}
interface Pending {
  kind: Kind;
  record: Record<string, any>;
  resolveDone?: boolean;
  resolve: (r: SaveResult) => void;
  reject: (e: Error) => void;
}
const pending: Pending[] = [];
let flushing = false;

function writeLocal(kind: Kind, record: object): string {
  const dir = path.resolve(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${kind}.jsonl`);
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
  return file;
}

function fallbackLocal(p: Pending, why: string) {
  const where = writeLocal(p.kind, p.record);
  console.warn(`[Storage] ${p.kind} NON écrit sur Hugging Face (${why}) → gardé localement dans ${where} (éphémère sur Render).`);
  p.resolve({ backend: 'local-file', where, note: why });
}

async function commitBatch(cfg: HfConfig, batch: Pending[]) {
  const repo = await resolveRepo(cfg);
  const allowCreate = process.env.HF_ALLOW_CREATE === '1';
  let lastErr: Error = new Error('échec inconnu');

  for (let attempt = 0; attempt < 6; attempt++) {
    const sha = await headSha(cfg, repo);
    const rev = sha || 'main';
    const targets = pickTargets(await listFiles(cfg, repo, rev), fileOverrides(), allowCreate);

    const files: { path: string; content: string }[] = [];
    const committed: Pending[] = [];
    for (const kind of ['feedback', 'reports'] as Kind[]) {
      const group = batch.filter(p => p.kind === kind && !p.resolveDone);
      if (!group.length) continue;
      const target = targets[kind];
      if (!target.path) {
        // aucun fichier sûr : on ne crée RIEN, on garde le retour localement
        group.forEach(p => { p.resolveDone = true; fallbackLocal(p, target.problem || 'fichier cible introuvable'); });
        continue;
      }
      const fmt = fmtOf(target.path)!;
      const existing = target.create ? '' : await readFile(cfg, repo, rev, target.path);
      files.push({ path: target.path, content: appendRecords(fmt, existing, group.map(p => p.record)) });
      committed.push(...group);
    }
    if (!files.length) return;

    const res = await hf(cfg, `${cfg.endpoint}/api/datasets/${repo}/commit/main`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body: buildCommitBody(`${committed.length} retour(s) visiteur`, files, sha),
    });
    if (res.ok) {
      for (const p of committed) {
        p.resolveDone = true;
        p.resolve({ backend: 'huggingface', where: `${repo}:${files.map(f => f.path).join(', ')}` });
      }
      return;
    }
    const text = (await res.text()).slice(0, 300);
    explain(res.status, repo);
    // 412 / 409 : le dataset a changé depuis la lecture → on relit et on recommence
    lastErr = new Error(`HF ${res.status}: ${text}`);
    await new Promise(r => setTimeout(r, 250 * (attempt + 1) + Math.random() * 250));
  }
  throw lastErr;
}

async function flush(cfg: HfConfig) {
  if (flushing) return;
  flushing = true;
  try {
    while (pending.length) {
      const batch = pending.splice(0, pending.length);
      try {
        await commitBatch(cfg, batch);
      } catch (err: any) {
        batch.filter(p => !p.resolveDone).forEach(p => p.reject(err instanceof Error ? err : new Error(String(err))));
      }
    }
  } finally {
    flushing = false;
  }
}

/** Enregistre un retour. Lève une erreur si Hugging Face est configuré mais que l'écriture échoue. */
export async function saveRecord(kind: Kind, data: object): Promise<SaveResult> {
  const record = { id: randomBytes(8).toString('hex'), kind, created_at: new Date().toISOString(), ...data };
  const cfg = readHfConfig();
  if (!cfg) {
    const where = writeLocal(kind, record);
    console.warn(
      `[Storage] Hugging Face NON configuré (HF_TOKEN + HF_DATASET attendus) : ${kind} écrit dans ${where}, ` +
        `fichier éphémère sur Render. Voir GET /api/storage-status.`
    );
    return { backend: 'local-file', where };
  }
  return new Promise<SaveResult>((resolve, reject) => {
    pending.push({ kind, record, resolve, reject });
    void flush(cfg);
  });
}

// ─────────────────────────────────────────────────────────────
// Diagnostic (jamais de contenu des retours, jamais le jeton)
// ─────────────────────────────────────────────────────────────
async function describeTarget(cfg: HfConfig, repo: string, rev: string, t: Target) {
  if (!t.path) return { file: null, problem: t.problem, candidates: t.candidates };
  const fmt = fmtOf(t.path)!;
  try {
    const table = inspectTable(fmt, t.create ? '' : await readFile(cfg, repo, rev, t.path));
    return { file: t.path, format: fmt, rows: table?.rows ?? 0, columns: table?.keys ?? [], will_create: !!t.create || undefined };
  } catch (e: any) {
    return { file: t.path, format: fmt, problem: String(e?.message || e) };
  }
}

export async function checkStorage() {
  const info: any = describeConfig();
  const cfg = readHfConfig();
  if (!cfg) return { ...info, ok: false, problem: 'HF_TOKEN et/ou le dataset ne sont pas détectés par le serveur.' };
  try {
    const repo = await resolveRepo(cfg);
    info.dataset = repo;
    const sha = await headSha(cfg, repo);
    const rev = sha || 'main';
    const targets = pickTargets(await listFiles(cfg, repo, rev), fileOverrides(), process.env.HF_ALLOW_CREATE === '1');
    const who = await hf(cfg, `${cfg.endpoint}/api/whoami-v2`);
    const me: any = who.ok ? await who.json() : null;
    const role = me?.auth?.accessToken?.role;
    return {
      ...info,
      ok: !!targets.feedback.path && !!targets.reports.path,
      token_role: role ?? 'inconnu',
      warning: role === 'read' ? "Le jeton est en LECTURE seule : l'écriture échouera (créez un jeton « Write »)." : undefined,
      feedback: await describeTarget(cfg, repo, rev, targets.feedback),
      reports: await describeTarget(cfg, repo, rev, targets.reports),
    };
  } catch (e: any) {
    return { ...info, ok: false, problem: String(e?.message || e) };
  }
}

/** Au démarrage : affiche dans les logs les fichiers du dataset et ceux qui seront complétés. */
export async function logDatasetFiles() {
  const cfg = readHfConfig();
  if (!cfg) return;
  try {
    const repo = await resolveRepo(cfg);
    const rev = (await headSha(cfg, repo)) || 'main';
    const files = await listFiles(cfg, repo, rev);
    const targets = pickTargets(files, fileOverrides(), process.env.HF_ALLOW_CREATE === '1');
    console.log(`[Storage] Fichiers du dataset « ${repo} » (${files.length}) : ${files.slice(0, 40).join(', ')}${files.length > 40 ? ', …' : ''}`);
    for (const k of ['feedback', 'reports'] as Kind[]) {
      const t = targets[k];
      console.log(t.path ? `[Storage] ${k} → les lignes seront AJOUTÉES à « ${t.path} »` : `[Storage] ${k} → AUCUN fichier retenu : ${t.problem}`);
    }
  } catch (e: any) {
    console.warn('[Storage] lecture du dataset impossible au démarrage :', e?.message || e);
  }
}
