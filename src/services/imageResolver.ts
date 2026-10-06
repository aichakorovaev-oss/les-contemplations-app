import * as THREE from 'three';
import { Painting } from '../types/gallery';

const _imgUrlCache: Record<string, string> = {};
const IMG_WIDTH = 1024;

export async function resolveCommonsFile(file: string): Promise<string | null> {
  try {
    const api = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(file)}&prop=imageinfo&iiprop=url|thumburl|mime&iiurlwidth=${IMG_WIDTH}&redirects=1&format=json&origin=*`;
    const r = await fetch(api);
    const d = await r.json();
    const pages = Object.values(d?.query?.pages || {}) as any[];
    for (const pg of pages) {
      if (pg.missing !== undefined || pg.ns === -1) return null;
      const info = pg?.imageinfo?.[0];
      const url = info?.thumburl || info?.url;
      if (url) return url;
    }
  } catch (e: any) {
    console.warn('resolveCommonsFile error', file, e.message);
  }
  return null;
}

export async function searchCommonsImage(p: Painting): Promise<string | null> {
  const query = [p.artist, p.searchTitle || p.title].filter(Boolean).join(' ');
  if (!query) return null;
  try {
    const api = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(query + ' filetype:bitmap')}&gsrlimit=12&prop=imageinfo&iiprop=url|thumburl|mime&iiurlwidth=${IMG_WIDTH}&format=json&origin=*`;
    const r = await fetch(api);
    const d = await r.json();
    const pages = Object.values(d?.query?.pages || {}) as any[];

    const bad = /(crop|cropped|detail|détail|study|étude|sketch|esquisse|frame|x-ray|xray|signature|tile|map)/i;
    const surname = (p.artist || '').split(/\s+/).pop()?.toLowerCase() || '';
    const titleWords = (p.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);

    const cand = pages
      .map(pg => {
        const info = pg?.imageinfo?.[0];
        if (!info) return null;
        const mime = (info.mime || '').toLowerCase();
        if (!/jpeg|jpg|png/.test(mime)) return null;
        const title = (pg.title || '').toLowerCase();
        if (bad.test(title)) return null;
        let score = 0;
        if (surname && title.includes(surname)) score += 3;
        for (const w of titleWords) {
          if (title.includes(w)) score += 1;
        }
        return { url: info.thumburl || info.url, score, idx: pg.index || 99 };
      })
      .filter(Boolean)
      .sort((a, b) => b!.score - a!.score || a!.idx - b!.idx);

    if (cand.length && cand[0]) {
      console.info('Image fallback used for', p.id, '→', cand[0].url);
      return cand[0].url;
    }
  } catch (e: any) {
    console.warn('searchCommonsImage error', p.id, e.message);
  }
  return null;
}

export async function fetchImageUrl(p: Painting): Promise<string | null> {
  if (_imgUrlCache[p.id]) return _imgUrlCache[p.id];

  if (p.wikiFile) {
    const exact = await resolveCommonsFile(decodeURIComponent(p.wikiFile));
    if (exact) {
      _imgUrlCache[p.id] = exact;
      return exact;
    }
  }

  const found = await searchCommonsImage(p);
  if (found) {
    _imgUrlCache[p.id] = found;
    return found;
  }

  return null;
}

export async function loadArtworkDrawable(url: string): Promise<ImageBitmap | HTMLImageElement> {
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (resp.ok) return await createImageBitmap(await resp.blob());
  } catch (e: any) {
    console.warn('[annotations] fetch image failed, fallback via <img>:', e.message);
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('img load failed'));
    img.src = url;
  });
}

export async function paintingToInline(url: string, maxSide = 1024): Promise<{ mimeType: string; data: string }> {
  const d = await loadArtworkDrawable(url);
  const iw = d instanceof HTMLImageElement ? d.naturalWidth : d.width;
  const ih = d instanceof HTMLImageElement ? d.naturalHeight : d.height;
  const scale = Math.min(1, maxSide / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d')?.drawImage(d as CanvasImageSource, 0, 0, w, h);
  if ('close' in d && typeof d.close === 'function') d.close();
  const dataUrl = cv.toDataURL('image/jpeg', 0.9);
  return { mimeType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

export async function makeBlurredTexture(url: string): Promise<THREE.CanvasTexture | null> {
  try {
    const d = await loadArtworkDrawable(url);
    const iw = d instanceof HTMLImageElement ? d.naturalWidth || 512 : d.width || 512;
    const ih = d instanceof HTMLImageElement ? d.naturalHeight || 512 : d.height || 512;
    const maxSide = 480;
    const scale = Math.min(1, maxSide / Math.max(iw, ih));
    const cw = Math.max(1, Math.round(iw * scale));
    const ch = Math.max(1, Math.round(ih * scale));
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    const filterOK = 'filter' in (ctx as any);
    if (filterOK) {
      (ctx as any).filter = `blur(${Math.max(6, Math.round(cw * 0.05))}px)`;
      ctx.drawImage(d as CanvasImageSource, 0, 0, cw, ch);
      (ctx as any).filter = 'none';
    } else {
      ctx.drawImage(d as CanvasImageSource, 0, 0, cw, ch);
    }
    if ('close' in d && typeof d.close === 'function') d.close();
    ctx.fillStyle = filterOK ? 'rgba(10,8,6,0.4)' : 'rgba(8,6,4,0.94)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    const r = Math.max(20, Math.min(cw, ch) * 0.1);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(244,240,230,0.9)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, cw * 0.004);
    ctx.strokeStyle = 'rgba(10,8,6,0.5)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(30,22,14,0.92)';
    ctx.font = `700 ${Math.round(r * 0.8)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('18+', 0, r * 0.06);
    ctx.restore();
    const tx = new THREE.CanvasTexture(cv);
    tx.colorSpace = THREE.SRGBColorSpace;
    return tx;
  } catch (e) {
    console.warn('[nudity-gate] blur load failed', e);
    return null;
  }
}
