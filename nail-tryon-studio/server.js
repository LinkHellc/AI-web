// 美甲试甲工作台 · 后端服务
// 零依赖：只用 Node.js 22+ 内置模块（http / fs / crypto / fetch / FormData）
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------- 配置 ----------
require('./lib/env').loadEnv(__dirname);

// 配置了代理时，让 Node 内置 fetch 走代理（需要 Node 22.21+ / 24.5+ 支持 NODE_USE_ENV_PROXY）
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (PROXY && !process.env.NODE_USE_ENV_PROXY) {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, process.argv.slice(1), { env: { ...process.env, NODE_USE_ENV_PROXY: '1' }, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
  return;
}

const { PRESETS, SHAPES, LENGTHS, FINISHES, QUALITIES, SIZES, buildPrompt } = require('./lib/prompt');

const CONFIG = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  apiKey: (process.env.OPENAI_API_KEY || '').trim(),
  baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
  timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 180000),
  maxConcurrent: Number(process.env.MAX_CONCURRENT || 2),
  dataDir: path.resolve(__dirname, process.env.DATA_DIR || 'data'),
  accessCode: (process.env.ACCESS_CODE || '').trim(),
};
CONFIG.mock = process.env.MOCK_MODE === '1' || !CONFIG.apiKey;

const PUBLIC_DIR = path.join(__dirname, 'public');
const INPUT_DIR = path.join(CONFIG.dataDir, 'inputs');
const OUTPUT_DIR = path.join(CONFIG.dataDir, 'outputs');
const HISTORY_FILE = path.join(CONFIG.dataDir, 'history.json');
const LIBRARY_DIR = path.join(CONFIG.dataDir, 'library');
const LIBRARY_FILE = path.join(CONFIG.dataDir, 'library.json');
const PRESET_IMG_DIR = path.join(PUBLIC_DIR, 'presets');
const MAX_BODY = 25 * 1024 * 1024; // 两张压缩后的图片足够
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

fs.mkdirSync(INPUT_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(LIBRARY_DIR, { recursive: true });

// ---------- 历史记录（JSON 文件，串行写入） ----------
let history = [];
try {
  history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  if (!Array.isArray(history)) history = [];
} catch {
  history = [];
}
let library = [];
try {
  library = JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
  if (!Array.isArray(library)) library = [];
} catch {
  library = [];
}
let writeChain = Promise.resolve();
function writeJson(file, data) {
  const snapshot = JSON.stringify(data, null, 2);
  writeChain = writeChain.then(async () => {
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, snapshot);
    await fsp.rename(tmp, file);
  }).catch((e) => console.error('[data] 写入失败', file, e));
  return writeChain;
}
const saveHistory = () => writeJson(HISTORY_FILE, history);
const saveLibrary = () => writeJson(LIBRARY_FILE, library);

// 推荐款是否有样图（public/presets/<id>.jpg|png|webp）
function presetImage(id) {
  for (const ext of ['.jpg', '.png', '.webp']) {
    if (fs.existsSync(path.join(PRESET_IMG_DIR, id + ext))) return `/presets/${id}${ext}`;
  }
  return null;
}
async function readPresetImage(id) {
  const rel = presetImage(id);
  if (!rel) return null;
  const ext = path.extname(rel);
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { mime, buf: await fsp.readFile(path.join(PUBLIC_DIR, rel)) };
}

// ---------- 工具函数 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, '图片太大了，请换一张小一点的照片'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = (await readBody(req)).toString('utf8');
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, '请求格式错误');
  }
}

function parseDataUrl(dataUrl, label) {
  if (typeof dataUrl !== 'string') throw new HttpError(400, `缺少${label}`);
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, `${label}格式不支持，请使用 JPG / PNG / WebP`);
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, `${label}超过 8MB`);
  if (buf.length < 100) throw new HttpError(400, `${label}内容为空`);
  return { mime: m[1], buf };
}

function pick(list, id, fallback) {
  return list.find((x) => x.id === id) || list.find((x) => x.id === fallback);
}

function checkAccess(req) {
  if (!CONFIG.accessCode) return;
  const code = req.headers['x-access-code'];
  if (code !== CONFIG.accessCode) throw new HttpError(401, '访问口令错误');
}

// ---------- 调用 OpenAI 图片编辑接口 ----------
let inFlight = 0;

