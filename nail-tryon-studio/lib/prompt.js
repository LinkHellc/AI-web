// 2026 爆款推荐：根据 2026 年小红书热门笔记关键词与时尚媒体趋势报道整理
// css 用于前端甲片预览；prompt 是给生图模型的款式描述；若 public/presets/<id>.png 存在，会同时作为款式参考图
const PRESETS = [
  { id: 'milky-jelly', name: '牛奶果冻', tag: '氛围感', desc: '豆沙粉果冻透感 + 细闪',
    css: 'linear-gradient(160deg,#f7d9d6,#e9b5b0)',
    prompt: 'translucent milky jelly gel in soft bean-paste pink, glassy and see-through, with ultra-fine shimmer suspended inside' },
  { id: 'ice-cateye', name: '冰透猫眼', tag: '氛围感', desc: '冰透渐变底 + 水光猫眼',
    css: 'radial-gradient(ellipse 30% 60% at 50% 45%,#ffffffcc,transparent),linear-gradient(180deg,#e8eef8,#b9c6e4)',
    prompt: 'icy translucent base with a soft gradient and a watery magnetic cat-eye light band, cool silver-blue shimmer, glass-like' },
  { id: 'starlight-cateye', name: '微醺星芒猫眼', tag: '氛围感', desc: '玫瑰酒色星芒光带',
    css: 'radial-gradient(ellipse 25% 70% at 45% 40%,#ffd9e6,transparent),linear-gradient(180deg,#b05a7a,#5d2140)',
    prompt: 'rosy wine-colored magnetic cat-eye with a sparkling starburst light band, deep berry edges, tipsy glow' },
  { id: 'choco-cherry', name: '巧克力樱桃', tag: '秋冬显白', desc: '深棕红亮面，2026 大热色',
    css: 'linear-gradient(160deg,#6b2a2a,#3d1414)',
    prompt: 'glossy chocolate-cherry polish, a deep brown-red, rich and opaque with a high-shine top coat' },
  { id: 'latte-brown', name: '奶咖焦糖', tag: '通勤', desc: '大地色奶咖，低调高级',
    css: 'linear-gradient(160deg,#c9a184,#8a5d42)',
    prompt: 'creamy latte-caramel brown solid polish, earthy and elegant, glossy finish' },
  { id: 'milky-french', name: '牛奶法式', tag: '通勤', desc: '奶白底 + 柔白边',
    css: 'linear-gradient(180deg,#f6e8e2 62%,#fffdf9 63%)',
    prompt: 'a milky French manicure: sheer milky-pink base with a soft, slightly diffused creamy white tip' },
  { id: 'thin-french', name: '红黑细线法式', tag: '极简', desc: '短甲细线，干净利落',
    css: 'linear-gradient(180deg,#f2dcd5 78%,#b3122b 79%,#b3122b 86%,#f2dcd5 87%)',
    prompt: 'micro French tips: a natural nude base with an ultra-thin red line at the tip on some nails and an ultra-thin black line on others, on short nails' },
  { id: 'pearl-3d', name: '珍珠微立体', tag: '精致', desc: '裸底 + 小珍珠 + 水滴',
    css: 'radial-gradient(circle at 50% 30%,#fff 0 9%,#e8dcd0 10%,transparent 13%),radial-gradient(circle at 35% 62%,#ffffffaa 0 6%,transparent 8%),linear-gradient(160deg,#f3dcd4,#e8c6bc)',
    prompt: 'sheer nude base with refined micro 3D art: a few tiny pearls near the cuticle and small clear raised water-droplet accents' },
  { id: 'champagne-chrome', name: '香槟镜面边', tag: '精致', desc: '裸色 + 香槟金镜面甲尖',
    css: 'linear-gradient(180deg,#ecd2c4 60%,#e6c98f 61%,#fff3d0 75%,#c9a45c 100%)',
    prompt: 'warm nude base with glazed champagne-gold chrome tips, subtle mirror shine' },
  { id: 'butter-pastel', name: '黄油奶油色', tag: '春夏', desc: '奶黄微透，温柔显白',
    css: 'linear-gradient(160deg,#fff4c9,#f6e3a1)',
    prompt: 'buttery pastel yellow, creamy and almost opaque with a glassy sheen, the natural free edge faintly visible' },
  { id: 'plumeria', name: '鸡蛋花海岛', tag: '春夏', desc: '透明底 + 鸡蛋花手绘',
    css: 'radial-gradient(circle at 50% 45%,#ffd23f 0 8%,#fff 9% 26%,transparent 27%),linear-gradient(160deg,#fdf1ec,#f7d8d0)',
    prompt: 'sheer clear-pink base with hand-painted white plumeria flowers with yellow centers on a few accent nails, tropical island vibe' },
  { id: 'candy-plaid', name: 'Y2K 糖果格纹', tag: '甜酷', desc: '果冻粉 + 格纹撞色',
    css: 'repeating-linear-gradient(0deg,#ff9cc2 0 6px,transparent 6px 14px),repeating-linear-gradient(90deg,#ff9cc2aa 0 6px,#ffe1ee 6px 14px)',
    prompt: 'Y2K candy style: pink jelly nails with a pink-and-white gingham plaid pattern on accent nails, playful and glossy' },
  { id: 'cocoa-dots', name: '粉棕波点', tag: '甜酷', desc: '热可可 + 奶油粉撞色',
    css: 'radial-gradient(circle,#7a4a35 0 18%,transparent 20%) 0 0/12px 12px,linear-gradient(160deg,#f6d6d0,#f0c6be)',
    prompt: 'creamy blush-pink base with small hot-cocoa brown polka dots, alternating with solid cocoa brown nails' },
  { id: 'doodle-flower', name: '手绘涂鸦小花', tag: '甜酷', desc: '奶白底 + 彩色小花',
    css: 'radial-gradient(circle at 30% 35%,#ff8fab 0 8%,transparent 9%),radial-gradient(circle at 68% 62%,#7ec4ff 0 8%,transparent 9%),linear-gradient(#fffaf3,#fff3e6)',
    prompt: 'cream white base with playful hand-drawn doodle flowers in pink, blue and yellow, cute and naive illustration style' },
  { id: 'blush', name: '腮红晕染', tag: '氛围感', desc: '甲面中心晕开一抹红',
    css: 'radial-gradient(ellipse 45% 40% at 50% 50%,#f07a8f,#f7c9cc 60%,#f9e3e0)',
    prompt: 'blush nails: a sheer nude base with a soft rosy-red airbrushed glow in the center of each nail, diffused edges' },
  { id: 'silver-mist', name: '银色雾感磁石', tag: '极简', desc: '低调银灰磁粉',
    css: 'radial-gradient(ellipse 50% 70% at 50% 40%,#ffffffb0,transparent),linear-gradient(160deg,#c9ccd3,#8e939c)',
    prompt: 'misty silver magnetic polish with a soft diffused shimmer, cool grey metallic, understated' },
  { id: 'peach-fig', name: '蜜桃无花果渐变', tag: '春夏', desc: '蜜桃粉晕染到无花果红',
    css: 'linear-gradient(180deg,#ffd3c2,#c2456a)',
    prompt: 'vertical ombre from peach pink at the cuticle to fig red at the tip, smooth glossy gradient' },
  { id: 'mono-line', name: '黑白极简线条', tag: '极简', desc: '低饱和底 + 利落黑线',
    css: 'linear-gradient(115deg,transparent 47%,#111 48% 52%,transparent 53%),linear-gradient(#efe6df,#e7dbd2)',
    prompt: 'minimalist nails: muted nude base with clean thin black abstract lines and one solid black accent nail' },
  { id: 'bear', name: '奶油小熊', tag: '甜酷', desc: '甜妹卡通小熊',
    css: 'radial-gradient(circle at 50% 55%,#a8784f 0 20%,transparent 21%),radial-gradient(circle at 36% 38%,#a8784f 0 8%,transparent 9%),radial-gradient(circle at 64% 38%,#a8784f 0 8%,transparent 9%),linear-gradient(#fff4ea,#ffe9da)',
    prompt: 'sweet cream base with cute small cartoon brown bear faces painted on two accent nails, the other nails solid milky beige' },
  { id: 'crystal-bling', name: '冰透碎钻', tag: '派对', desc: '冰透底 + 满钻闪',
    css: 'radial-gradient(circle,#fff 0 12%,transparent 14%) 0 0/9px 9px,linear-gradient(160deg,#ecdff5,#c9c3e6)',
    prompt: 'icy translucent base densely covered with fine crystal glitter and a few small sparkling rhinestones near the cuticle, glamorous party look' },
  { id: 'berry-velvet', name: '酒红丝绒猫眼', tag: '秋冬显白', desc: '冬日莓果丝绒光',
    css: 'radial-gradient(ellipse 35% 70% at 50% 45%,#d65a7c,transparent),linear-gradient(160deg,#6d1430,#3c0a1b)',
    prompt: 'winter-berry velvet cat-eye: deep burgundy with a soft velvety magnetic shimmer halo' },
  { id: 'baby-blue', name: '冰淇淋浅蓝', tag: '春夏', desc: '清透浅蓝，醋酸感',
    css: 'linear-gradient(160deg,#dcecff,#a9cdf2)',
    prompt: 'clear pastel baby-blue, creamy-glassy like acetate, soft and fresh' },
];

