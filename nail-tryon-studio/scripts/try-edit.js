// 真实调用一次图片编辑接口（会产生一次低画质生图费用）：node scripts/try-edit.js [手照路径] [款式图路径]
// 不传路径时用两张纯色测试图。输出耗时、HTTP 状态、错误码，结果存到 data/test-edit.png
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
require('../lib/env').loadEnv(path.join(__dirname, '..'));
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxy && !process.env.NODE_USE_ENV_PROXY) {
  const r = require('node:child_process').spawnSync(process.execPath, process.argv.slice(1), { env: { ...process.env, NODE_USE_ENV_PROXY: '1' }, stdio: 'inherit' });
  process.exit(r.status ?? 0);
}
const key = (process.env.OPENAI_API_KEY || '').trim();
const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const field = process.env.OPENAI_IMAGE_FIELD || 'image[]';

function solidPng(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [r, g, b][i % 3])]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function load(p, fallback) {
  if (!p) return { buf: fallback, type: 'image/png', name: 'x.png' };
  const ext = path.extname(p).toLowerCase();
  return { buf: fs.readFileSync(p), type: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg', name: path.basename(p) };
}
(async () => {
  const imgs = [load(process.argv[2], solidPng(512, 512, [236, 205, 190])), load(process.argv[3], solidPng(512, 512, [140, 20, 40]))];
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', 'Image 1 is a hand photo, image 2 is a nail design. Apply the nail design from image 2 to the nails in image 1. Keep everything else unchanged.');
  for (const im of imgs) form.append(field, new Blob([im.buf], { type: im.type }), im.name);
  form.append('quality', 'low');
  form.append('size', '1024x1024');
  console.log(`POST ${base}/images/edits  model=${model} field=${field}`);
  const t0 = Date.now();
  try {
    const r = await fetch(`${base}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(300000) });
    const text = await r.text();
    console.log(`HTTP ${r.status}  耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    let j; try { j = JSON.parse(text); } catch { console.log('非 JSON 响应：', text.slice(0, 500)); return; }
    if (!r.ok) { console.log('错误：', JSON.stringify(j.error || j).slice(0, 500)); return; }
    const d = (j.data || [])[0] || {};
    console.log('返回字段：', Object.keys(d).join(', '), d.url ? `url host=${new URL(d.url).host}` : '');
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
    const out = path.join(__dirname, '..', 'data', 'test-edit.png');
    if (d.b64_json) fs.writeFileSync(out, Buffer.from(d.b64_json, 'base64'));
    else if (d.url) fs.writeFileSync(out, Buffer.from(await (await fetch(d.url)).arrayBuffer()));
    console.log('✓ 成功，已保存', out);
  } catch (e) {
    const c = e.cause || {};
    console.log(`✗ 在 ${((Date.now() - t0) / 1000).toFixed(1)}s 后失败：${e.name} ${e.message} | cause: ${c.code || ''} ${c.message || ''}`);
  }
})();