// 多图字段名：OpenAI 官方用 image[]；部分中转只认 image。失败时自动换另一种再试一次
let imageField = process.env.OPENAI_IMAGE_FIELD || 'image[]';
// 输出 JPEG：比 PNG 小 5–10 倍，返回更快；中转不支持时自动去掉该参数
let outputFormat = (process.env.OUTPUT_FORMAT || 'jpeg').toLowerCase();

async function callImageEdit(args, retried = false) {
  try {
    return await callImageEditOnce({ ...args, field: imageField });
  } catch (e) {
    if (!retried && e.status === 400 && e.formatProblem && outputFormat) {
      outputFormat = '';
      console.warn('[openai] 中转不支持 output_format，改为默认输出重试');
      return callImageEdit(args, true);
    }
    if (!retried && e.status === 400 && e.fieldProblem) {
      imageField = imageField === 'image[]' ? 'image' : 'image[]';
      console.warn(`[openai] 图片字段被拒，改用 ${imageField} 重试`);
      return callImageEdit(args, true);
    }
    throw e;
  }
}

async function callImageEditOnce({ images, prompt, quality, size, field }) {
  const form = new FormData();
  form.append('model', CONFIG.model);
  form.append('prompt', prompt);
  images.forEach((img, i) => {
    form.append(field, new Blob([img.buf], { type: img.mime }), `image-${i + 1}${IMAGE_EXT[img.mime]}`);
  });
  form.append('quality', quality);
  form.append('size', size);
  form.append('n', '1');
  if (outputFormat) {
    form.append('output_format', outputFormat);
    if (outputFormat !== 'png') form.append('output_compression', '90');
  }
  const outMime = { jpeg: 'image/jpeg', webp: 'image/webp' }[outputFormat] || 'image/png';

  let resp;
  const t0 = Date.now();
  try {
    resp = await fetch(`${CONFIG.baseUrl}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CONFIG.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(CONFIG.timeoutMs),
    });
  } catch (e) {
    console.error(`[openai] 请求在 ${((Date.now() - t0) / 1000).toFixed(1)}s 后失败`);
    if (e.name === 'TimeoutError') throw new HttpError(504, '生图超时了，请稍后重试（可以试试「快速」画质）');
    const c = e.cause || {};
    const detail = [c.code, c.message].filter(Boolean).join(' ') || e.message;
    console.error('[openai] 连接失败', CONFIG.baseUrl, detail);
    throw new HttpError(502, `无法连接生图服务（${CONFIG.baseUrl}）：${detail}。${connectHint(c.code)}`);
  }

  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HttpError(502, `生图服务返回异常（HTTP ${resp.status}）`);
  }
  if (!resp.ok) {
    const err = json.error || {};
    console.error('[openai] 失败', resp.status, err.code || '', err.message || text.slice(0, 500));
    const he = new HttpError(resp.status >= 500 ? 502 : 400, friendlyError(resp.status, err));
    // 形如 "image is required" / "Unknown parameter: image[]" 的报错说明字段名不被接受
    he.formatProblem = resp.status === 400 && /output_format|output_compression/i.test(err.message || '');
    he.fieldProblem = resp.status === 400 && /image(\[\])?['"`]?\s*(is required|required|missing)|unknown parameter.*image|no image/i.test(err.message || '');
    throw he;
  }
  const item = json.data && json.data[0];
  if (!item) throw new HttpError(502, '生图服务没有返回图片');
  console.log(`[openai] 出图完成 ${((Date.now() - t0) / 1000).toFixed(1)}s quality=${quality} size=${size} 图片数=${images.length}`);
  if (item.b64_json) return { buf: Buffer.from(item.b64_json, 'base64'), mime: sniffMime(item.b64_json, outMime), usage: json.usage || null };
  if (item.url) {
    let imgResp;
    try {
      imgResp = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
    } catch (e) {
      const c = e.cause || {};
      console.error('[openai] 下载结果图失败', new URL(item.url).host, c.code || e.message);
      throw new HttpError(502, `图片已生成，但下载结果图失败（${new URL(item.url).host}：${c.code || e.message}）。可能需要在 .env 配置 HTTPS_PROXY`);
    }
    if (!imgResp.ok) throw new HttpError(502, `下载生成图片失败（HTTP ${imgResp.status}）`);
    const buf = Buffer.from(await imgResp.arrayBuffer());
    return { buf, mime: sniffMime(buf.subarray(0, 12).toString('base64'), outMime), usage: json.usage || null };
  }
  throw new HttpError(502, '生图服务返回的数据无法识别');
}

