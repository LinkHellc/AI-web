// 写真工作台的全部选项与提示词拼装。改选项只需改这里，前端会从 /api/config 读取。
'use strict';

// 拍摄模式
const MODES = [
  { id: 'mirror', name: '对镜', icon: '🪞', desc: '手机对镜自拍，镜中可见手机',
    en: 'A mirror selfie: the person stands in front of a mirror holding a smartphone, the phone and the reflection are visible, authentic smartphone photo look.' },
  { id: 'selfie', name: '自拍', icon: '🤳', desc: '前置镜头，手臂距离',
    en: 'A front-camera selfie taken at arm\'s length, slight wide-angle smartphone lens, the phone itself is not visible, natural and casual.' },
  { id: 'third', name: '他拍', icon: '📷', desc: '朋友或摄影师帮拍',
    en: 'A photo taken by a friend or photographer standing a few meters away, natural candid composition, realistic camera perspective.' },
  { id: 'dance', name: '舞蹈定格', icon: '💃', desc: '动态瞬间，发丝衣摆飞起',
    en: 'A frozen mid-dance moment captured with a fast shutter: dynamic body motion, hair and clothing in motion, crisp freeze-frame, energetic.' },
  { id: 'copy', name: 'AI 仿图', icon: '🎯', desc: '上传参考图，复刻姿势构图', needsRef: true,
    en: 'Recreate the reference photo: copy its pose, body angle, framing, camera angle, lighting and overall mood, but with the person from the identity photos.' },
];

