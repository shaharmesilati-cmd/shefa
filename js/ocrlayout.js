// Turns Tesseract word boxes back into screen lines, right to left.
// The Hebrew model reads names well but numbers poorly, so number-like boxes are re-read by a digits-only pass.

/** Parses Tesseract TSV output into words with their boxes. */
export function parseTsv(tsv) {
  const words = [];
  for (const line of String(tsv || '').split('\n').slice(1)) {
    const c = line.split('\t');
    if (c.length < 12 || c[0] !== '5') continue;
    const text = c.slice(11).join('\t').trim();
    if (!text) continue;
    words.push({ x: +c[6], y: +c[7], w: +c[8], h: +c[9], conf: +c[10], text });
  }
  return words;
}

const HEB = /[֐-׿]/, LAT2 = /[a-z]{2,}/i;
/** A box that should be re-read as digits (amount, date, time). */
export const needsDigits = w => !HEB.test(w.text) && !LAT2.test(w.text) && w.w > 8 && w.h > 8;

/** Groups words into lines by their vertical centre and joins each line right-to-left. */
export function buildLines(words) {
  const ws = words.filter(w => w.text && w.text.trim()).map(w => ({ ...w, cy: w.y + w.h / 2 })).sort((a, b) => a.cy - b.cy);
  const lines = [];
  for (const w of ws) {
    const L = lines.find(l => Math.abs(l.cy - w.cy) <= Math.max(l.h, w.h) * 0.55);
    if (L) { L.words.push(w); L.cy = (L.cy * (L.words.length - 1) + w.cy) / L.words.length; L.h = Math.max(L.h, w.h); }
    else lines.push({ cy: w.cy, h: w.h, words: [w] });
  }
  return lines.sort((a, b) => a.cy - b.cy)
    .map(l => l.words.sort((a, b) => (b.x + b.w) - (a.x + a.w)).map(w => w.text).join(' '))
    .join('\n');
}
