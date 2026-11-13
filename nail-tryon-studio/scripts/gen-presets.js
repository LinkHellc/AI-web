// 为「2026 爆款推荐」生成真实样图（可选，会产生生图费用，约 22 张）
// 用法：node scripts/gen-presets.js            只生成缺失的
//       node scripts/gen-presets.js --force    全部重新生成
//       node scripts/gen-presets.js cateye     只生成指定 id
// 生成后的图保存在 public/presets/<id>.jpg：推荐卡片会显示真实样图，试戴时也会作为款式参考图，效果更稳定
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
require('../lib/env').loadEnv(root);
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxy && !process.env.NODE_USE_ENV_PROXY) {
  const r = require('node:child_process').spawnSync(process.execPath, process.argv.slice(1), { env: { ...process.env, NODE_USE_ENV_PROXY: '1' }, stdio: 'inherit' });
  process.exit(r.status ?? 0);
}
const { PRESETS } = require('../lib/prompt');
const key = (process.env.OPENAI_API_KEY || '').trim();
const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const outDir = path.join(root, 'public', 'presets');
fs.mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

(async () => {
  if (!key) { console.log('✗ 未配置 OPENAI_API_KEY'); process.exit(1); }
  const list = PRESETS.filter((p) => (only.length ? only.includes(p.id) : true))
    .filter((p) => force || !['.jpg', '.png', '.webp'].some((e) => fs.existsSync(path.join(outDir, p.id + e))));
  console.log(`将生成 ${list.length} 张样图（模型 ${model}）`);
  for (const p of list) {
    const prompt = `Professional nail salon product photo: close-up of a woman's hand with natural skin, five fingernails showing ${p.prompt}. Medium almond nails, soft natural daylight, clean light beige background, realistic, high detail, no text, no watermark.`;
    const t0 = Date.now();
    try {
      const r = await fetch(`${base}/images/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, size: '1024x1024', quality: 'medium', output_format: 'jpeg', n: 1 }),
        signal: AbortSignal.timeout(300000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { console.log(`✗ ${p.name}：HTTP ${r.status} ${(j.error && j.error.message) || ''}`); continue; }
      const d = (j.data || [])[0] || {};
      const buf = d.b64_json ? Buffer.from(d.b64_json, 'base64') : d.url ? Buffer.from(await (await fetch(d.url)).arrayBuffer()) : null;
      if (!buf) { console.log(`✗ ${p.name}：没有返回图片`); continue; }
      fs.writeFileSync(path.join(outDir, `${p.id}.jpg`), buf);
      console.log(`✓ ${p.name}（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
    } catch (e) {
      console.log(`✗ ${p.name}：${(e.cause && e.cause.code) || e.message}`);
    }
  }
  console.log('完成。刷新网页即可看到样图。');
})();