// 按文件头判断真实格式（中转可能忽略 output_format）
function sniffMime(b64head, fallback) {
  const head = Buffer.from(String(b64head).slice(0, 16), 'base64');
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.subarray(0, 4).toString() === 'RIFF') return 'image/webp';
  return fallback;
}

function connectHint(code) {
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '域名解析失败，请检查 OPENAI_BASE_URL 是否拼写正确、网络是否正常';
  if (code === 'ECONNREFUSED' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return '连不上服务器，可能需要代理：在 .env 填写 HTTPS_PROXY 后重启';
  if (code === 'UND_ERR_SOCKET' || code === 'ECONNRESET') return '连接被服务器中断，可能是中转超时或图片过大，请稍后重试或换「快速」画质';
  if (/CERT|SSL|TLS/i.test(code || '')) return '证书校验失败，检查系统时间或代理设置';
  return '请先运行 npm run check 检查接口';
}

function friendlyError(status, err) {
  const code = err.code || err.type || '';
  const msg = err.message || '';
  if (status === 401) return 'API Key 无效或已过期，请检查 .env 里的 OPENAI_API_KEY';
  if (status === 403) return '当前 API Key 没有该模型的权限（可能需要在 OpenAI 后台完成组织验证）';
  if (status === 429) return /quota|billing/i.test(msg) ? 'API 额度不足，请检查账户余额' : '请求太频繁，请稍后再试';
  if (code === 'moderation_blocked' || /safety|moderation/i.test(msg)) return '图片或描述触发了内容安全限制，请换一张照片试试';
  if (code === 'invalid_image_file' || /image/i.test(code)) return '图片无法识别，请换一张 JPG / PNG 照片';
  return `生图失败：${msg || '未知错误'}`;
}

// 模拟模式：没有 API Key 时也能把整个流程跑通，直接返回手部照片
async function mockImageEdit({ images }) {
  await new Promise((r) => setTimeout(r, 1200));
  return { buf: images[0].buf, mime: images[0].mime, usage: null };
}

// ---------- 业务接口 ----------
async function handleTryOn(req, res) {
  checkAccess(req);
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, '请求格式错误');
  }

  const hand = parseDataUrl(body.handImage, '手部照片');
  let design = body.designImage ? parseDataUrl(body.designImage, '款式图') : null;
  const preset = body.presetId ? PRESETS.find((p) => p.id === body.presetId) : null;
  const libItem = body.libraryId ? library.find((l) => l.id === body.libraryId) : null;
  if (!design && libItem) design = { mime: libItem.mime, buf: await fsp.readFile(path.join(CONFIG.dataDir, libItem.file)) };
  if (!design && preset) design = await readPresetImage(preset.id); // 推荐款有样图时一并作为参考
  const extra = String(body.extra || '').slice(0, 300).trim();
  if (!design && !preset && !extra) throw new HttpError(400, '请上传款式图，或从款式库选一个款式');

  const shape = pick(SHAPES, body.shape, 'keep');
  const length = pick(LENGTHS, body.length, 'keep');
  const finish = pick(FINISHES, body.finish, 'auto');
  const quality = pick(QUALITIES, body.quality, 'medium');
  const size = pick(SIZES, body.size, 'auto');

  const prompt = buildPrompt({ hasDesign: !!design, preset, shape, length, finish, extra });

  if (inFlight >= CONFIG.maxConcurrent) throw new HttpError(429, '当前排队的人有点多，请稍等几秒再试');
  inFlight++;
  const started = Date.now();
  let result;
  try {
    const images = design ? [hand, design] : [hand];
    result = CONFIG.mock
      ? await mockImageEdit({ images })
      : await callImageEdit({ images, prompt, quality: quality.api, size: size.api });
  } finally {
    inFlight--;
  }

  const id = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(5).toString('hex')}`;
  const outExt = result.mime ? IMAGE_EXT[result.mime] : '.png';
  const files = {
    hand: `inputs/${id}-hand${IMAGE_EXT[hand.mime]}`,
    design: design ? `inputs/${id}-design${IMAGE_EXT[design.mime]}` : null,
    output: `outputs/${id}${outExt}`,
  };
  await fsp.writeFile(path.join(CONFIG.dataDir, files.hand), hand.buf);
  if (design) await fsp.writeFile(path.join(CONFIG.dataDir, files.design), design.buf);
  await fsp.writeFile(path.join(CONFIG.dataDir, files.output), result.buf);

  const record = {
    id,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    mock: CONFIG.mock,
    model: CONFIG.mock ? 'mock' : CONFIG.model,
    options: {
      presetId: preset ? preset.id : null,
      presetName: preset ? preset.name : null,
      libraryId: libItem ? libItem.id : null,
      libraryName: libItem ? libItem.name : null,
      shape: shape.id,
      length: length.id,
      finish: finish.id,
      quality: quality.id,
      size: size.id,
      extra,
    },
    usage: result.usage,
    files,
  };
  history.unshift(record);
  await saveHistory();
  sendJson(res, 200, withUrls(record));
}

function withUrls(r) {
  return {
    ...r,
    urls: {
      hand: `/files/${r.files.hand}`,
      design: r.files.design ? `/files/${r.files.design}` : null,
      output: `/files/${r.files.output}`,
    },
  };
}

async function handleDelete(req, res, id) {
  checkAccess(req);
  const idx = history.findIndex((h) => h.id === id);
  if (idx === -1) throw new HttpError(404, '记录不存在');
  const [rec] = history.splice(idx, 1);
  await saveHistory();
  for (const f of Object.values(rec.files)) {
    if (f) await fsp.rm(path.join(CONFIG.dataDir, f), { force: true });
  }
  sendJson(res, 200, { ok: true });
}

// ---------- 我的款式库（用户导入的美甲图） ----------
function libView(item) {
  return { id: item.id, name: item.name, tags: item.tags, source: item.source, createdAt: item.createdAt, url: `/files/${item.file}` };
}

async function addLibraryItem({ mime, buf }, name, tags, source) {
  const id = `lib-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const file = `library/${id}${IMAGE_EXT[mime]}`;
  await fsp.writeFile(path.join(CONFIG.dataDir, file), buf);
  const item = {
    id,
    name: String(name || '').trim().slice(0, 40) || '未命名款式',
    tags: (Array.isArray(tags) ? tags : String(tags || '').split(/[,，\s]+/)).map((t) => String(t).trim()).filter(Boolean).slice(0, 8),
    source: source || null,
    mime,
    file,
    createdAt: new Date().toISOString(),
  };
  library.unshift(item);
  await saveLibrary();
  return item;
}

