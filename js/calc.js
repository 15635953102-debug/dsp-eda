// 配平计算：配方链路 / 机器数量 / 原料与电力
(function (global) {
  'use strict';

  var D = global.DSP_DATA;
  var itemsById = {};
  var recipesById = {};
  var buildingsById = {};
  var recipesByOut = {};

  D.items.forEach(function (it) { itemsById[it.id] = it; });
  D.buildings.forEach(function (b) { buildingsById[b.id] = b; });
  D.recipes.forEach(function (r) {
    recipesById[r.id] = r;
    r.outs.forEach(function (o) {
      (recipesByOut[o[0]] = recipesByOut[o[0]] || []).push(r);
    });
  });

  function itemName(id) {
    var it = itemsById[id];
    return it ? it.name : ('物品#' + id);
  }

  // 每分钟产量：count * 3600 / time(ticks) * 机器倍率  （60 tick = 1 秒）
  function rateOf(recipe, count, machineSpeed) {
    return count * 3600 / recipe.time * (machineSpeed || 1);
  }

  function machineCandidates(recipe) {
    return (recipe.factories || []).map(function (id) { return buildingsById[id]; })
      .filter(function (b) { return b && b.speed > 0; });
  }

  function bestMachine(recipe) {
    var list = machineCandidates(recipe);
    if (!list.length) return null;
    return list.reduce(function (a, b) { return b.speed > a.speed ? b : a; });
  }

  function machineFor(recipe, preferId) {
    if (preferId && buildingsById[preferId]) return buildingsById[preferId];
    return bestMachine(recipe);
  }

  // 视为原始资源（不再展开）的物品名
  var RAW_NAMES = {
    '铁矿': 1, '铜矿': 1, '硅石': 1, '钛石': 1, '石矿': 1, '煤矿': 1, '原油': 1, '水': 1,
    '可燃冰': 1, '金伯利矿石': 1, '分形硅石': 1, '光栅石': 1, '刺笋结晶': 1, '单极磁石': 1,
    '临界光子': 1
  };
  var rawItemIds = {};
  D.items.forEach(function (it) { if (RAW_NAMES[it.name]) rawItemIds[it.id] = 1; });

  function isRaw(itemId) {
    if (rawItemIds[itemId]) return true;
    var producers = recipesByOut[itemId] || [];
    for (var i = 0; i < producers.length; i++) {
      if (producers[i].type !== -1) return false;
    }
    return true;
  }

  // 递归展开：目标物品 + 目标速率(每分钟)
  function plan(targetItemId, perMin, opts) {
    opts = opts || {};
    var rows = [];
    var rawMap = {};
    var byRecipe = {};
    var depthLimit = 40;

    function walk(itemId, rate, depth) {
      if (depth > depthLimit) return;
      if (isRaw(itemId)) {
        rawMap[itemId] = (rawMap[itemId] || 0) + rate;
        return;
      }
      var producers = recipesByOut[itemId] || [];
      // 只考虑主产物为该物品的配方；type=-1 的采矿类配方视为原始资源
      var recipe = null;
      for (var i = 0; i < producers.length; i++) {
        var r = producers[i];
        if (r.type === -1) continue;
        for (var k = 0; k < r.outs.length; k++) if (r.outs[k][0] === itemId) { recipe = r; break; }
        if (recipe) break;
      }
      if (!recipe || rate <= 1e-9) {
        rawMap[itemId] = (rawMap[itemId] || 0) + rate;
        return;
      }
      var machine = machineFor(recipe, opts.machinePerRecipe && opts.machinePerRecipe[recipe.id]);
      var speed = machine ? machine.speed : 1;
      var mainOut = 1;
      recipe.outs.forEach(function (o) { if (o[0] === itemId) mainOut = o[1]; });
      var perMachine = rateOf(recipe, mainOut, speed); // 每分钟产量
      var machines = perMachine > 0 ? rate / perMachine : 0;

      var row = byRecipe[recipe.id] || (function () {
        var rr = {
          itemId: itemId,
          recipe: recipe,
          machine: machine,
          machines: 0,
          rate: 0,
          ins: recipe.ins.map(function (x) { return { itemId: x[0], rate: 0 }; })
        };
        byRecipe[recipe.id] = rr;
        rows.push(rr);
        return rr;
      })();
      row.machines += machines;

      recipe.ins.forEach(function (inp) {
        var inRate = rateOf(recipe, inp[1], speed) * machines;
        var slot = row.ins.filter(function (x) { return x.itemId === inp[0]; })[0];
        if (slot) slot.rate += inRate;
        walk(inp[0], inRate, depth + 1);
      });
    }

    walk(targetItemId, perMin, 0);

    var power = 0;
    rows.forEach(function (r) {
      if (r.machine) power += r.machines * (r.machine.power || 0);
    });

    var raw = Object.keys(rawMap).map(function (id) {
      return { itemId: +id, rate: rawMap[id] };
    }).sort(function (a, b) { return b.rate - a.rate; });

    return {
      rows: rows,
      raw: raw,
      power: power,
      totalMachines: rows.reduce(function (s, r) { return s + r.machines; }, 0)
    };
  }

  // 已摆放机器的统计
  function layoutStats(buildings) {
    var unassigned = 0;
    var byRecipe = {};
    var produced = {};
    var consumed = {};
    var power = 0;
    var counts = {};

    buildings.forEach(function (b) {
      var def = buildingsById[b.item];
      if (!def) { return; }
      counts[b.item] = (counts[b.item] || 0) + 1;
      if (def.speed > 0 && b.recipe) {
        var r = recipesById[b.recipe];
        if (!r) { unassigned++; return; }
        var key = b.item + ':' + b.recipe;
        var row = byRecipe[key] || (byRecipe[key] = { recipe: r, machine: def, count: 0 });
        row.count++;
        power += def.power || 0;
        r.outs.forEach(function (o) {
          produced[o[0]] = (produced[o[0]] || 0) + rateOf(r, o[1], def.speed);
        });
        r.ins.forEach(function (inp) {
          consumed[inp[0]] = (consumed[inp[0]] || 0) + rateOf(r, inp[1], def.speed);
        });
      } else if (def.speed > 0 && !b.recipe) {
        unassigned++;
      }
    });

    var rows = Object.keys(byRecipe).map(function (k) { return byRecipe[k]; });
    rows.sort(function (a, b) { return b.count - a.count; });

    var ids = {};
    Object.keys(produced).forEach(function (k) { ids[k] = 1; });
    Object.keys(consumed).forEach(function (k) { ids[k] = 1; });
    var balance = Object.keys(ids).map(function (id) {
      var p = produced[id] || 0, c = consumed[id] || 0;
      return { itemId: +id, produced: p, consumed: c, net: p - c, isRaw: !(recipesByOut[id] && recipesByOut[id].length) };
    }).sort(function (a, b) { return Math.abs(b.net) - Math.abs(a.net); });

    return {
      rows: rows,
      balance: balance,
      power: power,
      unassigned: unassigned,
      counts: counts,
      totalBuildings: buildings.length
    };
  }

  // 画布上出现的所有物品（有产出或消耗），按机器数排序
  function resourceList(buildings) {
    var produced = {}, consumed = {}, machines = {};
    buildings.forEach(function (b) {
      var def = buildingsById[b.item];
      if (!def || !b.recipe) return;
      var r = recipesById[b.recipe];
      if (!r || !(def.speed > 0)) return;
      r.outs.forEach(function (o) {
        produced[o[0]] = (produced[o[0]] || 0) + rateOf(r, o[1], def.speed);
        machines[o[0]] = (machines[o[0]] || 0) + 1;
      });
      r.ins.forEach(function (i) {
        consumed[i[0]] = (consumed[i[0]] || 0) + rateOf(r, i[1], def.speed);
        machines[i[0]] = (machines[i[0]] || 0) + 1;
      });
    });
    var ids = {};
    Object.keys(produced).forEach(function (k) { ids[k] = 1; });
    Object.keys(consumed).forEach(function (k) { ids[k] = 1; });
    return Object.keys(ids).map(function (id) {
      return {
        itemId: +id,
        produced: produced[id] || 0,
        consumed: consumed[id] || 0,
        machines: machines[id] || 0
      };
    }).sort(function (a, b) {
      return (b.produced + b.consumed) - (a.produced + a.consumed);
    });
  }

  // 供电覆盖判定：返回未供电的建筑（按格心的圆半径判定）
  function powerStatus(buildings) {
    var sources = [];
    buildings.forEach(function (b) {
      var def = buildingsById[b.item];
      if (!def || !(def.powerR > 0)) return;
      sources.push({
        x: b.x + (def.w || 1) / 2,
        y: b.y + (def.h || 1) / 2,
        r: def.powerR,
        uid: b.uid
      });
    });
    var unpowered = [];
    var powered = [];
    buildings.forEach(function (b) {
      var def = buildingsById[b.item];
      if (!def) return;
      // 只有真正的用电设备才需要供电：传送带/分拣器/仓储/供电设备本身都不算
      var needsPower = (def.power > 0) || def.cat === 'defense';
      if (!needsPower) return;
      var cx = b.x + (def.w || 1) / 2;
      var cy = b.y + (def.h || 1) / 2;
      var ok = false;
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        var dx = cx - s.x, dy = cy - s.y;
        if (dx * dx + dy * dy <= s.r * s.r) { ok = true; break; }
      }
      if (ok) powered.push(b.uid); else unpowered.push(b.uid);
    });
    return { unpowered: unpowered, powered: powered, sources: sources.length };
  }

  // 某台机器可以做的全部配方（含“该设施”字段匹配）
  function recipesFor(machineId) {
    var out = [];
    D.recipes.forEach(function (r) {
      if ((r.factories || []).indexOf(machineId) >= 0) out.push(r);
    });
    return out;
  }

  // 分拣器（爪子）速度：档位基础速度 × 伸出长度系数（参考值，长度越长越慢）
  var SORTER_BASE = { 2011: 1.5, 2012: 3.0, 2013: 6.0, 2014: 6.0 };
  var LEN_FACTOR = { 1: 1, 2: 0.75, 3: 0.5, 4: 0.4 };

  function sorterInfo(itemId, len) {
    var base = SORTER_BASE[itemId];
    if (!base) return null;
    var L = Math.max(1, Math.min(4, Math.round(len || 1)));
    var f = LEN_FACTOR[L] || 0.5;
    var perSec = base * f;
    return {
      len: L,
      perSec: perSec,
      perMin: perSec * 60,
      base: base,
      factor: f,
      stacked: itemId === 2014
    };
  }

  // ---------- 运行逻辑：按方向流动，算每台机器缺什么料 ----------
  // 有向图：机器 →(爪子)→ 传送带 →(沿带子方向)→ 传送带 →(爪子)→ 机器
  // 爪子记录里的 ino/outo 已解析成 fromUid/toUid（取料端 / 给料端）。
  var STATION_IDS = { 2103: 1, 2104: 1 };   // 物流站：视为无限外部输入

  function flow(buildings) {
    var byUid = {};
    buildings.forEach(function (b) { byUid[b.uid] = b; });
    var isBelt = function (it) { return it >= 2001 && it <= 2003; };
    var isSorter = function (it) { return it >= 2011 && it <= 2014; };

    // 格子 → 传送带（同一格可能有多条带子记录，按数组存）
    var cell2belt = {};
    var cell2belta = {};   // 不分层的平面索引
    buildings.forEach(function (b) {
      if (!isBelt(b.item)) return;
      var k0 = Math.floor(b.x) + ',' + Math.floor(b.y);
      (cell2belta[k0] = cell2belta[k0] || []).push(b.uid);
    });

    var dirOf = function (yaw) {
      var a = ((yaw % 360) + 360) % 360;
      if (a < 45 || a >= 315) return [0, 1];
      if (a < 135) return [1, 0];
      if (a < 225) return [0, -1];
      return [-1, 0];
    };

    var beltDir = function (b) {
      var a = (( (b.yaw0 !== undefined && b.yaw0 !== null ? b.yaw0 : (b.yaw || 0)) % 360) + 360) % 360;
      if (a < 45 || a >= 315) return [0, 1];
      if (a < 135) return [1, 0];
      if (a < 225) return [0, -1];
      return [-1, 0];
    };

    // 有向邻接表
    var out = {};
    function addEdge(a, b) {
      if (a === undefined || b === undefined || a === b) return;
      (out[a] = out[a] || {})[b] = 1;
    }

    // 传送带之间：同一条带子上的相邻格子互通（带子内部不区分方向，方向只体现在出入口的爪子上）
    buildings.forEach(function (b) {
      if (!isBelt(b.item)) return;
      var cx = Math.floor(b.x), cy = Math.floor(b.y);
      var dirB = beltDir(b);
      var nb4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < 4; i++) {
        var list = cell2belta[(cx + nb4[i][0]) + ',' + (cy + nb4[i][1])];
        if (!list) continue;
        for (var j = 0; j < list.length; j++) {
          if (list[j] === b.uid) continue;
          var other = byUid[list[j]];
          if (!other) continue;
          var dirO = beltDir(other);
          // 两条带子“脸对脸”时接不上（和游戏一致），其余相邻可以侧向接入
          if (dirB[0] === -dirO[0] && dirB[1] === -dirO[1]) continue;
          addEdge(b.uid, list[j]); addEdge(list[j], b.uid);
        }
      }
    });

    // 分流器 / 监测器 / 集装机：在带子中间起"直通"作用，把它们两侧的带子接起来
    var PASS_THROUGH = { 2020: 1, 2030: 1, 2040: 1 };
    buildings.forEach(function (b) {
      if (!PASS_THROUGH[b.item]) return;
      var cx = Math.floor(b.x), cy = Math.floor(b.y);
      var nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      var around = [];
      for (var i = 0; i < nb.length; i++) {
        var list = cell2belta[(cx + nb[i][0]) + ',' + (cy + nb[i][1])];
        if (list) around = around.concat(list);
      }
      for (var a = 0; a < around.length; a++) {
        addEdge(b.uid, around[a]); addEdge(around[a], b.uid);
        for (var c2 = a + 1; c2 < around.length; c2++) {
          addEdge(around[a], around[c2]); addEdge(around[c2], around[a]);
        }
      }
    });

    // 爪子：from → to
    var sorterList = buildings.filter(function (b) { return isSorter(b.item); });
    var stats = { sorters: sorterList.length, resolved: 0, fallback: 0 };
    sorterList.forEach(function (b) {
      var ex = b.extra || {};
      var from = ex.fromUid, to = ex.toUid;
      if (from === undefined || to === undefined) {
        var lk = ex.link || { dx: 0, dy: 0 };
        var near = function (px, py) {
          var bst = null, bd = 2.2;
          buildings.forEach(function (o) {
            if (o.uid === b.uid || isSorter(o.item)) return;
            var dd = Math.hypot(o.x - px, o.y - py);
            if (dd < bd) { bd = dd; bst = o; }
          });
          return bst ? bst.uid : undefined;
        };
        if (from === undefined) from = near(b.x, b.y);
        if (to === undefined) to = near(b.x + lk.dx, b.y + lk.dy);
        stats.fallback++;
      } else stats.resolved++;
      if (from !== undefined && from === to) return;
      addEdge(from, to);
    });

    // 物品 → 生产者
    var prodOf = {};
    var machines = {};
    buildings.forEach(function (b) {
      if (isBelt(b.item) || isSorter(b.item)) return;
      var def = buildingsById[b.item];
      if (!def) return;
      if (STATION_IDS[b.item]) { (prodOf['*'] = prodOf['*'] || []).push(b.uid); return; }
      if (!b.recipe) return;
      var r = recipesById[b.recipe];
      if (!r) return;
      machines[b.uid] = { rec: r, def: def };
      r.outs.forEach(function (o) { (prodOf[o[0]] = prodOf[o[0]] || []).push(b.uid); });
    });

    // 从若干源点沿有向边做 BFS，标记能到达的节点
    function reach(sources) {
      var seen = {};
      var q = sources.slice();
      q.forEach(function (s) { seen[s] = 1; });
      var guard = 0;
      while (q.length && guard < 400000) {
        guard++;
        var cur = q.pop();
        var nexts = out[cur];
        if (!nexts) continue;
        for (var k in nexts) {
          if (seen[k]) continue;
          seen[k] = 1;
          q.push(+k);
        }
      }
      return seen;
    }

    // 每种物品：它从生产者出发能流到哪些节点
    var reachCache = {};
    function reachFor(itemId) {
      if (reachCache[itemId]) return reachCache[itemId];
      var src = (prodOf[itemId] || []).slice();
      if (prodOf['*']) src = src.concat(prodOf['*']);
      var r = src.length ? reach(src) : {};
      reachCache[itemId] = r;
      return r;
    }

    var res = {
      machines: {}, external: {}, unlinked: {}, okCount: 0, badCount: 0,
      sorters: stats.sorters, stats: stats, stations: (prodOf['*'] || []).length
    };
    var extNeed = {};
    Object.keys(machines).forEach(function (uid) {
      var m = machines[uid];
      var inputs = [];
      var unlinkedItems = [];
      var externalItems = [];
      m.rec.ins.forEach(function (inp) {
        var itemId = inp[0];
        var producers = (prodOf[itemId] || []).filter(function (x) { return x !== +uid; });
        var hasStation = !!(prodOf['*'] && prodOf['*'].length);
        var need = rateOf(m.rec, 1, m.def.speed || 1) * inp[1];
        var state, ok = false;
        if (!producers.length && !hasStation) {
          state = 'external';                     // 本图里没人生产 → 必须从外部送入
          extNeed[itemId] = (extNeed[itemId] || 0) + need;
        } else if (reachFor(itemId)[uid]) {
          state = 'ok'; ok = true;                // 图里有产且线路接通
        } else {
          state = 'unlinked';                     // 图里有产，但这条线没连上
        }
        if (state === 'unlinked') { res.unlinked[itemId] = (res.unlinked[itemId] || 0) + 1; unlinkedItems.push(itemId); }
        if (state === 'external') { res.external[itemId] = (res.external[itemId] || 0) + 1; externalItems.push(itemId); }
        inputs.push({ item: itemId, name: itemName(itemId), need: need, ok: ok, state: state });
      });
      var allOk = inputs.every(function (x) { return x.state === 'ok'; });
      if (allOk) res.okCount++; else res.badCount++;
      res.machines[uid] = { okAll: allOk, inputs: inputs, recipe: m.rec.id };
    });
    res.extNeed = extNeed;
    res.ok = res.okCount;
    res.bad = res.badCount;
    res.unconnected = 0;
    return res;
  }

  // ---------- DRC：设计规则检查 ----------
  function drc(buildings) {
    var byUid = {};
    buildings.forEach(function (b) { byUid[b.uid] = b; });
    var isBelt = function (it) { return it >= 2001 && it <= 2003; };
    var isSorter = function (it) { return it >= 2011 && it <= 2014; };
    var out = { isolated: [], longSorter: [], unpowered: [], missing: [], noPort: [], counts: {} };

    // 1) 断头带子：四周没有别的带子、也没有爪子接它的
    var cell = {};
    buildings.forEach(function (b) {
      if (isBelt(b.item)) cell[Math.floor(b.x) + ',' + Math.floor(b.y)] = b.uid;
    });
    var touched = {};
    buildings.forEach(function (b) {
      if (!isSorter(b.item)) return;
      var ex = b.extra || {};
      [ex.fromUid, ex.toUid].forEach(function (u) { if (u !== undefined) touched[u] = 1; });
    });
    buildings.forEach(function (b) {
      if (!isBelt(b.item)) return;
      var cx = Math.floor(b.x), cy = Math.floor(b.y);
      var hasNb = false;
      var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < 4; i++) if (cell[(cx + nb[i][0]) + ',' + (cy + nb[i][1])] !== undefined) { hasNb = true; break; }
      if (!hasNb && !touched[b.uid]) out.isolated.push(b.uid);
    });

    // 2) 爪子过长（>2 格速度掉一半以上）
    buildings.forEach(function (b) {
      if (!isSorter(b.item)) return;
      var ex = b.extra || {};
      var len = ex.len || (ex.link ? Math.max(1, Math.round(Math.hypot(ex.link.dx, ex.link.dy))) : 1);
      if (len > 2) out.longSorter.push(b.uid);
    });

    // 3) 未供电
    try {
      var ps = powerStatus(buildings);
      out.unpowered = ps.unpowered.slice();
    } catch (e) { out.unpowered = []; }

    // 4) 缺料（外部输入 / 未接通）
    try {
      var fl = flow(buildings);
      Object.keys(fl.machines).forEach(function (uid) {
        var m = fl.machines[uid];
        if (!m.okAll) out.missing.push(+uid);
      });
    } catch (e) { out.missing = []; }

    out.counts = {
      isolated: out.isolated.length,
      longSorter: out.longSorter.length,
      unpowered: out.unpowered.length,
      missing: out.missing.length
    };
    return out;
  }
  global.DSPCALC = {
    itemsById: itemsById,
    recipesById: recipesById,
    buildingsById: buildingsById,
    recipesByOut: recipesByOut,
    itemName: itemName,
    rateOf: rateOf,
    machineCandidates: machineCandidates,
    bestMachine: bestMachine,
    machineFor: machineFor,
    plan: plan,
    layoutStats: layoutStats,
    resourceList: resourceList,
    powerStatus: powerStatus,
    sorterInfo: sorterInfo,
    flow: flow,
    drc: drc,
    recipesFor: recipesFor
  };
})(window);