const SHAPES = [
  { id: 'keep', name: '保持原甲型', en: null },
  { id: 'round', name: '圆形', en: 'round' },
  { id: 'oval', name: '椭圆', en: 'oval' },
  { id: 'square', name: '方形', en: 'square' },
  { id: 'squoval', name: '方圆', en: 'squoval (square with softly rounded corners)' },
  { id: 'almond', name: '杏仁', en: 'almond' },
  { id: 'coffin', name: '芭蕾/棺材', en: 'coffin (ballerina)' },
  { id: 'stiletto', name: '尖形', en: 'stiletto' },
];

const LENGTHS = [
  { id: 'keep', name: '保持原长度', en: null },
  { id: 'short', name: '短', en: 'short, just past the fingertip' },
  { id: 'medium', name: '中长', en: 'medium length' },
  { id: 'long', name: '长', en: 'long extensions' },
];

const FINISHES = [
  { id: 'auto', name: '跟随款式', en: null },
  { id: 'glossy', name: '亮面', en: 'high-gloss gel finish' },
  { id: 'matte', name: '磨砂哑光', en: 'velvety matte finish' },
  { id: 'chrome', name: '镜面', en: 'mirror chrome finish' },
];

// 画质对应 gpt-image 的 quality 参数
const QUALITIES = [
  { id: 'low', name: '快速', hint: '默认，适合挑款', api: 'low' },
  { id: 'medium', name: '标准', hint: '较慢', api: 'medium' },
  { id: 'high', name: '精细', hint: '最慢，细节最好', api: 'high' },
];

