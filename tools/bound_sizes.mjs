// 用真实蓝图推导每个建筑尺寸的“上界”：同类/异类建筑不可能重叠，故 dx<w 且 dy<h 的组合不会出现
import fs from 'fs';
import path from 'path';

globalThis.window = globalThis;
for (const f of ['js/data.js', 'js/md5.js', 'js/blueprint.js']) {
  (0, eval)(fs.readFileSync('C:/Users/L/Desktop/Dysen/' + f, 'utf8'));
}
const BP = globalThis.DSPBP;
const D = window.DSP_DATA;
const byId = new Map(D.buildings.map(b => [b.id, b]));
const isBeltOrSorter = id => id >= 2000 && id < 2020;

const dir = 'C:/Users/L/Documents/Dyson Sphere Program/Blueprint';
function walk(d, acc) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.txt') && !e.name.startsWith('_')) acc.push(p);
  }
  return acc;
}

// wBound[item] = 沿 x 方向的最小间距；hBound[item] = 沿 y 方向的最小间距
const wBound = new Map();
const hBound = new Map();
const upd = (m, id, v) => { if (!(m.get(id) <= v)) m.set(id, v); };

for (const f of walk(dir, [])) {
  if (f.indexOf('仙术') >= 0) continue;   // 仙术蓝图是刻意重叠的魔法存档，不能作为尺寸依据
  let text;
  try { text = fs.readFileSync(f, 'utf8').trim(); } catch { continue; }
  if (!text.startsWith('BLUEPRINT:')) continue;
  let p;
  try { p = BP.parse(text); await BP.parsePayload(p); } catch { continue; }
  if (p.warnings && p.warnings.skipped) continue;   // 抢救过的蓝图可能有假记录
  const pts = [];
  for (const b of p.buildings) {
    if (isBeltOrSorter(b.item)) continue;
    if (!byId.has(b.item)) continue;
    pts.push({ x: Math.floor(b.p0.x + 0.001), y: Math.floor(b.p0.y + 0.001), z: b.p0.z || 0, a: b.area || 0, id: b.item });
  }
  // 只比较近距离的点
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j];
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      if (dx > 10 || dy > 10) continue;
      if (dx === 0 && dy === 0) continue;
      if (a.a !== b.a) continue;                  // 不同区域互不占位
      if (Math.abs(a.z - b.z) > 0.6) continue;   // 不同高度互不占位
      if (dy === 0 && dx > 0) { upd(wBound, a.id, dx); upd(wBound, b.id, dx); }
      if (dx === 0 && dy > 0) { upd(hBound, a.id, dy); upd(hBound, b.id, dy); }
    }
  }
}

console.log('id    名字            当前尺寸  推导上界(w×h)');
const adjustments = [];
for (const b of D.buildings) {
  if (isBeltOrSorter(b.id)) continue;
  const wb = wBound.get(b.id), hb = hBound.get(b.id);
  if (wb === undefined && hb === undefined) continue;
  const w = Math.min(b.w, wb === undefined ? b.w : wb);
  const h = Math.min(b.h, hb === undefined ? b.h : hb);
  const flag = (w !== b.w || h !== b.h) ? '  <-- 调整' : '';
  console.log(`${b.id}  ${b.name.padEnd(14)} ${b.w}x${b.h}   ${wb ?? '-'}x${hb ?? '-'} -> ${w}x${h}${flag}`);
  if (flag) adjustments.push([b.id, b.name, w, h]);
}
console.log('\n需要下调的:', JSON.stringify(adjustments));