// 模拟模式下的接口全流程测试：npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
process.env.ENV_FILE = 'none';
for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) delete process.env[k];
process.env.MOCK_MODE = '1';
process.env.MOCK_DELAY_MS = '10';
process.env.DATA_DIR = dataDir;
const { server } = require('../server');
const { buildPrompt, buildAnglePrompt, describeCamera, MODES, ACTIONS, STYLES, SUBJECTS } = require('../lib/presets');

// 1x1 JPEG
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=' + 'A'.repeat(200);

let base;
test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const call = async (p, method = 'GET', body) => {
  const r = await fetch(base + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json() };
};

// 生成改为异步任务：提交后轮询，把结果映射回旧的同步返回格式
const gen = async (body) => {
  const sub = await call('/api/generate', 'POST', body);
  if (sub.status !== 202) return sub;
  for (let i = 0; i < 400; i++) {
    const t = await call('/api/task/' + sub.json.taskId);
    if (t.json.status === 'done') return { status: 200, json: t.json.result };
    if (t.json.status === 'error') return { status: t.json.error.status || 500, json: { error: t.json.error.message } };
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('测试任务超时');
};

test('config 返回模式、动作、风格', async () => {
  const { status, json } = await call('/api/config');
  assert.equal(status, 200);
  assert.equal(json.mock, true);
  assert.equal(json.modes.length, 5);
  assert.ok(json.actions.length >= 40);
  assert.ok(json.styles.length >= 10);
});

test('没有模特时不能生成', async () => {
  const { status, json } = await gen({ mode: 'third' });
  assert.equal(status, 400);
  assert.match(json.error, /模特/);
});

test('新建模特 → 批量生成 → 画廊 → 仿图 → 再来一张 → 删除', async () => {
  const p = await call('/api/persons', 'POST', { name: '小雨', images: [JPG, JPG] });
  assert.equal(p.status, 200);
  assert.equal(p.json.photos.length, 2);

  const ids = [];
  for (const actionId of ['stand-back', 'sit-chin']) {
    const g = await gen({ personId: p.json.id, garments: [JPG], mode: 'mirror', actionId, styleId: 'film', locks: ['face', 'body'], quality: 'fast', ratio: '2:3', resolution: '2K', batchId: 'b1', camera: { auto: false, azimuth: 40, elevation: 20, distance: 1.8 } });
    assert.equal(g.status, 200, JSON.stringify(g.json));
    assert.equal(g.json.options.size, '1344x2016');
    assert.equal(g.json.urls.garments.length, 1);
    ids.push(g.json.id);
  }
  const img = await fetch(base + `/files/outputs/${ids[0]}.jpg`);
  assert.equal(img.status, 200);

  const noRef = await gen({ personId: p.json.id, mode: 'copy' });
  assert.equal(noRef.status, 400);
  const copy = await gen({ personId: p.json.id, mode: 'copy', refHistoryId: ids[0] });
  assert.equal(copy.status, 200);
  assert.ok(copy.json.urls.ref);

  const again = await gen({ personId: p.json.id, mode: 'copy', regenOf: copy.json.id, variant: 2 });
  assert.equal(again.status, 200);
  assert.ok(again.json.urls.ref, '再来一张应沿用参考图');

  const hist = await call('/api/history');
  assert.equal(hist.json.length, 4);
  const persons = await call('/api/persons');
  assert.equal(persons.json[0].uses, 4);

  assert.equal((await call(`/api/history/${ids[1]}`, 'DELETE')).status, 200);
  assert.equal((await call('/api/history')).json.length, 3);
  assert.equal((await call(`/api/persons/${p.json.id}`, 'PATCH', { name: '小雨2' })).json.name, '小雨2');
  assert.equal((await call(`/api/persons/${p.json.id}`, 'DELETE')).status, 200);
});

test('3D 镜头：源图换机位', async () => {
  const bad = await gen({ mode: 'angle' });
  assert.equal(bad.status, 400);
  const r = await gen({ mode: 'angle', sourceImage: JPG, camera: { azimuth: 90, elevation: 30, distance: 1 }, subject: 'jewelry', quality: 'fast' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.options.mode, 'angle');
  assert.equal(r.json.options.subjectName, '首饰包袋');
  const again = await gen({ mode: 'angle', sourceHistoryId: r.json.id });
  assert.equal(again.status, 200);
});

test('页面都能打开', async () => {
  for (const p of ['/', '/studio.html', '/camera.html', '/showcase.html', '/method.html', '/usage.html', '/tokens.css', '/theme.js', '/common.js']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
  }
});

test('模特性别：保存、改名保留、提示词用 man', async () => {
  const p = await call('/api/persons', 'POST', { name: '阿杰', gender: 'male', images: [JPG] });
  assert.equal(p.json.gender, 'male');
  const bad = await call('/api/persons', 'POST', { name: 'x', gender: 'robot', images: [JPG] });
  assert.equal(bad.json.gender, '');
  const g = await gen({ personId: p.json.id, mode: 'third', actionId: 'gent-watch', styleId: 'oldmoney' });
  assert.equal(g.status, 200);
  assert.equal(g.json.options.actionName, '看腕表');
  assert.match(buildPrompt({ mode: MODES[2], action: null, style: STYLES[0], locks: [], camera: null, idCount: 1, garmentCount: 0, hasRef: false, extra: '', variant: 1, gender: 'male' }), /same man shown in Image 1/);
});

test('路径穿越被拦截', async () => {
  const r = await fetch(base + '/files/..%2F..%2Fetc%2Fpasswd');
  assert.ok([403, 404].includes(r.status));
});

test('提示词：图片编号、镜头、锁定规则', () => {
  const mode = MODES.find((m) => m.id === 'mirror');
  const action = ACTIONS.find((a) => a.id === 'stand-back');
  const style = STYLES.find((s) => s.id === 'film');
  const pr = buildPrompt({ mode, action, style, locks: ['face', 'outfit', 'env'], camera: { auto: false, azimuth: 0, elevation: 0, distance: 5 }, idCount: 2, garmentCount: 2, hasRef: false, extra: '', variant: 1 });
  assert.match(pr, /Images 1–2 \(identity/);
  assert.match(pr, /clothing shown in Images 3–4/);
  assert.match(pr, /looking back over the shoulder/);
  assert.match(pr, /Keep the face exactly/);
  assert.doesNotMatch(pr, /same clothing as worn/); // 上传了服装就不锁原服装
  assert.doesNotMatch(pr, /same environment/); // 选了风格就不锁环境
  assert.match(pr, /full-body shot, at eye level, from the front/);
  assert.equal(describeCamera({ auto: true }), '');
  const ap = buildAnglePrompt({ camera: { azimuth: 180, elevation: 0, distance: 4 }, subject: SUBJECTS[0], extra: '' });
  assert.match(ap, /same moment from a new camera position/);
  assert.match(ap, /from directly behind/);
  assert.match(describeCamera({ auto: false, azimuth: -90, elevation: 70, distance: 1 }), /close-up.*bird.*left side in profile/);
});
