// 用真实蓝图校验建筑占地是否过大：把每个建筑按 w×h 展开成格子，看是否与别的建筑冲突
import fs from 'fs';
import path from 'path';

globalThis.window = globalThis;
for (const f of ['js/data.js', 'js/md5.js', 'js/blueprint.js']) {
  (0, eval)(fs.readFileSync('./' + f, 'utf8'));
}
const BP = globalThis.DSPBP;
const D = window.DSP_DATA;
const byId = new Map(D.buildings.map(b => [b.id, b]));

const dir = 'C:/Users/L/Documents/Dyson Sphere Program/Blueprint';
function walk(d, acc) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.txt') && !e.name.startsWith('_')) acc.push(p);
  }
  return acc;
}

const overlaps = new Map();   // itemId -> count
const pairCount = new Map();  // "a-b" -> count
let files = 0, withOverlap = 0;

for (const f of walk(dir, [])) {
  let text;
  try { text = fs.readFileSync(f, 'utf8').trim(); } catch { continue; }
  if (!text.startsWith('BLUEPRINT:')) continue;
  let p;
  try {
    p = BP.parse(text);
    await BP.parsePayload(p);
  } catch { continue; }
  files++;
  const grid = new Map();
  let bad = false;
  for (const b of p.buildings) {
    // 传送带/分拣器不参与占位校验（爪子本来就压在机器与带子的边界上）
    if (b.item >= 2000 && b.item < 2020) continue;
    const def = byId.get(b.item);
    const w = def ? def.w : 1, h = def ? def.h : 1;
    const rot = Math.abs((b.yaw0 || 0) % 180) > 1;
    const bw = rot ? h : w, bh = rot ? w : h;
    // 蓝图坐标是浮点，取 floor 作为格子左下角（传送带/分拣器经常落在 .5 上）
    const x0 = Math.floor(b.p0.x + 0.001), y0 = Math.floor(b.p0.y + 0.001);
    for (let x = x0; x < x0 + bw; x++) {
      for (let y = y0; y < y0 + bh; y++) {
        const k = x + ',' + y;
        const other = grid.get(k);
        if (other !== undefined && other !== b.item) {
          bad = true;
          pairCount.set(other + '-' + b.item, (pairCount.get(other + '-' + b.item) || 0) + 1);
        } else if (other === undefined) {
          grid.set(k, b.item);
        } else if (other === b.item) {
          // 同类重叠（叠放/浮空），忽略
          bad = bad || false;
        }
      }
    }
    if (!def) overlaps.set(b.item, (overlaps.get(b.item) || 0) + 1);
  }
  if (bad) withOverlap++;
}

console.log(`蓝图 ${files} 个，出现跨类占位冲突的 ${withOverlap} 个`);
console.log('未知建筑 id:', [...overlaps.keys()].slice(0, 20));
const top = [...pairCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
for (const [k, v] of top) {
  const [a, b] = k.split('-').map(Number);
  const na = byId.get(a)?.name || a, nb = byId.get(b)?.name || b;
  console.log(`  ${na}(${a}) × ${nb}(${b}) : ${v}`);
}