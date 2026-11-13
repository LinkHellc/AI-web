// AI 写真工作台 · 前端
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem('studio:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('studio:' + k, JSON.stringify(v)); } catch {} },
};

// ---------- 状态 ----------
const saved = store.get('settings', {});
const S = {
  cfg: null,
  persons: [],
  history: [],
  personId: saved.personId || null,
  garments: [null, null, null],
  mode: saved.mode || 'third',
  refImage: null, // dataURL
  refHistoryId: null,
  refPreview: null,
  batch: !!saved.batch,
  actions: new Set(saved.actions || []),
  cat: '全部',
  search: '',
  style: saved.style || 'keep',
  camera: { auto: true, azimuth: 0, elevation: 10, distance: 3, ...(saved.camera || {}) },
  locks: new Set(saved.locks || ['face', 'body']),
  quality: saved.quality || 'fast',
  ratio: saved.ratio || '2:3',
  resolution: saved.resolution || '1K',
  count: saved.count || 1,
  extra: saved.extra || '',
  galleryFilter: '',
  samples: [],
};
function persist() {
  store.set('settings', {
    personId: S.personId, mode: S.mode, batch: S.batch, actions: [...S.actions], style: S.style, camera: S.camera,
    locks: [...S.locks], quality: S.quality, ratio: S.ratio, resolution: S.resolution, count: S.count, extra: S.extra,
  });
}

// ---------- 接口 ----------
async function api(path, opts = {}) {
  const headers = { ...(opts.body ? { 'Content-Type': 'application/json' } : {}) };
  const code = store.get('accessCode', '');
  if (code) headers['x-access-code'] = code;
  const resp = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let data = null;
  try { data = await resp.json(); } catch {}
  if (resp.status === 401 && S.cfg && S.cfg.needAccessCode) {
    const c = prompt('请输入访问口令');
    if (c) { store.set('accessCode', c.trim()); return api(path, opts); }
  }
  if (!resp.ok) {
    const e = new Error((data && data.error) || `请求失败（HTTP ${resp.status}）`);
    e.status = resp.status;
    throw e;
  }
  return data;
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

// 压缩图片：长边 1536，JPEG 0.9（人像细节够用，上传快）
function compress(file, maxEdge = 1536) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('请选择图片文件'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法读取，请换一张 JPG / PNG')); };
    img.src = url;
  });
}

// 上传位：点击 / 拖拽 / 粘贴
function makeSlot({ label, value, onChange, cls = 'slot' }) {
  const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const el = h('label', { class: cls, tabindex: 0 }, input);
  const draw = (v) => {
    $$('img,.rm,.plus,span', el).forEach((n) => n.remove());
    if (v) {
      el.append(h('img', { src: v, alt: label }), h('button', { class: 'rm', type: 'button', 'aria-label': '移除', onclick: (e) => { e.preventDefault(); onChange(null); draw(null); } }, '✕'));
    } else el.append(h('span', { class: 'plus' }, '+'), h('span', {}, label));
  };
  const take = async (file) => {
    try { const d = await compress(file); onChange(d); draw(d); } catch (e) { toast(e.message); }
  };
  input.addEventListener('change', () => { if (input.files[0]) take(input.files[0]); input.value = ''; });
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag'));
  el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drag'); if (e.dataTransfer.files[0]) take(e.dataTransfer.files[0]); });
  draw(value);
  return el;
}

