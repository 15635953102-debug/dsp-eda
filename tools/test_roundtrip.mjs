// Node 端自检：MD5F 向量 + 全量蓝图解析/重建
import fs from 'fs';
import path from 'path';

globalThis.window = globalThis;
const root = path.resolve(import.meta.dirname, '..');
for (const f of ['js/data.js', 'js/md5.js', 'js/blueprint.js']) {
  (0, eval)(fs.readFileSync(path.join(root, f), 'utf8'));
}
const BP = globalThis.DSPBP;
const MD5 = globalThis.DSPMD5;

const vec = [
  ['', '84D1CE3BD68F49AB26EB0F96416617CF'],
  ['a', 'F10BDDAECB62E5A92433757867EE06DB'],
  ['abcd', 'FA27C78B6EC31559F0E760CE3F2B03F6'],
  ['Why are you doing this, Youthcat Studio?', '13424E12890A3F50A1F8567C464FFF8C'],
];
for (const [s, want] of vec) {
  if (MD5.hash(MD5.utf8Bytes(s)) !== want) throw new Error('md5f vector fail: ' + s);
}
console.log('MD5F 向量通过');

const dir = 'C:/Users/L/Documents/Dyson Sphere Program/Blueprint';
function walk(d, acc) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.txt') && !e.name.startsWith('_')) acc.push(p);
  }
  return acc;
}

let total = 0, clean = 0, partial = 0, failed = 0, rebuilt = 0;
const problems = [];

for (const full of walk(dir, [])) {
  let text;
  try { text = fs.readFileSync(full, 'utf8').trim(); } catch { continue; }
  if (!text.startsWith('BLUEPRINT:') || text.length < 60) continue;
  total++;
  let p;
  try {
    p = BP.parse(text);
    await BP.parsePayload(p);
  } catch (e) {
    failed++;
    problems.push([path.basename(full), 'parse: ' + e.message]);
    continue;
  }
  const warn = (p.warnings && (p.warnings.skipped || p.warnings.fatal)) || (p.buildings.length !== p.declaredCount);
  if (warn) { partial++; problems.push([path.basename(full), '部分恢复 ' + warn + ' 条（共 ' + p.declaredCount + '）']); }
  else clean++;

  if (warn) continue; // 抢救过的记录无法原样重建，跳过

  const recs = p.buildings.map(b => ({
    item: b.item, model: b.model, p0: b.p0, area: b.area, yaw0: b.yaw0, yaw1: b.yaw1,
    tilt: b.tilt, tilt2: b.tilt2, pitch: b.pitch, pitch2: b.pitch2, p1: b.p1,
    outo: b.outo, ino: b.ino, s01: b.s01, s02: b.s02, s03: b.s03, s04: b.s04, s05: b.s05, s06: b.s06,
    recipe: b.recipe, filter: b.filter, params: b.params, marker: b.marker, suffix: b.suffix
  }));
  try {
    const out = await BP.build(recs, {
      version: p.meta.version, layout: p.header.layout, gameVersion: p.header.gameVersion,
      shortDesc: p.header.shortDesc, desc: p.header.desc,
      dragX: p.meta.dragX, dragY: p.meta.dragY, areas: p.areas, trailer: p.trailer
    });
    const p2 = BP.parse(out);
    await BP.parsePayload(p2);
    if (!p2.hashOk || p2.buildings.length !== p.buildings.length) throw new Error('rebuild mismatch');
    if (p2.areas.length !== p.areas.length) throw new Error('area count mismatch');
    rebuilt++;
  } catch (e) {
    failed++;
    problems.push([path.basename(full), 'rebuild: ' + e.message]);
  }
}

console.log(`蓝图 ${total} 个：完整 ${clean}，逐步抢救 ${partial}，重建一致 ${rebuilt}，失败 ${failed}`);
problems.slice(0, 10).forEach(x => console.log('   ', x[0], '->', x[1]));
if (failed) process.exitCode = 1;
