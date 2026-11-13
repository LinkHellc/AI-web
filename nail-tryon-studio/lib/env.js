// 读取 .env，且 .env 里的非空值优先于系统环境变量（避免系统里残留的 OPENAI_* 变量干扰）
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

// Node 22 以下没有 util.parseEnv，做一个最小化兜底，保证线上沙箱也能启动
function parseSimple(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 1) continue;
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[s.slice(0, i).trim()] = v;
  }
  return out;
}

function loadEnv(rootDir) {
  const file = process.env.ENV_FILE || path.join(rootDir, '.env');
  if (file === 'none') return;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  const clean = text.replace(/^\uFEFF/, '');
  const parsed = typeof util.parseEnv === 'function' ? util.parseEnv(clean) : parseSimple(clean);
  for (const [k, v] of Object.entries(parsed)) {
    // 部署平台用环境变量注入 PORT / HOST，必须优先，否则会监听错端口或只绑定回环地址
    if ((k === 'PORT' || k === 'HOST') && process.env[k]) continue;
    const value = String(v).trim();
    if (value !== '') process.env[k] = value;
  }
}
module.exports = { loadEnv };