async function handleLibraryAdd(req, res) {
  checkAccess(req);
  const body = await readJson(req);
  const items = Array.isArray(body.items) ? body.items.slice(0, 30) : [body];
  const added = [];
  for (const it of items) {
    const img = parseDataUrl(it.image, '款式图');
    added.push(libView(await addLibraryItem(img, it.name, it.tags, it.source || 'upload')));
  }
  sendJson(res, 200, added);
}

// 只允许公网 http(s) 图片地址，防止访问本机或内网
function assertPublicUrl(u) {
  let url;
  try { url = new URL(u); } catch { throw new HttpError(400, '链接格式不正确'); }
  if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, '只支持 http / https 图片链接');
  const h = url.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) || h === '[::1]' || h.startsWith('[fc') || h.startsWith('[fd')) {
    throw new HttpError(400, '不支持内网地址');
  }
  return url;
}

async function handleLibraryImportUrl(req, res) {
  checkAccess(req);
  const body = await readJson(req);
  const url = assertPublicUrl(String(body.url || '').trim());
  let resp;
  try {
    resp = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*' },
    });
  } catch (e) {
    throw new HttpError(502, `下载失败：${(e.cause && e.cause.code) || e.message}`);
  }
  if (!resp.ok) throw new HttpError(400, `下载失败（HTTP ${resp.status}），请把图片保存到本地后用「导入图片」`);
  const type = (resp.headers.get('content-type') || '').split(';')[0].trim();
  if (!IMAGE_EXT[type]) {
    throw new HttpError(400, type.startsWith('text/html')
      ? '这是网页链接不是图片链接。小红书笔记请长按/右键图片「复制图片地址」，或保存图片后用「导入图片」'
      : `不支持的图片格式（${type || '未知'}），请用 JPG / PNG / WebP`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, '图片超过 8MB');
  const item = await addLibraryItem({ mime: type, buf }, body.name, body.tags, url.href);
  sendJson(res, 200, [libView(item)]);
}