// 动作库（批量模式下每个动作出一张）
const ACTIONS = [
  // 站姿
  { id: 'stand-relaxed', cat: '站姿', name: '自然站立', en: 'standing relaxed, weight on one leg, arms naturally down' },
  { id: 'stand-hip', cat: '站姿', name: '单手叉腰', en: 'standing with one hand on the hip, confident' },
  { id: 'stand-cross', cat: '站姿', name: '双臂交叉', en: 'standing with arms crossed, slight smile' },
  { id: 'stand-lean', cat: '站姿', name: '倚墙', en: 'leaning one shoulder against a wall, legs crossed at the ankles' },
  { id: 'stand-back', cat: '站姿', name: '回眸', en: 'back turned to the camera, looking back over the shoulder' },
  { id: 'stand-pocket', cat: '站姿', name: '插兜', en: 'standing with hands in pockets, cool and casual' },
  { id: 'stand-side', cat: '站姿', name: '侧身', en: 'body turned sideways, face turned toward the camera' },
  { id: 'stand-hair', cat: '站姿', name: '撩头发', en: 'standing and lightly tucking hair behind the ear' },
  // 坐姿
  { id: 'sit-chair', cat: '坐姿', name: '椅子上', en: 'sitting on a chair, legs crossed, hands on the knee' },
  { id: 'sit-floor', cat: '坐姿', name: '席地而坐', en: 'sitting on the floor with knees up, arms around the knees' },
  { id: 'sit-steps', cat: '坐姿', name: '台阶', en: 'sitting on steps, leaning forward, elbows on knees' },
  { id: 'sit-chin', cat: '坐姿', name: '托腮', en: 'sitting at a table, chin resting on one hand' },
  { id: 'sit-sofa', cat: '坐姿', name: '沙发慵懒', en: 'lounging on a sofa, relaxed and cozy' },
  { id: 'sit-edge', cat: '坐姿', name: '坐边沿', en: 'sitting on a ledge with legs dangling' },
  // 走动
  { id: 'walk-toward', cat: '走动', name: '迎面走来', en: 'walking toward the camera mid-stride' },
  { id: 'walk-away', cat: '走动', name: '背影走远', en: 'walking away from the camera, slight glance back' },
  { id: 'walk-cross', cat: '走动', name: '过马路', en: 'crossing the street mid-stride, candid street style' },
  { id: 'walk-spin', cat: '走动', name: '转圈', en: 'spinning around with the skirt or coat flaring out' },
  { id: 'walk-jump', cat: '走动', name: '跳起', en: 'jumping in the air joyfully' },
  // 手势
  { id: 'hand-peace', cat: '手势', name: '比耶', en: 'making a peace sign near the face, playful' },
  { id: 'hand-heart', cat: '手势', name: '比心', en: 'making a finger heart gesture' },
  { id: 'hand-cover', cat: '手势', name: '捂嘴笑', en: 'laughing with one hand covering the mouth' },
  { id: 'hand-frame', cat: '手势', name: '手框脸', en: 'framing the face with both hands' },
  { id: 'hand-wave', cat: '手势', name: '挥手', en: 'waving at the camera with a bright smile' },
  { id: 'hand-sun', cat: '手势', name: '遮阳', en: 'shading the eyes from the sun with one hand' },
  // 特写
  { id: 'close-smile', cat: '特写', name: '微笑特写', en: 'head-and-shoulders close-up, soft natural smile' },
  { id: 'close-look', cat: '特写', name: '看向远方', en: 'close-up, gazing into the distance, thoughtful' },
  { id: 'close-down', cat: '特写', name: '低头浅笑', en: 'close-up, looking down with a shy smile' },
  { id: 'close-wink', cat: '特写', name: '眨眼', en: 'close-up, winking playfully' },
  { id: 'close-pout', cat: '特写', name: '嘟嘴', en: 'close-up, cute pout' },
  // 道具
  { id: 'prop-coffee', cat: '道具', name: '捧咖啡', en: 'holding a coffee cup with both hands' },
  { id: 'prop-flower', cat: '道具', name: '抱花束', en: 'holding a bouquet of flowers' },
  { id: 'prop-bag', cat: '道具', name: '拎包', en: 'holding a handbag, fashion pose' },
  { id: 'prop-phone', cat: '道具', name: '看手机', en: 'looking down at a phone, candid' },
  { id: 'prop-book', cat: '道具', name: '看书', en: 'reading a book' },
  { id: 'prop-hat', cat: '道具', name: '扶帽子', en: 'holding the brim of a hat' },
  { id: 'prop-glasses', cat: '道具', name: '推墨镜', en: 'pushing sunglasses down the nose' },
  // 躺/倚
  { id: 'lie-grass', cat: '躺倚', name: '躺草地', en: 'lying on the grass, shot from above' },
  { id: 'lie-bed', cat: '躺倚', name: '趴床上', en: 'lying on the stomach on a bed, chin on hands, feet up' },
  { id: 'lean-rail', cat: '躺倚', name: '靠栏杆', en: 'leaning on a railing, relaxed' },
  // 绅士（男士向，也适合中性穿搭）
  { id: 'gent-cuff', cat: '绅士', name: '整理袖口', en: 'adjusting the shirt cuff with one hand, refined and composed' },
  { id: 'gent-tie', cat: '绅士', name: '调领带', en: 'adjusting the tie knot, looking slightly off camera' },
  { id: 'gent-watch', cat: '绅士', name: '看腕表', en: 'glancing at the wristwatch, wrist raised to show the watch' },
  { id: 'gent-jacket', cat: '绅士', name: '肩搭外套', en: 'holding a jacket slung over one shoulder' },
  { id: 'gent-button', cat: '绅士', name: '扣西装扣', en: 'buttoning the suit jacket while walking' },
  { id: 'gent-car', cat: '绅士', name: '倚靠跑车', en: 'leaning casually against a luxury car' },
  { id: 'gent-brief', cat: '绅士', name: '拎公文包', en: 'walking confidently while carrying a leather briefcase' },
  { id: 'gent-chair', cat: '绅士', name: '翘腿而坐', en: 'sitting in an armchair with one ankle resting on the other knee, relaxed and confident' },
  // 舞蹈
  { id: 'dance-arms', cat: '舞蹈', name: '展臂', en: 'dance move with both arms extended gracefully' },
  { id: 'dance-kick', cat: '舞蹈', name: '踢腿', en: 'dance move with a high kick' },
  { id: 'dance-twirl', cat: '舞蹈', name: '旋转', en: 'twirling dance move, hair flying' },
  { id: 'dance-pop', cat: '舞蹈', name: '街舞定格', en: 'hip-hop freeze pose, street dance attitude' },
];

