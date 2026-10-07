// Pré-compresse dist/ (brotli + gzip) une fois pour toutes au build.
// Sur une petite instance (Render gratuit ≈ 0,1 CPU), compresser à chaque requête serait lent.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const EXT = new Set(['.js', '.css', '.html', '.svg', '.json', '.txt', '.map']);
const walk = d => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
let total = 0, br = 0;
for (const file of walk('dist')) {
  if (!EXT.has(extname(file)) || statSync(file).size < 1024) continue;
  const buf = readFileSync(file);
  const b = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
  writeFileSync(file + '.br', b);
  writeFileSync(file + '.gz', gzipSync(buf, { level: 9 }));
  total += buf.length; br += b.length;
}
console.log(`precompress : ${(total / 1024).toFixed(0)} Ko → ${(br / 1024).toFixed(0)} Ko (brotli)`);
