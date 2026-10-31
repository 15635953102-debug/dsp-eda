// 戴森球计划 蓝图字符串 编解码
// 容器格式: BLUEPRINT:<header-cells>,"<base64(gzip(payload))>"<MD5F>
// payload: 7 x int32 元数据 + u8 区域数 + 区域(14B) * n + int32 建筑数 + 建筑记录...
(function (global) {
  'use strict';

  // ---------- bytes / base64 ----------
  function b64encode(bytes) {
    var s = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  function b64decode(str) {
    var s = atob(str);
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // ---------- gzip ----------
  async function gzip(bytes) {
    if (typeof CompressionStream === 'undefined') {
      throw new Error('此浏览器不支持 CompressionStream，请使用较新版 Chrome/Edge');
    }
    var cs = new CompressionStream('gzip');
    var stream = new Blob([bytes]).stream().pipeThrough(cs);
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function gunzip(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('此浏览器不支持 DecompressionStream，请使用较新版 Chrome/Edge');
    }
    var ds = new DecompressionStream('gzip');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  // ---------- 读写器 ----------
  function Reader(bytes) {
    this.b = bytes;
    this.p = 0;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  Reader.prototype = {
    i8: function () { var v = this.dv.getInt8(this.p); this.p += 1; return v; },
    u8: function () { var v = this.dv.getUint8(this.p); this.p += 1; return v; },
    i16: function () { var v = this.dv.getInt16(this.p, true); this.p += 2; return v; },
    i32: function () { var v = this.dv.getInt32(this.p, true); this.p += 4; return v; },
    f32: function () { var v = this.dv.getFloat32(this.p, true); this.p += 4; return v; },
    xyz: function () { return { x: this.f32(), y: this.f32(), z: this.f32() }; },
    bytes: function (n) { var v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
  };

  function Writer(size) {
    this.b = new Uint8Array(size);
    this.p = 0;
    this.dv = new DataView(this.b.buffer);
  }
  Writer.prototype = {
    i8: function (v) { this.dv.setInt8(this.p, v); this.p += 1; },
    u8: function (v) { this.dv.setUint8(this.p, v); this.p += 1; },
    i16: function (v) { this.dv.setInt16(this.p, v, true); this.p += 2; },
    i32: function (v) { this.dv.setInt32(this.p, v, true); this.p += 4; },
    f32: function (v) { this.dv.setFloat32(this.p, v, true); this.p += 4; },
    xyz: function (o) { this.f32(o.x); this.f32(o.y); this.f32(o.z); }
  };

  function isBelt(item) { return item > 2000 && item < 2010; }
  function isSorter(item) { return item > 2010 && item < 2020; }

  // ---------- 解析 ----------
  function parse(str) {
    str = (str || '').trim();
    if (str.indexOf('BLUEPRINT:') !== 0) throw new Error('不是蓝图字符串（应以 BLUEPRINT: 开头）');
    var p1 = str.indexOf('"', 10);
    if (p1 < 0) throw new Error('蓝图表头缺少引号');
    var p2 = str.length - 33;
    if (p2 < p1 || str.charAt(p2) !== '"') throw new Error('蓝图校验段格式不正确');
    var cells = str.slice(10, p1).split(',');
    var b64 = str.slice(p1 + 1, p2);
    var given = str.slice(p2 + 1).toUpperCase();
    var calc = global.DSPMD5.hash(global.DSPMD5.utf8Bytes(str.slice(0, p2)));
    return {
      raw: str,
      cells: cells,
      b64: b64,
      hash: given,
      hashCalc: calc,
      hashOk: given === calc,
      header: {
        layout: parseInt(cells[1], 10) || 0,
        icons: cells.slice(2, 7).map(function (s) { return parseInt(s, 10) || 0; }),
        time: parseInt(cells[8], 10) || 0,
        gameVersion: cells[9] || '',
        shortDesc: safeDecode(cells[10]),
        desc: safeDecode(cells[cells.length - 1] || '')
      }
    };
  }

  function safeDecode(s) {
    try { return decodeURIComponent(s || ''); } catch (e) { return s || ''; }
  }

  // 解压并解析二进制部分（带重同步：遇到无法识别的记录时跳过并继续）
  async function parsePayload(parsed) {
    var gz = b64decode(parsed.b64);
    var raw = await gunzip(gz);
    var r = new Reader(raw);
    var meta = {
      version: r.i32(),
      cursorX: r.i32(),
      cursorY: r.i32(),
      cursorTargetArea: r.i32(),
      dragX: r.i32(),
      dragY: r.i32(),
      primaryArea: r.i32()
    };
    var areaCount = r.u8();
    var areas = [];
    for (var i = 0; i < areaCount; i++) {
      areas.push({
        index: r.i8(), parent: r.i8(), tropicAnchor: r.i16(), areaSegments: r.i16(),
        anchorX: r.i16(), anchorY: r.i16(), w: r.i16(), h: r.i16()
      });
    }
    var count = r.i32();
    var dataStart = r.p;
    var buildings = [];
    var warnings = { skipped: 0, recovered: 0, details: [] };
    var p = dataStart;

    while (buildings.length < count && p < raw.length && warnings.skipped < 5000) {
      var b = tryRead(raw, p);
      if (b) {
        buildings.push(b);
        p += b.byteLength;
        continue;
      }
      // 记录长度异常：抢救头部，然后跳到下一个可信记录
      var head = recoverHead(raw, p);
      var next = resync(raw, p + 4);
      if (!head || next < 0) { warnings.fatal = true; break; }
      head.index = buildings.length;
      head.byteLength = next - p;
      head.recovered = true;
      buildings.push(head);
      warnings.skipped++;
      if (warnings.details.length < 20) warnings.details.push({ index: buildings.length - 1, offset: p });
      p = next;
    }
    parsed.meta = meta;
    parsed.areas = areas;
    parsed.buildings = buildings;
    parsed.declaredCount = count;
    parsed.warnings = warnings;
    var trailerStart = p;
    parsed.trailer = (trailerStart !== null && trailerStart <= raw.length)
      ? raw.subarray(trailerStart)
      : null;
    parsed.rawLength = raw.length;
    return parsed;
  }

  var MARKERS = [-100, -101, -102, -103, -104];

  // 读取一条建筑记录：自行推算尾部长度（0/4/8/12 字节）并用“下一条记录标记”校验
  function tryRead(raw, s) {
    var dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    var f32 = function (o) { return dv.getFloat32(o, true); };
    var i32 = function (o) { return dv.getInt32(o, true); };
    var i16 = function (o) { return dv.getInt16(o, true); };
    var i8 = function (o) { return dv.getInt8(o); };
    try {
      var marker = i32(s);
      if (MARKERS.indexOf(marker) < 0) return null;
      var idx = i32(s + 4);
      var item = i16(s + 8);
      var model = i16(s + 10);
      if (!(item >= 1000 && item <= 8000)) return null;
      if (!(model >= 0 && model <= 8000)) return null;
      var area = i8(s + 12);
      if (area < -1 || area > 64) return null;
      var p0 = { x: f32(s + 13), y: f32(s + 17), z: f32(s + 21) };
      if (!(Math.abs(p0.x) < 1e6 && Math.abs(p0.y) < 1e6 && Math.abs(p0.z) < 1e6)) return null;
      var yaw = f32(s + 25);
      var typeExtra = isBelt(item) ? 4 : (isSorter(item) ? 32 : 0);
      var pcPos = s + 29 + typeExtra + 18;
      var pc = i16(pcPos);
      if (!(pc >= 0 && pc <= 8192)) return null;
      var baseLen = 29 + typeExtra + 20 + 4 * pc;

      var chosen = -1;
      for (var g = 0; g <= 16; g += 4) {
        var np = s + baseLen + g;
        if (np > raw.length) break;
        if (np === raw.length) { chosen = g; break; }
        if (np + 24 <= raw.length) {
          var m2 = i32(np);
          var it2 = i16(np + 8);
          if (MARKERS.indexOf(m2) >= 0 && it2 >= 1000 && it2 <= 6000) { chosen = g; break; }
        } else if (raw.length - np <= 60) {
          chosen = g;
          break;
        }
      }
      if (chosen < 0) {
        // 最后一条：剩余字节 = 尾部字段 + 蓝图尾注，全部原样保留
        var leftover = raw.length - (s + baseLen);
        if (leftover >= 0) chosen = leftover >= 4 ? 4 : leftover;
      }
      if (chosen < 0) return null;

      var p = s + 29;
      var tilt = 0, pitch = 0, tilt2 = 0, pitch2 = 0;
      var p1 = { x: p0.x, y: p0.y, z: p0.z };
      var yaw1 = yaw;
      if (isBelt(item)) {
        tilt = f32(p); tilt2 = tilt; p += 4;
      } else if (isSorter(item)) {
        tilt = f32(p); pitch = f32(p + 4);
        p1 = { x: f32(p + 8), y: f32(p + 12), z: f32(p + 16) };
        yaw1 = f32(p + 20);
        tilt2 = f32(p + 24); pitch2 = f32(p + 28);
        p += 32;
      }
      var outo = i32(p), ino = i32(p + 4);
      var s1 = i8(p + 8), s2 = i8(p + 9), s3 = i8(p + 10), s4 = i8(p + 11), s5 = i8(p + 12), s6 = i8(p + 13);
      var recipe = i16(p + 14);
      var filter = i16(p + 16);
      var paramsStart = p + 20;
      var params = [];
      for (var k2 = 0; k2 < pc; k2++) params.push(i32(paramsStart + k2 * 4));
      var suffix = null;
      if (chosen > 0) {
        suffix = [];
        for (var m = 0; m < chosen; m++) suffix.push(raw[paramsStart + 4 * pc + m]);
      }
      return {
        marker: marker, index: idx, item: item, model: model, area: area,
        p0: p0, p1: p1, yaw0: yaw, yaw1: yaw1,
        tilt: tilt, tilt2: tilt2, pitch: pitch, pitch2: pitch2,
        outo: outo, ino: ino,
        s01: s1, s02: s2, s03: s3, s04: s4, s05: s5, s06: s6,
        recipe: recipe, filter: filter, params: params,
        suffix: suffix,
        byteLength: baseLen + chosen
      };
    } catch (err) {
      return null;
    }
  }

  // 只抢救记录头部（标记/序号/物品/坐标/朝向），配方与参数丢弃
  function recoverHead(raw, p) {
    try {
      var dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      var marker = dv.getInt32(p, true);
      if (MARKERS.indexOf(marker) < 0) return null;
      var idx = dv.getInt32(p + 4, true);
      if (idx < 0 || idx > 200000) return null;
      var item = dv.getInt16(p + 8, true);
      if (!(item >= 1000 && item <= 8000)) return null;
      var model = dv.getInt16(p + 10, true);
      var area = dv.getInt8(p + 12);
      var p0 = {
        x: dv.getFloat32(p + 13, true),
        y: dv.getFloat32(p + 17, true),
        z: dv.getFloat32(p + 21, true)
      };
      if (!(Math.abs(p0.x) < 1e6 && Math.abs(p0.y) < 1e6 && Math.abs(p0.z) < 1e6)) return null;
      var yaw = dv.getFloat32(p + 25, true);
      var b = {
        marker: marker, index: idx, item: item, model: model, area: area,
        p0: p0, p1: { x: p0.x, y: p0.y, z: p0.z }, yaw0: yaw, yaw1: yaw,
        tilt: 0, tilt2: 0, pitch: 0, pitch2: 0,
        outo: -1, ino: -1, s01: 0, s02: 0, s03: 0, s04: 0, s05: 0, s06: 0,
        recipe: 0, filter: 0, params: [], recovered: true
      };
      return b;
    } catch (e) {
      return null;
    }
  }

  // 在字节流中寻找下一条可信记录（标记 + 合理物品/坐标；不依赖序号连续）
  function resync(raw, from) {
    var dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    var limit = Math.min(raw.length - 40, from + 8192);
    for (var p = from; p < limit; p++) {
      var m = dv.getInt32(p, true);
      if (MARKERS.indexOf(m) < 0) continue;
      var item = dv.getInt16(p + 8, true);
      if (!(item >= 1000 && item <= 8000)) continue;
      var model = dv.getInt16(p + 10, true);
      if (!(model >= 0 && model <= 8000)) continue;
      var area = dv.getInt8(p + 12);
      if (area < -1 || area > 64) continue;
      var ok = true;
      for (var k = 0; k < 3; k++) {
        var f = dv.getFloat32(p + 13 + k * 4, true);
        if (!(f > -1e6 && f < 1e6)) { ok = false; break; }
      }
      if (ok) return p;
    }
    return -1;
  }

  function readBuilding(r) {
    var marker = r.i32();
    var b = { marker: marker };
    if (marker <= -101) {
      b.index = r.i32();
      b.item = r.i16();
      b.model = r.i16();
      b.area = r.i8();
      b.p0 = r.xyz();
      b.yaw0 = r.f32();
      b.p1 = { x: b.p0.x, y: b.p0.y, z: b.p0.z };
      b.yaw1 = b.yaw0;
      b.tilt = 0; b.tilt2 = 0; b.pitch = 0; b.pitch2 = 0;
      if (isBelt(b.item)) {
        b.tilt = r.f32();
        b.tilt2 = b.tilt;
      } else if (isSorter(b.item)) {
        b.tilt = r.f32();
        b.pitch = r.f32();
        b.p1 = r.xyz();
        b.yaw1 = r.f32();
        b.tilt2 = r.f32();
        b.pitch2 = r.f32();
      }
    } else if (marker <= -100) {
      b.index = r.i32();
      b.area = r.i8();
      b.p0 = r.xyz();
      b.p1 = r.xyz();
      b.yaw0 = r.f32(); b.yaw1 = r.f32();
      b.tilt = r.f32(); b.tilt2 = 0; b.pitch = 0; b.pitch2 = 0;
      b.item = r.i16();
      b.model = r.i16();
    } else {
      b.index = marker;
      b.area = r.i8();
      b.p0 = r.xyz();
      b.p1 = r.xyz();
      b.yaw0 = r.f32(); b.yaw1 = r.f32();
      b.tilt = 0; b.tilt2 = 0; b.pitch = 0; b.pitch2 = 0;
      b.item = r.i16();
      b.model = r.i16();
    }
    b.outo = r.i32();
    b.ino = r.i32();
    b.s01 = r.i8(); b.s02 = r.i8(); b.s03 = r.i8(); b.s04 = r.i8(); b.s05 = r.i8(); b.s06 = r.i8();
    b.recipe = r.i16();
    b.filter = r.i16();
    var pc = r.i16();
    b.params = [];
    for (var i = 0; i < pc; i++) b.params.push(r.i32());
    // 0.10.31+ 的记录（marker <= -102）在参数后多一个 int32
    if (marker <= -102) b.extra4 = r.i32();
    return b;
  }

  function buildingSize(b) {
    if (isBelt(b.item)) return b.params && b.params.length ? 0 : 0;
    return 0;
  }

  // ---------- 生成 ----------
  // opts: {version, dragX, dragY, layout, gameVersion, shortDesc, desc, icons}
  async function build(buildings, opts) {
    opts = opts || {};
    var version = opts.version || 1;
    var trailer = opts.trailer || null;
    // 多区域（跨纬度带）蓝图：沿用导入时的区域表，避免子区域建筑错位
    var areas = (opts.areas && opts.areas.length) ? opts.areas : [{
      index: 0, parent: -1, tropicAnchor: 0, areaSegments: 200,
      anchorX: 0, anchorY: 0, w: opts.dragX || 1, h: opts.dragY || 1
    }];
    var size = 28 + 1 + 14 * areas.length + 4;
    for (var i = 0; i < buildings.length; i++) size += buildingBytes(buildings[i]);
    if (trailer && trailer.length) size += trailer.length;
    var w = new Writer(size + 64);
    w.i32(version);
    w.i32(opts.cursorX || 0);
    w.i32(opts.cursorY || 0);
    w.i32(0);
    w.i32(opts.dragX || 1);
    w.i32(opts.dragY || 1);
    w.i32(0);
    w.u8(areas.length);
    for (var ai = 0; ai < areas.length; ai++) {
      var a = areas[ai];
      w.i8(a.index);
      w.i8(a.parent);
      w.i16(a.tropicAnchor || 0);
      w.i16(a.areaSegments || 200);
      w.i16(a.anchorX || 0);
      w.i16(a.anchorY || 0);
      w.i16(a.w || 1);
      w.i16(a.h || 1);
    }
    w.i32(buildings.length);
    for (var k = 0; k < buildings.length; k++) writeBuilding(w, buildings[k], k);
    if (trailer && trailer.length) {
      w.b.set(new Uint8Array(trailer), w.p);
      w.p += trailer.length;
    }
    var payload = w.b.subarray(0, w.p);
    var gz = await gzip(payload);
    var b64 = b64encode(gz);

    var cells = [];
    cells.push('1');
    cells.push(String(opts.layout || 10));
    var icons = opts.icons || [0, 0, 0, 0, 0];
    for (var c = 0; c < 5; c++) cells.push(String(icons[c] || 0));
    cells.push('0');
    cells.push(String(opts.time || csharpNow()));
    cells.push(opts.gameVersion || '0.10.34.28529');
    cells.push(encodeURIComponent(opts.shortDesc || '新蓝图'));
    cells.push('');
    cells.push('');
    cells.push('');
    cells.push(encodeURIComponent(opts.desc || ''));

    var head = 'BLUEPRINT:' + cells.join(',') + ',"' + b64;
    var hash = global.DSPMD5.hash(global.DSPMD5.utf8Bytes(head));
    return head + '"' + hash;
  }

  function buildingBytes(b) {
    var n = 4 + 4 + 2 + 2 + 1 + 12 + 4;
    if (isBelt(b.item)) n += 4;
    else if (isSorter(b.item)) n += 4 + 4 + 12 + 4 + 4 + 4;
    n += 4 + 4 + 6 + 2 + 2 + 2;
    n += 4 * (b.params ? b.params.length : 0);
    // 原样保留的记录尾部（新版游戏每条 -102 记录末尾的额外字段）
    var sfx = b.suffix || (b.marker !== undefined && b.marker <= -102 ? [0, 0, 0, 0] : []);
    n += sfx.length;
    return n;
  }

  function writeBuilding(w, b, index) {
    var marker = b.marker === undefined ? -101 : b.marker;
    // 旧版记录（-100 / 无标记）统一改写为 -101 布局；-102 保留其尾部字段
    if (marker > -102) marker = -101;
    w.i32(marker);
    w.i32(index);
    w.i16(b.item);
    w.i16(b.model || 0);
    w.i8(b.area || 0);
    w.xyz(b.p0);
    w.f32(b.yaw0 || 0);
    if (isBelt(b.item)) {
      w.f32(b.tilt || 0);
    } else if (isSorter(b.item)) {
      w.f32(b.tilt || 0);
      w.f32(b.pitch || 0);
      w.xyz(b.p1 || b.p0);
      w.f32(b.yaw1 === undefined ? (b.yaw0 || 0) : b.yaw1);
      w.f32(b.tilt2 || 0);
      w.f32(b.pitch2 || 0);
    }
    w.i32(b.outo === undefined ? -1 : b.outo);
    w.i32(b.ino === undefined ? -1 : b.ino);
    w.i8(b.s01 === undefined ? 0 : b.s01);
    w.i8(b.s02 === undefined ? 0 : b.s02);
    w.i8(b.s03 === undefined ? 0 : b.s03);
    w.i8(b.s04 === undefined ? 0 : b.s04);
    w.i8(b.s05 === undefined ? 0 : b.s05);
    w.i8(b.s06 === undefined ? 0 : b.s06);
    w.i16(b.recipe || 0);
    w.i16(b.filter || 0);
    var params = b.params || [];
    w.i16(params.length);
    for (var i = 0; i < params.length; i++) w.i32(params[i]);
    // 记录尾部：优先原样回写；没有原始数据时按 -102 惯例补 4 字节
    var sfx = b.suffix || (marker <= -102 ? [0, 0, 0, 0] : []);
    for (var j = 0; j < sfx.length; j++) w.b[w.p + j] = sfx[j] & 0xff;
    w.p += sfx.length;
  }

  function csharpNow() {
    return Date.now() * 10000 + 621355968000000000;
  }

  function ticksToDate(ticks) {
    if (!ticks) return null;
    return new Date((ticks - 621355968000000000) / 10000);
  }

  function dateToTicks(d) {
    return d.getTime() * 10000 + 621355968000000000;
  }

  global.DSPBP = {
    parse: parse,
    parsePayload: parsePayload,
    build: build,
    ticksToDate: ticksToDate,
    dateToTicks: dateToTicks,
    csharpNow: csharpNow,
    isBelt: isBelt,
    isSorter: isSorter,
    b64decode: b64decode
  };
})(window);
