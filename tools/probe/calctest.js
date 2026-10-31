globalThis.window = globalThis;
const fs = require("fs");
for (const f of ["js/data.js","js/calc.js"]) eval(fs.readFileSync("C:/Users/L/Desktop/Dysen/" + f, "utf8"));
const C = window.DSPCALC, D = window.DSP_DATA;
const names = ["处理器","硫酸","宇宙矩阵","绿糖","引力透镜","卡西米尔晶体"];
for (const n of names) {
  const it = D.items.find(x => x.name === n);
  if (!it) { console.log(n, "-> item not found"); continue; }
  const r = C.plan(it.id, 60, {});
  console.log("===" + n + " (" + it.id + ") 机器 " + r.totalMachines.toFixed(2) + " 电力 " + r.power.toFixed(2) + "MW");
  r.rows.forEach(row => console.log("   " + row.recipe.name.padEnd(18) + (row.machine ? row.machine.name : "-").padEnd(14) + row.machines.toFixed(2)));
  console.log("   原料:", r.raw.map(x => C.itemName(x.itemId) + " " + x.rate.toFixed(1)).join(", "));
}