async function handleLibraryDelete(req, res, id) {
  checkAccess(req);
  const idx = library.findIndex((l) => l.id === id);
  if (idx === -1) throw new HttpError(404, '款式不存在');
  const [item] = library.splice(idx, 1);
  await saveLibrary();
  await fsp.rm(path.join(CONFIG.dataDir, item.file), { force: true });
  sendJson(res, 200, { ok: true });
}

async function handleLibraryRename(req, res, id) {
  checkAccess(req);
  const item = library.find((l) => l.id === id);
  if (!item) throw new HttpError(404, '款式不存在');
  const body = await readJson(req);
  if (body.name !== undefined) item.name = String(body.name).trim().slice(0, 40) || item.name;
  await saveLibrary();
  sendJson(res, 200, libView(item));
}

// ---------- 静态文件 ----------
async function serveFile(res, baseDir, relPath, cache) {
  const target = path.resolve(baseDir, '.' + path.posix.normalize('/' + relPath));
  if (!target.startsWith(baseDir + path.sep) && target !== baseDir) throw new HttpError(403, 'Forbidden');
  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    throw new HttpError(404, 'Not found');
  }
  if (!stat.isFile()) throw new HttpError(404, 'Not found');
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cache,
  });
  fs.createReadStream(target).pipe(res);
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'GET' && p === '/api/config') {
      return sendJson(res, 200, {
        model: CONFIG.model,
        mock: CONFIG.mock,
        needAccessCode: !!CONFIG.accessCode,
        presets: PRESETS.map(({ id, name, tag, desc, css }) => ({ id, name, tag, desc, css, image: presetImage(id) })),
        shapes: SHAPES.map(({ id, name }) => ({ id, name })),
        lengths: LENGTHS.map(({ id, name }) => ({ id, name })),
        finishes: FINISHES.map(({ id, name }) => ({ id, name })),
        qualities: QUALITIES.map(({ id, name, hint }) => ({ id, name, hint })),
        sizes: SIZES.map(({ id, name }) => ({ id, name })),
      });
    }
    if (req.method === 'POST' && p === '/api/tryon') return await handleTryOn(req, res);
    if (req.method === 'GET' && p === '/api/history') {
      checkAccess(req);
      return sendJson(res, 200, history.slice(0, 200).map(withUrls));
    }
    const del = /^\/api\/history\/([\w-]+)$/.exec(p);
    if (req.method === 'DELETE' && del) return await handleDelete(req, res, del[1]);
    if (req.method === 'GET' && p === '/api/library') {
      checkAccess(req);
      return sendJson(res, 200, library.map(libView));
    }
    if (req.method === 'POST' && p === '/api/library') return await handleLibraryAdd(req, res);
    if (req.method === 'POST' && p === '/api/library/import-url') return await handleLibraryImportUrl(req, res);
    const lib = /^\/api\/library\/([\w-]+)$/.exec(p);
    if (req.method === 'DELETE' && lib) return await handleLibraryDelete(req, res, lib[1]);
    if (req.method === 'PATCH' && lib) return await handleLibraryRename(req, res, lib[1]);
    if (req.method === 'GET' && p.startsWith('/files/')) {
      return await serveFile(res, CONFIG.dataDir, p.slice('/files/'.length), 'private, max-age=86400');
    }
    if (req.method === 'GET') {
      return await serveFile(res, PUBLIC_DIR, p === '/' ? 'index.html' : p.slice(1), 'no-cache');
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[server]', e);
    if (!res.headersSent) sendJson(res, status, { error: e.status ? e.message : '服务器内部错误' });
    else res.end();
  }
});

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`\n💅 美甲试甲工作台已启动：http://${CONFIG.host === '0.0.0.0' ? 'localhost' : CONFIG.host}:${CONFIG.port}`);
  console.log(`   生图模型：${CONFIG.model}  接口：${CONFIG.baseUrl}${PROXY ? `  代理：${PROXY}` : ''}`);
  if (CONFIG.mock) console.log('   ⚠ 模拟模式（未配置 OPENAI_API_KEY 或 MOCK_MODE=1），不会真正生图\n');
});

module.exports = { server, CONFIG };
