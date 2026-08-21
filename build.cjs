const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const partsDir = path.join(__dirname, 'bundle');
const parts = fs.readdirSync(partsDir).filter((name) => /^part\d+\.txt$/.test(name)).sort();
if (!parts.length) throw new Error('No bundle parts found');

const encoded = parts.map((name) => fs.readFileSync(path.join(partsDir, name), 'utf8')).join('').trim();
const payload = zlib.gunzipSync(Buffer.from(encoded, 'base64'));
const files = JSON.parse(payload.toString('utf8'));
const out = path.join(__dirname, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const [relative, content] of Object.entries(files)) {
  const target = path.join(out, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

console.log(`Built ${Object.keys(files).length} web files into dist/`);
