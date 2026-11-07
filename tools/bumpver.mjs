import fs from "fs";
let h = fs.readFileSync("index.html", "utf8");
h = h.replace(/\.js\?v=[0-9a-z]+/g, ".js?v=20261107b");
fs.writeFileSync("index.html", h);
console.log("version ->", (h.match(/v=20261107b/g) || []).length, "tags");
