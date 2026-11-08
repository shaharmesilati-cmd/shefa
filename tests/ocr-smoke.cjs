// CI check: serves the built site, opens tests/ocr-smoke.html in headless Chrome and checks what was read.
const puppeteer = require('puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.gz': 'application/gzip', '.svg': 'image/svg+xml', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(data); });
}).listen(8099);
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', m => console.log('page:', m.text()));
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto('http://localhost:8099/ocr-smoke.html');
  await page.waitForFunction('window.__done', { timeout: 240000 });
  const out = await page.evaluate(() => window.__done);
  await browser.close(); server.close();
  console.log(JSON.stringify(out, null, 1));
  if (out.error) throw new Error(out.error);
  for (const n of ['light', 'dark']) {
    const rows = out[n].rows, amounts = rows.map(r => r.amount);
    for (const a of [214.9, 180, 400, 89.9]) if (!amounts.includes(a)) throw new Error(`${n}: amount ${a} not read`);
    if (rows.length < 4) throw new Error(`${n}: only ${rows.length} purchases`);
    if (!rows.every(r => r.card === '9012')) throw new Error(`${n}: card last-4 missing`);
    if (JSON.stringify(out[n]).match(/4580|5678/)) throw new Error(`${n}: full card number leaked`);
  }
  const p = out.payslip;
  if (p.net !== 12345.67) console.log('payslip text:\n' + out.payslipText);
  if (p.net !== 12345.67 || p.gross !== 16200 || p.monthKey !== '2026-10') throw new Error('payslip: wrong numbers ' + JSON.stringify(p));
  if (JSON.stringify(p).match(/012345678|1234567/)) throw new Error('payslip: personal number leaked');
  console.log('OCR smoke test passed');
})().catch(e => { console.error('OCR smoke test FAILED:', e.message); server.close(); process.exit(1); });
