// AI 写真工作台 · 后端服务
// 零依赖：只用 Node.js 22+ 内置模块（http / fs / crypto / fetch / FormData）
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// ---------- 配置 ----------
const ENV_FILES = require('./lib/env').loadEnv(__dirname);

// 配置了代理时，让 Node 内置 fetch 走代理（需要 Node 22.21+ / 24.5+ 支持 NODE_USE_ENV_PROXY）
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (PROXY && !process.env.NODE_USE_ENV_PROXY) {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, process.argv.slice(1), { env: { ...process.env, NODE_USE_ENV_PROXY: '1' }, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
  return;
}

const { MODES, ACTIONS, STYLES, LOCKS, QUALITIES, RATIOS, RESOLUTIONS, SUBJECTS, buildPrompt, buildAnglePrompt } = require('./lib/presets');

// 发布平台注入 PORT 作为唯一对外端口，并要求绑定 0.0.0.0；本地仍沿用 STUDIO_PORT / STUDIO_HOST
const DEPLOYED = !!process.env.PORT;
const CONFIG = {
  port: Number(process.env.PORT || process.env.STUDIO_PORT || 3001),
  host: process.env.STUDIO_HOST || process.env.HOST || (DEPLOYED ? '0.0.0.0' : '127.0.0.1'),
  apiKey: (process.env.OPENAI_API_KEY || '').trim(),
  baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
  timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 240000),
  maxConcurrent: Number(process.env.MAX_CONCURRENT || 3),
  dataDir: path.resolve(__dirname, process.env.DATA_DIR || 'data'),
  accessCode: (process.env.ACCESS_CODE || '').trim(),
};
CONFIG.mock = process.env.MOCK_MODE === '1' || !CONFIG.apiKey;

const PUBLIC_DIR = path.join(__dirname, 'public');
const INPUT_DIR = path.join(CONFIG.dataDir, 'inputs');
const OUTPUT_DIR = path.join(CONFIG.dataDir, 'outputs');
const PERSON_DIR = path.join(CONFIG.dataDir, 'persons');
const HISTORY_FILE = path.join(CONFIG.dataDir, 'history.json');
const PERSONS_FILE = path.join(CONFIG.dataDir, 'persons.json');
const MAX_BODY = 40 * 1024 * 1024; // 模特照 + 3 件服装 + 参考图
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

for (const d of [INPUT_DIR, OUTPUT_DIR, PERSON_DIR]) fs.mkdirSync(d, { recursive: true });

function loadJsonArray(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
let history = loadJsonArray(HISTORY_FILE);
let persons = loadJsonArray(PERSONS_FILE);

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
const savePersons = () => writeJson(PERSONS_FILE, persons);

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
        reject(new HttpError(413, '图片太多或太大了，请减少服装图或换小一点的照片'));
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
    throw new HttpError(502, `无法连接生图服务：${detail}。${connectHint(c.code)}`);
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
  if (status === 403) return '当前 API Key 没有生图权限，请检查接口账户';
  if (status === 429) return /quota|billing/i.test(msg) ? 'API 额度不足，请检查账户余额' : '请求太频繁，请稍后再试';
  if (code === 'moderation_blocked' || /safety|moderation/i.test(msg)) return '图片或描述触发了内容安全限制，请换一张照片或调整描述试试';
  if (code === 'invalid_image_file' || /image/i.test(code)) return '图片无法识别，请换一张 JPG / PNG 照片';
  return `生图失败：${msg || '未知错误'}`;
}

// 模拟模式：没有 API Key 时也能跑通流程，返回一张带标记的占位图（SVG 转不了 JPEG，这里直接回传模特原图）
async function mockImageEdit({ images }) {
  await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DELAY_MS || 1200)));
  return { buf: images[0].buf, mime: images[0].mime, usage: null };
}

// 相同内容的输入图只存一份（批量出图时服装图会重复上传）
async function storeInput({ mime, buf }) {
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const rel = `inputs/${hash}${IMAGE_EXT[mime]}`;
  const abs = path.join(CONFIG.dataDir, rel);
  if (!fs.existsSync(abs)) await fsp.writeFile(abs, buf);
  return rel;
}

async function readStored(rel) {
  const ext = path.extname(rel).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { mime, buf: await fsp.readFile(path.join(CONFIG.dataDir, rel)) };
}

const newId = (prefix = '') => `${prefix}${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(5).toString('hex')}`;

// ---------- 模特资产 ----------
function personView(p) {
  return { id: p.id, name: p.name, gender: p.gender || '', createdAt: p.createdAt, photos: p.photos.map((f) => `/files/${f}`), uses: history.filter((h) => h.personId === p.id).length };
}