// 场景风格模板
const STYLES = [
  { id: 'keep', name: '保持原背景', swatch: 'linear-gradient(135deg,#d9d4ce,#b8b0a8)', en: '' },
  { id: 'japanese', name: '日系清新', swatch: 'linear-gradient(135deg,#f6efe3,#cfe3e8)', en: 'Japanese fresh style: soft daylight, airy pastel tones, slightly overexposed, clean and gentle.' },
  { id: 'korean', name: '韩系棚拍', swatch: 'linear-gradient(135deg,#f3e6ea,#e7e0f2)', en: 'Korean studio portrait: seamless pastel backdrop, soft beauty lighting, polished and elegant.' },
  { id: 'film', name: '胶片街拍', swatch: 'linear-gradient(135deg,#c9a36a,#6d5d4b)', en: 'Film street photography: 35mm Kodak Portra film look, fine grain, warm tones, city street background.' },
  { id: 'cafe', name: '咖啡馆', swatch: 'linear-gradient(135deg,#a77b5a,#e8d5c0)', en: 'Inside a cozy café with warm window light, wooden tables, shallow depth of field.' },
  { id: 'beach', name: '海边日落', swatch: 'linear-gradient(135deg,#f6a96b,#6aa5c9)', en: 'At the beach during golden hour sunset, warm backlight, ocean in the background, gentle breeze.' },
  { id: 'neon', name: '城市夜景', swatch: 'linear-gradient(135deg,#2a1f4f,#e0457b)', en: 'City night scene with neon signs and bokeh lights, cinematic color grading.' },
  { id: 'ecom', name: '白底电商', swatch: 'linear-gradient(135deg,#ffffff,#e9e9e9)', en: 'Clean e-commerce product shot: pure white seamless background, even soft studio lighting, the outfit clearly visible and true to color.' },
  { id: 'forest', name: '森系户外', swatch: 'linear-gradient(135deg,#9bbf8a,#4f6f4a)', en: 'Outdoors in a sunlit forest, dappled light through leaves, natural greens.' },
  { id: 'hk', name: '复古港风', swatch: 'linear-gradient(135deg,#7a2e2e,#d9a441)', en: 'Retro 1990s Hong Kong film style: saturated reds and greens, tungsten light, nostalgic movie still.' },
  { id: 'campus', name: '校园', swatch: 'linear-gradient(135deg,#cfe0f5,#f2efe0)', en: 'On a sunny university campus with trees and classic buildings, youthful and fresh.' },
  { id: 'oldmoney', name: '老钱风', swatch: 'linear-gradient(135deg,#d8cdb6,#4e5b46)', en: 'Quiet-luxury "old money" aesthetic: country estate or yacht club setting, soft natural light, muted earth tones, understated elegance.' },
  { id: 'business', name: '商务大片', swatch: 'linear-gradient(135deg,#2b2f36,#8a8f98)', en: 'High-end business editorial: modern glass office or skyline view, cool controlled lighting, crisp and authoritative, magazine cover quality.' },
  { id: 'club', name: '绅士会所', swatch: 'linear-gradient(135deg,#3b2418,#a1673b)', en: 'Private gentlemen\'s club interior: leather armchairs, dark wood paneling, warm lamp light, rich and moody.' },
  { id: 'home', name: '居家生活', swatch: 'linear-gradient(135deg,#efe3d3,#c9b8a3)', en: 'In a bright, tidy modern apartment with natural window light, lifestyle photo.' },
];

// 渲染锁定：开 = 与参考照保持一致
const LOCKS = [
  { id: 'face', name: '脸部', on: 'Keep the face exactly the same as the identity photos: same facial features, face shape, skin tone, hairstyle and makeup. Do not beautify into a different person.' },
  { id: 'body', name: '体型', on: 'Keep the same body shape, height proportions and build as the identity photos.' },
  { id: 'outfit', name: '服装', on: 'Keep the same clothing as worn in the identity photos.' },
  { id: 'env', name: '环境', on: 'Keep the same environment/background as the first identity photo.' },
  { id: 'props', name: '道具', on: 'Keep any accessories and props from the identity photos (bags, jewelry, glasses).' },
];

const QUALITIES = [
  { id: 'fast', name: '快速', api: 'low', hint: '约 20–40 秒' },
  { id: 'standard', name: '标准', api: 'medium', hint: '更细腻' },
  { id: 'pro', name: '专业', api: 'high', hint: '最慢，细节最好' },
];

// 比例 × 分辨率 → 接口 size。1K 为官方标准尺寸；2K/4K 是 gpt-image-2 的自定义尺寸，中转不支持时自动降回 1K
const RATIOS = [
  { id: '2:3', name: '竖 2:3', sizes: { '1K': '1024x1536', '2K': '1344x2016', '4K': '2336x3504' } },
  { id: '1:1', name: '方 1:1', sizes: { '1K': '1024x1024', '2K': '2048x2048', '4K': '2880x2880' } },
  { id: '3:2', name: '横 3:2', sizes: { '1K': '1536x1024', '2K': '2016x1344', '4K': '3504x2336' } },
];
const RESOLUTIONS = ['1K', '2K', '4K'];

