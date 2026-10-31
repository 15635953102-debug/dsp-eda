// 生成一个小样例蓝图，供浏览器端测试使用
import fs from 'fs';
globalThis.window = globalThis;
const root = 'C:/Users/L/Desktop/Dysen';
for (const f of ['js/data.js', 'js/md5.js', 'js/blueprint.js']) {
  (0, eval)(fs.readFileSync(root + '/' + f, 'utf8'));
}
const BP = globalThis.DSPBP;

const recs = [
  { item: 2303, model: 65, p0: { x: 3, y: 0, z: 3 }, yaw0: 0, recipe: 1, params: [0], marker: -101 },
  { item: 2303, model: 65, p0: { x: 7, y: 0, z: 3 }, yaw0: 0, recipe: 1, params: [0], marker: -101 },
  { item: 2302, model: 62, p0: { x: 11, y: 0, z: 3 }, yaw0: 90, recipe: 1, params: [0], marker: -101 },
  { item: 2003, model: 37, p0: { x: 3, y: 0, z: 7 }, yaw0: 270, tilt: 0, params: [], marker: -102, extra4: 0 }
];
const str = await BP.build(recs, {
  version: 2, layout: 10, gameVersion: '0.10.34.28529',
  shortDesc: '浏览器测试', desc: '', dragX: 20, dragY: 20, trailer: [1, 0, 0, 0, 0]
});
fs.writeFileSync(root + '/tools/sample_bp.js', 'window.SAMPLE_BP = ' + JSON.stringify(str) + ';\n', 'utf8');
console.log('len', str.length);
console.log(str.slice(0, 80) + '...' + str.slice(-36));