// ---------- 示例素材（public/samples/credits.json） ----------
async function loadSamples() {
  try {
    const r = await fetch('/samples/credits.json', { cache: 'no-cache' });
    if (r.ok) S.samples = (await r.json()).filter((x) => x && x.file && x.kind);
  } catch {}
}
const genderOf = (x) => (x && x.gender === 'male' ? 'male' : 'female');
const GENDER_NAME = { female: '女士', male: '男士' };
// 示例单品跟着当前模特的性别走；没设性别时默认女士，也可以手动切
function sampleGender() {
  if (S.sampleGender) return S.sampleGender;
  const p = S.persons.find((x) => x.id === S.personId);
  return p && p.gender ? p.gender : 'female';
}
const samplesOf = (...kinds) => S.samples.filter((x) => kinds.includes(x.kind) && genderOf(x) === sampleGender());
const hasGender = (g) => S.samples.some((x) => genderOf(x) === g);
async function sampleDataUrl(item) {
  const r = await fetch('/samples/' + item.file);
  if (!r.ok) throw new Error('示例图读取失败：' + item.file);
  const blob = await r.blob();
  return compress(new File([blob], item.file, { type: blob.type || 'image/jpeg' }));
}
function sampleRow(box, items, onPick) {
  box.hidden = !items.length && !(hasGender('male') && hasGender('female'));
  const head = $('span', box);
  head.replaceChildren(head.dataset.label || (head.dataset.label = head.textContent));
  if (hasGender('male') && hasGender('female')) {
    head.append(h('span', { class: 'gtabs' }, ...['female', 'male'].map((g) => h('button', {
      type: 'button', class: sampleGender() === g ? 'on' : '',
      onclick: () => { S.sampleGender = g; renderGarments(); renderModes(); },
    }, GENDER_NAME[g]))));
  }
  $('div', box).replaceChildren(...items.map((it) => h('button', {
    type: 'button', class: 'sample', title: `${it.label || it.file}${it.author ? ' · 摄影：' + it.author : ''}${it.license ? ' · ' + it.license : ''}`,
    onclick: async () => { try { await onPick(it); } catch (e) { toast(e.message); } },
  }, h('img', { src: '/samples/' + it.file, alt: it.label || '', loading: 'lazy' }), h('span', {}, it.label || it.kind))));
}
const SAMPLE_PERSON_NAME = { female: '示例女模特', male: '示例男模特' };
function hasSamplePerson(g) {
  return S.persons.some((p) => p.name === SAMPLE_PERSON_NAME[g] || (g === 'female' && p.name === '示例模特'));
}
function renderSamplePersonBtns() {
  const box = $('#samplePersonBtns');
  const btns = ['female', 'male']
    .filter((g) => S.samples.some((x) => x.kind === 'person' && genderOf(x) === g) && !hasSamplePerson(g))
    .map((g) => h('button', { class: 'sample-btn', type: 'button', onclick: (e) => createSamplePerson(g, e.currentTarget) }, `✨ ${SAMPLE_PERSON_NAME[g]}`));
  box.replaceChildren(...btns);
  box.hidden = !btns.length;
}
async function createSamplePerson(gender, btn) {
  const items = S.samples.filter((x) => x.kind === 'person' && genderOf(x) === gender);
  if (!items.length) return;
  btn.disabled = true; btn.textContent = '正在创建…';
  try {
    const images = [];
    for (const it of items.slice(0, 4)) images.push(await sampleDataUrl(it));
    const p = await api('/api/persons', { method: 'POST', body: { name: SAMPLE_PERSON_NAME[gender], gender, images } });
    S.personId = p.id; S.sampleGender = null; persist();
    await loadPersons();
    renderGarments(); renderModes();
    toast(`已创建「${p.name}」，再挑几件示例单品就能生成`);
  } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = `✨ ${SAMPLE_PERSON_NAME[gender]}`; }
}

// ---------- 渲染：左侧面板 ----------
function renderPersons() {
  const list = $('#personList');
  list.replaceChildren(
    ...S.persons.map((p) => h('button', { class: 'person' + (p.id === S.personId ? ' on' : ''), type: 'button', title: p.name, onclick: () => { S.personId = p.id; S.sampleGender = null; persist(); renderPersons(); renderSummary(); renderGarments(); renderModes(); } },
      h('div', { class: 'av' }, h('img', { src: p.photos[0], alt: '' })), h('span', {}, p.name))),
    h('button', { class: 'person add', type: 'button', onclick: openPersonDialog }, h('div', { class: 'av' }, '+'), h('span', {}, '新建模特')),
  );
  $('#personHint').hidden = S.persons.length > 0;
  renderSamplePersonBtns();
  renderPersonsTab();
  renderGalleryFilter();
}

function renderGarments() {
  const labels = ['上衣 / 连衣裙', '下装', '鞋 / 包 / 配饰'];
  $('#garmentSlots').replaceChildren(...S.garments.map((g, i) => makeSlot({ label: labels[i], value: g, onChange: (v) => { S.garments[i] = v; renderSummary(); } })));
  sampleRow($('#garmentSamples'), samplesOf('garment', 'bag', 'shoes', 'accessory'), async (it) => {
    // 包/鞋优先放第 3 格，服装优先放前两格；都满了就替换对应格
    const order = ['bag', 'shoes', 'accessory'].includes(it.kind) ? [2, 0, 1] : [0, 1, 2];
    const i = order.find((k) => !S.garments[k]) ?? order[0];
    S.garments[i] = await sampleDataUrl(it);
    renderGarments(); renderSummary();
  });
}

