// 首页 / 成果 / 方法 / 用量 / 3D 镜头 共用：导航、页脚、接口、小工具
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

async function api(path, opts = {}) {
  const headers = { ...(opts.body ? { 'Content-Type': 'application/json' } : {}) };
  const code = store.get('accessCode', '');
  if (code) headers['x-access-code'] = code;
  const resp = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  let data = null;
  try { data = await resp.json(); } catch {}
  if (resp.status === 401) {
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
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast', class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

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

async function loadSamples() {
  try {
    const r = await fetch('/samples/credits.json', { cache: 'no-cache' });
    if (r.ok) return (await r.json()).filter((x) => x && x.file);
  } catch {}
  return [];
}

const NAV = [
  ['/', '首页', 'home'], ['/showcase.html', '成果', 'showcase'], ['/method.html', '方法', 'method'],
  ['/#pain', '痛点', ''], ['/#workflow', '流程', ''], ['/#pricing', '费用', ''], ['/#faq', 'FAQ', ''], ['/usage.html', '用量', 'usage'],
];
function renderChrome(active) {
  const nav = $('#nav');
  if (nav) {
    nav.className = 'nav';
    nav.replaceChildren(
      h('a', { class: 'skip', href: '#main' }, '跳到正文'),
      h('a', { class: 'brand', href: '/' }, h('img', { src: '/favicon.svg', alt: '' }), h('span', {}, 'AI 写真工作台', h('small', {}, 'PORTRAIT STUDIO'))),
      h('nav', { class: 'links', 'aria-label': '站内导航' }, ...NAV.map(([href, name, key]) => h('a', { href, class: key && key === active ? 'on' : '' }, name))),
      h('div', { class: 'right' },
        h('button', { class: 'icon-btn', 'data-theme-toggle': true, title: '切换深浅色', 'aria-label': '切换深浅色' }, '🌓'),
        h('a', { class: 'btn sm hide-sm' + (active === 'camera' ? ' primary' : ''), href: '/camera.html' }, '🎬 3D 镜头'),
        h('a', { class: 'btn sm' + (active === 'camera' ? '' : ' primary'), href: '/studio.html' }, '写真工作台 ', h('span', { class: 'beta' }, 'BETA'))),
    );
  }
  const foot = $('#foot');
  if (foot) {
    foot.className = 'foot';
    foot.replaceChildren(h('div', { class: 'wrap' },
      h('div', {}, `© ${new Date().getFullYear()} AI 写真工作台 · 本机运行，作品只存在你的电脑上`),
      h('nav', {}, ...[['/showcase.html', '成果'], ['/method.html', '方法'], ['/#pricing', '费用说明'], ['/#faq', 'FAQ'], ['/#workflow', '使用流程'], ['/usage.html', '用量中心'], ['/studio.html', '写真工作台'], ['/camera.html', '3D 镜头']].map(([href, n]) => h('a', { href }, n)))));
  }
}

function lightbox(src, caption) {
  let d = $('#lightbox');
  if (!d) {
    d = h('dialog', { id: 'lightbox', class: 'lightbox' });
    d.addEventListener('click', () => d.close());
    document.body.append(d);
  }
  d.replaceChildren(h('img', { src, alt: caption || '' }), caption ? h('p', {}, caption) : null);
  d.showModal();
}

const fmtDate = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
