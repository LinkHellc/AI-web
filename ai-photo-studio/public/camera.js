// 3D 镜头工作台：一张照片换机位重拍
'use strict';
renderChrome('camera');

const C = {
  cfg: null,
  source: null, // { dataUrl } 或 { historyId, url }
  ctrl: 'free',
  cam: { azimuth: 30, elevation: 15, distance: 2.5, ...store.get('cam3d', {}) },
  orbitN: 4,
  presets: new Set(),
  subject: 'person',
  quality: 'fast',
  ratio: '2:3',
  resolution: '1K',
  nodes: [], // { id, kind:'src'|'out', url, rec?, label, state }
  sel: null,
  zoom: 1,
};
const PRESETS = [
  ['正面', 0, 5, 3], ['右前 45°', 45, 10, 2.5], ['右侧', 90, 5, 3], ['背面', 180, 5, 3.5], ['左前 45°', -45, 10, 2.5], ['左侧', -90, 5, 3],
  ['俯拍特写', 0, 50, 1], ['仰拍全身', 15, -20, 4.5], ['顶拍', 0, 75, 3], ['远景', 20, 10, 6.5],
];
const QN = { fast: '⚡ 快速', standard: '🌟 中等', pro: '💎 高级' };

// ---------- 球体 ----------
const cv = $('#orbit');
const ctx = cv.getContext('2d');
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function project(az, el, r) {
  const t = 0.42; // 视角俯视倾角
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  const x = Math.sin(a) * Math.cos(e), y = Math.sin(e), z = Math.cos(a) * Math.cos(e);
  return { x: cv.width / 2 + x * r, y: cv.height * 0.56 - (y * Math.cos(t) - z * Math.sin(t)) * r, front: z };
}
function drawOrbit() {
  const W = cv.width, H = cv.height, R = 150;
  ctx.clearRect(0, 0, W, H);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = css('--line');
  // 经纬线
  for (const el of [-30, 0, 30, 60]) {
    ctx.beginPath();
    for (let az = -180; az <= 180; az += 6) { const p = project(az, el, R); az === -180 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); }
    ctx.stroke();
  }
  for (let az = -180; az < 180; az += 45) {
    ctx.beginPath();
    for (let el = -30; el <= 90; el += 5) { const p = project(az, el, R); el === -30 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); }
    ctx.stroke();
  }
  // 正面标记
  ctx.fillStyle = css('--muted');
  ctx.font = '20px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('正面 · 朝向你', W / 2, H - 14);
  ctx.fillText('背面', W / 2, 26);
  // 人物
  const cx = W / 2, cy = H * 0.56;
  ctx.fillStyle = css('--muted');
  ctx.beginPath(); ctx.arc(cx, cy - 46, 13, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.roundRect(cx - 13, cy - 30, 26, 64, 12); ctx.fill();
  // 镜头
  const r = R * (0.45 + (C.cam.distance / 7) * 0.75);
  const p = project(C.cam.azimuth, C.cam.elevation, r);
  ctx.strokeStyle = css('--accent');
  ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(cx, cy - 10); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = css('--accent');
  ctx.globalAlpha = p.front >= 0 ? 1 : 0.55;
  const s = p.front >= 0 ? 15 : 11;
  ctx.beginPath(); ctx.roundRect(p.x - s, p.y - s * 0.7, s * 2, s * 1.4, 4); ctx.fill();
  ctx.globalAlpha = 1;
  // 环绕 / 预设预览点
  const ghosts = C.ctrl === 'orbit' ? orbitShots() : C.ctrl === 'preset' ? presetShots() : [];
  for (const g of ghosts) {
    const q = project(g.azimuth, g.elevation, R * (0.45 + (g.distance / 7) * 0.75));
    ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = css('--accent'); ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1.2;
  }
}
let drag = null;
cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, az: C.cam.azimuth, el: C.cam.elevation }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', (e) => {
  if (!drag) return;
  let az = drag.az + (e.clientX - drag.x) * 0.9;
  az = ((az + 540) % 360) - 180;
  setCam({ azimuth: Math.round(az / 5) * 5, elevation: Math.max(-30, Math.min(75, Math.round((drag.el - (e.clientY - drag.y) * 0.5) / 5) * 5)) });
});
cv.addEventListener('pointerup', () => (drag = null));
cv.addEventListener('wheel', (e) => { e.preventDefault(); setCam({ distance: Math.max(0.6, Math.min(7, +(C.cam.distance + (e.deltaY > 0 ? 0.2 : -0.2)).toFixed(1))) }); }, { passive: false });

