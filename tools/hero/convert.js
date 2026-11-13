// Bakes the hero bust from the source FBX (arms lowered, cropped at the chest, packed).
// Usage: node tools/hero/convert.js <model.fbx> <out folder> [bust|rig]
//   bust: the menu's portrait (arms lowered, cropped at the chest) -> model.json
//   rig:  the whole body with its skeleton, for the game          -> rig.json
// Needs `npm install` in tools/hero (three.js for its FBX loader, and Playwright).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const [, , fbx, outDir, mode = 'bust'] = process.argv;
if (!fbx || !outDir || !/^(bust|rig)$/.test(mode)) { console.log('usage: node tools/hero/convert.js <model.fbx> <out folder> [bust|rig]'); process.exit(1); }
const root = __dirname, model = path.resolve(fbx);
const types = { '.html': 'text/html', '.js': 'text/javascript' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = url === '/model.fbx' ? model : path.join(root, path.normalize(url));
  if (file !== model && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(0, '127.0.0.1', async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('page error:', e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/${mode === 'rig' ? 'rig.html' : 'convert.html?arm=34&cut=-3.9'}`);
    await page.waitForFunction(() => window.DONE, null, { timeout: 300000 });
    console.log(JSON.stringify(await page.evaluate(() => window.INFO)));
    const out = await page.evaluate(() => window.OUT);
    if (!out) throw new Error('conversion failed');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, mode === 'rig' ? 'rig.json' : 'model.json'), JSON.stringify(out));
  } finally {
    await browser.close();
    server.close();
  }
});
