// Minimal .xlsx reader (no library): unzips with the browser's DecompressionStream and reads the sheet XML.
// Also reads ".xls" files that are really HTML tables (common in Israeli bank exports).

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(data) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw { code: 'format' };
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw { code: 'format' };
    const method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), elen = u16(b, p + 30), clen = u16(b, p + 32), off = u32(b, p + 42);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen));
    const start = off + 30 + u16(b, off + 26) + u16(b, off + 28);
    files[name] = { method, data: b.subarray(start, start + csize) };
    p += 46 + nlen + elen + clen;
  }
  return {
    has: n => !!files[n],
    async text(n) {
      const f = files[n]; if (!f) return null;
      const raw = f.method === 0 ? f.data : f.method === 8 ? await inflateRaw(f.data) : null;
      if (!raw) throw { code: 'format' };
      return new TextDecoder('utf-8').decode(raw);
    },
  };
}

const xml = s => new DOMParser().parseFromString(s, 'application/xml');
const byTag = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];
const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

async function readXlsx(buf) {
  const z = await unzip(buf);
  const shared = [];
  const ss = await z.text('xl/sharedStrings.xml');
  if (ss) for (const si of byTag(xml(ss), 'si')) shared.push(byTag(si, 't').map(t => t.textContent).join(''));
  const wb = xml(await z.text('xl/workbook.xml'));
  const rels = xml((await z.text('xl/_rels/workbook.xml.rels')) || '<r/>');
  const target = {};
  for (const r of byTag(rels, 'Relationship')) target[r.getAttribute('Id')] = r.getAttribute('Target');
  const sheets = [];
  for (const s of byTag(wb, 'sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let t = target[rid] || ''; t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
    const text = await z.text(t); if (!text) continue;
    const rows = [];
    for (const row of byTag(xml(text), 'row')) {
      const r = [];
      for (const c of byTag(row, 'c')) {
        const i = colIndex(c.getAttribute('r') || 'A1'), type = c.getAttribute('t');
        const v = byTag(c, 'v')[0]?.textContent ?? '';
        let val;
        if (type === 's') val = shared[+v] ?? '';
        else if (type === 'inlineStr') val = byTag(c, 't').map(x => x.textContent).join('');
        else if (type === 'str' || type === 'e') val = v;
        else if (type === 'b') val = v === '1';
        else val = v === '' ? '' : Number(v);
        r[i] = val;
      }
      for (let i = 0; i < r.length; i++) if (r[i] === undefined) r[i] = '';
      rows[(+row.getAttribute('r') || rows.length + 1) - 1] = r;
    }
    sheets.push(Array.from(rows, x => x || []));
  }
  return sheets;
}

function readHtmlTables(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return [...doc.querySelectorAll('table')].map(t => [...t.rows].map(tr => [...tr.cells].map(td => td.textContent.replace(/\s+/g, ' ').trim())));
}

/** Returns sheets as arrays of rows, or throws {code:'old-xls'|'format'}. */
export async function readSpreadsheet(file) {
  const buf = await file.arrayBuffer();
  const b = new Uint8Array(buf.slice(0, 8));
  if (b[0] === 0x50 && b[1] === 0x4b) return readXlsx(buf);
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) throw { code: 'old-xls' };
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1255').decode(buf);
  if (/^\s*</.test(text.replace(/^﻿/, ''))) { const t = readHtmlTables(text); if (t.length) return t; }
  return null; // caller treats as CSV text
}