// 镜头：水平方位角 / 俯仰角 / 距离 → 文字描述
function describeCamera(cam) {
  if (!cam || cam.auto !== false) return '';
  const az = ((Number(cam.azimuth) || 0) % 360 + 540) % 360 - 180; // -180..180
  const el = Math.max(-30, Math.min(75, Number(cam.elevation) || 0));
  const d = Math.max(0.5, Math.min(8, Number(cam.distance) || 2.5));
  const a = Math.abs(az);
  const side = az < 0 ? 'left' : 'right';
  let view;
  if (a <= 15) view = 'from the front, facing the camera';
  else if (a <= 60) view = `from a three-quarter angle on the subject\'s ${side} side`;
  else if (a <= 120) view = `from the subject\'s ${side} side in profile`;
  else if (a <= 165) view = `from behind on the ${side}, three-quarter back view`;
  else view = 'from directly behind';
  let height;
  if (el <= -15) height = 'low angle looking up at the subject';
  else if (el < 10) height = 'at eye level';
  else if (el < 35) height = 'slightly high angle looking down';
  else if (el < 60) height = 'high angle looking down';
  else height = 'top-down bird\'s-eye view';
  let shot;
  if (d < 1.2) shot = 'tight close-up (face and shoulders)';
  else if (d < 2.2) shot = 'medium shot (waist up)';
  else if (d < 3.5) shot = 'three-quarter shot (knees up)';
  else if (d < 5.5) shot = 'full-body shot';
  else shot = 'wide shot, the person small in the environment';
  return `Camera: ${shot}, ${height}, ${view} (azimuth ${Math.round(az)}°, elevation ${Math.round(el)}°, distance ${d.toFixed(1)} m).`;
}

// 3D 镜头页：对一张已有照片换机位重拍
const SUBJECTS = [
  { id: 'person', name: '人物', icon: '👤', en: 'the person as a whole' },
  { id: 'scene', name: '场景', icon: '🏞', en: 'the environment, with the person smaller in frame' },
  { id: 'top', name: '上衣', icon: '👕', en: 'the upper-body garment' },
  { id: 'bottom', name: '裤裙', icon: '👖', en: 'the pants or skirt' },
  { id: 'shoes', name: '鞋子', icon: '👟', en: 'the shoes' },
  { id: 'jewelry', name: '首饰包袋', icon: '💍', en: 'the jewelry and bag' },
];

function buildAnglePrompt({ camera, subject, extra }) {
  const L = [
    'Image 1 is the source photo. Re-photograph the exact same moment from a new camera position, as if a second camera was in the same place at the same time.',
    'Keep everything identical: the same person (face, hairstyle, body), the same outfit and accessories with all details, the same location, lighting, time of day and color grading. Only the viewpoint changes; infer hidden parts plausibly and consistently.',
  ];
  const cam = describeCamera({ ...(camera || {}), auto: false });
  if (cam) L.push(cam);
  if (subject) L.push(`Frame the shot around ${subject.en}.`);
  if (extra) L.push(`Additional request: ${extra}`);
  L.push('Photorealistic, natural perspective and lens distortion for that camera position, no text, no watermark.');
  return L.join('\n');
}

function buildPrompt({ mode, action, style, locks, camera, idCount, garmentCount, hasRef, extra, variant, gender }) {
  const L = [];
  let n = 1;
  const idRange = idCount > 1 ? `Images ${n}–${n + idCount - 1}` : `Image ${n}`;
  n += idCount;
  const who = gender === 'male' ? 'man' : gender === 'female' ? 'woman' : 'person';
  L.push(`Create a photorealistic photo of the same ${who} shown in ${idRange} (identity reference). The result must look like a real photo of this exact ${who}, not a lookalike.`);
  if (garmentCount > 0) {
    const gRange = garmentCount > 1 ? `Images ${n}–${n + garmentCount - 1}` : `Image ${n}`;
    n += garmentCount;
    L.push(`Dress the person in the clothing shown in ${gRange}: reproduce each garment faithfully (color, fabric, pattern, cut, logos, details) and combine them into one natural outfit that fits the body realistically.`);
  }
  if (hasRef) L.push(`Image ${n} is the pose/composition reference.`);
  L.push(mode.en);
  if (action && mode.id !== 'copy') L.push(`Pose: ${action.en}.`);
  if (style && style.en) L.push(style.en);
  for (const lk of LOCKS) {
    if (lk.id === 'outfit' && garmentCount > 0) continue; // 上传了服装就以服装图为准
    if (lk.id === 'env' && style && style.en) continue; // 选了场景风格就以风格为准
    if (locks.includes(lk.id)) L.push(lk.on);
  }
  const cam = describeCamera(camera);
  if (cam) L.push(cam);
  if (extra) L.push(`Additional request: ${extra}`);
  L.push('Natural skin texture, realistic hands with five fingers, correct anatomy, no text, no watermark, no extra people.');
  if (variant > 1) L.push(`Variation #${variant}: vary the moment and expression slightly.`);
  return L.join('\n');
}

module.exports = { MODES, ACTIONS, STYLES, LOCKS, QUALITIES, RATIOS, RESOLUTIONS, SUBJECTS, describeCamera, buildPrompt, buildAnglePrompt };