function renderModes() {
  $('#modeList').replaceChildren(...S.cfg.modes.map((m) => h('button', {
    class: 'mode' + (m.id === S.mode ? ' on' : ''), type: 'button', title: m.desc,
    onclick: () => { S.mode = m.id; persist(); renderModes(); renderActions(); renderSummary(); },
  }, h('i', {}, m.icon), m.name)));
  const mode = S.cfg.modes.find((m) => m.id === S.mode);
  $('#refBox').hidden = !(mode && mode.needsRef);
  const refSlot = makeSlot({
    label: '上传要复刻的参考图', cls: 'slot big', value: S.refImage || S.refPreview,
    onChange: (v) => { S.refImage = v; S.refHistoryId = null; S.refPreview = null; renderSummary(); },
  });
  refSlot.id = 'refSlot';
  $('#refSlot').replaceWith(refSlot);
  sampleRow($('#refSamples'), samplesOf('pose'), async (it) => {
    S.refImage = await sampleDataUrl(it); S.refHistoryId = null; S.refPreview = null;
    renderModes(); renderSummary();
  });
}

function renderActions() {
  const cats = ['全部', ...new Set(S.cfg.actions.map((a) => a.cat))];
  $('#actionCats').replaceChildren(...cats.map((c) => h('button', { type: 'button', class: c === S.cat ? 'on' : '', onclick: () => { S.cat = c; renderActions(); } }, c)));
  const q = S.search.trim();
  const list = S.cfg.actions.filter((a) => (S.cat === '全部' || a.cat === S.cat) && (!q || a.name.includes(q) || a.cat.includes(q)));
  $('#actionList').replaceChildren(...list.map((a) => h('button', {
    type: 'button', class: 'chip' + (S.actions.has(a.id) ? ' on' : ''),
    onclick: () => {
      if (S.actions.has(a.id)) S.actions.delete(a.id);
      else {
        if (!S.batch) S.actions.clear();
        if (S.actions.size >= 12) return toast('批量最多一次选 12 个动作');
        S.actions.add(a.id);
      }
      persist(); renderActions(); renderSummary();
    },
  }, a.name)));
  if (!list.length) $('#actionList').append(h('span', { class: 'hint' }, '没有匹配的动作'));
  const copy = S.mode === 'copy';
  $('#actionHint').textContent = copy ? '「AI 仿图」模式按参考图的姿势生成，动作只用于批量出多张时区分。'
    : S.batch ? `已选 ${S.actions.size} 个动作，每个动作各出一组图。` : (S.actions.size ? '单选模式。打开「批量模式」可一次选多个动作。' : '不选则由 AI 自然摆姿势。');
}

function renderStyles() {
  $('#styleList').replaceChildren(...S.cfg.styles.map((s) => h('button', {
    type: 'button', class: 'style' + (s.id === S.style ? ' on' : ''),
    onclick: () => { S.style = s.id; persist(); renderStyles(); renderSummary(); },
  }, h('span', { class: 'sw', style: `background:${s.swatch}` }), s.name)));
}

function renderLocks() {
  $('#lockList').replaceChildren(...S.cfg.locks.map((l) => h('button', {
    type: 'button', class: 'chip' + (S.locks.has(l.id) ? ' on' : ''),
    onclick: () => { S.locks.has(l.id) ? S.locks.delete(l.id) : S.locks.add(l.id); persist(); renderLocks(); },
  }, (S.locks.has(l.id) ? '🔒 ' : '') + l.name)));
}