async function handlePersonAdd(req, res) {
  checkAccess(req);
  const body = await readJson(req);
  const imgs = (Array.isArray(body.images) ? body.images : []).slice(0, 4).map((d, i) => parseDataUrl(d, `第 ${i + 1} 张模特照`));
  if (!imgs.length) throw new HttpError(400, '请至少上传一张人物照片');
  const id = newId('p-');
  const photos = [];
  for (let i = 0; i < imgs.length; i++) {
    const rel = `persons/${id}-${i + 1}${IMAGE_EXT[imgs[i].mime]}`;
    await fsp.writeFile(path.join(CONFIG.dataDir, rel), imgs[i].buf);
    photos.push(rel);
  }
  const p = { id, name: String(body.name || '').trim().slice(0, 20) || `模特 ${persons.length + 1}`, gender: ['female', 'male'].includes(body.gender) ? body.gender : '', photos, createdAt: new Date().toISOString() };
  persons.unshift(p);
  await savePersons();
  sendJson(res, 200, personView(p));
}

async function handlePersonDelete(req, res, id) {
  checkAccess(req);
  const idx = persons.findIndex((p) => p.id === id);
  if (idx === -1) throw new HttpError(404, '模特不存在');
  const [p] = persons.splice(idx, 1);
  await savePersons();
  // 历史记录里引用的照片仍保留（records 里存的是 inputs/ 下的副本）
  for (const f of p.photos) await fsp.rm(path.join(CONFIG.dataDir, f), { force: true });
  sendJson(res, 200, { ok: true });
}

async function handlePersonRename(req, res, id) {
  checkAccess(req);
  const p = persons.find((x) => x.id === id);
  if (!p) throw new HttpError(404, '模特不存在');
  const body = await readJson(req);
  if (body.name !== undefined) p.name = String(body.name).trim().slice(0, 20) || p.name;
  if (body.gender !== undefined) p.gender = ['female', 'male'].includes(body.gender) ? body.gender : '';
  await savePersons();
  sendJson(res, 200, personView(p));
}

// ---------- 生成 ----------
// 发布平台反向代理有 60 秒超时，而中转生图常需 55～150 秒。
// 因此 POST /api/generate 只登记任务并立即返回，前端用短轮询 /api/task/:id 取结果，
// 任何一次 HTTP 请求都不会长时间挂起，也就不会被网关判定为超时。
const TASKS = new Map();
const TASK_TTL_MS = 30 * 60 * 1000;

function startTask(body) {
  const id = crypto.randomBytes(8).toString('hex');
  const task = { id, status: 'running', startedAt: Date.now(), result: null, error: null };
  TASKS.set(id, task);
  for (const [k, v] of TASKS) if (k !== id && Date.now() - v.startedAt > TASK_TTL_MS) TASKS.delete(k);
  doGenerate(body).then((rec) => {
    task.status = 'done';
    task.result = rec;
  }).catch((e) => {
    task.status = 'error';
    task.error = { message: e.status ? e.message : '服务器内部错误', status: e.status || 500 };
    if (!e.status) console.error('[task] 生成异常', e);
  });
  return id;
}