function camLabel(c) {
  const a = Math.abs(c.azimuth), side = c.azimuth < 0 ? '左' : '右';
  const view = a <= 15 ? '正面' : a <= 60 ? `${side}前` : a <= 120 ? `${side}侧` : a <= 165 ? `${side}后` : '背面';
  const ht = c.elevation <= -15 ? '仰拍' : c.elevation < 10 ? '平视' : c.elevation < 35 ? '微俯' : c.elevation < 60 ? '俯拍' : '顶拍';
  const shot = c.distance < 1.2 ? '特写' : c.distance < 2.2 ? '半身' : c.distance < 3.5 ? '七分身' : c.distance < 5.5 ? '全身' : '远景';
  return `${view} · ${ht} · ${shot}`;
}
function setCam(patch) {
  Object.assign(C.cam, patch);
  store.set('cam3d', C.cam);
  $('#az').value = C.cam.azimuth; $('#el').value = C.cam.elevation; $('#d').value = C.cam.distance;
  $('#azO').textContent = C.cam.azimuth + '°'; $('#elO').textContent = C.cam.elevation + '°'; $('#dO').textContent = Number(C.cam.distance).toFixed(1) + 'm';
  $('#readout').textContent = `AZ ${C.cam.azimuth}° · EL ${C.cam.elevation}° · D ${Number(C.cam.distance).toFixed(1)}m  —  ${camLabel(C.cam)}`;
  drawOrbit();
  updateGo();
}
for (const [id, key] of [['az', 'azimuth'], ['el', 'elevation'], ['d', 'distance']]) $('#' + id).addEventListener('input', (e) => setCam({ [key]: Number(e.target.value) }));

function orbitShots() {
  const n = C.orbitN;
  return Array.from({ length: n }, (_, i) => ({ ...C.cam, azimuth: ((C.cam.azimuth + (360 / n) * i + 540) % 360) - 180 }));
}
function presetShots() {
  return PRESETS.filter((p) => C.presets.has(p[0])).map(([name, azimuth, elevation, distance]) => ({ azimuth, elevation, distance, name }));
}
function shots() {
  if (C.ctrl === 'orbit') return orbitShots();
  if (C.ctrl === 'preset') return presetShots();
  return [{ ...C.cam }];
}

// ---------- 控件 ----------
function seg(el, items, cur, on) {
  el.replaceChildren(...items.map(([id, name]) => h('button', { type: 'button', class: id === cur ? 'on' : '', onclick: () => on(id) }, name)));
}
function renderControls() {
  $$('#ctrlModes button').forEach((b) => b.classList.toggle('on', b.dataset.m === C.ctrl));
  $('#freeBox').hidden = C.ctrl === 'preset';
  $('#orbitBox').hidden = C.ctrl !== 'orbit';
  $('#presetBox').hidden = C.ctrl !== 'preset';
  seg($('#orbitN'), [[4, '4 张'], [6, '6 张'], [8, '8 张']], C.orbitN, (v) => { C.orbitN = v; renderControls(); });
  $('#presets').replaceChildren(...PRESETS.map(([name, az, el, d]) => h('button', {
    type: 'button', class: 'chip' + (C.presets.has(name) ? ' on' : ''),
    onclick: () => { C.presets.has(name) ? C.presets.delete(name) : C.presets.add(name); setCam({ azimuth: az, elevation: el, distance: d }); renderControls(); },
  }, name)));
  $('#subjects').replaceChildren(...(C.cfg ? C.cfg.subjects : []).map((s) => h('button', { type: 'button', class: 'chip' + (s.id === C.subject ? ' on' : ''), onclick: () => { C.subject = s.id; renderControls(); } }, `${s.icon} ${s.name}`)));
  seg($('#res'), (C.cfg ? C.cfg.resolutions : ['1K']).map((r) => [r, r]), C.resolution, (v) => { C.resolution = v; renderControls(); });
  seg($('#ratio'), (C.cfg ? C.cfg.ratios : []).map((r) => [r.id, r.name]), C.ratio, (v) => { C.ratio = v; renderControls(); });
  seg($('#quality'), (C.cfg ? C.cfg.qualities : []).map((q) => [q.id, QN[q.id] || q.name]), C.quality, (v) => { C.quality = v; renderControls(); });
  drawOrbit();
  updateGo();
}
$$('#ctrlModes button').forEach((b) => b.addEventListener('click', () => { C.ctrl = b.dataset.m; renderControls(); }));

