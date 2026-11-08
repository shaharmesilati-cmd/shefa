// Reads a PDF statement from the bank or the credit card company ON THE DEVICE (pdf.js, nothing is uploaded).
// Text PDFs: the words and their positions are read directly. Scanned PDFs (pictures): each page goes through
// the same on-device screenshot reader. The result is plain text lines for parseStatement().
import { buildLines } from './ocrlayout.js';
import { readImage, stopOcr } from './ocr.js';

let lib = null, BASE = '';
async function pdfjs() {
  if (lib) return lib;
  BASE = new URL('vendor/pdfjs/', location.href).href;
  const m = await import(BASE + 'pdf.min.mjs');
  m.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.mjs';
  lib = m;
  return lib;
}

const MONEY = /^-?₪?\s?-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?₪?-?$|^-?\d+\.\d{2}-?$/;
const COLS = [
  ['charge', /סכום\s*(ה)?חיוב|חיוב\s*בש"?ח|סכום\s*לחיוב|לחיוב\s*בש"?ח/],
  ['deal', /סכום\s*(ה)?עסקה|סכום\s*מקורי|סכום\s*קנייה/],
  ['debit', /^חובה$|בחובה/],
  ['credit', /^זכות$|בזכות/],
  ['balance', /יתרה/],
];

/** Finds the amount columns from the table header so the right number is kept on each row. */
function findColumns(lines) {
  for (const l of lines) {
    const found = {};
    for (const w of l.words) for (const [k, re] of COLS) if (!found[k] && re.test(w.text)) found[k] = w.x + w.w / 2;
    // header words may be split ("סכום" + "חיוב"): try pairs too
    for (let i = 0; i < l.words.length - 1; i++) {
      const t = l.words[i].text + ' ' + l.words[i + 1].text, t2 = l.words[i + 1].text + ' ' + l.words[i].text;
      for (const [k, re] of COLS) if (!found[k] && (re.test(t) || re.test(t2))) found[k] = (l.words[i].x + l.words[i + 1].x + l.words[i + 1].w) / 2;
    }
    if (found.charge || (found.debit && found.credit)) return { ...found, headerY: l.y };
  }
  return null;
}

function groupLines(words) {
  const ws = words.slice().sort((a, b) => a.y - b.y), lines = [];
  for (const w of ws) {
    const L = lines.find(l => Math.abs(l.y - w.y) <= Math.max(l.h, w.h) * 0.5);
    if (L) { L.words.push(w); L.h = Math.max(L.h, w.h); } else lines.push({ y: w.y, h: w.h, words: [w] });
  }
  return lines.sort((a, b) => a.y - b.y);
}

/** Text lines of one page, keeping only the amount that matters on each row. */
function pageText(words) {
  const lines = groupLines(words);
  const cols = findColumns(lines);
  let bank = false;
  if (cols) {
    bank = !!(cols.debit && cols.credit) && !cols.charge;
    for (const l of lines) {
      if (l.y <= cols.headerY) continue;
      const money = l.words.filter(w => MONEY.test(w.text.trim()));
      if (!money.length) continue;
      const nearest = w => { const cx = w.x + w.w / 2; let best = null; for (const k of ['charge', 'deal', 'debit', 'credit', 'balance']) if (cols[k] != null) { const d = Math.abs(cx - cols[k]); if (!best || d < best.d) best = { k, d }; } return best && best.k; };
      const keep = [];
      for (const w of money) {
        const k = nearest(w);
        if (cols.charge ? k === 'charge' : (k === 'debit' || k === 'credit')) { keep.push(w); if (k === 'credit') l.income = true; }
      }
      if (keep.length) l.words = l.words.filter(w => !money.includes(w) || keep.includes(w));
    }
  }
  const text = lines.map(l => buildLines(l.words) + (l.income ? ' ⟦IN⟧' : '')).join('\n');
  return { text, bank };
}

/** Returns { text, bank, pages, scanned }. */
export async function readPdf(file, onStatus) {
  const pdf = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdf.getDocument({ data, isEvalSupported: false, disableFontFace: true, cMapUrl: BASE + 'cmaps/', cMapPacked: true,
    standardFontDataUrl: BASE + 'standard_fonts/', wasmUrl: BASE + 'wasm/' });
  const doc = await task.promise;
  const n = Math.min(doc.numPages, 30);
  const out = []; let bank = false, scanned = 0;
  try {
    for (let i = 1; i <= n; i++) {
      onStatus && onStatus(`קורא עמוד ${i} מתוך ${n}…`, (i - 1) / n);
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const words = tc.items.filter(it => it.str && it.str.trim()).map(it => {
        const h = Math.abs(it.height || it.transform[3]) || 10;
        return { x: it.transform[4], y: vp.height - it.transform[5] - h, w: it.width, h, text: it.str.trim() };
      });
      if (words.reduce((a, w) => a + w.text.length, 0) >= 20) {
        const r = pageText(words); out.push(r.text); bank = bank || r.bank;
      } else {
        // a scanned page: render it and read it like a screenshot
        scanned++;
        const v2 = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas'); c.width = v2.width; c.height = v2.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: v2 }).promise;
        const blob = await new Promise(res => c.toBlob(res, 'image/png'));
        c.width = c.height = 0;
        out.push(await readImage(blob, (msg, p) => onStatus && onStatus(msg || `קורא עמוד סרוק ${i}…`, (i - 1 + (p || 0)) / n)));
      }
      page.cleanup();
    }
  } finally {
    try { await task.destroy(); } catch { }
    if (scanned) await stopOcr();
  }
  return { text: out.join('\n'), bank, pages: n, scanned };
}
