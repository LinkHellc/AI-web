// 检查生图接口是否可用：node scripts/check-api.js
// 只调用 /models（不生图、不扣费），确认 Key、地址和模型是否可用
'use strict';
const path = require('node:path');
require('../lib/env').loadEnv(path.join(__dirname, '..'));
const key = (process.env.OPENAI_API_KEY || '').trim();
const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxy && !process.env.NODE_USE_ENV_PROXY) {
  const r = require('node:child_process').spawnSync(process.execPath, process.argv.slice(1), { env: { ...process.env, NODE_USE_ENV_PROXY: '1' }, stdio: 'inherit' });
  process.exit(r.status ?? 0);
}
(async () => {
  if (!key) { console.log('✗ 未配置 OPENAI_API_KEY（.env）'); process.exit(1); }
  console.log(`接口：${base}\n模型：${model}\nKey：${key.slice(0, 5)}…${key.slice(-4)}`);
  try {
    const r = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    if (!r.ok) { console.log(`✗ HTTP ${r.status}：${text.slice(0, 300)}`); process.exit(1); }
    let ids = [];
    try { ids = (JSON.parse(text).data || []).map((m) => m.id); } catch {}
    console.log(`✓ 接口连通，Key 有效（共 ${ids.length} 个模型）`);
    const imgs = ids.filter((id) => /image|dall/i.test(id));
    if (imgs.length) console.log('  可用图片模型：' + imgs.join(', '));
    if (ids.length && !ids.includes(model)) console.log(`⚠ 列表里没有 ${model}，如果生图报错，请把 .env 的 OPENAI_IMAGE_MODEL 改成上面列出的某个图片模型`);
    else console.log(`✓ ${model} 可用`);
  } catch (e) {
    const c = e.cause || {};
    console.log('✗ 连接失败：' + e.message + ' ' + [c.code, c.message].filter(Boolean).join(' ') + '\n  检查 OPENAI_BASE_URL 是否正确（一般以 /v1 结尾），或网络/代理设置');
    process.exit(1);
  }
})();