async function doGenerate(body) {
  if (body.mode === 'angle') return doAngle(body);
  const person = persons.find((p) => p.id === body.personId);
  if (!person) throw new HttpError(400, '请先选择或新建一个模特');
  const mode = pick(MODES, body.mode, 'third');
  const action = body.actionId ? ACTIONS.find((a) => a.id === body.actionId) || null : null;
  const style = pick(STYLES, body.styleId, 'keep');
  const quality = pick(QUALITIES, body.quality, 'fast');
  const ratio = pick(RATIOS, body.ratio, '2:3');
  const resolution = RESOLUTIONS.includes(body.resolution) ? body.resolution : '1K';
  const locks = (Array.isArray(body.locks) ? body.locks : []).filter((l) => LOCKS.some((x) => x.id === l));
  const extra = String(body.extra || '').slice(0, 300).trim();
  const variant = Math.max(1, Math.min(8, Number(body.variant) || 1));
  const camera = body.camera && typeof body.camera === 'object' ? body.camera : null;

  const idImgs = [];
  for (const f of person.photos.slice(0, 3)) idImgs.push(await readStored(f));
  const garments = (Array.isArray(body.garments) ? body.garments : []).slice(0, 3).map((d, i) => parseDataUrl(d, `第 ${i + 1} 件服装图`));
  let ref = null;
  if (body.refImage) ref = parseDataUrl(body.refImage, '参考图');
  else if (body.refHistoryId) {
    const h = history.find((x) => x.id === body.refHistoryId);
    if (h) ref = await readStored(h.files.output);
  }
  // 「相同设置再来一张」：沿用原记录的服装图和参考图
  const src = body.regenOf ? history.find((x) => x.id === body.regenOf) : null;
  if (src) {
    if (!garments.length) for (const f of src.files.garments) garments.push(await readStored(f));
    if (!ref && src.files.ref) ref = await readStored(src.files.ref);
  }
  if (mode.needsRef && !ref) throw new HttpError(400, '「AI 仿图」需要先上传一张参考图');

  const prompt = buildPrompt({ mode, action, style, locks, camera, idCount: idImgs.length, garmentCount: garments.length, hasRef: !!ref, extra, variant, gender: person.gender || '' });
  const images = [...idImgs, ...garments, ...(ref ? [ref] : [])];
  let size = ratio.sizes[resolution];

  if (inFlight >= CONFIG.maxConcurrent) throw new HttpError(429, '同时生成的任务有点多，稍等几秒会自动重试');
  inFlight++;
  const started = Date.now();
  let result;
  let sizeFallback = false;
  try {
    if (CONFIG.mock) result = await mockImageEdit({ images });
    else {
      try {
        result = await callImageEdit({ images, prompt, quality: quality.api, size });
      } catch (e) {
        if (resolution !== '1K' && e.status === 400 && /size/i.test(e.message)) {
          console.warn(`[openai] 中转不支持 ${size}，降为 1K 重试`);
          size = ratio.sizes['1K'];
          sizeFallback = true;
          result = await callImageEdit({ images, prompt, quality: quality.api, size });
        } else throw e;
      }
    }
  } finally {
    inFlight--;
  }

  const id = newId();
  const files = {
    identity: [],
    garments: [],
    ref: ref ? await storeInput(ref) : null,
    output: `outputs/${id}${IMAGE_EXT[result.mime] || '.png'}`,
  };
  for (const im of idImgs) files.identity.push(await storeInput(im));
  for (const g of garments) files.garments.push(await storeInput(g));
  await fsp.writeFile(path.join(CONFIG.dataDir, files.output), result.buf);

  const record = {
    id,
    batchId: String(body.batchId || '').slice(0, 40) || null,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    mock: CONFIG.mock,
    engine: CONFIG.mock ? 'mock' : 'live',
    personId: person.id,
    personName: person.name,
    options: {
      mode: mode.id, modeName: mode.name,
      actionId: action ? action.id : null, actionName: action ? action.name : null,
      styleId: style.id, styleName: style.name,
      locks, camera, quality: quality.id, ratio: ratio.id, resolution, size, sizeFallback, extra, variant,
    },
    usage: result.usage,
    files,
  };
  history.unshift(record);
  await saveHistory();
  return withUrls(record);
}

// 3D 镜头：一张源图换机位
async function doAngle(body) {
  let src = null;
  if (body.sourceImage) src = parseDataUrl(body.sourceImage, '源图');
  else if (body.sourceHistoryId) {
    const h = history.find((x) => x.id === body.sourceHistoryId);
    if (h) src = await readStored(h.files.output);
  }
  if (!src) throw new HttpError(400, '请先上传一张要换角度的照片');
  const subject = body.subject ? SUBJECTS.find((x) => x.id === body.subject) || null : null;
  const quality = pick(QUALITIES, body.quality, 'fast');
  const ratio = pick(RATIOS, body.ratio, '2:3');
  const resolution = RESOLUTIONS.includes(body.resolution) ? body.resolution : '1K';
  const extra = String(body.extra || '').slice(0, 300).trim();
  const camera = { azimuth: 0, elevation: 10, distance: 3, ...(body.camera && typeof body.camera === 'object' ? body.camera : {}), auto: false };
  const prompt = buildAnglePrompt({ camera, subject, extra });
  let size = ratio.sizes[resolution];

  if (inFlight >= CONFIG.maxConcurrent) throw new HttpError(429, '同时生成的任务有点多，稍等几秒会自动重试');
  inFlight++;
  const started = Date.now();
  let result;
  let sizeFallback = false;
  try {
    if (CONFIG.mock) result = await mockImageEdit({ images: [src] });
    else {
      try {
        result = await callImageEdit({ images: [src], prompt, quality: quality.api, size });
      } catch (e) {
        if (resolution !== '1K' && e.status === 400 && /size/i.test(e.message)) {
          size = ratio.sizes['1K'];
          sizeFallback = true;
          result = await callImageEdit({ images: [src], prompt, quality: quality.api, size });
        } else throw e;
      }
    }
  } finally {
    inFlight--;
  }
  const id = newId();
  const files = { identity: [], garments: [], ref: await storeInput(src), output: `outputs/${id}${IMAGE_EXT[result.mime] || '.png'}` };
  await fsp.writeFile(path.join(CONFIG.dataDir, files.output), result.buf);
  const record = {
    id, batchId: null, createdAt: new Date().toISOString(), durationMs: Date.now() - started,
    mock: CONFIG.mock, engine: CONFIG.mock ? 'mock' : 'live', personId: null, personName: null,
    options: {
      mode: 'angle', modeName: '3D 镜头', actionId: null, actionName: null, styleId: 'keep', styleName: '保持原图',
      subject: subject ? subject.id : null, subjectName: subject ? subject.name : null,
      locks: [], camera, quality: quality.id, ratio: ratio.id, resolution, size, sizeFallback, extra, variant: 1,
    },
    usage: result.usage, files,
  };
  history.unshift(record);
  await saveHistory();
  return withUrls(record);
}

