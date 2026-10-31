globalThis.window = globalThis;
const fs = require("fs");
eval(fs.readFileSync("C:/Users/L/Desktop/Dysen/js/data.js", "utf8"));
const D = window.DSP_DATA;
const ore = new Set([1001,1002,1003,1004,1005,1006]);
const rows = D.recipes.filter(r => r.outs.some(o => ore.has(o[0])));
for (const r of rows) console.log(r.id, r.name, "type=" + r.type, "time=" + r.time, "factories=" + JSON.stringify(r.factories), "ins=" + JSON.stringify(r.ins));
console.log("types:", [...new Set(D.recipes.map(r => r.type))]);