function updateGo() {
  const n = shots().length;
  const btn = $('#go');
  btn.textContent = `⚡ 生成${n > 1 ? ` ${n} 张` : ''}`;
  let why = '';
  if (!C.source) why = '先上传一张要换角度的照片';
  else if (!n) why = '至少选一个机位预设';
  btn.disabled = !!why;
  $('#goHint').textContent = why || (C.cfg && C.cfg.mock ? '模拟模式：不会真正调用生图接口' : `当前机位：${camLabel(C.cam)}`);
}

// ---------- 源图 ----------
const drop = $('#drop');
function setSource(src) {
  C.source = src;
  $$('img,.rm', drop).forEach((n) => n.remove());
  $('span', drop).hidden = !!src;
  if (src) {
    drop.append(h('img', { src: src.dataUrl || src.url, alt: '源图' }), h('button', { class: 'rm', type: 'button', 'aria-label': '移除', onclick: (e) => { e.preventDefault(); setSource(null); } }, '✕'));
    const node = { id: 'src-' + Date.now(), kind: 'src', url: src.dataUrl || src.url, label: src.label || '上传的照片', state: 'done' };
    C.nodes.push(node);
    renderNodes();
  }
  updateGo();
}
async function takeFile(f) { try { setSource({ dataUrl: await compress(f), label: f.name || '上传的照片' }); } catch (e) { toast(e.message); } }
$('input', drop).addEventListener('change', (e) => { if (e.target.files[0]) takeFile(e.target.files[0]); e.target.value = ''; });
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files[0]) takeFile(e.dataTransfer.files[0]); });
$('#board').addEventListener('dragover', (e) => e.preventDefault());
$('#board').addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) takeFile(e.dataTransfer.files[0]); });
document.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) takeFile(f); });

async function pickUrl(url, label, historyId) {
  if (historyId) return setSource({ historyId, url, label });
  const r = await fetch(url);
  const blob = await r.blob();
  setSource({ dataUrl: await compress(new File([blob], 'x.jpg', { type: blob.type || 'image/jpeg' })), label });
}

// ---------- 画布节点 ----------
function renderNodes() {
  $('#boardHint').hidden = C.nodes.length > 0;
  $('#nodes').replaceChildren(...C.nodes.map((n) => {
    const box = n.state === 'done' ? h('img', { src: n.url, alt: n.label })
      : n.state === 'error' ? h('div', { class: 'err' }, '✗ ' + n.error)
      : h('div', {}, h('div', { class: 'spinner' }), n.state === 'queued' ? '排队中' : '生成中…');
    return h('div', { class: `node ${n.kind}${C.sel === n.id ? ' sel' : ''}`, onclick: () => { C.sel = n.id; renderNodes(); renderDetail(); } },
      h('div', { class: 'img' }, box),
      h('div', { class: 'meta' }, h('b', {}, n.label), n.cam ? `AZ ${n.cam.azimuth}° · EL ${n.cam.elevation}° · D ${Number(n.cam.distance).toFixed(1)}m` : ''));
  }));
  $('#nodes').style.transform = `scale(${C.zoom})`;
  $('#zoomV').textContent = Math.round(C.zoom * 100) + '%';
}
function renderDetail() {
  const n = C.nodes.find((x) => x.id === C.sel);
  const d = $('#detail');
  d.hidden = !n;
  if (!n) return;
  const dl = h('dl', {}, h('dt', {}, '节点'), h('dd', {}, n.kind === 'src' ? '源图' : '生成结果'),
    n.cam ? [h('dt', {}, '机位'), h('dd', {}, camLabel(n.cam))] : null,
    n.rec ? [h('dt', {}, '尺寸'), h('dd', {}, n.rec.options.size + (n.rec.options.sizeFallback ? '（已降为 1K）' : '')), h('dt', {}, '耗时'), h('dd', {}, (n.rec.durationMs / 1000).toFixed(1) + ' 秒' + (n.rec.mock ? '（模拟）' : ''))] : null);
  const ops = h('div', { class: 'row' },
    n.state === 'done' && n.kind === 'out' ? h('button', { class: 'btn sm', onclick: () => pickUrl(n.url, n.label, n.rec.id) }, '设为源图') : null,
    n.state === 'done' ? h('a', { class: 'btn sm', href: n.url, download: `3D镜头-${n.rec ? n.rec.id : 'source'}.jpg` }, '💾 下载图片') : null,
    n.state === 'done' ? h('button', { class: 'btn sm', onclick: () => lightbox(n.url, n.label) }, '看大图') : null,
    h('button', { class: 'btn sm', onclick: () => deleteNode(n) }, '🗑 删除节点'));
  d.replaceChildren(dl, ops);
}
async function deleteNode(n) {
  if (n.rec && !confirm('同时从作品库删除这张图？')) return;
  if (n.rec) { try { await api(`/api/history/${n.rec.id}`, { method: 'DELETE' }); } catch (e) { return toast(e.message); } }
  C.nodes = C.nodes.filter((x) => x !== n);
  C.sel = null;
  renderNodes(); renderDetail();
}
$('#zoomIn').onclick = () => { C.zoom = Math.min(2, +(C.zoom + 0.1).toFixed(1)); renderNodes(); };
$('#zoomOut').onclick = () => { C.zoom = Math.max(0.4, +(C.zoom - 0.1).toFixed(1)); renderNodes(); };
$('#zoomFit').onclick = () => { C.zoom = 1; renderNodes(); };

