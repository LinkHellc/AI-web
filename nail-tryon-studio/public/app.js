// 美甲试甲工作台 · 前端（三步流程：上传素材 → 生成中 → 完成）
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const MAX_SIDE = 1024; // 上传前压缩，最长边像素（越小上传和生成越快）
  const LOADING_TIPS = [
    '正在贴合美甲款式并锁定原图细节…',
    '正在识别每根手指的指甲位置…',
    '正在把款式贴合到甲面弧度上…',
    '正在匹配原图的光线和高光…',
    '快好了，精细画质会稍慢一些…',
  ];

  const state = {
    config: null,
    hand: null, // dataURL
    design: null, // dataURL
    presetId: null,
    libraryId: null,
    library: [],
    tagFilter: '全部',
    shape: 'keep',
    length: 'keep',
    finish: 'auto',
    quality: 'low',
    size: 'auto',
    stage: 'upload',
    busy: false,
    history: [],
    current: null,
    viewing: null,
  };

  // ---------- 通用 ----------
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), 2600);
  }

  function accessHeaders() {
    let code = '';
    try { code = localStorage.getItem('accessCode') || ''; } catch {}
    return code ? { 'X-Access-Code': code } : {};
  }

  async function api(path, opts = {}, retried = false) {
    const resp = await fetch(path, { ...opts, headers: { ...(opts.headers || {}), ...accessHeaders() } });
    let data = null;
    try { data = await resp.json(); } catch {}
    if (resp.status === 401 && !retried && state.config && state.config.needAccessCode) {
      const code = prompt('请输入访问口令');
      if (code) {
        try { localStorage.setItem('accessCode', code.trim()); } catch {}
        return api(path, opts, true);
      }
    }
    if (!resp.ok) throw new Error((data && data.error) || `请求失败（${resp.status}）`);
    return data;
  }

  // 读取图片 → 按 EXIF 方向绘制 → 压缩为 JPEG dataURL（顺带解决手机 HEIC/MPO 等格式问题）
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file || (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name || ''))) {
        reject(new Error('请选择图片文件'));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('这张图片打不开，请换一张 JPG / PNG 照片'));
      };
      img.src = url;
    });
  }

  async function urlToDataUrl(url) {
    const b = await (await fetch(url, { headers: accessHeaders() })).blob();
    return fileToDataUrl(new File([b], 'img', { type: b.type || 'image/png' }));
  }

  // ---------- 阶段与进度条 ----------
  function setStage(stage) {
    state.stage = stage;
    $('stageUpload').hidden = stage !== 'upload' && stage !== 'loading';
    $('stageUpload').classList.toggle('locked', stage === 'loading');
    $('stageLoading').hidden = stage !== 'loading';
    $('stageError').hidden = stage !== 'error';
    $('stageResult').hidden = stage !== 'result';
    const cur = { upload: 1, loading: 2, error: 2, result: 3 }[stage];
    const items = [...$('stepper').children];
    items.forEach((li) => {
      if (li.dataset.step) {
        const n = Number(li.dataset.step);
        li.classList.toggle('done', n < cur);
        li.classList.toggle('current', n === cur);
        if (n === cur) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      }
    });
    // 连接线：前一个步骤已完成即点亮
    items.forEach((li, i) => {
      if (li.classList.contains('bar')) li.classList.toggle('done', items[i - 1].classList.contains('done'));
    });
  }

  // ---------- 上传区 ----------
  function setupDrop(dropId, inputId, key) {
    const drop = $(dropId);
    const input = $(inputId);
    const preview = drop.querySelector('.drop-preview');
    const clear = drop.querySelector('.drop-clear');

    async function take(file) {
      if (!file) return;
      try { setImage(key, await fileToDataUrl(file)); } catch (e) { toast(e.message); }
    }
    input.addEventListener('change', () => { take(input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragover'); }));
    drop.addEventListener('drop', (e) => take(e.dataTransfer.files[0]));
    clear.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (key === 'design') { state.presetId = null; state.libraryId = null; }
      setImage(key, null);
    });

    drop._render = () => {
      const val = state[key];
      drop.classList.toggle('has-image', !!val);
      preview.hidden = !val;
      clear.hidden = !val;
      if (val) preview.src = val; else preview.removeAttribute('src');
    };
  }

  function setImage(key, dataUrl, { silent = false } = {}) {
    state[key] = dataUrl;
    if (key === 'design' && dataUrl) { state.presetId = null; state.libraryId = null; }
    renderStyleState();
    if (!silent && dataUrl) maybeAuto();
  }

  // 对标站：手照和款式都就绪后自动生成
  function maybeAuto() {
    if (state.hand && (state.design || state.presetId || state.libraryId) && $('autoGen').checked && state.stage === 'upload' && !state.busy) generate();
  }

  function selectPreset(id) {
    state.presetId = state.presetId === id ? null : id;
    if (state.presetId) { state.design = null; state.libraryId = null; }
    renderStyleState();
    if (state.presetId) maybeAuto();
  }

  function selectLibrary(id) {
    state.libraryId = state.libraryId === id ? null : id;
    if (state.libraryId) { state.design = null; state.presetId = null; }
    renderStyleState();
    if (state.libraryId) maybeAuto();
  }

  function nailsHtml(css) {
    return `<div class="nails" aria-hidden="true">${'<i></i>'.repeat(5)}</div>`.replace(/<i><\/i>/g, `<i style="background:${css}"></i>`);
  }

  // 款式卡片：显示当前选中的款式（上传图 / 推荐款 / 我的款式）
  function renderStyleState() {
    $('handDrop')._render();
    $('designDrop')._render();
    const drop = $('designDrop');
    const chosen = $('designChosen');
    const preset = state.presetId && state.config ? state.config.presets.find((p) => p.id === state.presetId) : null;
    const lib = state.libraryId ? state.library.find((l) => l.id === state.libraryId) : null;
    if (!state.design && (preset || lib)) {
      drop.classList.add('has-image');
      drop.querySelector('.drop-clear').hidden = false;
      chosen.hidden = false;
      chosen.innerHTML = '';
      if (lib || (preset && preset.image)) {
        const img = document.createElement('img');
        img.src = lib ? lib.url : preset.image;
        img.alt = '';
        chosen.appendChild(img);
      } else {
        chosen.insertAdjacentHTML('beforeend', nailsHtml(preset.css));
      }
      const cap = document.createElement('p');
      cap.textContent = lib ? `我的款式 · ${lib.name}` : `2026 爆款 · ${preset.name}`;
      chosen.appendChild(cap);
    } else {
      chosen.hidden = true;
    }
    $('saveLibBtn').hidden = !state.design;
    if (state.config) renderPresets();
    renderLibrary();
    updateForm();
  }

  // 在上传页任意位置粘贴截图：没有手照时当手照，否则当款式图
  document.addEventListener('paste', async (e) => {
    if (state.stage !== 'upload') return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    const dataUrl = await fileToDataUrl(item.getAsFile()).catch(() => null);
    if (!dataUrl) return;
    if (!state.hand) { setImage('hand', dataUrl); toast('已粘贴为手部照片'); }
    else { setImage('design', dataUrl); toast('已粘贴为款式图'); }
  });

  // ---------- 爆款推荐 ----------
  function renderFilters() {
    const tags = ['全部', ...new Set(state.config.presets.map((p) => p.tag))];
    const box = $('tagFilters');
    box.innerHTML = '';
    for (const t of tags) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', state.tagFilter === t);
      b.textContent = t;
      b.addEventListener('click', () => { state.tagFilter = t; renderFilters(); renderPresets(); });
      box.appendChild(b);
    }
  }

  function renderPresets() {
    const box = $('presetList');
    box.innerHTML = '';
    for (const p of state.config.presets) {
      if (state.tagFilter !== '全部' && p.tag !== state.tagFilter) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', state.presetId === p.id);
      btn.innerHTML = `<div class="preset-visual">${p.image ? '<img alt="" loading="lazy" />' : nailsHtml(p.css)}<span class="preset-tag"></span></div><b></b><small></small>`;
      if (p.image) btn.querySelector('img').src = p.image;
      btn.querySelector('.preset-tag').textContent = p.tag;
      btn.querySelector('b').textContent = p.name;
      btn.querySelector('small').textContent = p.desc;
      btn.addEventListener('click', () => selectPreset(p.id));
      box.appendChild(btn);
    }
  }

  // ---------- 我的款式库 ----------
  function renderLibrary() {
    const box = $('libList');
    if (!box) return;
    box.innerHTML = '';
    $('libCount').textContent = state.library.length ? `(${state.library.length})` : '';
    $('libEmpty').hidden = state.library.length > 0;
    for (const item of state.library) {
      const card = document.createElement('div');
      card.className = 'preset lib-item';
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', state.libraryId === item.id);
      card.tabIndex = 0;
      card.innerHTML = '<div class="preset-visual"><img alt="" loading="lazy" /></div><b></b><small></small><div class="lib-ops"><button type="button" class="lib-op" data-op="rename" aria-label="重命名">✎</button><button type="button" class="lib-op" data-op="delete" aria-label="删除">×</button></div>';
      card.querySelector('img').src = item.url;
      card.querySelector('b').textContent = item.name;
      card.querySelector('small').textContent = item.tags.length ? item.tags.join(' · ') : new Date(item.createdAt).toLocaleDateString('zh-CN');
      card.addEventListener('click', (e) => {
        const op = e.target.closest('.lib-op');
        if (op) { e.stopPropagation(); return op.dataset.op === 'delete' ? deleteLib(item) : renameLib(item); }
        selectLibrary(item.id);
      });
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectLibrary(item.id); } });
      box.appendChild(card);
    }
  }

  async function loadLibrary() {
    try { state.library = await api('/api/library'); } catch (e) { toast(e.message); }
    renderLibrary();
  }

  async function importFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name)).slice(0, 30);
    if (!list.length) return toast('请选择图片文件');
    toast(`正在导入 ${list.length} 张…`);
    try {
      const items = [];
      for (const f of list) items.push({ image: await fileToDataUrl(f), name: f.name.replace(/\.[^.]+$/, '').slice(0, 40) });
      const added = await api('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
      state.library = [...added, ...state.library];
      selectTab('mine');
      renderLibrary();
      toast(`已导入 ${added.length} 个款式，点选即可试戴`);
    } catch (e) { toast(e.message); }
  }

  async function deleteLib(item) {
    if (!confirm(`从款式库删除「${item.name}」？`)) return;
    try {
      await api(`/api/library/${item.id}`, { method: 'DELETE' });
      state.library = state.library.filter((l) => l.id !== item.id);
      if (state.libraryId === item.id) state.libraryId = null;
      renderStyleState();
    } catch (e) { toast(e.message); }
  }

  async function renameLib(item) {
    const name = prompt('款式名称', item.name);
    if (!name || name === item.name) return;
    try {
      const updated = await api(`/api/library/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      Object.assign(item, updated);
      renderStyleState();
    } catch (e) { toast(e.message); }
  }

  $('libFiles').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
  const minePanel = document.querySelector('[data-panel="mine"]');
  ['dragenter', 'dragover'].forEach((ev) => minePanel.addEventListener(ev, (e) => { e.preventDefault(); minePanel.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) => minePanel.addEventListener(ev, (e) => { e.preventDefault(); minePanel.classList.remove('dragover'); }));
  minePanel.addEventListener('drop', (e) => importFiles(e.dataTransfer.files));

  $('importUrlForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('importUrl').value.trim();
    if (!url) return;
    const btn = e.submitter;
    if (btn) btn.disabled = true;
    try {
      const added = await api('/api/library/import-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      state.library = [...added, ...state.library];
      $('importUrl').value = '';
      renderLibrary();
      toast('导入成功，点选即可试戴');
    } catch (err) { toast(err.message); } finally { if (btn) btn.disabled = false; }
  });

  $('saveLibBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!state.design) return;
    const name = prompt('给这个款式起个名字', '');
    if (name === null) return;
    try {
      const [item] = await api('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: state.design, name }) });
      state.library.unshift(item);
      renderLibrary();
      toast('已收藏到我的款式库');
    } catch (err) { toast(err.message); }
  });

  $('sampleHandBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { setImage('hand', await urlToDataUrl('/samples/hand.jpg')); } catch { toast('示例图加载失败'); }
  });

  // ---------- 灵感 tab ----------
  function selectTab(tab) {
    document.querySelectorAll('.inspo .tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    document.querySelectorAll('.inspo .tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== tab));
  }
  document.querySelectorAll('.inspo .tab').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));

  function renderChips(boxId, list, key) {
    const box = $(boxId);
    box.innerHTML = '';
    box.setAttribute('role', 'radiogroup');
    for (const item of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', state[key] === item.id);
      btn.textContent = item.name;
      if (item.hint) {
        const s = document.createElement('small');
        s.textContent = item.hint;
        btn.appendChild(s);
      }
      btn.addEventListener('click', () => { state[key] = item.id; renderChips(boxId, list, key); });
      box.appendChild(btn);
    }
  }

  function renderAllChips() {
    const c = state.config;
    renderChips('shapeChips', c.shapes, 'shape');
    renderChips('lengthChips', c.lengths, 'length');
    renderChips('finishChips', c.finishes, 'finish');
    renderChips('qualityChips', c.qualities, 'quality');
    renderChips('sizeChips', c.sizes, 'size');
  }

  function styleReady() {
    return !!(state.design || state.presetId || state.libraryId || $('extraInput').value.trim());
  }

  function updateForm() {
    let hint = '';
    if (!state.hand) hint = '先上传手部照片';
    else if (!styleReady()) hint = '再上传款式图，或在下方选一个爆款 / 我的款式';
    $('generateBtn').disabled = !!hint || state.busy;
    $('formHint').textContent = hint || (state.config?.mock ? '模拟模式：会直接返回原图，用于测试流程' : '素材已就绪');
  }
  $('extraInput').addEventListener('input', updateForm);

  // ---------- 生成 ----------
  let timer = null;
  function startLoading() {
    setStage('loading');
    const t0 = Date.now();
    let tipIdx = 0;
    $('loadingTip').textContent = LOADING_TIPS[0];
    $('elapsed').textContent = '0s';
    timer = setInterval(() => {
      const s = Math.round((Date.now() - t0) / 1000);
      $('elapsed').textContent = `${s}s`;
      if (s >= 90) $('loadingTip').textContent = '生图服务这会儿比较慢，还在等待结果…';
      else if (s > 0 && s % 8 === 0) $('loadingTip').textContent = LOADING_TIPS[++tipIdx % LOADING_TIPS.length];
    }, 1000);
    $('stageLoading').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  let genAbort = null;
  $('cancelBtn').addEventListener('click', () => genAbort && genAbort.abort());

  async function generate() {
    if (state.busy || !state.hand || !styleReady()) return;
    const payload = {
      handImage: state.hand,
      designImage: state.design || null,
      presetId: state.design ? null : state.presetId,
      libraryId: state.design ? null : state.libraryId,
      extra: $('extraInput').value.trim(),
      shape: state.shape,
      length: state.length,
      finish: state.finish,
      quality: state.quality,
      size: state.size,
    };
    state.busy = true;
    updateForm();
    startLoading();
    try {
      genAbort = new AbortController();
      const rec = await api('/api/tryon', {
        signal: genAbort.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      state.history.unshift(rec);
      renderHistory();
      renderResult(rec);
    } catch (e) {
      if (e.name === 'AbortError') { setStage('upload'); toast('已取消'); }
      else { $('errorText').textContent = e.message; setStage('error'); }
    } finally {
      genAbort = null;
      clearInterval(timer);
      state.busy = false;
      updateForm();
    }
  }

  // ---------- 结果 ----------
  function setCompare(v) {
    $('beforeWrap').style.clipPath = `inset(0 ${100 - v}% 0 0)`;
    $('compareHandle').style.left = `${v}%`;
    $('compare').classList.toggle('pristine', Number(v) === 0);
  }
  $('compareRange').addEventListener('input', (e) => setCompare(e.target.value));

  function describe(rec) {
    const c = state.config;
    const o = rec.options;
    const name = (list, id) => (list.find((x) => x.id === id) || {}).name || id;
    const parts = [o.libraryName || o.presetName || (rec.files.design ? '款式图' : '文字描述')];
    if (o.shape !== 'keep') parts.push(name(c.shapes, o.shape));
    if (o.length !== 'keep') parts.push(name(c.lengths, o.length));
    if (o.finish !== 'auto') parts.push(name(c.finishes, o.finish));
    parts.push(name(c.qualities, o.quality));
    return parts.join(' · ');
  }

  function renderResult(rec) {
    state.current = rec;
    $('afterImg').src = rec.urls.output;
    $('beforeImg').src = rec.urls.hand;
    $('compareRange').value = 0;
    setCompare(0);
    $('sideHand').src = rec.urls.hand;
    const sp = $('sidePreset');
    if (rec.urls.design) {
      $('sideDesign').src = rec.urls.design;
      $('sideDesign').hidden = false;
      sp.hidden = true;
    } else {
      $('sideDesign').hidden = true;
      const p = state.config.presets.find((x) => x.id === rec.options.presetId);
      sp.innerHTML = p ? `${nailsHtml(p.css)}<span></span>` : '<span></span>';
      sp.querySelector('span').textContent = p ? `2026 爆款 · ${p.name}` : rec.options.extra || '文字描述';
      sp.hidden = false;
    }
    $('downloadBtn').href = rec.urls.output;
    $('downloadBtn').download = `试甲-${rec.id}.png`;
    $('hdBtn').hidden = rec.options.quality === 'high';
    $('resultMeta').textContent = `${describe(rec)} · 用时 ${(rec.durationMs / 1000).toFixed(1)}s${rec.mock ? ' · 模拟结果' : ''}`;
    setStage('result');
  }

  function resetAll() {
    setImage('hand', null, { silent: true });
    setImage('design', null, { silent: true });
    state.presetId = null;
    state.libraryId = null;
    $('extraInput').value = '';
    renderStyleState();
    state.current = null;
    setStage('upload');
    updateForm();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $('generateBtn').addEventListener('click', generate);
  $('retryBtn').addEventListener('click', generate);
  $('againBtn').addEventListener('click', generate);
  $('hdBtn').addEventListener('click', () => {
    state.quality = 'high';
    renderAllChips();
    generate();
  });
  $('backBtn').addEventListener('click', () => setStage('upload'));
  $('resetBtn').addEventListener('click', resetAll);

  // ---------- 历史 ----------
  function renderHistory() {
    const grid = $('historyGrid');
    grid.innerHTML = '';
    $('historyEmpty').hidden = state.history.length > 0;
    $('historyCount').textContent = state.history.length ? `共 ${state.history.length} 张` : '';
    for (const rec of state.history) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-item';
      btn.innerHTML = '<img loading="lazy" alt="" /><span></span>';
      btn.querySelector('img').src = rec.urls.output;
      btn.querySelector('img').alt = `试甲效果 ${rec.id}`;
      btn.querySelector('span').textContent = `${new Date(rec.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${describe(rec)}`;
      btn.addEventListener('click', () => openViewer(rec));
      grid.appendChild(btn);
    }
  }

  function openViewer(rec) {
    state.viewing = rec;
    $('viewerImg').src = rec.urls.output;
    $('viewerDownload').href = rec.urls.output;
    $('viewerDownload').download = `试甲-${rec.id}.png`;
    const thumbs = $('viewerThumbs');
    thumbs.innerHTML = '';
    const add = (url, label) => {
      if (!url) return;
      const f = document.createElement('figure');
      f.innerHTML = '<img alt="" /><figcaption></figcaption>';
      f.querySelector('img').src = url;
      f.querySelector('figcaption').textContent = label;
      thumbs.appendChild(f);
    };
    add(rec.urls.hand, '手部原图');
    add(rec.urls.design, '美甲款式');
    $('viewer').showModal();
  }

  $('viewerDelete').addEventListener('click', async () => {
    const rec = state.viewing;
    if (!rec || !confirm('确定删除这条试甲记录吗？')) return;
    try {
      await api(`/api/history/${rec.id}`, { method: 'DELETE' });
      state.history = state.history.filter((h) => h.id !== rec.id);
      renderHistory();
      $('viewer').close();
      if (state.current && state.current.id === rec.id) setStage('upload');
      toast('已删除');
    } catch (e) { toast(e.message); }
  });

  // 打开历史记录：恢复素材和参数，进入完成页，可直接「重新生成」
  $('viewerReuse').addEventListener('click', async () => {
    const rec = state.viewing;
    if (!rec || state.busy) return;
    try {
      setImage('hand', await urlToDataUrl(rec.urls.hand), { silent: true });
      const libOk = rec.options.libraryId && state.library.some((l) => l.id === rec.options.libraryId);
      const presetOnly = rec.options.presetId && !libOk;
      setImage('design', !libOk && !presetOnly && rec.urls.design ? await urlToDataUrl(rec.urls.design) : null, { silent: true });
      state.presetId = presetOnly ? rec.options.presetId : null;
      state.libraryId = libOk ? rec.options.libraryId : null;
      $('extraInput').value = rec.options.extra || '';
      Object.assign(state, {
        shape: rec.options.shape, length: rec.options.length, finish: rec.options.finish,
        quality: rec.options.quality, size: rec.options.size,
      });
      renderStyleState();
      renderAllChips();
      renderResult(rec);
      $('viewer').close();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch { toast('加载素材失败'); }
  });

  // ---------- 启动 ----------
  async function init() {
    setupDrop('handDrop', 'handInput', 'hand');
    setupDrop('designDrop', 'designInput', 'design');
    setStage('upload');
    try {
      state.config = await api('/api/config');
    } catch (e) {
      toast('无法连接服务：' + e.message);
      return;
    }
    const badge = $('modelBadge');
    badge.hidden = false;
    if (state.config.mock) { badge.textContent = '模拟模式'; badge.classList.add('warn'); badge.title = '未配置 OPENAI_API_KEY'; }
    else badge.textContent = state.config.model;
    renderFilters();
    renderPresets();
    renderAllChips();
    updateForm();
    loadLibrary();
    try {
      state.history = await api('/api/history');
      renderHistory();
    } catch (e) { toast(e.message); }
  }
  init();
})();
