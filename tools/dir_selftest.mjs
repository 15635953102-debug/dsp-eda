import fs from "fs";
globalThis.window = globalThis;
// 仅做逻辑层自查：yaw → 屏幕方向（+y 向下）
const W = 1000, H = 800, S = 40;
function dirOf(yaw) {
  const a = ((yaw % 360) + 360) % 360;
  if (a < 45 || a >= 315) return { x: 0, y: 1 };
  if (a < 135) return { x: 1, y: 0 };
  if (a < 225) return { x: 0, y: -1 };
  return { x: -1, y: 0 };
}
const expect = [
  [0, 0, 1, "下"], [90, 1, 0, "右"], [180, 0, -1, "上"], [270, -1, 0, "左"]
];
let ok = true;
for (const [yaw, ex, ey, name] of expect) {
  const d = dirOf(yaw);
  const good = d.x === ex && d.y === ey;
  if (!good) ok = false;
  console.log(`yaw ${yaw} → (${d.x},${d.y}) 期望 ${name} ${good ? "OK" : "FAIL"}`);
}
console.log(ok ? "方向映射 PASS" : "方向映射 FAIL");
