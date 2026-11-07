// 主应用：状态、面板、导入导出、计算器
(function (global) {
  'use strict';

  var D = global.DSP_DATA;
  var CALC = global.DSPCALC;
  var BP = global.DSPBP;

  var itemsById = CALC.itemsById;
  var recipesById = CALC.recipesById;
  var buildingsById = CALC.buildingsById;

  global.DSPAPP = {
    buildingsById: buildingsById,
    recipesById: recipesById
  };

  // ---------- 工具 ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  var toastTimer = null;
  function toast(msg, kind) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast hidden'; }, 2600);
  }
  function fmt(n, digits) {
    if (!isFinite(n)) return '—';
    var d = digits === undefined ? 1 : digits;
    var v = Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
    return v.toLocaleString('en-US');
  }
  function openModal(title, bodyNodes, actions) {
    $('modalTitle').textContent = title;
    var body = $('modalBody');
    body.innerHTML = '';
    (bodyNodes || []).forEach(function (n) { body.appendChild(n); });
    if (actions && actions.length) {
      var bar = el('div', 'modal-actions');
      actions.forEach(function (a) {
        var b = el('button', 'btn ' + (a.primary ? 'primary' : ''), a.label);
        b.onclick = a.onClick;
        bar.appendChild(b);
      });
      body.appendChild(bar);
    }
    $('modal').classList.remove('hidden');
  }
  function closeModal() { $('modal').classList.add('hidden'); }

  // ---------- 状态 ----------
  var state = {
    docVersion: 1,
    doc: newDoc(),
    uid: 1,
    undo: [],
    redo: [],
    clipboard: [],
    selection: []
  };

  function newDoc() {
    return {
      buildings: [],
      header: {
        shortDesc: '新蓝图',
        desc: '',
        gameVersion: '0.10.34.28529',
        layout: 10,
        version: 1
      },
      area: { x: 0, y: 0, w: 40, h: 40 },
      areas: null,          // 导入时的多区域信息（含纬度锚点）
      trailer: null,
      imported: null,
      layer: null
    };
  }

  function nextUid() { return state.uid++; }

  function addRecord(rec) {
    invalidateFlow();
    rec.uid = nextUid();
    state.doc.buildings.push(rec);
    return rec;
  }

  function byUid(uid) {
    for (var i = 0; i < state.doc.buildings.length; i++) {
      if (state.doc.buildings[i].uid === uid) return state.doc.buildings[i];
    }
    return null;
  }

  function defaultParams(itemId) {
    var def = buildingsById[itemId];
    var p = def && def.params;
    if (!p) return [];
    if (typeof p.length === 'number') return [p.length];
    if (p.researchMode !== undefined && p.acceleratorMode !== undefined) return [p.researchMode, p.acceleratorMode];
    if (p.acceleratorMode !== undefined) return [p.acceleratorMode];
    if (p.storage || p.slots) return [];
    return [];
  }

  // ---------- 撤销 ----------
  function pushUndo(cmd) {
    state.undo.push(cmd);
    if (state.undo.length > 120) state.undo.shift();
    state.redo.length = 0;
    updateHud();
  }

  function applyUndo(cmd, dir) {
    var bs = state.doc.buildings;
    if (cmd.kind === 'add') {
      if (dir < 0) {
        var ids = {};
        cmd.recs.forEach(function (r) { ids[r.uid] = 1; });
        state.doc.buildings = bs.filter(function (b) { return !ids[b.uid]; });
      } else {
        cmd.recs.forEach(function (r) { bs.push(r); });
      }
    } else if (cmd.kind === 'remove') {
      if (dir < 0) {
        cmd.recs.forEach(function (r) { bs.push(r); });
      } else {
        var ids2 = {};
        cmd.recs.forEach(function (r) { ids2[r.uid] = 1; });
        state.doc.buildings = bs.filter(function (b) { return !ids2[b.uid]; });
      }
    } else if (cmd.kind === 'move') {
      cmd.origins.forEach(function (o) {
        var b = byUid(o.uid);
        if (!b) return;
        b.x = dir > 0 ? o.toX : o.fromX;
        b.y = dir > 0 ? o.toY : o.fromY;
      });
    } else if (cmd.kind === 'props') {
      cmd.changes.forEach(function (c) {
        var b = byUid(c.uid);
        if (!b) return;
        if (c.key === 'recipe') b.recipe = dir > 0 ? c.to : c.from;
        else if (c.key === 'yaw') b.yaw = dir > 0 ? c.to : c.from;
      });
    }
    editor.reindex();
    editor.render();
    renderInspector();
  }

  function undo() {
    invalidateFlow();
    var cmd = state.undo.pop();
    if (!cmd) return toast('没有可撤销的操作');
    applyUndo(cmd, -1);
    state.redo.push(cmd);
    updateHud();
  }
  function redo() {
    invalidateFlow();
    var cmd = state.redo.pop();
    if (!cmd) return;
    applyUndo(cmd, 1);
    state.undo.push(cmd);
    updateHud();
  }

  // ---------- 建筑操作 ----------
  // x, y = 平面坐标（建筑以中心存储）；z = 高度（层）
  function placeBuilding(item, x, y, z, yaw) {
    var def = buildingsById[item];
    if (!def) return;

    // 爪子：吸附到最近的建筑端口，并连到端口外侧的那条传送带
    if (item >= 2011 && item <= 2014) {
      var snapped = snapSorter(x, y);
      if (snapped) {
        x = snapped.x; y = snapped.y; z = snapped.z;
        var recS = {
          uid: 0, item: item, model: def.model || 0,
          x: x, y: y, z: z, yaw: snapped.yaw, recipe: 0,
          params: defaultParams(item),
          extra: { link: snapped.link, len: snapped.len, synthetic: true, yaw1: snapped.yaw, fromUid: snapped.fromUid, toUid: snapped.toUid }
        };
        addRecord(recS);
        pushUndo({ kind: 'add', recs: [recS] });
        editor.reindex();
        editor.render();
        renderInspector();
        toast('爪子已连到端口（长度 ' + snapped.len + ' 格，速度 ' + fmt(snapped.perMin, 0) + '/分）', 'ok');
        return recS;
      }
    }

    // 传送带：只有调用方没指定朝向时，才沿用相邻带子的朝向（走线会显式给朝向，不能被覆盖）
    if (item >= 2001 && item <= 2003 && (yaw === undefined || yaw === null)) {
      for (var bi = 0; bi < state.doc.buildings.length; bi++) {
        var nb = state.doc.buildings[bi];
        if (nb.item < 2001 || nb.item > 2003) continue;
        if (Math.abs(nb.x - x) > 1.05 || Math.abs(nb.y - y) > 1.05) continue;
        if (Math.abs((nb.z || 0) - (z || 0)) > 0.6) continue;
        if (Math.abs(nb.x - x) < 0.05 && Math.abs(nb.y - y) < 0.05) continue;
        yaw = (nb.yaw0 !== undefined && nb.yaw0 !== null) ? nb.yaw0 : (nb.yaw || 0);
        break;
      }
    }

    var rec = {
      uid: 0,
      item: item,
      model: def.model || 0,
      x: x, y: y, z: z || 0,
      yaw: yaw || 0,
      recipe: def.recipe || 0,
      params: defaultParams(item),
      extra: null
    };
    addRecord(rec);
    pushUndo({ kind: 'add', recs: [rec] });
    editor.reindex();
    editor.render();
    renderInspector();
    return rec;
  }

  // 找到能接上的端口：端口外侧相邻格必须是传送带
  function snapSorter(wx, wy) {
    var dirs = { t: { x: 0, y: -1, yaw: 0 }, b: { x: 0, y: 1, yaw: 180 }, l: { x: -1, y: 0, yaw: 270 }, r: { x: 1, y: 0, yaw: 90 } };
    var beltCells = {};
    state.doc.buildings.forEach(function (b) {
      if (b.item < 2001 || b.item > 2003) return;
      beltCells[(Math.floor(b.x) + ',' + Math.floor(b.y))] = b;
    });
    var best = null;
    state.doc.buildings.forEach(function (b) {
      var def = buildingsById[b.item];
      if (!def || def.cat === 'belt' || def.cat === 'sorter') return;
      var ports = editor.portsOf(b);
      ports.forEach(function (p) {
        var d = dirs[p.dir];
        if (!d) return;
        var cellKey = Math.floor(p.x + d.x) + ',' + Math.floor(p.y + d.y);
        if (!beltCells[cellKey]) return;
        var dist = Math.hypot(p.x - wx, p.y - wy);
        if (dist > 3.2) return;
        if (!best || dist < best.dist) {
          var belt = beltCells[cellKey];
          var bx = Math.floor(belt.x) + 0.5, by = Math.floor(belt.y) + 0.5;
          // 记录点就是端口；绘图时爪子根部会往建筑里侧延伸，看起来才像一条完整的爪子
          best = {
            dist: dist, x: p.x, y: p.y, z: b.z,
            yaw: d.yaw,
            link: { dx: bx - p.x, dy: by - p.y, dz: 0 },
            len: Math.max(1, Math.round(Math.hypot(bx - p.x, by - p.y))),
            fromUid: belt.uid, toUid: b.uid       // 默认按“从传送带喂进建筑”来连
          };
        }
      });
    });
    if (!best) return null;
    var si = CALC.sorterInfo(2011, best.len);
    best.perMin = si ? si.perMin : 0;
    return best;
  }

  function eraseBuildings(list) {
    invalidateFlow();
    if (!list.length) return;
    var ids = {};
    list.forEach(function (b) { ids[b.uid] = 1; state.editorSel = null; });
    var removed = state.doc.buildings.filter(function (b) { return ids[b.uid]; });
    state.doc.buildings = state.doc.buildings.filter(function (b) { return !ids[b.uid]; });
    pushUndo({ kind: 'remove', recs: removed });
    editor.selection.clear();
    editor.reindex();
    editor.render();
    renderInspector();
  }

  function setProp(uids, key, value) {
    invalidateFlow();
    var changes = [];
    uids.forEach(function (uid) {
      var b = byUid(uid);
      if (!b) return;
      var from = b[key];
      if (from === value) return;
      changes.push({ uid: uid, key: key, from: from, to: value });
      b[key] = value;
    });
    if (changes.length) {
      pushUndo({ kind: 'props', changes: changes });
      renderInspector();
    }
  }

  // ---------- 面板：建筑调色板 ----------
  var CAT_LABEL = {
    machine: '生产机器', lab: '研究', belt: '传送带', sorter: '分拣器',
    logistics: '物流/仓储', power: '电力', miner: '采集', defense: '防御', misc: '其他'
  };
  var CAT_ORDER = ['machine', 'lab', 'belt', 'sorter', 'logistics', 'miner', 'power', 'defense', 'misc'];

  function buildPalette(filter) {
    var list = $('paletteList');
    list.innerHTML = '';
    var q = (filter || '').trim().toLowerCase();
    var groups = {};
    D.buildings.forEach(function (b) {
      if (q && b.name.toLowerCase().indexOf(q) < 0) return;
      (groups[b.cat] = groups[b.cat] || []).push(b);
    });
    CAT_ORDER.forEach(function (cat) {
      var arr = groups[cat];
      if (!arr || !arr.length) return;
      var g = el('div', 'pgroup');
      g.appendChild(el('div', 'pgroup-title', CAT_LABEL[cat] || cat));
      arr.forEach(function (b) {
        var item = el('div', 'pitem' + (editor.pendingItem === b.id ? ' active' : ''));
        item.dataset.id = b.id;
        var dot = el('span', 'dot');
        dot.style.background = catColor(cat);
        item.appendChild(dot);
        item.appendChild(el('span', 'name', b.name));
        item.appendChild(el('span', 'size', b.w + '×' + b.h));
        item.onclick = function () {
          editor.pendingItem = b.id;
          editor.tool = 'place';
          document.querySelectorAll('.pitem').forEach(function (n) { n.classList.remove('active'); });
          item.classList.add('active');
          $('hudInfo').textContent = '放置：' + b.name + '（R 旋转）';
        };
        g.appendChild(item);
      });
      list.appendChild(g);
    });
  }

  // 可搜索的配方选择器
  function recipePicker(machineId, current, onPick) {
    var wrap = el('div');
    var list = CALC.recipesFor(machineId);
    if (!list.length) {
      list = D.recipes.filter(function (r) {
        var m = CALC.bestMachine(r);
        return m && m.id === machineId;
      });
    }
    var search = document.createElement('input');
    search.placeholder = '搜索配方…';
    search.style.marginBottom = '6px';
    var sel = el('select');
    function fill(q) {
      sel.innerHTML = '';
      var o0 = el('option', '', '（未设置）');
      o0.value = '0';
      sel.appendChild(o0);
      list.filter(function (r) { return !q || r.name.indexOf(q) >= 0; })
        .sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); })
        .forEach(function (r) {
          var o = el('option');
          o.value = String(r.id);
          o.textContent = r.name + ' → ' + r.outs.map(function (x) { return itemName(x[0]) + '×' + x[1]; }).join('+')
            + ' · ' + (r.time / 60) + 's';
          sel.appendChild(o);
        });
      sel.value = String(current || 0);
    }
    fill('');
    search.oninput = function () { fill(search.value.trim()); };
    sel.onchange = function () { onPick(parseInt(sel.value, 10) || 0); };
    wrap.appendChild(search);
    wrap.appendChild(sel);
    if (!list.length) {
      wrap.appendChild(el('div', 'note', '没有找到该机器的配方数据（可能只能通过物流站输入）。'));
    }
    return wrap;
  }

  // ---------- 运行逻辑：原料供求 ----------
  var flowCache = { key: '', res: null };
  function computeFlow() {
    var bs = state.doc.buildings;
    // 用内容签名做缓存键：任何直接改数据（含脚本/批量操作）也能自动失效
    var sig = bs.length * 2654435761 % 2147483647;
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      sig = (sig * 31 + b.uid * 7 + b.item * 13 + (b.recipe || 0) * 17 +
        Math.round(b.x * 4) * 19 + Math.round(b.y * 4) * 23 + Math.round((b.z || 0) * 4) * 29 +
        ((b.extra && b.extra.fromUid) || 0) * 31 + ((b.extra && b.extra.toUid) || 0) * 37) % 2147483647;
    }
    var key = bs.length + ':' + sig;
    if (flowCache.key === key) return flowCache.res;
    var res = null;
    try { res = CALC.flow(bs); } catch (e) { res = null; }
    flowCache = { key: key, res: res };
    return res;
  }
  function invalidateFlow() { flowCache.key = ''; state.docVersion++; }

  function inputStateText(s) {
    if (s.state === 'ok') return '已接通';
    if (s.state === 'external') return '需外部输入';
    return '图里有产但未接通';
  }
  // 单个建筑的参数：占地尺寸 / 供电半径 / 射程（保存在本机）
  var SIZE_KEY = 'dsp-studio-sizes-v1';
  function loadOverrides() {
    try { return JSON.parse(localStorage.getItem(SIZE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveOverride(id, w, h, powerR, weaponR) {
    var o = loadOverrides();
    o[id] = { w: w, h: h, powerR: powerR, weaponR: weaponR };
    try { localStorage.setItem(SIZE_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ }
    applyOverride(id, o[id]);
  }
  var PORT_KEY = 'dsp-studio-ports-v1';
  function savePorts(id, ports) {
    var o = {};
    try { o = JSON.parse(localStorage.getItem(PORT_KEY) || '{}'); } catch (e) { o = {}; }
    o[id] = ports;
    try { localStorage.setItem(PORT_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ }
    var def = buildingsById[id];
    if (def) def.ports = ports;
  }
  function loadPorts() {
    var o = {};
    try { o = JSON.parse(localStorage.getItem(PORT_KEY) || '{}'); } catch (e) { o = {}; }
    Object.keys(o).forEach(function (id) {
      var def = buildingsById[+id];
      if (def) def.ports = o[id];
    });
  }
  function applyOverride(id, v) {
    var def = buildingsById[id];
    if (!def || !v) return;
    if (v.w) def.w = v.w;
    if (v.h) def.h = v.h;
    if (v.powerR !== undefined) def.powerR = v.powerR;
    if (v.weaponR !== undefined) def.weaponR = v.weaponR;
  }
  function defSettingsNode(b) {
    var def = buildingsById[b.item];
    if (!def) return el('div');
    var sec = el('div', 'sec');
    sec.appendChild(el('h3', '', '建筑参数（估算值，可按游戏校准）'));
    var row = el('div', 'row');
    row.appendChild(el('label', '', '占地'));
    var wIn = document.createElement('input');
    wIn.type = 'number'; wIn.min = '1'; wIn.max = '12'; wIn.value = String(def.w);
    var hIn = document.createElement('input');
    hIn.type = 'number'; hIn.min = '1'; hIn.max = '12'; hIn.value = String(def.h);
    row.appendChild(wIn);
    row.appendChild(el('span', '', '×'));
    row.appendChild(hIn);
    sec.appendChild(row);
    var rowR = el('div', 'row');
    if (def.powerR) {
      rowR.appendChild(el('label', '', '供电半径'));
      var pIn = document.createElement('input');
      pIn.type = 'number'; pIn.value = String(def.powerR);
      rowR.appendChild(pIn);
      pIn.onchange = function () {
        saveOverride(b.item, def.w, def.h, parseFloat(pIn.value) || 0, def.weaponR || 0);
        refreshPower(); editor.render(); renderInspector();
      };
    }
    if (def.weaponR) {
      rowR.appendChild(el('label', '', '射程'));
      var wIn2 = document.createElement('input');
      wIn2.type = 'number'; wIn2.value = String(def.weaponR);
      rowR.appendChild(wIn2);
      wIn2.onchange = function () {
        saveOverride(b.item, def.w, def.h, def.powerR || 0, parseFloat(wIn2.value) || 0);
        editor.render();
      };
    }
    if (rowR.childNodes.length) sec.appendChild(rowR);

    // 端口数量（严格按游戏可调，保存在本机）
    var pf = def.ports || { t: 1, r: 1, b: 1, l: 1 };
    var rowP = el('div', 'row');
    rowP.appendChild(el('label', '', '端口 上/右/下/左'));
    var pInputs = {};
    ['t', 'r', 'b', 'l'].forEach(function (k) {
      var inp = document.createElement('input');
      inp.type = 'number'; inp.min = '0'; inp.max = '8';
      inp.style.width = '46px';
      inp.value = String(pf[k] || 0);
      pInputs[k] = inp;
      rowP.appendChild(inp);
    });
    sec.appendChild(rowP);
    var applyPorts = function () {
      var v = {};
      ['t', 'r', 'b', 'l'].forEach(function (k) {
        v[k] = Math.max(0, Math.min(8, parseInt(pInputs[k].value, 10) || 0));
      });
      savePorts(b.item, v);
      editor.render();
      renderInspector();
    };
    ['t', 'r', 'b', 'l'].forEach(function (k) { pInputs[k].onchange = applyPorts; });
    sec.appendChild(el('div', 'note', '端口数默认取自游戏数据（上/下边），左右边为估计值；对不上就在这里改，同类建筑一起生效。'));
    function commit() {
      saveOverride(b.item, Math.max(1, Math.min(12, parseInt(wIn.value, 10) || def.w)),
        Math.max(1, Math.min(12, parseInt(hIn.value, 10) || def.h)), def.powerR || 0, def.weaponR || 0);
      editor.reindex();
      editor.render();
      renderInspector();
    }
    wIn.onchange = commit;
    hIn.onchange = commit;
    return sec;
  }

  function catColor(cat) {
    return {
      machine: '#c8863c', lab: '#7a6bd6', belt: '#3e6b7a', sorter: '#4a7a5e',
      logistics: '#3f6f8f', power: '#8f7a3f', miner: '#6f5a3f', defense: '#7a3f3f', misc: '#555a63'
    }[cat] || '#555a63';
  }

  // ---------- 面板：属性 ----------
  function renderInspector() {
    if (state.doc.buildings.length <= 20000) { try { refreshPower(); } catch (e) { } }
    var body = $('inspectorBody');
    body.innerHTML = '';
    var sel = editor ? editor.selectedObjects() : [];
    state.selection = sel;

    if (sel.length === 0) {
      body.appendChild(layoutStatsNode());
      try { body.appendChild(drcNode()); } catch (e2) { }
      body.appendChild(exportHintNode());
      return;
    }

    if (sel.length === 1) {
      var b = sel[0];
      var def = buildingsById[b.item] || { name: '未知建筑 #' + b.item, speed: 0, cat: 'misc' };
      body.appendChild(el('div', 'selname', def.name));
      body.appendChild(el('div', 'selsub', '位置 (' + (Math.round(b.x*10)/10) + ', ' + (Math.round(b.y*10)/10) + ')' + ((b.z||0) ? '  z=' + (Math.round(b.z*100)/100) : '') + '  ·  朝向 ' + (b.yaw || 0) + '°'));

      var box = el('div', 'sec');
      box.appendChild(el('h3', '', '朝向'));
      var rowY = el('div', 'row');
      var btnRot = el('button', 'btn', '顺时针旋转 90°');
      btnRot.onclick = function () { setProp([b.uid], 'yaw', ((b.yaw || 0) + 90) % 360); editor.reindex(); editor.render(); };
      rowY.appendChild(btnRot);
      box.appendChild(rowY);
      body.appendChild(box);

      if (def.speed > 0) {
        var sec = el('div', 'sec');
        sec.appendChild(el('h3', '', '配方（选中后立即生效）'));
        sec.appendChild(recipePicker(b.item, b.recipe, function (rid) {
          setProp([b.uid], 'recipe', rid);
          editor.render();
          renderInspector();
        }));
        if (b.recipe && recipesById[b.recipe]) {
          var r = recipesById[b.recipe];
          var info = el('div', 'sec');
          info.appendChild(el('h3', '', '配方面板'));
          info.appendChild(kv('周期', (r.time / 60) + ' 秒'));
          info.appendChild(kv('输入', r.ins.map(function (i) { return itemName(i[0]) + ' ×' + i[1]; }).join('，') || '无'));
          info.appendChild(kv('产出', r.outs.map(function (o) { return itemName(o[0]) + ' ×' + o[1]; }).join('，')));
          info.appendChild(kv('本机产能', fmt(CALC.rateOf(r, 1, def.speed || 1)) + ' /min'));
          info.appendChild(kv('本机功率', fmt(def.power || 0, 2) + ' MW'));
          body.appendChild(info);
        }
        // 把配方套用到所有同类建筑
        var rowApply = el('div', 'row');
        var applyBtn = el('button', 'btn', '应用到全部同类机器');
        applyBtn.onclick = function () {
          if (!b.recipe) return toast('先给这台选个配方', 'bad');
          var same = state.doc.buildings.filter(function (x) { return x.item === b.item; });
          setProp(same.map(function (x) { return x.uid; }), 'recipe', b.recipe);
          editor.render();
          renderInspector();
          toast('已把配方应用到 ' + same.length + ' 台同类机器', 'ok');
        };
        rowApply.appendChild(applyBtn);
        sec.appendChild(rowApply);
        body.appendChild(sec);
      }

      // 原料状态（运行逻辑）：这台机器要什么、有没有送到
      var fl = computeFlow();
      var finfo = fl && fl.machines[b.uid];
      if (finfo && finfo.inputs.length) {
        var secF = el('div', 'sec');
        secF.appendChild(el('h3', '', '原料状态'));
        var tb = document.createElement('table');
        tb.className = 'mini-table';
        var hr = document.createElement('tr');
        ['原料', '需求/分', '状态'].forEach(function (h) { var th = document.createElement('th'); th.textContent = h; hr.appendChild(th); });
        tb.appendChild(hr);
        finfo.inputs.forEach(function (s) {
          var tr = document.createElement('tr');
          tr.className = 'rowlink' + (s.state === 'ok' ? '' : ' bad');
          tr.onclick = function () { toggleHighlight(s.item); };
          var td1 = document.createElement('td'); td1.textContent = s.name;
          var td2 = document.createElement('td'); td2.textContent = fmt(s.need, 0);
          var td3 = document.createElement('td');
          td3.textContent = inputStateText(s);
          td3.style.color = s.state === 'ok' ? '#6fe0a0' : (s.state === 'external' ? '#ffb457' : '#ff8a7a');
          tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
          tb.appendChild(tr);
        });
        secF.appendChild(tb);
        if (!finfo.okAll) {
          secF.appendChild(el('div', 'note', '红/橙色表示这条原料链路有问题：本图没有生产（需外部输入），或图里有产但传送带没连到这台机器。'));
        }
        body.appendChild(secF);
      }

      body.appendChild(defSettingsNode(b));

      // 爪子：显示档位/长度/通过速度（长度越长越慢）
      if (b.item >= 2011 && b.item <= 2014) {
        var ex = b.extra || {};
        var len = ex.len || (ex.link ? Math.max(1, Math.round(Math.hypot(ex.link.dx, ex.link.dy))) : 1);
        var si = CALC.sorterInfo(b.item, len);
        if (si) {
          var secS = el('div', 'sec');
          secS.appendChild(el('h3', '', '爪子'));
          secS.appendChild(kv('伸出长度', si.len + ' 格' + (si.len > 1 ? '（速度系数 ' + si.factor + '）' : '')));
          secS.appendChild(kv('通过速度', fmt(si.perSec, 2) + ' 个/秒 ＝ ' + fmt(si.perMin, 0) + ' 个/分' + (si.stacked ? '（集装，每趟 4 个）' : '')));
          if (si.len > 1) {
            secS.appendChild(el('div', 'note', '注意：爪子的伸出长度越长，搬运速度越慢。同一排产线尽量用长度 1 的爪子，或用极速爪子补回速度。'));
          }
          body.appendChild(secS);
        }
      }

      var del = el('button', 'btn', '删除此建筑');
      del.onclick = function () { eraseBuildings([b]); };
      body.appendChild(del);
    } else {
      body.appendChild(el('div', 'selname', '已选中 ' + sel.length + ' 个建筑'));
      var items = {};
      sel.forEach(function (x) { items[x.item] = (items[x.item] || 0) + 1; });
      var sec2 = el('div', 'sec');
      sec2.appendChild(el('h3', '', '构成'));
      Object.keys(items).forEach(function (id) {
        var d = buildingsById[id];
        sec2.appendChild(kv(d ? d.name : '未知 #' + id, items[id] + ' 个'));
      });
      body.appendChild(sec2);

      var machineSel = sel.filter(function (x) { return (buildingsById[x.item] || {}).speed > 0; });
      if (machineSel.length) {
        var sec3 = el('div', 'sec');
        sec3.appendChild(el('h3', '', '批量设置配方'));
        var s2 = el('select');
        var o0 = el('option', '', '（未设置）'); o0.value = '0'; s2.appendChild(o0);
        var seen = {};
        machineSel.forEach(function (x) {
          D.recipes.forEach(function (r) {
            if (seen[r.id]) return;
            if ((r.factories || []).indexOf(x.item) >= 0) { seen[r.id] = 1; }
          });
        });
        D.recipes.forEach(function (r) {
          if (!seen[r.id]) return;
          var o = el('option'); o.textContent = r.name; o.value = String(r.id); s2.appendChild(o);
        });
        s2.onchange = function () {
          var val = parseInt(s2.value, 10) || 0;
          setProp(machineSel.map(function (x) { return x.uid; }), 'recipe', val);
        };
        sec3.appendChild(s2);
        body.appendChild(sec3);
      }

      var del2 = el('button', 'btn', '删除选中');
      del2.onclick = function () { eraseBuildings(sel); };
      body.appendChild(del2);
    }
  }

  function kv(k, v) {
    var d = el('div', 'kv');
    d.appendChild(el('span', 'k', k));
    d.appendChild(el('span', 'v', v));
    return d;
  }

  function itemName(id) {
    var it = itemsById[id];
    return it ? it.name : '#' + id;
  }

  function layoutStatsNode() {
    var sec = el('div', 'sec');
    sec.appendChild(el('h3', '', '布局统计'));
    var st = CALC.layoutStats(state.doc.buildings);
    sec.appendChild(kv('建筑总数', fmt(st.totalBuildings, 0)));
    sec.appendChild(kv('估算电力', fmt(st.power, 2) + ' MW'));
    if (st.unassigned) sec.appendChild(kv('未设配方', st.unassigned + ' 台'));

    if (st.rows.length) {
      var t = el('table', 'tbl');
      t.innerHTML = '<thead><tr><th>配方</th><th class="num">机器</th><th class="num">产能/min</th></tr></thead>';
      var tb = el('tbody');
      st.rows.forEach(function (r) {
        var tr = el('tr');
        tr.appendChild(el('td', '', r.recipe.name));
        tr.appendChild(el('td', 'num', fmt(r.count, 0)));
        tr.appendChild(el('td', 'num', fmt(CALC.rateOf(r.recipe, r.recipe.outs[0][1], r.machine.speed) * r.count)));
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      sec.appendChild(t);
    }

    var bal = st.balance.filter(function (b) { return Math.abs(b.net) > 0.01 || b.isRaw; }).slice(0, 16);
    if (bal.length) {
      sec.appendChild(el('h3', '', '物料平衡（点击行可高亮相关产线）'));
      var t2 = el('table', 'tbl');
      t2.innerHTML = '<thead><tr><th>物品</th><th class="num">产出</th><th class="num">消耗</th><th class="num">净值</th></tr></thead>';
      var tb2 = el('tbody');
      bal.forEach(function (b) {
        var tr = el('tr', 'rowlink');
        tr.appendChild(el('td', '', itemName(b.itemId)));
        tr.appendChild(el('td', 'num', fmt(b.produced)));
        tr.appendChild(el('td', 'num', fmt(b.consumed)));
        var tag = b.isRaw ? '<span class="tag">原料</span>' : (b.net >= 0 ? '<span class="tag ok">盈</span>' : '<span class="tag bad">缺</span>');
        tr.appendChild(el('td', 'num', fmt(b.net) + ' ' + tag));
        tr.onclick = function () { toggleHighlight(b.itemId); };
        tb2.appendChild(tr);
      });
      t2.appendChild(tb2);
      sec.appendChild(t2);
    }

    // 资源列表：画布上出现的所有物品
    var res = CALC.resourceList(state.doc.buildings);
    if (res.length) {
      sec.appendChild(el('h3', '', '资源列表（点击高亮）'));
      var t3 = el('table', 'tbl');
      t3.innerHTML = '<thead><tr><th>物品</th><th class="num">产/min</th><th class="num">耗/min</th><th class="num">机器</th></tr></thead>';
      var tb3 = el('tbody');
      res.slice(0, 40).forEach(function (r) {
        var tr = el('tr', 'rowlink' + (state.highlightItem === r.itemId ? ' on' : ''));
        tr.appendChild(el('td', '', itemName(r.itemId)));
        tr.appendChild(el('td', 'num', fmt(r.produced)));
        tr.appendChild(el('td', 'num', fmt(r.consumed)));
        tr.appendChild(el('td', 'num', r.machines ? fmt(r.machines, 0) : '—'));
        tr.onclick = function () { toggleHighlight(r.itemId); };
        tb3.appendChild(tr);
      });
      t3.appendChild(tb3);
      sec.appendChild(t3);
    }

    // 原料供给（运行逻辑汇总）
    var fl2 = computeFlow();
    if (fl2) {
      var secF2 = el('div', 'sec');
      secF2.appendChild(el('h3', '', '原料供给'));
      var ext = Object.keys(fl2.extNeed || {});
      var un = Object.keys(fl2.unlinked || {});
      if (!ext.length && !un.length) {
        secF2.appendChild(kv('状态', '所有原料都能在本图内接通'));
      } else {
        if (ext.length) {
          secF2.appendChild(el('div', 'note', '需要从外部送进来的原料（本图不生产）：'));
          var tb2 = document.createElement('table');
          tb2.className = 'mini-table';
          var hr2 = document.createElement('tr');
          ['原料', '需求/分'].forEach(function (h) { var th = document.createElement('th'); th.textContent = h; hr2.appendChild(th); });
          tb2.appendChild(hr2);
          ext.sort(function (a, b) { return fl2.extNeed[b] - fl2.extNeed[a]; }).slice(0, 12).forEach(function (id) {
            var tr = document.createElement('tr');
            tr.className = 'rowlink';
            tr.onclick = function () { toggleHighlight(+id); };
            var td1 = document.createElement('td'); td1.textContent = itemName(+id);
            var td2 = document.createElement('td'); td2.textContent = fmt(fl2.extNeed[id], 0);
            tr.appendChild(td1); tr.appendChild(td2);
            tb2.appendChild(tr);
          });
          secF2.appendChild(tb2);
        }
        if (un.length) {
          secF2.appendChild(el('div', 'note', '图里有生产、但传送带没接到机器上的原料：'));
          un.slice(0, 8).forEach(function (id) {
            secF2.appendChild(kv(itemName(+id), fl2.unlinked[id] + ' 台缺'));
          });
        }
      }
      secF2.appendChild(el('div', 'note', '判定依据是爪子记录里的取料/给料对象（ino/outo）加传送带连通关系；多层升降、物流站转运等情况可能判不准。'));
      sec.appendChild(secF2);
    }
    return sec;
  }

  // 点击资源 → 高亮生产/消耗它的建筑；再点一次取消
  function toggleHighlight(itemId) {
    if (state.highlightItem === itemId) {
      state.highlightItem = null;
      editor.highlight.clear();
      editor.render();
      renderInspector();
      updateHud();
      return;
    }
    state.highlightItem = itemId;
    var n = editor.highlightItem(itemId);
    renderInspector();
    updateHud();
    toast('高亮 ' + itemName(itemId) + ' 相关建筑 ' + n + ' 台（再点一次取消）', n ? 'ok' : 'bad');
  }

  function exportHintNode() {
    var sec = el('div', 'sec');
    sec.appendChild(el('h3', '', '绘制设置'));
    var row = el('div', 'row');
    row.appendChild(el('label', '', '新建筑层高'));
    var zInput = document.createElement('input');
    zInput.type = 'number';
    zInput.step = '0.1';
    zInput.value = String(editor.pendingZ || 0);
    zInput.onchange = function () {
      var v = parseFloat(zInput.value);
      editor.pendingZ = isFinite(v) ? v : 0;
      toast('之后放置的建筑将位于 z=' + editor.pendingZ, 'ok');
    };
    row.appendChild(zInput);
    sec.appendChild(row);
    sec.appendChild(el('div', 'note',
      '游戏里平面坐标是 (x, y)，z 是高度：把某些建筑放在 z>0 就可以做浮空/多层结构。' +
      '导入含多层的蓝图时，左下角会出现「第1层 / 第2层」按钮用于分层查看。'));

    sec.appendChild(el('h3', '', '说明'));
    sec.appendChild(el('div', 'note',
      '把建筑放到画布上，设置配方后点击右上角「导出蓝图」，把生成的字符串在游戏里粘贴即可。<br>' +
      '若从游戏导入了蓝图，编辑后再导出会保留原来的传送带/分拣器数据。'));
    return sec;
  }

  // ---------- 导入 / 导出 ----------
  function recordFromParsed(b) {
    var extra = {
      p1: b.p1, yaw1: b.yaw1, tilt: b.tilt, tilt2: b.tilt2, pitch: b.pitch, pitch2: b.pitch2,
      outo: b.outo, ino: b.ino, s01: b.s01, s02: b.s02, s03: b.s03,
      s04: b.s04, s05: b.s05, s06: b.s06, filter: b.filter, marker: b.marker, suffix: b.suffix,
      _index: b.index
    };
    // 爪子：记下 p1 相对 p0 的偏移，移动时跟着走；并算伸出长度
    if (b.item >= 2011 && b.item <= 2014) {
      extra.link = { dx: b.p1.x - b.p0.x, dy: b.p1.y - b.p0.y, dz: b.p1.z - b.p0.z };
      extra.len = Math.max(1, Math.round(Math.hypot(extra.link.dx, extra.link.dy)));
    }
    return {
      uid: 0,
      item: b.item,
      model: b.model,
      x: b.p0.x,
      y: b.p0.y,
      z: b.p0.z,
      area: b.area || 0,
      yaw: b.yaw0 || 0,
      recipe: b.recipe || 0,
      params: b.params || [],
      recovered: b.recovered || false,
      extra: extra
    };
  }

  // 导入后：把 outo/ino（建筑序号）换成 uid，这样编辑中增删建筑也不会连错
  function resolveLinks(recs) {
    var byIndex = {};
    recs.forEach(function (r) {
      var ix = r.extra && r.extra._index;
      if (typeof ix === 'number' && ix >= 0) byIndex[ix] = r;
    });
    var n = 0;
    recs.forEach(function (r) {
      var ex = r.extra;
      if (!ex || !(r.item >= 2011 && r.item <= 2014)) return;
      if (typeof ex.ino === 'number' && ex.ino >= 0 && byIndex[ex.ino]) { ex.fromUid = byIndex[ex.ino].uid; n++; }
      if (typeof ex.outo === 'number' && ex.outo >= 0 && byIndex[ex.outo]) { ex.toUid = byIndex[ex.outo].uid; n++; }
    });
    return n;
  }
  function recordToExport(b, uidToIndex) {
    var ex = b.extra || {};
    var def = buildingsById[b.item];
    var z = b.z || 0;
    // 爪子：p1 = p0 + 连接偏移（导入时记录的 or 新放置时算出的）
    var p1 = ex.p1;
    if (ex.link) {
      p1 = { x: b.x + ex.link.dx, y: b.y + ex.link.dy, z: z + (ex.link.dz || 0) };
    }
    return {
      item: b.item,
      model: b.model !== undefined ? b.model : (def ? def.model : 0),
      p0: { x: b.x, y: b.y, z: z },
      area: b.area || 0,
      yaw0: b.yaw || 0,
      yaw1: ex.yaw1 !== undefined ? ex.yaw1 : (b.yaw || 0),
      tilt: ex.tilt || 0,
      tilt2: ex.tilt2 || 0,
      pitch: ex.pitch || 0,
      pitch2: ex.pitch2 || 0,
      p1: p1 || { x: b.x, y: b.y, z: z },
      outo: (uidToIndex && ex.toUid !== undefined && uidToIndex[ex.toUid] !== undefined) ? uidToIndex[ex.toUid]
        : (ex.outo !== undefined ? ex.outo : -1),
      ino: (uidToIndex && ex.fromUid !== undefined && uidToIndex[ex.fromUid] !== undefined) ? uidToIndex[ex.fromUid]
        : (ex.ino !== undefined ? ex.ino : -1),
      s01: ex.s01 || 0, s02: ex.s02 || 0, s03: ex.s03 || 0,
      s04: ex.s04 || 0, s05: ex.s05 || 0, s06: ex.s06 || 0,
      recipe: b.recipe || 0,
      filter: ex.filter || 0,
      params: b.params || [],
      marker: ex.marker,
      suffix: ex.suffix
    };
  }

  function bbox(buildings, withMargin) {
    if (!buildings.length) return { x: 0, y: 0, w: 1, h: 1 };
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    buildings.forEach(function (b) {
      var fp = editor.footprint(b);
      minX = Math.min(minX, fp.x); minY = Math.min(minY, fp.y);
      maxX = Math.max(maxX, fp.x + fp.w); maxY = Math.max(maxY, fp.y + fp.h);
    });
    var m = withMargin === undefined ? 2 : withMargin;
    return {
      x: Math.floor(minX) - m,
      y: Math.floor(minY) - m,
      w: Math.ceil(maxX - minX) + m * 2,
      h: Math.ceil(maxY - minY) + m * 2
    };
  }

  async function doExport() {
    if (!state.doc.buildings.length) return toast('画布是空的，先放点建筑吧', 'bad');
    var area = bbox(state.doc.buildings, 2);
    var syntheticSorters = state.doc.buildings.filter(function (b) { return b.extra && b.extra.synthetic; }).length;
    var opts = {
      version: state.doc.header.version || 1,
      trailerMode: state.doc.trailer ? 'keep' : 'none',
      includeSynthetic: false
    };

    function currentRecords() {
      var kept = state.doc.buildings
        .filter(function (b) { return !(b.extra && b.extra.synthetic) || opts.includeSynthetic; });
      var uidToIndex = {};
      kept.forEach(function (b, i) { uidToIndex[b.uid] = i; });
      return kept.map(function (b) { return recordToExport(b, uidToIndex); });
    }

    async function buildString() {
      return BP.build(currentRecords(), {
        version: opts.version,
        layout: state.doc.header.layout || 10,
        gameVersion: state.doc.header.gameVersion,
        shortDesc: state.doc.header.shortDesc,
        desc: state.doc.header.desc,
        dragX: area.w,
        dragY: area.h,
        areas: state.doc.areas,
        trailer: opts.trailerMode === 'keep' ? state.doc.trailer : null
      });
    }

    var str;
    try {
      str = await buildString();
    } catch (e) {
      return toast('生成失败：' + e.message, 'bad');
    }

    var body = [];
    body.push(el('div', 'note', '复制下面的字符串，在游戏内「蓝图 → 导入」粘贴即可。建议先在游戏里放一张小蓝图验证。'));
    var ta = el('textarea');
    ta.value = str;
    body.push(ta);
    var info = el('div', 'note', '');
    var refreshInfo = function () {
      var n = currentRecords().length;
      info.textContent = '建筑 ' + n + ' 个 · 字符串 ' + ta.value.length + ' 字符 · 载荷 v' + opts.version +
        ' · 尾注 ' + (opts.trailerMode === 'keep' && state.doc.trailer ? '保留原样' : '无') +
        (syntheticSorters ? (' · 未导出 ' + (opts.includeSynthetic ? 0 : syntheticSorters) + ' 个自动生成的爪子') : '') +
        ' · 校验段已生成';
    };
    refreshInfo();
    body.push(info);

    if (syntheticSorters) {
      var chkRow = el('div', 'row');
      var chkWrap = el('label', 'chk');
      var chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.onchange = async function () {
        opts.includeSynthetic = chk.checked;
        try { ta.value = await buildString(); refreshInfo(); }
        catch (e) { toast('生成失败：' + e.message, 'bad'); }
      };
      chkWrap.appendChild(chk);
      chkWrap.appendChild(document.createTextNode('导出自动生成的爪子（实验性：位置由端口推算，进游戏后建议复核）'));
      chkRow.appendChild(chkWrap);
      body.push(chkRow);
    }

    var inputs = el('div', 'row');
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = state.doc.header.shortDesc;
    inputs.appendChild(el('label', '', '蓝图名'));
    inputs.appendChild(nameInput);
    body.push(inputs);

    var optRow = el('div', 'row');
    optRow.appendChild(el('label', '', '输出格式'));
    var vSel = el('select');
    [['1', '载荷 v1（通用）'], ['2', '载荷 v2（新版游戏）']].forEach(function (p) {
      var o = el('option', '', p[1]); o.value = p[0]; vSel.appendChild(o);
    });
    vSel.value = String(opts.version);
    var tSel = el('select');
    [['none', '无尾注'], ['keep', '保留原尾注']].forEach(function (p) {
      var o = el('option', '', p[1]); o.value = p[0]; tSel.appendChild(o);
    });
    tSel.value = opts.trailerMode;
    if (!state.doc.trailer) tSel.disabled = true;
    optRow.appendChild(vSel);
    optRow.appendChild(tSel);
    body.push(optRow);

    async function rebuild() {
      opts.version = parseInt(vSel.value, 10) || 1;
      opts.trailerMode = tSel.value;
      try {
        ta.value = await buildString();
        refreshInfo();
      } catch (e) {
        toast('生成失败：' + e.message, 'bad');
      }
    }
    vSel.onchange = rebuild;
    tSel.onchange = rebuild;
    nameInput.oninput = function () { state.doc.header.shortDesc = nameInput.value; };
    nameInput.onchange = async function () { await rebuild(); };

    openModal('导出蓝图', body, [
      { label: '关闭', onClick: closeModal },
      {
        label: '下载 .txt', onClick: function () {
          var blob = new Blob([ta.value], { type: 'text/plain' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = (state.doc.header.shortDesc || 'blueprint') + '.txt';
          a.click();
        }
      },
      {
        label: '复制到剪贴板', primary: true, onClick: function () {
          navigator.clipboard.writeText(ta.value).then(function () {
            toast('已复制蓝图字符串', 'ok');
          }, function () {
            ta.select();
            document.execCommand('copy');
            toast('已复制（兼容模式）', 'ok');
          });
        }
      }
    ]);
  }

  async function importFromString(text) {
    var parsed = BP.parse(text);
    await BP.parsePayload(parsed);
    if (!parsed.hashOk) {
      // 继续，但提示
      console.warn('checksum mismatch');
    }
    var doc = newDoc();
    doc.header = {
      shortDesc: parsed.header.shortDesc || '导入蓝图',
      desc: parsed.header.desc || '',
      gameVersion: parsed.header.gameVersion || doc.header.gameVersion,
      layout: parsed.header.layout || 10,
      version: (parsed.meta && parsed.meta.version) || 1
    };
    doc.trailer = parsed.trailer ? Array.from(parsed.trailer) : null;
    doc.imported = { cells: parsed.cells.length, hashOk: parsed.hashOk };
    doc.areas = parsed.areas || null;
    doc.meta = parsed.meta || null;

    state.uid = 1;
    state.doc = doc;
    state.undo = [];
    state.redo = [];
    var importedRecs = [];
    parsed.buildings.forEach(function (b) {
      var rec = recordFromParsed(b);
      addRecord(rec);
      importedRecs.push(rec);
    });
    // 把爪子里的 outo/ino（建筑序号）解析成 uid，供运行逻辑与再导出使用
    resolveLinks(importedRecs);
    editor.selection.clear();
    editor.setDoc(doc);
    var bb = bbox(doc.buildings, 4);
    doc.area = { x: bb.x, y: bb.y, w: bb.w, h: bb.h };
    // 若蓝图带区域信息，用它的尺寸（更贴近游戏内的拖动框）
    if (parsed.areas && parsed.areas.length === 1) {
      var a0 = parsed.areas[0];
      doc.area.w = a0.w;
      doc.area.h = a0.h;
    }
    editor.layer = null;
    renderLayers();
    editor.centerOn(bb);
    editor.reindex();
    editor.render();
    renderInspector();
    updateHud();

    var msg = '已导入 ' + doc.buildings.length + ' 个建筑';
    var kind = 'ok';
    if (parsed.warnings && (parsed.warnings.skipped || parsed.warnings.fatal)) {
      msg += '；' + parsed.warnings.skipped + ' 条记录布局异常，已按坐标尽量保留（配方可能缺失）';
      kind = 'bad';
    }
    if (parsed.buildings.length !== parsed.declaredCount) {
      msg = '部分导入：' + doc.buildings.length + ' / ' + parsed.declaredCount + ' 个建筑（其余无法定位）';
      kind = 'bad';
    }
    if (!parsed.hashOk) msg += '（校验段不匹配）';
    toast(msg, kind);
  }

  function openImportDialog() {
    var body = [];
    body.push(el('div', 'note', '把游戏里复制的 BLUEPRINT:... 字符串粘贴进来，或选择 .txt 文件。'));
    var ta = el('textarea');
    ta.placeholder = 'BLUEPRINT:1,10,0,0,0,0,0,0,...';
    body.push(ta);
    var fileRow = el('div', 'row');
    var f = document.createElement('input');
    f.type = 'file';
    f.accept = '.txt,.json';
    f.onchange = function () {
      var file = f.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { ta.value = String(reader.result).trim(); };
      reader.readAsText(file, 'utf-8');
    };
    fileRow.appendChild(f);
    body.push(fileRow);

    openModal('导入蓝图', body, [
      { label: '取消', onClick: closeModal },
      {
        label: '解析导入', primary: true, onClick: function () {
          var txt = ta.value.trim();
          if (!txt) return toast('内容为空', 'bad');
          closeModal();
          importFromString(txt).catch(function (e) {
            console.error(e);
            toast('导入失败：' + e.message, 'bad');
          });
        }
      }
    ]);
  }

  // ---------- 工程存取 ----------
  function projectData() {
    return {
      app: 'dsp-studio',
      version: 1,
      header: state.doc.header,
      area: state.doc.area,
      buildings: state.doc.buildings
    };
  }

  async function saveProject() {
    var json = JSON.stringify(projectData(), null, 1);
    var blob = new Blob([json], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.doc.header.shortDesc || '工程') + '.dspstudio.json';
    a.click();
    toast('工程已导出', 'ok');
  }

  function loadProject(json) {
    var data = JSON.parse(json);
    if (!data || !data.buildings) throw new Error('不是有效的工程文件');
    var doc = newDoc();
    doc.header = data.header || doc.header;
    doc.area = data.area || doc.area;
    state.uid = 1;
    state.doc = doc;
    state.undo = [];
    state.redo = [];
    data.buildings.forEach(function (b) {
      var rec = {
        uid: 0, item: b.item, model: b.model, x: b.x, y: b.y, z: b.z, yaw: b.yaw,
        recipe: b.recipe, params: b.params, extra: b.extra
      };
      addRecord(rec);
    });
    editor.selection.clear();
    editor.setDoc(doc);
    var bb = bbox(doc.buildings, 4);
    editor.layer = null;
    editor.centerOn(bb);
    editor.reindex();
    renderLayers();
    editor.render();
    renderInspector();
    updateHud();
    toast('工程已载入（' + doc.buildings.length + ' 个建筑）', 'ok');
  }

  function autosave() {
    if (state.doc.buildings.length > 20000) return; // 超大蓝图不自动保存，避免卡顿
    try {
      localStorage.setItem('dsp-studio-autosave', JSON.stringify(projectData()));
    } catch (e) { /* ignore quota */ }
  }

  function tryRestoreAutosave() {
    try {
      var raw = localStorage.getItem('dsp-studio-autosave');
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data.buildings || !data.buildings.length) return false;
      loadProject(raw);
      toast('已恢复上次的工程', 'ok');
      return true;
    } catch (e) { return false; }
  }

  // ---------- DRC：设计规则检查 ----------
  function runDrc() {
    var res = CALC.drc(state.doc.buildings);
    invalidateFlow();
    // 把问题建筑全部高亮出来
    editor.highlight.clear();
    [].concat(res.isolated, res.longSorter, res.unpowered, res.missing).forEach(function (uid) {
      editor.highlight.add(uid);
    });
    editor.render();
    renderInspector();

    var c = res.counts;
    var parts = [];
    if (c.isolated) parts.push('断头带子 ' + c.isolated + ' 条');
    if (c.longSorter) parts.push('爪子过长 ' + c.longSorter + ' 台');
    if (c.unpowered) parts.push('未供电 ' + c.unpowered + ' 台');
    if (c.missing) parts.push('缺料 ' + c.missing + ' 台');
    state.lastDrc = res;
    if (!parts.length) toast('检查通过：没有发现问题', 'ok');
    else toast('检查发现：' + parts.join('，') + '（已高亮）', 'bad');
    return res;
  }

  function drcNode() {
    var res = state.lastDrc || CALC.drc(state.doc.buildings);
    var sec = el('div', 'sec');
    sec.appendChild(el('h3', '', '检查结果（DRC）'));
    var rows = [
      ['断头带子', res.counts.isolated, res.isolated, '没有接到任何带子/爪子的孤立带子'],
      ['爪子过长', res.counts.longSorter, res.longSorter, '伸出超过 2 格，速度会掉一半以上'],
      ['未供电', res.counts.unpowered, res.unpowered, '不在任何供电塔范围内'],
      ['缺料', res.counts.missing, res.missing, '原料没接通或需外部输入']
    ];
    var any = false;
    rows.forEach(function (r) {
      if (!r[1]) return;
      any = true;
      var row = el('div', 'rowlink');
      row.style.cssText = 'display:flex;justify-content:space-between;cursor:pointer;padding:3px 2px;border-bottom:1px solid rgba(255,255,255,.05)';
      var l = el('span', '', r[0]);
      l.style.color = '#ff9c8f';
      var n = el('span', '', r[1] + ' 处');
      row.appendChild(l); row.appendChild(n);
      row.title = r[3];
      row.onclick = function () {
        editor.highlight.clear();
        r[2].forEach(function (uid) { editor.highlight.add(uid); });
        editor.render();
        toast('高亮 ' + r[0] + ' ' + r[1] + ' 处', 'ok');
      };
      sec.appendChild(row);
    });
    if (!any) sec.appendChild(kv('状态', '通过，没有发现问题'));
    sec.appendChild(el('div', 'note', '点任意一行会把对应问题高亮出来；改完再点右上角「检查 (X)」重跑。'));
    return sec;
  }
  // ---------- HUD ----------
  function refreshPower() {
    var st = CALC.powerStatus(state.doc.buildings);
    editor.noPower = new Set(st.unpowered);
    var tag = $('hudPower');
    if (tag) {
      var n = st.unpowered.length;
      if (n) {
        tag.style.display = 'inline';
        tag.textContent = '⚠ 未供电 ' + n + ' 台';
        tag.className = 'warnchip';
      } else {
        tag.style.display = 'none';
      }
    }
    $('btnShowPower').classList.toggle('on', !!editor.showPower);
    $('btnShowWeapon').classList.toggle('on', !!editor.showWeapon);
    $('btnShowPorts').classList.toggle('on', !!editor.showPorts);
    return st;
  }

  function updateHud() {
    var n = state.doc.buildings.length;
    var layerTxt = '';
    if (editor && editor.layer !== null && editor.layer !== undefined) {
      layerTxt = ' · 第 ' + (layerIndex(editor.layer) + 1) + ' 层';
    }
    var hl = editor && editor.highlight && editor.highlight.size;
    if (hl) layerTxt += ' · 高亮 ' + hl + ' 台';
    $('hudInfo').textContent = (n ? (n + ' 个建筑') : '空布局') + layerTxt;
    $('hudZoom').textContent = Math.round(editor.scale / 12 * 100) + '%';
  }

  function layerIndex(z) {
    var ls = editor.layers();
    for (var i = 0; i < ls.length; i++) if (Math.abs(ls[i] - z) < 0.05) return i;
    return 0;
  }

  // 多层：按 z 高度生成楼层按钮
  function renderLayers() {
    var host = $('layerBar');
    if (!host) return;
    host.innerHTML = '';
    var ls = editor.layers();
    if (ls.length <= 1) {
      host.style.display = 'none';
      editor.layer = null;
      return;
    }
    host.style.display = 'flex';
    var allBtn = el('button', 'mini' + (editor.layer === null ? ' on' : ''), '全部');
    allBtn.onclick = function () { editor.layer = null; renderLayers(); renderInspector(); editor.render(); updateHud(); };
    host.appendChild(allBtn);
    ls.forEach(function (z, i) {
      var on = editor.layer !== null && Math.abs(editor.layer - z) < 0.05;
      var btn = el('button', 'mini' + (on ? ' on' : ''), '第' + (i + 1) + '层 z=' + (Math.round(z * 10) / 10));
      btn.onclick = function () {
        editor.layer = z;
        editor.pendingZ = z;
        renderLayers();
        renderInspector();
        editor.render();
        updateHud();
      };
      host.appendChild(btn);
    });
  }

  // ---------- 计算器 ----------
  var calcLast = null;

  function initCalcUI() {
    var dl = $('itemList');
    D.items.forEach(function (it) {
      var o = document.createElement('option');
      o.value = it.name;
      dl.appendChild(o);
    });
    var ms = $('calcMachine');
    D.buildings.filter(function (b) { return b.speed > 0; }).forEach(function (b) {
      var o = document.createElement('option');
      o.value = String(b.id);
      o.textContent = b.name + ' ×' + b.speed;
      ms.appendChild(o);
    });
  }

  function itemIdByName(name) {
    name = (name || '').trim();
    for (var i = 0; i < D.items.length; i++) if (D.items[i].name === name) return D.items[i].id;
    return null;
  }

  function runCalc() {
    var name = $('calcItem').value;
    var id = itemIdByName(name);
    if (!id) return toast('没找到这个物品，请从下拉列表选择', 'bad');
    var rate = parseFloat($('calcRate').value) || 0;
    if (rate <= 0) return toast('产量要大于 0', 'bad');
    var res = CALC.plan(id, rate, {});
    calcLast = res;
    renderCalc(res, id, rate);
  }

  function renderCalc(res, targetId, rate) {
    var out = $('calcOut');
    out.innerHTML = '';
    var head = el('div', 'calchead');
    head.appendChild(el('div', '', '<div class="big">' + fmt(rate) + ' /min</div><div>' + itemName(targetId) + '</div>'));
    head.appendChild(el('div', 'note', '机器 ' + fmt(res.totalMachines) + ' 台 · 电力 ' + fmt(res.power, 2) + ' MW'));
    out.appendChild(head);

    var t = el('table', 'tbl');
    t.innerHTML = '<thead><tr><th>环节</th><th>机器</th><th class="num">数量</th><th class="num">单机/min</th></tr></thead>';
    var tb = el('tbody');
    res.rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', '', r.recipe.name));
      tr.appendChild(el('td', '', r.machine ? r.machine.name : '—'));
      tr.appendChild(el('td', 'num', fmt(r.machines)));
      tr.appendChild(el('td', 'num', r.machine ? fmt(CALC.rateOf(r.recipe, r.recipe.outs[0][1], r.machine.speed)) : '—'));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    out.appendChild(t);

    if (res.raw.length) {
      out.appendChild(el('h3', '', '原始资源需求'));
      var t2 = el('table', 'tbl');
      t2.innerHTML = '<thead><tr><th>资源</th><th class="num">需求 /min</th></tr></thead>';
      var tb2 = el('tbody');
      res.raw.forEach(function (r) {
        var tr = el('tr');
        tr.appendChild(el('td', '', itemName(r.itemId)));
        tr.appendChild(el('td', 'num', fmt(r.rate)));
        tb2.appendChild(tr);
      });
      t2.appendChild(tb2);
      out.appendChild(t2);
    }
  }

  function generateLayoutFromCalc() {
    if (!calcLast || !calcLast.rows.length) return toast('先点「计算」', 'bad');
    var mode = document.querySelector('input[name=calcMode]:checked').value;
    var x = 0, z = 0;
    var added = [];
    calcLast.rows.forEach(function (r) {
      if (!r.machine) return;
      var n = mode === 'ceil' ? Math.ceil(r.machines) : Math.max(1, Math.round(r.machines));
      var cols = Math.ceil(Math.sqrt(n));
      for (var i = 0; i < n; i++) {
        var cx = x + (i % cols) * (r.machine.w + 1);
        var cz = z + Math.floor(i / cols) * (r.machine.h + 1);
        var rec = {
          uid: 0, item: r.machine.id, model: r.machine.model, x: cx, z: cz, yaw: 0,
          recipe: r.recipe.id, params: defaultParams(r.machine.id), extra: null
        };
        addRecord(rec);
        added.push(rec);
      }
      x += cols * (r.machine.w + 1) + 3;
      if (x > 60) { x = 0; z += 12; }
    });
    pushUndo({ kind: 'add', recs: added });
    editor.reindex();
    var bb = bbox(state.doc.buildings, 3);
    state.doc.area = { x: bb.x, y: bb.y, w: bb.w, h: bb.h };
    editor.centerOn(bb);
    editor.render();
    renderInspector();
    updateHud();
    switchTab('design');
    toast('已生成 ' + added.length + ' 台机器（配方已设置）', 'ok');
  }

  // ---------- 标签页 ----------
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    $('viewDesign').classList.toggle('hidden', name !== 'design');
    $('viewCalc').classList.toggle('hidden', name !== 'calc');
    if (name === 'design') { editor.requestRender(); }
    else { try { runCalc(); } catch (e) { /* 输入不完整时忽略 */ } }
  }

  // ---------- 复制粘贴 ----------
  function copySelection() {
    var sel = editor.selectedObjects();
    if (!sel.length) return;
    state.clipboard = sel.map(function (b) {
      return {
        item: b.item, model: b.model, x: b.x, y: b.y, z: b.z, yaw: b.yaw,
        recipe: b.recipe, params: b.params ? b.params.slice() : [], extra: b.extra
      };
    });
    toast('已复制 ' + sel.length + ' 个建筑', 'ok');
  }

  function pasteSelection() {
    if (!state.clipboard.length) return;
    var minX = Infinity, minY = Infinity;
    state.clipboard.forEach(function (b) { minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); });
    var ox = 1, oy = 1;
    var added = [];
    state.clipboard.forEach(function (c) {
      var rec = {
        uid: 0, item: c.item, model: c.model,
        x: Math.round(c.x - minX) + ox, y: Math.round(c.y - minY) + oy, z: c.z || 0,
        yaw: c.yaw, recipe: c.recipe, params: c.params.slice(), extra: c.extra
      };
      addRecord(rec);
      added.push(rec);
    });
    // 避免重叠：整体右移
    var tries = 0;
    while (tries < 30) {
      var bad = added.some(function (b) {
        var cells = editor.cellsFor(b.item, b.x, b.y, b.yaw);
        return editor.collides(cells, b.uid);
      });
      if (!bad) break;
      added.forEach(function (b) { b.x += 1; b.y += 1; });
      tries++;
    }
    pushUndo({ kind: 'add', recs: added });
    editor.selection.clear();
    added.forEach(function (b) { editor.selection.add(b.uid); });
    editor.reindex();
    editor.render();
    renderInspector();
    toast('已粘贴 ' + added.length + ' 个建筑', 'ok');
  }

  // ---------- 初始化 ----------
  var editor;
  function init() {
    editor = new global.DSPEditor($('cv'));

    editor.on('place', function (item, x, y, z, yaw) { return placeBuilding(item, x, y, z, yaw); });
    editor.on('erase', function (list) { eraseBuildings(list); });
    editor.on('select', function (sel) {
      var list = (sel && sel.length !== undefined) ? sel : editor.selectedObjects();
      // EDA 手感：只选中一条传送带时，自动高亮整条相连的产线（网络）
      if (list && list.length === 1 && list[0].item >= 2001 && list[0].item <= 2003) {
        var n = editor.highlightNet(list[0]);
        editor.render();
        if (n > 1) toast('网络高亮：' + n + ' 段传送带（Esc 取消）', 'ok');
      }
      renderInspector();
    });
    editor.on('cancel', function () {
      document.querySelectorAll('.pitem').forEach(function (n) { n.classList.remove('active'); });
      state.highlightItem = null;
      renderInspector();
      updateHud();
    });
    editor.on('hover', function (b) {
      if (!b) { updateHud(); return; }
      var def = buildingsById[b.item];
      $('hudInfo').textContent = (def ? def.name : '#' + b.item) + '  (' + (Math.round(b.x * 10) / 10) + ', ' + (Math.round(b.y * 10) / 10) + ')' +
        ((b.z || 0) ? '  z=' + (Math.round(b.z * 100) / 100) : '') +
        (b.recipe && recipesById[b.recipe] ? ' · ' + recipesById[b.recipe].name : '');
    });
    editor.on('moved', function (origins) {
      var arr = [];
      origins.forEach(function (o) {
        arr.push({ uid: o.ref.uid, fromX: o.x, fromY: o.y, toX: o.ref.x, toY: o.ref.y });
      });
      pushUndo({ kind: 'move', origins: arr });
      renderInspector();
    });
    editor.on('yaw', function () { });

    buildPalette('');
    $('paletteSearch').oninput = function () { buildPalette(this.value); };

    editor.setDoc(state.doc);
    editor.centerOn({ x: -2, y: -2, w: 30, h: 30 });

    $('btnNew').onclick = function () {
      if (state.doc.buildings.length && !confirm('新建会清空当前画布，继续？')) return;
      state.uid = 1;
      state.doc = newDoc();
      state.undo = [];
      state.redo = [];
      editor.setDoc(state.doc);
      editor.centerOn({ x: -2, y: -2, w: 30, h: 30 });
      renderLayers();
      renderInspector();
      updateHud();
    };
    $('btnImport').onclick = openImportDialog;
    $('btnExport').onclick = function () { doExport(); };
    $('btnSaveProj').onclick = saveProject;
    $('btnOpenProj').onclick = function () { $('fileProj').click(); };
    $('fileProj').onchange = function () {
      var f = this.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try { loadProject(String(r.result)); }
        catch (e) { toast('打开失败：' + e.message, 'bad'); }
      };
      r.readAsText(f, 'utf-8');
      this.value = '';
    };
    $('fileBp').onchange = function () {
      var f = this.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        importFromString(String(r.result).trim()).catch(function (e) {
          toast('导入失败：' + e.message, 'bad');
        });
      };
      r.readAsText(f, 'utf-8');
      this.value = '';
    };

    document.querySelectorAll('.tab').forEach(function (t) {
      t.onclick = function () { switchTab(t.dataset.tab); };
    });

    $('btnFit').onclick = function () {
      var bb = bbox(state.doc.buildings, 3);
      editor.centerOn(bb.length ? bb : { x: -2, y: -2, w: 30, h: 30 });
    };
    $('btnShowPower').onclick = function () {
      editor.showPower = !editor.showPower;
      var st = refreshPower();
      editor.render();
      if (editor.showPower) {
        toast(st.unpowered.length ? ('未供电 ' + st.unpowered.length + ' 台（红框标记）') : '所有建筑都在供电范围内',
          st.unpowered.length ? 'bad' : 'ok');
      }
    };
    $('btnShowWeapon').onclick = function () {
      editor.showWeapon = !editor.showWeapon;
      refreshPower();
      editor.render();
    };
    $('btnShowPorts').onclick = function () {
      editor.showPorts = !editor.showPorts;
      refreshPower();
      editor.render();
    };
    $('btnZoomIn').onclick = function () { editor.scale = Math.min(64, editor.scale * 1.25); editor.render(); updateHud(); };
    $('btnZoomOut').onclick = function () { editor.scale = Math.max(2, editor.scale / 1.25); editor.render(); updateHud(); };

    $('modalClose').onclick = closeModal;
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });

    // 检查（DRC）
    $('btnCheck').onclick = runDrc;

    // EDA 风格快捷键：W 走线 / S 选择 / E 删除 / X 检查 / F 适应 / R 旋转（编辑器内处理）
    window.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var k = (e.key || '').toLowerCase();
      if (k === 'w') { pickTool('belt'); e.preventDefault(); }
      else if (k === 's') { pickTool('select'); e.preventDefault(); }
      else if (k === 'e') { pickTool('erase'); e.preventDefault(); }
      else if (k === 'x') { runDrc(); e.preventDefault(); }
      else if (k === 'f') { var bb = bbox(state.doc.buildings, 3); editor.centerOn(bb.length ? bb : { x: -2, y: -2, w: 30, h: 30 }); }
    });

    function pickTool(kind) {
      if (kind === 'select') {
        editor.tool = 'select';
        editor.pendingItem = null;
        document.querySelectorAll('.pitem').forEach(function (n) { n.classList.remove('active'); });
        $('hudInfo').textContent = '选择模式';
        editor.render();
        return;
      }
      if (kind === 'erase') {
        editor.tool = 'erase';
        editor.pendingItem = null;
        $('hudInfo').textContent = '删除模式（点建筑即删）';
        editor.render();
        return;
      }
      if (kind === 'belt') {
        // 直接切到极速传送带并进入放置模式
        var target = null;
        var items = document.querySelectorAll('.pitem');
        for (var i = 0; i < items.length; i++) {
          if (items[i].textContent.indexOf('极速传送带') >= 0) { target = items[i]; break; }
        }
        if (target) target.click();
      }
    }

    initCalcUI();
    renderLayers();
    // 应用本机保存的建筑参数覆盖（占地/半径）
    (function () {
      var o = loadOverrides();
      Object.keys(o).forEach(function (id) { applyOverride(+id, o[id]); });
      loadPorts();
    })();
    refreshPower();
    $('btnCalc').onclick = runCalc;
    $('btnGenLayout').onclick = generateLayoutFromCalc;

    // 拖入蓝图文件
    var wrap = document.querySelector('.canvas-wrap');
    ['dragenter', 'dragover'].forEach(function (ev) {
      wrap.addEventListener(ev, function (e) { e.preventDefault(); wrap.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      wrap.addEventListener(ev, function (e) { e.preventDefault(); wrap.classList.remove('dragover'); });
    });
    wrap.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        importFromString(String(r.result).trim()).catch(function (err) {
          toast('导入失败：' + err.message, 'bad');
        });
      };
      r.readAsText(f, 'utf-8');
    });

    document.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      var ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (ctrl && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); }
      else if (ctrl && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteSelection(); }
      else if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); }
      else if (ctrl && e.key.toLowerCase() === 'o') { e.preventDefault(); $('fileProj').click(); }
      else if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        editor.selection.clear();
        state.doc.buildings.forEach(function (b) { editor.selection.add(b.uid); });
        editor.render();
        renderInspector();
      }
    });

    setInterval(autosave, 8000);
    renderInspector();
    updateHud();
    if (!tryRestoreAutosave()) {
      // 首次打开：给个示例
      toast('提示：先在左侧选择建筑，然后在画布上点击放置', '');
    }
    setTimeout(function () { editor.render(); }, 30);
    global.addEventListener('resize', function () { editor.requestRender(); });

    if (location.search.indexOf('selftest') >= 0) {
      runSelfTest().catch(function (e) {
        document.title = 'SELFTEST ERROR ' + e.message;
      });
    }
    if (location.hash === '#calc') switchTab('calc');
  }

  // 自检：放几台机器 -> 生成蓝图 -> 解析回来
  async function runSelfTest() {
    placeBuilding(2303, 3, 3, 0, 0);
    placeBuilding(2303, 8, 3, 0, 0);
    placeBuilding(2302, 13, 3, 0, 90);
    placeBuilding(2003, 3, 8, 0, 270);
    state.doc.buildings.forEach(function (b, i) {
      if (i === 0 || i === 1) b.recipe = 1;
      if (i === 2) b.recipe = 1;
    });
    renderInspector();
    var area = bbox(state.doc.buildings, 2);
    var recs = state.doc.buildings.map(recordToExport);
    var str = await BP.build(recs, {
      version: state.doc.header.version, layout: 10,
      gameVersion: state.doc.header.gameVersion,
      shortDesc: '自检', desc: '', dragX: area.w, dragY: area.h, areas: state.doc.areas, trailer: state.doc.trailer
    });
    var p = BP.parse(str);
    await BP.parsePayload(p);
    var ok = p.hashOk && p.buildings.length === recs.length;
    if (ok) {
      ok = p.buildings.every(function (b, i) {
        return b.item === recs[i].item && b.recipe === recs[i].recipe &&
          Math.abs(b.p0.x - recs[i].p0.x) < 1e-3 && Math.abs(b.p0.z - recs[i].p0.z) < 1e-3;
      });
    }
    document.title = 'SELFTEST ' + (ok ? 'PASS' : 'FAIL') + ' n=' + recs.length + ' len=' + str.length;
    $('hudInfo').textContent = document.title;
    editor.centerOn(bbox(state.doc.buildings, 4));
    return ok;
  }

  global.addEventListener('DOMContentLoaded', init);
  global.DSPAPP.tryRestoreAutosave = tryRestoreAutosave;
  global.DSPAPP.importString = importFromString;
  global.DSPAPP.exportString = doExport;
  global.DSPAPP.count = function () { return state.doc.buildings.length; };
  global.DSPAPP.debug = {
    state: state,
    get editor() { return editor; },
    place: placeBuilding,
    erase: eraseBuildings,
    highlight: toggleHighlight,
    renderInspector: renderInspector,
    invalidateFlow: invalidateFlow,
    flow: computeFlow,
    layers: function () { return editor.layers(); }
  };
})(window);
