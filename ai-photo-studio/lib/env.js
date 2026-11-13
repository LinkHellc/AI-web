// 读取 .env：先读上级目录（美甲站）的 .env 复用同一套生图中转配置，再读本目录 .env 覆盖。
// .env 里的非空值优先于系统环境变量（避免系统里残留的 OPENAI_* 变量干扰）
// 注意：作为独立站点发布时只会上传本目录，上级 .env 不存在，因此本目录 .env 必须自带生图配置。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

const SHARED_KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_IMAGE_MODEL', 'HTTPS_PROXY', 'OPENAI_IMAGE_FIELD', 'OUTPUT_FORMAT', 'REQUEST_TIMEOUT_MS'];

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

function readEnvFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return typeof util.parseEnv === 'function' ? util.parseEnv(text) : parseSimple(text);
  } catch {
    return null;
  }
}

function loadEnv(rootDir) {
  if (process.env.ENV_FILE === 'none') return [];
  const loaded = [];
  const files = process.env.ENV_FILE
    ? [[process.env.ENV_FILE, null]]
    : [[path.join(rootDir, '..', '.env'), SHARED_KEYS], [path.join(rootDir, '.env'), null]];
  for (const [file, onlyKeys] of files) {
    const parsed = readEnvFile(file);
    if (!parsed) continue;
    loaded.push(file);
    for (const [k, v] of Object.entries(parsed)) {
      if (onlyKeys && !onlyKeys.includes(k)) continue; // 上级 .env 只借用生图相关配置，端口等不跟着走
      // 发布平台注入的 PORT 必须优先，否则服务会监听错端口；HOST 同理
      if ((k === 'PORT' || k === 'STUDIO_PORT') && process.env.PORT) continue;
      if ((k === 'HOST' || k === 'STUDIO_HOST') && (process.env.HOST || process.env.STUDIO_HOST)) continue;
      if (String(v).trim() !== '') process.env[k] = String(v).trim();
    }
  }
  return loaded;
}
module.exports = { loadEnv };