function seg(el, items, cur, onPick) {
  el.replaceChildren(...items.map((it) => h('button', { type: 'button', class: it.id === cur ? 'on' : '', title: it.hint || '', onclick: () => onPick(it.id) }, it.name)));
}
function renderRender() {
  seg($('#qualitySeg'), S.cfg.qualities, S.quality, (v) => { S.quality = v; persist(); renderRender(); renderSummary(); });
  seg($('#ratioSeg'), S.cfg.ratios, S.ratio, (v) => { S.ratio = v; persist(); renderRender(); });
  seg($('#resSeg'), S.cfg.resolutions.map((r) => ({ id: r, name: r, hint: r === '1K' ? '标准尺寸，最稳' : '中转不支持时会自动降回 1K' })), S.resolution, (v) => { S.resolution = v; persist(); renderRender(); renderSummary(); });
  $('#count').value = S.count;
  $('#countOut').textContent = S.count;
  $('#extra').value = S.extra;
}

// ---------- 镜头 ----------
function camText(c) {
  const az = c.azimuth, a = Math.abs(az), el = c.elevation, d = c.distance;
  const side = az < 0 ? '左' : '右';
  const view = a <= 15 ? '正面' : a <= 60 ? `${side}前 45°` : a <= 120 ? `${side}侧面` : a <= 165 ? `${side}后方` : '正背面';
  const height = el <= -15 ? '仰拍' : el < 10 ? '平视' : el < 35 ? '微俯' : el < 60 ? '俯拍' : '顶拍';
  const shot = d < 1.2 ? '特写' : d < 2.2 ? '半身' : d < 3.5 ? '七分身' : d < 5.5 ? '全身' : '远景';
  return `${view} · ${height} · ${shot}`;
}
function renderCamera() {
  const c = S.camera;
  $('#camToggle').checked = c.auto === false;
  $('#camBox').hidden = c.auto !== false;
  $('#az').value = c.azimuth; $('#el').value = c.elevation; $('#dist').value = c.distance;
  $('#azOut').textContent = `${c.azimuth}°`; $('#elOut').textContent = `${c.elevation}°`; $('#dOut').textContent = `${Number(c.distance).toFixed(1)}m`;
  $('#camDesc').textContent = '当前：' + camText(c);
  const rad = (c.azimuth * Math.PI) / 180;
  const r = 18 + (c.distance / 7) * 30;
  const cx = r * Math.sin(rad), cy = r * Math.cos(rad);
  $('#camTop').innerHTML = `
    <circle class="ring" r="48"/><circle class="ring" r="24"/>
    <text x="0" y="-52" text-anchor="middle">背后</text><text x="0" y="57" text-anchor="middle">正面</text>
    <circle class="subj" r="7"/><path class="subj" d="M-3 6 L3 6 L0 11 Z"/>
    <line class="ray" x1="${cx}" y1="${cy}" x2="0" y2="0"/>
    <rect class="cam" x="${cx - 5}" y="${cy - 4}" width="10" height="8" rx="2" transform="rotate(${-c.azimuth} ${cx} ${cy})"/>`;
  const er = (c.elevation * Math.PI) / 180;
  const sx = 8 + r * 2 * Math.cos(er) * 0.9, sy = -r * 2 * Math.sin(er) * 0.9;
  $('#camSide').innerHTML = `
    <line class="ring" x1="-10" y1="40" x2="120" y2="40"/>
    <rect class="subj" x="-4" y="-22" width="8" height="62" rx="4"/><circle class="subj" cx="0" cy="-30" r="7"/>
    <line class="ray" x1="${sx}" y1="${sy}" x2="0" y2="0"/>
    <rect class="cam" x="${sx - 5}" y="${sy - 4}" width="10" height="8" rx="2"/>
    <text x="60" y="54" text-anchor="middle">侧视 · 距离 ${Number(c.distance).toFixed(1)}m</text>`;
}
const CAM_PRESETS = [
  ['正面全身', 0, 5, 4.5], ['45° 半身', 35, 10, 1.8], ['侧面', 90, 0, 3], ['背影回眸', 165, 5, 3.2], ['俯拍特写', 0, 45, 1], ['仰拍大长腿', 10, -20, 4],
];

