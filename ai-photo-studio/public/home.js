// 首页：导航、统计、流程 tabs、作品墙
'use strict';
renderChrome('home');

const TAGS = ['AI 写真', '商拍换装', '对镜自拍', '他拍视角', '舞蹈定格', 'AI 仿图', '姿势复刻', '批量出图', '奢侈品穿搭', '场景风格', '3D 换机位', '脸部锁定', '白底电商', '胶片街拍', '内容创作', '副业接单'];
$('#ticker').replaceChildren(...[...TAGS, ...TAGS].map((t) => h('span', {}, t)));

const FLOWS = {
  电商卖家: [
    ['上传单品与模特', '把外套、连衣裙、包和鞋的商品图放进服装位，再存一位固定模特。', 'OUTFIT + IDENTITY'],
    ['选白底电商或场景风格', '主图用「白底电商」，详情页换「咖啡馆」「城市夜景」，画质选标准或专业。', 'STYLE / QUALITY'],
    ['同一模特批量上新', '换下一件单品继续生成，模特不变，整店图片风格统一。', 'BATCH'],
  ],
  内容账号: [
    ['建好你的人设', '存 2–3 张你自己的清晰照片作为模特，锁定脸部和体型。', 'IDENTITY LOCK'],
    ['选模式和一组动作', '对镜、自拍或他拍，打开批量模式勾 6–12 个动作，一次出一周的图。', 'MODE × ACTIONS'],
    ['用仿图追热点', '看到爆款构图，上传为参考图用「AI 仿图」复刻，再用 3D 镜头补几个机位。', 'COPY / CAMERA'],
  ],
  摄影工作室: [
    ['客片变模特资产', '客户选片后存成模特，后续加片不用再约棚。', 'ASSET'],
    ['给客户出样片', '同一人套用不同风格模板，快速出几套方向让客户选。', 'STYLE BOARD'],
    ['补角度、补动作', '原片角度不够就用 3D 镜头换机位，动作不满意就换动作重拍。', 'RE-SHOOT'],
  ],
};
let flow = '电商卖家';
function renderFlow() {
  $('#wfTabs').replaceChildren(...Object.keys(FLOWS).map((k) => h('button', { role: 'tab', class: k === flow ? 'on' : '', 'aria-selected': String(k === flow), onclick: () => { flow = k; renderFlow(); } }, k)));
  $('#wfSteps').replaceChildren(...FLOWS[flow].map(([t, d, tag], i) => h('div', { class: 'card' }, h('div', { class: 'num' }, String(i + 1).padStart(2, '0')), h('h3', { class: 'h3' }, t), h('p', {}, d), h('span', { class: 'tag' }, tag))));
}
renderFlow();

(async function () {
  const [cfg, history, samples] = await Promise.all([
    api('/api/config').catch(() => null),
    api('/api/history').catch(() => []),
    loadSamples(),
  ]);
  if (cfg) {
    const s = $$('#stats b');
    s[0].textContent = cfg.styles.length;
    s[1].textContent = cfg.modes.length + ' 种';
    s[2].textContent = cfg.actions.length;
  }
  $$('#stats b')[4].textContent = history.length;

  // 右侧拼贴：优先用自己的作品，没有就用示例素材
  const outs = history.filter((r) => !r.mock).slice(0, 4).map((r) => ({ src: r.urls.output, cap: r.options.actionName || r.options.modeName }));
  const pick = (kind) => samples.find((x) => x.kind === kind);
  const fallback = [pick('person'), pick('pose'), pick('garment'), pick('bag')].filter(Boolean).map((x) => ({ src: '/samples/' + x.file, cap: x.label }));
  const tiles = [...outs, ...fallback].slice(0, 4);
  $('#collage').replaceChildren(...tiles.map((t, i) => h('figure', { class: 'c' + (i + 1) }, h('img', { src: t.src, alt: '' }), h('figcaption', {}, t.cap || ''))));

  // 作品墙
  const works = history.slice(0, 6);
  if (works.length) {
    $('#worksGrid').replaceChildren(...works.map((r) => h('figure', { class: 'work' },
      h('img', { src: r.urls.output, alt: r.options.actionName || '', loading: 'lazy', onclick: () => lightbox(r.urls.output, `${r.personName || ''} · ${r.options.modeName} · ${r.options.styleName}`) }),
      h('figcaption', {}, h('small', {}, r.options.modeName + (r.mock ? ' · 模拟' : '')), r.options.actionName || r.options.styleName))));
  } else if (samples.length) {
    $('#worksGrid').replaceChildren(...samples.slice(0, 6).map((x) => h('figure', { class: 'work' },
      h('img', { src: '/samples/' + x.file, alt: x.label || '', loading: 'lazy' }),
      h('figcaption', {}, h('small', {}, '示例素材 · ' + ({ person: '模特', garment: '服装', bag: '包袋', shoes: '鞋履', pose: '参考' }[x.kind] || x.kind)), x.label))));
  } else {
    $('#worksGrid').replaceChildren(h('div', { class: 'empty', style: 'grid-column:1/-1' }, '还没有作品。去写真工作台生成第一张吧。'));
  }
})();