// ---------- 生成 ----------
let running = 0;
const queue = [];
function pump() {
  while (running < 2 && queue.length) {
    const job = queue.shift();
    running++;
    job.node.state = 'running';
    renderNodes();
    (async () => {
      for (let i = 0; ; i++) {
        try {
          const rec = await generateAsync(job.body);
          Object.assign(job.node, { state: 'done', url: rec.urls.output, rec });
          break;
        } catch (e) {
          if (e.status === 429 && i < 30) { await new Promise((r) => setTimeout(r, 3000)); continue; }
          Object.assign(job.node, { state: 'error', error: e.message });
          break;
        }
      }
      running--;
      renderNodes();
      if (C.sel === job.node.id) renderDetail();
      pump();
    })();
  }
}
$('#go').addEventListener('click', () => {
  const src = C.source;
  for (const cam of shots()) {
    const node = { id: 'n' + Date.now() + Math.random().toString(36).slice(2, 6), kind: 'out', state: 'queued', label: cam.name || camLabel(cam), cam: { azimuth: cam.azimuth, elevation: cam.elevation, distance: cam.distance } };
    C.nodes.push(node);
    queue.push({ node, body: {
      mode: 'angle', camera: node.cam, subject: C.subject, quality: C.quality, ratio: C.ratio, resolution: C.resolution, extra: $('#extra').value.trim(),
      sourceImage: src.dataUrl || null, sourceHistoryId: src.historyId || null,
    } });
  }
  renderNodes();
  pump();
  $('#board').scrollTop = $('#board').scrollHeight;
});

// ---------- 启动 ----------
(async () => {
  setCam({});
  try { C.cfg = await api('/api/config'); } catch { toast('连不上本地服务，请双击 start.bat 启动', 8000); }
  renderControls();
  const [hist, samples] = await Promise.all([api('/api/history').catch(() => []), loadSamples()]);
  const picks = [
    ...hist.filter((r) => r.options.mode !== 'angle').slice(0, 8).map((r) => ({ url: r.urls.output, label: r.options.actionName || r.options.modeName, id: r.id })),
    ...samples.filter((x) => x.kind === 'person' || x.kind === 'pose').map((x) => ({ url: '/samples/' + x.file, label: x.label })),
  ];
  $('#pickLbl').hidden = !picks.length;
  $('#picks').replaceChildren(...picks.map((p) => h('img', { src: p.url, alt: p.label, title: p.label, onclick: () => pickUrl(p.url, p.label, p.id).catch((e) => toast(e.message)) })));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawOrbit);
  new MutationObserver(drawOrbit).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