// ---------- 摘要与按钮 ----------
function jobsPlan() {
  const acts = S.actions.size ? [...S.actions] : [null];
  return { acts, total: acts.length * S.count };
}
function renderSummary() {
  const p = S.persons.find((x) => x.id === S.personId);
  const mode = S.cfg.modes.find((m) => m.id === S.mode);
  const style = S.cfg.styles.find((s) => s.id === S.style);
  const q = S.cfg.qualities.find((x) => x.id === S.quality);
  const actNames = [...S.actions].map((id) => (S.cfg.actions.find((a) => a.id === id) || {}).name).filter(Boolean);
  const g = S.garments.filter(Boolean).length;
  const item = (k, v) => h('span', {}, k + '：', h('b', {}, v));
  $('#summary').replaceChildren(
    item('模特', p ? p.name : '未选择'), item('模式', mode ? mode.name : '-'),
    item('动作', actNames.length ? (actNames.length > 3 ? `${actNames.slice(0, 3).join('、')} 等 ${actNames.length} 个` : actNames.join('、')) : '自由'),
    item('风格', style ? style.name : '-'), item('服装', g ? `${g} 件` : '原服装'), item('画质', `${q ? q.name : ''} · ${S.resolution}`),
  );
  const { total } = jobsPlan();
  const btn = $('#goBtn');
  let why = '';
  if (!p) why = '先新建或选择一个模特';
  else if (mode && mode.needsRef && !S.refImage && !S.refHistoryId) why = '「AI 仿图」需要先上传参考图';
  btn.disabled = !!why;
  btn.textContent = `⚡ 立即生成 ${total} 张`;
  $('#goHint').textContent = why || (S.cfg.mock ? '模拟模式：不会真正调用生图接口' : `预计每张 ${S.quality === 'fast' ? '20–40' : S.quality === 'standard' ? '40–80' : '60–150'} 秒，同时跑 2 张`);
}

// ---------- 生成队列 ----------
const queue = [];
let running = 0;
const MAX_PARALLEL = 2;

function startBatch() {
  const { acts } = jobsPlan();
  const batchId = 'b' + Date.now().toString(36);
  const base = {
    personId: S.personId, garments: S.garments.filter(Boolean), mode: S.mode, styleId: S.style,
    locks: [...S.locks], camera: S.camera.auto === false ? { ...S.camera } : null, quality: S.quality,
    ratio: S.ratio, resolution: S.resolution, extra: S.extra.trim(), batchId,
    refImage: S.mode === 'copy' ? S.refImage : null, refHistoryId: S.mode === 'copy' ? S.refHistoryId : null,
  };
  const jobs = [];
  for (const a of acts) for (let v = 1; v <= S.count; v++) jobs.push({ ...base, actionId: a, variant: v });
  runJobs(jobs, `${S.persons.find((p) => p.id === S.personId)?.name || ''} · ${S.cfg.modes.find((m) => m.id === S.mode)?.name || ''}`);
}

function runJobs(jobs, title) {
  switchTab('create');
  $('#empty').hidden = true;
  const ratioCls = { '1:1': 'r11', '3:2': 'r32' }[jobs[0].ratio] || '';
  const grid = h('div', { class: 'grid' });
  const bar = h('i', { style: 'width:0%' });
  const status = h('span', { class: 'hint' });
  const batch = h('div', { class: 'batch' },
    h('div', { class: 'batch-head' }, h('strong', {}, title), status),
    h('div', { class: 'progress' }, bar), grid);
  $('#batches').prepend(batch);
  if (matchMedia('(max-width: 900px)').matches) batch.scrollIntoView({ behavior: 'smooth', block: 'start' });
  let done = 0, failed = 0;
  const update = () => {
    bar.style.width = `${Math.round(((done + failed) / jobs.length) * 100)}%`;
    status.textContent = done + failed < jobs.length ? `生成中 ${done + failed}/${jobs.length}` : `完成 ${done} 张${failed ? `，失败 ${failed} 张` : ''}`;
  };
  update();
  for (const job of jobs) {
    const actName = job.actionId ? (S.cfg.actions.find((a) => a.id === job.actionId) || {}).name : '自由姿势';
    const card = h('div', { class: `card ${ratioCls}` }, h('div', { class: 'ph' }, h('div', {}, h('div', { class: 'spinner' }), `排队中 · ${actName}${job.variant > 1 ? ' #' + job.variant : ''}`)));
    grid.append(card);
    const t = {
      job, card,
      onStart() { $('.ph', card).replaceChildren(h('div', {}, h('div', { class: 'spinner' }), `生成中 · ${actName}`, h('br'), h('small', { class: 'elapsed' }, '0s'))); const t0 = Date.now(); this.tick = setInterval(() => { const e = $('.elapsed', card); if (e) e.textContent = Math.round((Date.now() - t0) / 1000) + 's'; }, 1000); },
      onDone(rec) { clearInterval(this.tick); done++; update(); fillCard(card, rec); S.history.unshift(rec); renderGallery(); },
      onFail(err) {
        clearInterval(this.tick); failed++; update();
        card.classList.add('err');
        $('.ph', card).replaceChildren(h('div', {}, `✗ ${actName}`, h('br'), h('small', {}, err.message), h('br'),
          h('button', { class: 'ghost', type: 'button', onclick: () => { failed--; card.classList.remove('err'); $('.ph', card).replaceChildren(h('div', {}, h('div', { class: 'spinner' }), '排队中')); enqueue(t); update(); } }, '重试')));
      },
    };
    enqueue(t);
  }
}

