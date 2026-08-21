const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = __dirname;
const payload = path.join(root, 'payload');
const headFiles = Array.from({ length: 8 }, (_, i) => `head-${String(i).padStart(2, '0')}.bin`);
const tailFiles = Array.from({ length: 4 }, (_, i) => `tail-${String(i).padStart(2, '0')}.b64`);

const head = Buffer.concat(headFiles.map((name) => fs.readFileSync(path.join(payload, name))));
const tailB64 = tailFiles.map((name) => fs.readFileSync(path.join(payload, name), 'utf8')).join('');
const compressed = Buffer.concat([head, Buffer.from(tailB64, 'base64')]);

if (compressed.length !== 119477) {
  throw new Error(`Source payload length mismatch: ${compressed.length}`);
}

const files = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const [relative, content] of Object.entries(files)) {
  const target = path.join(out, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

console.log(`Life in Game: restored ${Object.keys(files).length} original source files.`);
