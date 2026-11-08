// Reads screenshots ON THE DEVICE with Tesseract (Hebrew + English). The image is never uploaded.
// The OCR engine files live in vendor/ and are downloaded by the site build (see .github/workflows/pages.yml).

import { parseTsv, needsDigits, buildLines } from './ocrlayout.js';

let worker = null, digits = null, loading = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.dataset.src = src; s.onload = res; s.onerror = () => { s.remove(); rej(new Error('load')); };
    document.head.appendChild(s);
  });
}

export async function ocrAvailable() {
  try { const r = await fetch('vendor/tesseract/tesseract.min.js', { method: 'HEAD', cache: 'no-store' }); return r.ok; } catch { return false; }
}

async function getWorker(onStatus) {
  if (worker) return worker;
  if (!loading) loading = (async () => {
    await loadScript('vendor/tesseract/tesseract.min.js');
    const base = new URL('vendor/tesseract/', location.href).href;
    onStatus && onStatus('מכין את קורא הצילומים (רק בפעם הראשונה)…');
    const opts = { workerPath: base + 'worker.min.js', corePath: base + 'core', langPath: base + 'lang', gzip: true, workerBlobURL: false };
    // words + their positions (Hebrew and English names)
    const w = await window.Tesseract.createWorker(['heb', 'eng'], 1, opts);
    await w.setParameters({ tessedit_pageseg_mode: '11' });
    // digits only, for amounts, dates and times
    const d = await window.Tesseract.createWorker('eng', 1, opts);
    await d.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789.,:/-' });
    worker = w; digits = d; return w;
  })().catch(e => { loading = null; throw e; });
  return loading;
}

/** Grayscale, scale to a good OCR width, and invert dark-mode screenshots so the text is dark on light. */
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(2, Math.max(1, 1300 / bmp.width));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, h); bmp.close && bmp.close();
  const img = g.getImageData(0, 0, w, h), d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = y; sum += y; }
  const dark = sum / (d.length / 4) < 110;
  if (dark) for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255 - d[i];
  g.putImageData(img, 0, 0);
  return c;
}
function wipeCanvas(c) { try { c.getContext('2d').clearRect(0, 0, c.width, c.height); c.width = c.height = 0; } catch { } }

/** Returns the recognized text of one image, line by line. The prepared copy is wiped right after. */
export async function readImage(file, onStatus) {
  const w = await getWorker(onStatus);
  const canvas = await prepare(file);
  try {
    onStatus && onStatus('קורא את הטקסט…');
    const { data } = await w.recognize(canvas, {}, { tsv: true, text: false, blocks: false, hocr: false });
    const words = parseTsv(data.tsv);
    const redo = words.filter(needsDigits);
    for (let i = 0; i < redo.length; i++) {
      const b = redo[i], p = 8;
      const left = Math.max(0, b.x - p), top = Math.max(0, b.y - p);
      const cw = Math.min(canvas.width - left, b.w + 2 * p), ch = Math.min(canvas.height - top, b.h + 2 * p);
      const crop = document.createElement('canvas'); crop.width = cw; crop.height = ch;
      crop.getContext('2d').drawImage(canvas, left, top, cw, ch, 0, 0, cw, ch);
      try {
        const r = await digits.recognize(crop, {}, { text: true, blocks: false, hocr: false, tsv: false });
        const t = (r.data.text || '').replace(/\s+/g, '');
        if (t) b.text = t;
      } catch { } finally { wipeCanvas(crop); }
      onStatus && onStatus(null, 0.3 + 0.7 * ((i + 1) / redo.length));
    }
    return buildLines(words);
  } finally { wipeCanvas(canvas); }
}

/** Frees the OCR engine and everything it held in memory. */
export async function stopOcr() {
  const ws = [worker, digits]; worker = digits = null; loading = null;
  for (const w of ws) if (w) { try { await w.terminate(); } catch { } }
}