function enqueue(t) { queue.push(t); pump(); }
function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const t = queue.shift();
    running++;
    t.onStart();
    (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const rec = await generateAsync(t.job);
          t.onDone(rec);
          break;
        } catch (e) {
          if (e.status === 429 && attempt < 30) { await new Promise((r) => setTimeout(r, 3000)); continue; }
          t.onFail(e);
          break;
        }
      }
      running--;
      pump();
    })();
  }
}

function fillCard(card, rec) {
  card.classList.remove('err');
  card.classList.toggle('r11', rec.options.ratio === '1:1');
  card.classList.toggle('r32', rec.options.ratio === '3:2');
  const label = [rec.options.actionName || rec.options.modeName, rec.options.styleId !== 'keep' ? rec.options.styleName : null].filter(Boolean).join(' · ');
  card.replaceChildren(
    h('div', { class: 'ph' }),
    h('img', { src: rec.urls.output, alt: label, loading: 'lazy', onclick: () => openViewer(rec) }),
    h('div', { class: 'cap' }, h('span', {}, label + (rec.mock ? '（模拟）' : '')),
      h('div', { class: 'ops' },
        h('a', { href: rec.urls.output, download: `写真-${rec.id}${rec.urls.output.slice(rec.urls.output.lastIndexOf('.'))}`, title: '下载' }, '下载'),
        h('button', { type: 'button', onclick: () => useAsRef(rec) }, '仿这张'))),
  );
}

function useAsRef(rec) {
  S.mode = 'copy';
  S.refHistoryId = rec.id;
  S.refImage = null;
  S.refPreview = rec.urls.output;
  persist();
  renderModes(); renderActions(); renderSummary();
  $('#viewer').open && $('#viewer').close();
  $('#refBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast('已设为参考图，可换模特或风格后再生成');
}

// ---------- 画廊 / 模特 ----------
function renderGalleryFilter() {
  const sel = $('#galleryFilter');
  sel.replaceChildren(h('option', { value: '' }, '全部模特'), ...S.persons.map((p) => h('option', { value: p.id, selected: p.id === S.galleryFilter }, p.name)));
}
function renderGallery() {
  const list = S.history.filter((r) => !S.galleryFilter || r.personId === S.galleryFilter);
  $('#galleryCount').textContent = `${list.length} 张`;
  const grid = $('#gallery');
  if (!list.length) return grid.replaceChildren(h('p', { class: 'hint' }, '还没有作品，去「创作」生成第一张吧。'));
  grid.replaceChildren(...list.map((r) => { const c = h('div', { class: 'card' }); fillCard(c, r); return c; }));
}
function renderPersonsTab() {
  $('#personsGrid').replaceChildren(
    ...S.persons.map((p) => h('div', { class: 'pcard' },
      h('div', { class: 'photos' }, ...p.photos.map((u) => h('img', { src: u, alt: p.name }))),
      h('div', { class: 'row' }, h('strong', {}, p.name), h('span', { class: 'hint' }, `${p.uses} 张作品`)),
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: () => { S.personId = p.id; persist(); renderPersons(); renderSummary(); switchTab('create'); toast(`已选择 ${p.name}`); } }, '用 TA 创作'),
        h('button', { type: 'button', onclick: async () => { const n = prompt('新名字', p.name); if (!n) return; try { await api(`/api/persons/${p.id}`, { method: 'PATCH', body: { name: n } }); await loadPersons(); } catch (e) { toast(e.message); } } }, '改名'),
        h('button', { type: 'button', class: 'danger', onclick: async () => { if (!confirm(`删除模特「${p.name}」？已生成的作品会保留。`)) return; try { await api(`/api/persons/${p.id}`, { method: 'DELETE' }); if (S.personId === p.id) S.personId = null; await loadPersons(); } catch (e) { toast(e.message); } } }, '删除')))),
    h('div', { class: 'pcard new', role: 'button', tabindex: 0, onclick: openPersonDialog }, '+ 新建模特'),
  );
}

function switchTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.tab').forEach((t) => (t.hidden = t.id !== 'tab-' + name));
}

// ---------- 新建模特 ----------
let newPhotos = [];
function openPersonDialog() {
  newPhotos = [null, null, null, null];
  const labels = ['正脸（必填）', '半身', '全身', '其他角度'];
  $('#personSlots').replaceChildren(...newPhotos.map((_, i) => makeSlot({ label: labels[i], value: null, onChange: (v) => (newPhotos[i] = v) })));
  $('#personForm').name.value = '';
  $('#personForm').gender.value = '';
  $('#personDlg').showModal();
}
$('#personForm').addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  e.preventDefault();
  const images = newPhotos.filter(Boolean);
  if (!images.length) return toast('请至少上传一张人物照片');
  const btn = $('#personSave');
  btn.disabled = true; btn.textContent = '保存中…';
  try {
    const p = await api('/api/persons', { method: 'POST', body: { name: $('#personForm').name.value, gender: $('#personForm').gender.value, images } });
    S.personId = p.id; persist();
    $('#personDlg').close();
    await loadPersons();
    toast(`模特「${p.name}」已保存`);
  } catch (err) { toast(err.message); } finally { btn.disabled = false; btn.textContent = '保存模特'; }
});

// ---------- 大图 ----------
function openViewer(rec) {
  const o = rec.options;
  const mode = S.cfg.modes.find((m) => m.id === o.mode);
  const thumbs = [...rec.urls.identity, ...rec.urls.garments, rec.urls.ref].filter(Boolean);
  $('#viewerImg').src = rec.urls.output;
  $('#viewerInfo').replaceChildren(
    h('h4', {}, o.actionName || '自由姿势'),
    h('dl', {},
      h('dt', {}, '模特'), h('dd', {}, rec.personName || '-'),
      h('dt', {}, '模式'), h('dd', {}, mode ? mode.name : (o.modeName || o.mode)),
      h('dt', {}, '风格'), h('dd', {}, o.styleName),
      o.camera ? [h('dt', {}, '镜头'), h('dd', {}, camText(o.camera))] : null,
      h('dt', {}, '画质'), h('dd', {}, `${(S.cfg.qualities.find((q) => q.id === o.quality) || {}).name || o.quality} · ${o.size}${o.sizeFallback ? '（已降为 1K）' : ''}`),
      h('dt', {}, '耗时'), h('dd', {}, `${(rec.durationMs / 1000).toFixed(1)} 秒${rec.mock ? '（模拟）' : ''}`),
      o.extra ? [h('dt', {}, '补充'), h('dd', {}, o.extra)] : null,
    ),
    h('div', { class: 'hint' }, '输入图'), h('div', { class: 'thumbs' }, ...thumbs.map((u) => h('img', { src: u, alt: '' }))),
    h('div', { class: 'vops' },
      h('a', { class: 'go small', href: rec.urls.output, download: `写真-${rec.id}.jpg`, style: 'text-align:center;text-decoration:none' }, '下载原图'),
      h('button', { class: 'ghost', type: 'button', onclick: () => useAsRef(rec) }, '🎯 仿这张（换人/换风格复刻）'),
      o.mode === 'angle' ? null : h('button', { class: 'ghost', type: 'button', onclick: () => regenerate(rec) }, '🔄 相同设置再来一张'),
      h('button', { class: 'ghost', type: 'button', style: 'color:var(--danger)', onclick: () => removeRecord(rec) }, '删除'),
    ),
  );
  $('#viewer').showModal();
}
$('#viewerClose').addEventListener('click', () => $('#viewer').close());
$('#viewer').addEventListener('click', (e) => { if (e.target === $('#viewer')) $('#viewer').close(); });