function withUrls(r) {
  const f = (x) => (x ? `/files/${x}` : null);
  return {
    ...r,
    prompt: undefined,
    model: undefined, // 不向网页暴露调用的模型
    urls: { output: f(r.files.output), ref: f(r.files.ref), identity: r.files.identity.map(f), garments: r.files.garments.map(f) },
  };
}

async function handleDelete(req, res, id) {
  checkAccess(req);
  const idx = history.findIndex((h) => h.id === id);
  if (idx === -1) throw new HttpError(404, '记录不存在');
  const [rec] = history.splice(idx, 1);
  await saveHistory();
  await fsp.rm(path.join(CONFIG.dataDir, rec.files.output), { force: true });
  // inputs/ 是按内容去重共享的，不随单条记录删除
  sendJson(res, 200, { ok: true });
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
        mock: CONFIG.mock,
        needAccessCode: !!CONFIG.accessCode,
        modes: MODES.map(({ id, name, icon, desc, needsRef }) => ({ id, name, icon, desc, needsRef: !!needsRef })),
        actions: ACTIONS.map(({ id, cat, name }) => ({ id, cat, name })),
        styles: STYLES.map(({ id, name, swatch }) => ({ id, name, swatch })),
        locks: LOCKS.map(({ id, name }) => ({ id, name })),
        qualities: QUALITIES.map(({ id, name, hint }) => ({ id, name, hint })),
        ratios: RATIOS.map(({ id, name }) => ({ id, name })),
        resolutions: RESOLUTIONS,
        subjects: SUBJECTS.map(({ id, name, icon }) => ({ id, name, icon })),
      });
    }
    if (req.method === 'POST' && p === '/api/generate') {
      checkAccess(req);
      const body = await readJson(req);
      return sendJson(res, 202, { taskId: startTask(body) });
    }
    const taskMatch = /^\/api\/task\/([\w-]+)$/.exec(p);
    if (req.method === 'GET' && taskMatch) {
      checkAccess(req);
      const t = TASKS.get(taskMatch[1]);
      if (!t) throw new HttpError(404, '任务不存在或已过期，请重新生成');
      return sendJson(res, 200, { status: t.status, result: t.result, error: t.error, elapsedMs: Date.now() - t.startedAt });
    }
    if (req.method === 'GET' && p === '/api/persons') {
      checkAccess(req);
      return sendJson(res, 200, persons.map(personView));
    }
    if (req.method === 'POST' && p === '/api/persons') return await handlePersonAdd(req, res);
    const pm = /^\/api\/persons\/([\w-]+)$/.exec(p);
    if (req.method === 'DELETE' && pm) return await handlePersonDelete(req, res, pm[1]);
    if (req.method === 'PATCH' && pm) return await handlePersonRename(req, res, pm[1]);
    if (req.method === 'GET' && p === '/api/history') {
      checkAccess(req);
      return sendJson(res, 200, history.slice(0, 300).map(withUrls));
    }
    const del = /^\/api\/history\/([\w-]+)$/.exec(p);
    if (req.method === 'DELETE' && del) return await handleDelete(req, res, del[1]);
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

if (require.main === module || process.env.STUDIO_LISTEN === '1') {
  server.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`\n📸 AI 写真工作台已启动：http://${CONFIG.host === '0.0.0.0' ? 'localhost' : CONFIG.host}:${CONFIG.port}`);
    console.log(`   生图模型：${CONFIG.model}  接口：${CONFIG.baseUrl}${PROXY ? `  代理：${PROXY}` : ''}`);
    console.log(`   配置来源：${ENV_FILES.length ? ENV_FILES.join(' + ') : '（未找到 .env）'}`);
    if (CONFIG.mock) console.log('   ⚠ 模拟模式（未配置 OPENAI_API_KEY 或 MOCK_MODE=1），不会真正生图\n');
  });
}

module.exports = { server, CONFIG };
