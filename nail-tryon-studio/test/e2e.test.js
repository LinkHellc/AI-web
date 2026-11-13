// 端到端测试：启动一个假的 OpenAI 接口，验证请求格式、落盘、历史和删除
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

// 1x1 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_URL = `data:image/png;base64,${PNG_B64}${'A'.repeat(0)}`;
// 让图片超过 100 字节的最小校验
const BIG_PNG = Buffer.concat([Buffer.from(PNG_B64, 'base64'), Buffer.alloc(200)]);
const HAND = `data:image/png;base64,${BIG_PNG.toString('base64')}`;
const DESIGN = `data:image/jpeg;base64,${Buffer.alloc(300, 7).toString('base64')}`;

let fake, app, appUrl, lastReq, nextStatus = 200, dataDir, rejectBracket = false;

function startApp(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, HTTPS_PROXY: '', HTTP_PROXY: '', https_proxy: '', http_proxy: '', ENV_FILE: 'none', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('已启动')) resolve(child);
    });
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (c) => reject(new Error('app exited ' + c + '\n' + out)));
  });
}

before(async () => {
  fake = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      lastReq = { url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('latin1') };
      if (rejectBracket && /name="image\[\]"/.test(lastReq.body)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'image is required' } }));
        return;
      }
      if (nextStatus !== 200) {
        res.writeHead(nextStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ created: 1, data: [{ b64_json: PNG_B64 }], usage: { total_tokens: 42 } }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nail-'));
  const port = 3900 + Math.floor(Math.random() * 90);
  app = await startApp({
    OPENAI_API_KEY: 'sk-test',
    OPENAI_BASE_URL: `http://127.0.0.1:${fake.address().port}/v1`,
    OPENAI_IMAGE_MODEL: 'gpt-image-2',
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    MOCK_MODE: '0',
    ACCESS_CODE: '',
  });
  appUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  app && app.kill();
  fake && fake.close();
});

async function post(body) {
  const r = await fetch(`${appUrl}/api/tryon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

test('config 返回模型与选项', async () => {
  const c = await (await fetch(`${appUrl}/api/config`)).json();
  assert.equal(c.model, 'gpt-image-2');
  assert.equal(c.mock, false);
  assert.ok(c.presets.length >= 10);
  assert.ok(!('prompt' in c.presets[0]), '不应把内部提示词暴露给前端');
});

test('手照 + 款式图：以 multipart 发送两张图到 /images/edits', async () => {
  const { status, json } = await post({ handImage: HAND, designImage: DESIGN, shape: 'almond', quality: 'high', size: 'portrait' });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(lastReq.url, '/v1/images/edits');
  assert.equal(lastReq.headers.authorization, 'Bearer sk-test');
  assert.match(lastReq.headers['content-type'], /multipart\/form-data/);
  assert.equal((lastReq.body.match(/name="image\[\]"/g) || []).length, 2);
  assert.match(lastReq.body, /name="model"\r\n\r\ngpt-image-2/);
  assert.match(lastReq.body, /name="quality"\r\n\r\nhigh/);
  assert.match(lastReq.body, /name="output_format"\r\n\r\njpeg/);
  assert.match(lastReq.body, /name="size"\r\n\r\n1024x1536/);
  assert.match(lastReq.body, /Nail shape: almond/);
  assert.match(lastReq.body, /Image 2 is a nail art design reference/);
  assert.ok(!/input_fidelity/.test(lastReq.body), 'gpt-image-2 不支持 input_fidelity');
  // 落盘
  assert.ok(fs.existsSync(path.join(dataDir, json.files.output)));
  assert.ok(fs.existsSync(path.join(dataDir, json.files.design)));
  const img = await fetch(appUrl + json.urls.output);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
});

test('款式库：只发一张手照，提示词带款式描述', async () => {
  const { status } = await post({ handImage: HAND, presetId: 'milky-french' });
  assert.equal(status, 200);
  assert.equal((lastReq.body.match(/name="image\[\]"/g) || []).length, 1);
  assert.match(lastReq.body, /milky French manicure/);
});

test('参数校验', async () => {
  assert.equal((await post({ designImage: DESIGN, presetId: 'milky-french' })).status, 400);
  assert.equal((await post({ handImage: HAND })).status, 400);
  assert.equal((await post({ handImage: 'data:image/gif;base64,AAAA', presetId: 'milky-french' })).status, 400);
});

test('上游 401 转成中文提示', async () => {
  nextStatus = 401;
  const { status, json } = await post({ handImage: HAND, presetId: 'milky-jelly' });
  nextStatus = 200;
  assert.equal(status, 400);
  assert.match(json.error, /API Key/);
});

test('中转只认 image 字段时自动切换重试', async () => {
  rejectBracket = true;
  const { status, json } = await post({ handImage: HAND, designImage: DESIGN });
  rejectBracket = false;
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal((lastReq.body.match(/name="image"/g) || []).length, 2);
});

test('历史与删除', async () => {
  const list = await (await fetch(`${appUrl}/api/history`)).json();
  assert.equal(list.length, 3);
  const target = list[0];
  const del = await fetch(`${appUrl}/api/history/${target.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.ok(!fs.existsSync(path.join(dataDir, target.files.output)));
  const list2 = await (await fetch(`${appUrl}/api/history`)).json();
  assert.equal(list2.length, 2);
});

test('我的款式库：导入、用于试甲、改名、删除', async () => {
  const add = await fetch(`${appUrl}/api/library`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ image: DESIGN, name: '红色猫眼', tags: '秋冬,猫眼' }, { image: HAND, name: '' }] }),
  });
  assert.equal(add.status, 200);
  const items = await add.json();
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].tags, ['秋冬', '猫眼']);
  assert.equal(items[1].name, '未命名款式');
  assert.equal((await fetch(appUrl + items[0].url)).status, 200);

  const { status, json } = await post({ handImage: HAND, libraryId: items[0].id });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal((lastReq.body.match(/name="image(\[\])?"/g) || []).length, 2);
  assert.equal(json.options.libraryName, '红色猫眼');
  assert.ok(json.files.design);

  const ren = await fetch(`${appUrl}/api/library/${items[1].id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '珍珠款' }) });
  assert.equal((await ren.json()).name, '珍珠款');
  assert.equal((await fetch(`${appUrl}/api/library/${items[1].id}`, { method: 'DELETE' })).status, 200);
  const list = await (await fetch(`${appUrl}/api/library`)).json();
  assert.equal(list.length, 1);
});

test('链接导入：拒绝内网地址和非图片', async () => {
  const r1 = await fetch(`${appUrl}/api/library/import-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'http://127.0.0.1:1/x.png' }) });
  assert.equal(r1.status, 400);
  const r2 = await fetch(`${appUrl}/api/library/import-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'file:///etc/passwd' }) });
  assert.equal(r2.status, 400);
});

test('推荐款：config 带分类与预览样式', async () => {
  const c = await (await fetch(`${appUrl}/api/config`)).json();
  assert.ok(c.presets.length >= 20);
  assert.ok(c.presets.every((p) => p.tag && p.css));
});

test('静态文件不允许越权读取', async () => {
  const r = await fetch(`${appUrl}/files/..%2f..%2fserver.js`);
  assert.ok([403, 404].includes(r.status));
  const r2 = await fetch(`${appUrl}/..%2fserver.js`);
  assert.ok([403, 404].includes(r2.status));
  const home = await fetch(`${appUrl}/`);
  assert.equal(home.status, 200);
});