function regenerate(rec) {
  if (!S.persons.some((p) => p.id === rec.personId)) return toast('这个模特已被删除');
  const o = rec.options;
  $('#viewer').close();
  runJobs([{
    personId: rec.personId, garments: [], mode: o.mode, styleId: o.styleId, locks: o.locks, camera: o.camera, quality: o.quality,
    ratio: o.ratio, resolution: o.resolution, extra: o.extra, actionId: o.actionId, variant: (o.variant || 1) + 1,
    refHistoryId: null, refImage: null, regenOf: rec.id,
  }], '再来一张 · ' + (o.actionName || '自由姿势'));
}

async function removeRecord(rec) {
  if (!confirm('删除这张作品？')) return;
  try {
    await api(`/api/history/${rec.id}`, { method: 'DELETE' });
    S.history = S.history.filter((r) => r.id !== rec.id);
    $('#viewer').close();
    renderGallery();
    $$('#batches img').forEach((img) => { if (img.getAttribute('src') === rec.urls.output) img.closest('.card').remove(); });
  } catch (e) { toast(e.message); }
}

// ---------- 启动 ----------
async function loadPersons() {
  S.persons = await api('/api/persons');
  if (!S.persons.some((p) => p.id === S.personId)) S.personId = S.persons[0] ? S.persons[0].id : null;
  renderPersons();
  renderSummary();
}

function bindStatic() {
  $('#batchToggle').checked = S.batch;
  $('#batchToggle').addEventListener('change', (e) => {
    S.batch = e.target.checked;
    if (!S.batch && S.actions.size > 1) S.actions = new Set([[...S.actions][0]]);
    persist(); renderActions(); renderSummary();
  });
  $('#actionSearch').addEventListener('input', (e) => { S.search = e.target.value; renderActions(); });
  $('#actionClear').addEventListener('click', () => { S.actions.clear(); persist(); renderActions(); renderSummary(); });
  $('#camToggle').addEventListener('change', (e) => { S.camera.auto = !e.target.checked; persist(); renderCamera(); });
  for (const [id, key] of [['az', 'azimuth'], ['el', 'elevation'], ['dist', 'distance']]) {
    $('#' + id).addEventListener('input', (e) => { S.camera[key] = Number(e.target.value); persist(); renderCamera(); });
  }
  $('#camPresets').replaceChildren(...CAM_PRESETS.map(([name, az, el, d]) => h('button', { type: 'button', class: 'chip', onclick: () => { Object.assign(S.camera, { azimuth: az, elevation: el, distance: d }); persist(); renderCamera(); } }, name)));
  $('#count').addEventListener('input', (e) => { S.count = Number(e.target.value); $('#countOut').textContent = S.count; persist(); renderSummary(); });
  $('#extra').addEventListener('input', (e) => { S.extra = e.target.value; persist(); });
  $('#goBtn').addEventListener('click', startBatch);
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#galleryFilter').addEventListener('change', (e) => { S.galleryFilter = e.target.value; renderGallery(); });
  // 粘贴图片：没有模特照时进新建模特，否则放进第一个空的服装位
  document.addEventListener('paste', async (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file || $('#personDlg').open) return;
    const i = S.garments.findIndex((g) => !g);
    if (i === -1) return toast('服装位已满');
    try { S.garments[i] = await compress(file); renderGarments(); renderSummary(); toast('已粘贴到服装位'); } catch (err) { toast(err.message); }
  });
}

(async function init() {
  try {
    S.cfg = await api('/api/config');
  } catch (e) {
    $('#engine').textContent = '服务未启动';
    $('#engine').classList.add('warn');
    return toast('连不上本地服务，请双击 start.bat 启动', 8000);
  }
  $('#engine').textContent = S.cfg.mock ? '模拟模式' : '● 已就绪';
  $('#engine').classList.toggle('warn', S.cfg.mock);
  if (!S.cfg.qualities.some((q) => q.id === S.quality)) S.quality = 'fast';
  if (!S.cfg.ratios.some((r) => r.id === S.ratio)) S.ratio = '2:3';
  if (!S.cfg.modes.some((m) => m.id === S.mode)) S.mode = 'third';
  for (const id of [...S.actions]) if (!S.cfg.actions.some((a) => a.id === id)) S.actions.delete(id);
  await loadSamples();
  bindStatic();
  renderGarments(); renderModes(); renderActions(); renderStyles(); renderLocks(); renderRender(); renderCamera();
  await loadPersons();
  try { S.history = await api('/api/history'); } catch {}
  renderGallery();
})();