const SIZES = [
  { id: 'auto', name: '跟随原图', api: 'auto' },
  { id: 'square', name: '1:1', api: '1024x1024' },
  { id: 'portrait', name: '竖图 2:3', api: '1024x1536' },
  { id: 'landscape', name: '横图 3:2', api: '1536x1024' },
];

function buildPrompt({ hasDesign, preset, shape, length, finish, extra }) {
  const lines = [];
  if (hasDesign) {
    lines.push(
      'Image 1 is a real photo of a hand. Image 2 is a nail art design reference.',
      'Edit image 1 so that every visible fingernail wears the nail design shown in image 2: reproduce its colors, patterns, decorations, gems and finish faithfully, adapting the pattern to each nail\'s size, curvature and perspective. Ignore the hand, skin and background in image 2; take only the nail design from it.'
    );
    if (preset) lines.push(`The design is: ${preset.prompt}.`);
  } else {
    lines.push(
      'The image is a real photo of a hand.',
      `Edit it so that every visible fingernail wears ${preset ? preset.prompt : 'the nail design described below'}.`
    );
  }
  if (extra) lines.push(`Additional request from the customer (may be in Chinese): ${extra}`);
  if (shape.en) lines.push(`Nail shape: ${shape.en}.`);
  if (length.en) lines.push(`Nail length: ${length.en}.`);
  if (finish.en) lines.push(`Finish: ${finish.en}.`);
  if (!shape.en) lines.push('Keep every nail\'s original shape exactly; do not reshape the nails.');
  if (!length.en) lines.push('Keep every nail\'s original length exactly; do not lengthen, extend or add tips to the nails.');
  lines.push(
    'Keep everything else identical to image 1: the same hand, pose, finger positions, skin tone, skin texture, wrinkles, knuckles, jewelry, sleeves, background, lighting, camera angle and framing. Only the nails change.',
    'Strict constraints: do NOT beautify or slim the fingers, do NOT smooth, retouch or whiten the skin, do NOT change the hand shape or gesture; preserve every original skin detail, pore, crease, vein and blemish exactly.',
    'Photorealistic salon-quality result: clean cuticle lines, no polish on the skin, natural specular highlights that match the scene lighting, correct hand anatomy with exactly the same number of fingers. Do not add text or watermarks.'
  );
  return lines.join('\n');
}

module.exports = { PRESETS, SHAPES, LENGTHS, FINISHES, QUALITIES, SIZES, buildPrompt };
