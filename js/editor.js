// 网格编辑器（Canvas 2D）
// 坐标约定：蓝图平面为 (x, y)，z 为高度（可用于多层/浮空建筑）
(function (global) {
  'use strict';

  var CAT_COLOR = {
    machine: '#c8863c',
    lab: '#7a6bd6',
    belt: '#3e6b7a',
    sorter: '#4a7a5e',
    logistics: '#3f6f8f',
    power: '#8f7a3f',
    miner: '#6f5a3f',
    defense: '#7a3f3f',
    misc: '#555a63'
  };

  // 层高按 0.5 格分桶，避免浮点噪声制造出假楼层
  function zKey(z) {
    return Math.round((z || 0) * 2) / 2;
  }

  function Editor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 12;
    this.ox = 0;
    this.oy = 0;
    this.doc = null;
    this.hooks = {};
    this.selection = new Set();
    this.highlight = new Set();
    this.hover = null;
    this.tool = 'select';
    this.pendingItem = null;
    this.pendingYaw = 0;
    this.pendingZ = 0;
    this.drag = null;
    this.spatial = new Map();
    this.layer = null;      // 当前层（z 值），null = 全部
    this.showPower = false; // 显示供电范围
    this.showWeapon = false;// 显示武器射程
    this.showPorts = true;  // 显示建筑输入输出口
    this._stroke = null;    // 传送带连铺状态
    this.noPower = null;    // 未供电建筑 uid 集合
    this._raf = null;
    this._bind();
  }

  Editor.prototype = {
    setDoc: function (doc) {
      this.doc = doc;
      this.selection.clear();
      this.highlight.clear();
      this.reindex();
      this.render();
    },

    on: function (name, fn) { this.hooks[name] = fn; },

    // 空间索引：格子 -> 建筑
    reindex: function () {
      this.spatial = new Map();
      if (!this.doc) return;
      for (var i = 0; i < this.doc.buildings.length; i++) {
        var b = this.doc.buildings[i];
        var fp = this.footprint(b);
        for (var x = Math.floor(fp.x); x < Math.ceil(fp.x + fp.w); x++) {
          for (var y = Math.floor(fp.y); y < Math.ceil(fp.y + fp.h); y++) {
            var key = x + ',' + y;
            var arr = this.spatial.get(key);
            if (!arr) { arr = []; this.spatial.set(key, arr); }
            arr.push(b);
          }
        }
      }
    },

    // 建筑以“中心点”存储；占地在渲染/碰撞时对齐到整格（游戏里也是按格占位）
    footprint: function (b) {
      var def = global.DSPAPP.buildingsById[b.item];
      var w = def ? def.w : 1, h = def ? def.h : 1;
      var rot = Math.abs((b.yaw || 0) % 180) > 1;
      if (rot) { var t = w; w = h; h = t; }
      return {
        x: Math.round(b.x - w / 2),
        y: Math.round(b.y - h / 2),
        w: w, h: h
      };
    },

    // 层（z）→ 楼层编号列表
    layers: function () {
      if (!this.doc) return [];
      var seen = {};
      var out = [];
      for (var i = 0; i < this.doc.buildings.length; i++) {
        var z = zKey(this.doc.buildings[i].z);
        if (seen[z]) continue;
        seen[z] = 1;
        out.push(z);
      }
      out.sort(function (a, b) { return a - b; });
      return out;
    },

    onLayer: function (b) {
      if (this.layer === null || this.layer === undefined) return true;
      return Math.abs(zKey(b.z) - this.layer) < 0.25;
    },

    pick: function (wx, wy) {
      var cx = Math.floor(wx), cy = Math.floor(wy);
      var arr = this.spatial.get(cx + ',' + cy);
      if (!arr || !arr.length) return null;
      // 优先当前层，其次任意层（取最高层）
      var best = null;
      for (var i = arr.length - 1; i >= 0; i--) {
        var b = arr[i];
        var fp = this.footprint(b);
        if (wx < fp.x || wx >= fp.x + fp.w || wy < fp.y || wy >= fp.y + fp.h) continue;
        if (this.onLayer(b)) return b;
        if (!best || (b.z || 0) > (best.z || 0)) best = b;
      }
      return best;
    },

    // ---------- 坐标变换 ----------
    toWorld: function (sx, sy) {
      return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale };
    },

    requestRender: function () {
      if (this._raf) return;
      var self = this;
      this._raf = requestAnimationFrame(function () {
        self._raf = null;
        self.render();
      });
    },

    render: function () {
      var cv = this.canvas, ctx = this.ctx;
      var dpr = global.devicePixelRatio || 1;
      var w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) {
        cv.width = Math.floor(w * dpr);
        cv.height = Math.floor(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#12151b';
      ctx.fillRect(0, 0, w, h);

      if (!this.doc) return;

      var s = this.scale;
      var x0 = Math.floor(-this.ox / s), x1 = Math.ceil((w - this.ox) / s);
      var y0 = Math.floor(-this.oy / s), y1 = Math.ceil((h - this.oy) / s);

      // 网格（细格 1×1，粗格 10×10）
      if (s >= 4) {
        ctx.strokeStyle = '#1b2029';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var gx = x0; gx <= x1; gx++) {
          var px = Math.round(gx * s + this.ox) + 0.5;
          ctx.moveTo(px, 0); ctx.lineTo(px, h);
        }
        for (var gy = y0; gy <= y1; gy++) {
          var py = Math.round(gy * s + this.oy) + 0.5;
          ctx.moveTo(0, py); ctx.lineTo(w, py);
        }
        ctx.stroke();
        ctx.strokeStyle = '#232d3a';
        ctx.beginPath();
        for (var gx2 = Math.floor(x0 / 10) * 10; gx2 <= x1; gx2 += 10) {
          var px2 = Math.round(gx2 * s + this.ox) + 0.5;
          ctx.moveTo(px2, 0); ctx.lineTo(px2, h);
        }
        for (var gy2 = Math.floor(y0 / 10) * 10; gy2 <= y1; gy2 += 10) {
          var py2 = Math.round(gy2 * s + this.oy) + 0.5;
          ctx.moveTo(0, py2); ctx.lineTo(w, py2);
        }
        ctx.stroke();
      }

      // 区域边框
      if (this.doc.area) {
        var a = this.doc.area;
        ctx.strokeStyle = '#2f3d52';
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(a.x * s + this.ox, a.y * s + this.oy, a.w * s, a.h * s);
        ctx.setLineDash([]);
      }

      var buildings = this.doc.buildings;
      var many = buildings.length > 6000;
      var hasHighlight = this.highlight.size > 0;
      var curLayer = this.layer;
      ctx.textBaseline = 'top';

      // 覆盖范围（先画，压在建筑下面）
      if (this.showPower || this.showWeapon) {
        for (var ri = 0; ri < buildings.length; ri++) {
          var rb = buildings[ri];
          var rdef = global.DSPAPP.buildingsById[rb.item];
          if (!rdef) continue;
          var rfp = this.footprint(rb);
          if (rfp.x + rfp.w < x0 || rfp.x > x1 || rfp.y + rfp.h < y0 || rfp.y > y1) continue;
          var ccx = (rfp.x + rfp.w / 2) * s + this.ox;
          var ccy = (rfp.y + rfp.h / 2) * s + this.oy;
          if (this.showPower && rdef.powerR > 0) {
            ctx.beginPath();
            ctx.arc(ccx, ccy, rdef.powerR * s, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(90,190,255,0.055)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(90,190,255,0.35)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          if (this.showWeapon && rdef.weaponR > 0) {
            ctx.beginPath();
            ctx.arc(ccx, ccy, rdef.weaponR * s, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,120,90,0.045)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,120,90,0.30)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      var noPower = this.noPower || null;

      for (var i = 0; i < buildings.length; i++) {
        var b = buildings[i];
        var fp = this.footprint(b);
        if (fp.x + fp.w < x0 || fp.x > x1 || fp.y + fp.h < y0 || fp.y > y1) continue;
        var def = global.DSPAPP.buildingsById[b.item];
        var col = def ? (CAT_COLOR[def.cat] || CAT_COLOR.misc) : '#8a5a8a';
        var sx = fp.x * s + this.ox, sy = fp.y * s + this.oy;
        var bw = fp.w * s, bh = fp.h * s;

        var dim = false;
        if (curLayer !== null && curLayer !== undefined) {
          dim = Math.abs(zKey(b.z) - curLayer) >= 0.25;
        }
        var hot = this.highlight.has(b.uid);
        var alpha = dim ? 0.16 : (hasHighlight && !hot ? 0.28 : 0.9);

        ctx.globalAlpha = alpha;
        if (def && def.cat === 'belt') {
          this.drawBelt(ctx, b, def, sx, sy, s);
        } else if (def && def.cat === 'sorter') {
          // 爪子留到最后统一画一遍，避免被机器/传送带盖住
        } else {
          ctx.fillStyle = col;
          ctx.fillRect(sx + 0.5, sy + 0.5, Math.max(1, bw - 1), Math.max(1, bh - 1));
          if (def && this.showPorts) this.drawPorts(ctx, b, def, sx, sy, bw, bh, s, alpha);
        }
        ctx.globalAlpha = 1;

        if (this.showPower && noPower && noPower.has(b.uid)) {
          ctx.strokeStyle = '#ff5a4a';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(sx + 1.5, sy + 1.5, Math.max(1, bw - 3), Math.max(1, bh - 3));
          ctx.setLineDash([]);
        }
        if (hot) {
          ctx.strokeStyle = '#7fe3ff';
          ctx.lineWidth = 2;
          ctx.strokeRect(sx + 1, sy + 1, Math.max(1, bw - 2), Math.max(1, bh - 2));
        }
        if (this.selection.has(b.uid)) {
          ctx.strokeStyle = '#ffd479';
          ctx.lineWidth = 2;
          ctx.strokeRect(sx + 1, sy + 1, Math.max(1, bw - 2), Math.max(1, bh - 2));
        }
        if (b === this.hover) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(sx + 1, sy + 1, Math.max(1, bw - 2), Math.max(1, bh - 2));
        }
        if (!many && !dim && s >= 14 && def && def.cat !== 'belt' && def.cat !== 'sorter' && fp.w * s > 34) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(sx, sy, bw, bh);
          ctx.clip();
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.font = '10px system-ui, sans-serif';
          ctx.fillText(def.name, sx + 3, sy + 3);
          var rname = this.recipeName(b);
          if (rname) ctx.fillText(rname, sx + 3, sy + 15);
          ctx.restore();
        }
      }

      // 爪子：单独一遍，画在所有建筑/传送带之上
      for (var sj = 0; sj < buildings.length; sj++) {
        var sb = buildings[sj];
        var sdef = global.DSPAPP.buildingsById[sb.item];
        if (!sdef || sdef.cat !== 'sorter') continue;
        var sfp = this.footprint(sb);
        if (sfp.x + sfp.w < x0 || sfp.x > x1 || sfp.y + sfp.h < y0 || sfp.y > y1) continue;
        var sdim = (curLayer !== null && curLayer !== undefined) && Math.abs(zKey(sb.z) - curLayer) >= 0.25;
        var shot = this.highlight.has(sb.uid);
        var salpha = sdim ? 0.15 : (hasHighlight && !shot ? 0.25 : 1);
        this.drawSorter(ctx, sb, sdef, sfp.x * s + this.ox, sfp.y * s + this.oy, s, salpha);
      }

      // 框选
      if (this.drag && this.drag.kind === 'marquee') {
        var d = this.drag;
        var mx = Math.min(d.sx, d.cx), my = Math.min(d.sy, d.cy);
        var mw = Math.abs(d.cx - d.sx), mh = Math.abs(d.cy - d.sy);
        ctx.fillStyle = 'rgba(120,180,255,0.12)';
        ctx.fillRect(mx, my, mw, mh);
        ctx.strokeStyle = 'rgba(120,180,255,0.7)';
        ctx.strokeRect(mx + 0.5, my + 0.5, mw, mh);
      }

      // 放置预览
      if (this.tool === 'place' && this.pendingItem && this.mouse) {
        var mpt = this.toWorld(this.mouse.x, this.mouse.y);
        if (global.DSPBP.isBelt(this.pendingItem)) {
          // 传送带：预览就是那条“线上的窄带”，所见即所得
          var snp2 = this.beltSnap(mpt.x, mpt.y, this.pendingYaw);
          var dd = this.dirOf(this.pendingYaw);
          var th = Math.max(2, s * 0.5);
          var bx0, by0, bw2, bh2;
          if (dd.x !== 0) {
            bx0 = Math.floor(snp2.x) * s + this.ox;
            by0 = snp2.y * s + this.oy - th / 2;
            bw2 = s; bh2 = th;
          } else {
            bx0 = snp2.x * s + this.ox - th / 2;
            by0 = Math.floor(snp2.y) * s + this.oy;
            bw2 = th; bh2 = s;
          }
          ctx.fillStyle = 'rgba(120,255,160,0.45)';
          ctx.fillRect(bx0, by0, bw2, bh2);
          ctx.strokeStyle = '#6bff9c';
          ctx.lineWidth = 1;
          ctx.strokeRect(bx0 + 0.5, by0 + 0.5, Math.max(1, bw2 - 1), Math.max(1, bh2 - 1));
        } else {
          var px3 = Math.floor(mpt.x), py3 = Math.floor(mpt.y);
          var def3 = global.DSPAPP.buildingsById[this.pendingItem];
          var pw = def3 ? def3.w : 1, ph3 = def3 ? def3.h : 1;
          if (Math.abs(this.pendingYaw % 180) > 1) { var t3 = pw; pw = ph3; ph3 = t3; }
          var cells = this.cellsFor(this.pendingItem, px3, py3, this.pendingYaw);
          var blocked = this.collides(cells, null, this.pendingZ);
          ctx.fillStyle = blocked ? 'rgba(255,80,80,0.30)' : 'rgba(120,255,160,0.30)';
          ctx.fillRect(px3 * s + this.ox, py3 * s + this.oy, pw * s, ph3 * s);
          ctx.strokeStyle = blocked ? '#ff6b6b' : '#6bff9c';
          ctx.strokeRect(px3 * s + this.ox + 0.5, py3 * s + this.oy + 0.5, pw * s, ph3 * s);
        }
      }
    },

    recipeName: function (b) {
      if (!b.recipe) return '';
      var r = global.DSPAPP.recipesById[b.recipe];
      return r ? r.name : '';
    },

    // 传送带吸附：横带吸到最近的横向格线（y 取整），竖带吸到最近的竖向格线（x 取整）
    beltSnap: function (wx, wy, yaw) {
      var d = this.dirOf(yaw || 0);
      if (d.x !== 0) return { x: Math.floor(wx) + 0.5, y: Math.round(wy) };
      return { x: Math.round(wx), y: Math.floor(wy) + 0.5 };
    },

    // yaw → 单位方向（游戏里 0 朝 +y，90 朝 +x，180 朝 -y，270 朝 -x）
    dirOf: function (yaw) {
      var a = ((yaw % 360) + 360) % 360;
      if (a < 45 || a >= 315) return { x: 0, y: 1 };
      if (a < 135) return { x: 1, y: 0 };
      if (a < 225) return { x: 0, y: -1 };
      return { x: -1, y: 0 };
    },

    // 传送带：坐标就是“格线”坐标——横带压在某条横向格线上（y 是整数），竖带压在竖向格线上
    drawBelt: function (ctx, b, def, sx, sy, s) {
      var d = this.dirOf(b.yaw0 !== undefined && b.yaw0 !== null ? b.yaw0 : (b.yaw || 0));
      var horizontal = d.x !== 0;
      var thick = Math.max(2, s * 0.5);
      var x0, y0, w, h;
      if (horizontal) {
        x0 = Math.floor(b.x) * s + this.ox;                 // 沿格线占 1 格
        y0 = b.y * s + this.oy - thick / 2;                 // 压在格线上
        w = s; h = thick;
      } else {
        x0 = b.x * s + this.ox - thick / 2;                 // 压在格线上
        y0 = Math.floor(b.y) * s + this.oy;
        w = thick; h = s;
      }
      ctx.fillStyle = b.item === 2003 ? '#3f7f93' : (b.item === 2002 ? '#3a7183' : '#356374');
      ctx.fillRect(x0, y0, w, h);
      ctx.strokeStyle = 'rgba(185,228,240,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(x0, y0 + 0.5); ctx.lineTo(x0 + w, y0 + 0.5);
        ctx.moveTo(x0, y0 + h - 0.5); ctx.lineTo(x0 + w, y0 + h - 0.5);
      } else {
        ctx.moveTo(x0 + 0.5, y0); ctx.lineTo(x0 + 0.5, y0 + h);
        ctx.moveTo(x0 + w - 0.5, y0); ctx.lineTo(x0 + w - 0.5, y0 + h);
      }
      ctx.stroke();
      if (s < 9) return;
      var cx = horizontal ? (Math.floor(b.x) + 0.5) * s + this.ox : b.x * s + this.ox;
      var cy = horizontal ? b.y * s + this.oy : (Math.floor(b.y) + 0.5) * s + this.oy;
      var L = s * 0.20;
      ctx.strokeStyle = 'rgba(232,248,255,0.85)';
      ctx.lineWidth = Math.max(1, s * 0.08);
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(cx - d.x * L, cy - L);
        ctx.lineTo(cx + d.x * L, cy);
        ctx.lineTo(cx - d.x * L, cy + L);
      } else {
        ctx.moveTo(cx - L, cy - d.y * L);
        ctx.lineTo(cx, cy + d.y * L);
        ctx.lineTo(cx + L, cy - d.y * L);
      }
      ctx.stroke();
    },

    // 分拣器（爪子）：从建筑端口抓到传送带，用 p0→p1 两个点画
    drawSorter: function (ctx, b, def, sx, sy, s, alpha) {
      var col = (b.item === 2013 || b.item === 2014) ? '#6fe0c0' : (b.item === 2012 ? '#57c3a6' : '#4aa98f');
      ctx.globalAlpha = alpha * 0.95;
      var ex = b.extra || {};
      var dirS = this.dirOf(b.yaw || 0);
      var p0 = { x: b.x, y: b.y };
      var p1 = ex.link ? { x: b.x + ex.link.dx, y: b.y + ex.link.dy } : { x: b.x + dirS.x * 0.5, y: b.y + dirS.y * 0.5 };
      var ax = p0.x * s + this.ox, ay = p0.y * s + this.oy;
      var bx = p1.x * s + this.ox, by = p1.y * s + this.oy;
      // 太短的爪子往建筑里侧补一段，视觉上才像一条完整爪子
      var span = Math.hypot(bx - ax, by - ay);
      if (span > 0.4 && span < s * 0.92) {
        var kk = (s * 0.92 - span) / span;
        ax -= (bx - ax) * kk; ay -= (by - ay) * kk;
      }
      if (s < 9) {
        ctx.fillStyle = col;
        ctx.fillRect(sx + s * 0.34, sy + s * 0.34, Math.max(1, s * 0.32), Math.max(1, s * 0.32));
        ctx.globalAlpha = 1;
        return;
      }
      // 深色描边 + 亮色圆弧，短爪子也能看清
      var mx2 = (ax + bx) / 2 + (by - ay) * 0.35;
      var my2 = (ay + by) / 2 - (bx - ax) * 0.35;
      ctx.strokeStyle = 'rgba(6,10,16,0.9)';
      ctx.lineWidth = Math.max(3, s * 0.26);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx2, my2, bx, by);
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.5, s * 0.13);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx2, my2, bx, by);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(1.6, s * 0.13), 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.fillStyle = '#0e1116';
      ctx.fillRect(ax - Math.max(1.5, s * 0.07), ay - Math.max(1.5, s * 0.07), Math.max(2.5, s * 0.14), Math.max(2.5, s * 0.14));
      ctx.globalAlpha = 1;
    },

    // 建筑端口：数量来自数据（游戏 inserterBorder），沿边均匀分布、居中对齐
    // 1 个就在边中点，2 个分居两侧，3 个正好每格中点
    portsOf: function (b) {
      var def = global.DSPAPP.buildingsById[b.item];
      if (!def) return [];
      var fp = this.footprint(b);
      var out = [];
      var push = function (x, y, dir) { out.push({ x: x, y: y, dir: dir }); };
      var pt = def.ports || { t: 1, r: 1, b: 1, l: 1 };
      var spread = function (n, start, len) {
        var arr = [];
        var k = Math.max(0, Math.min(8, Math.round(n || 0)));
        for (var i = 0; i < k; i++) arr.push(start + (i + 0.5) * len / k);
        return arr;
      };
      var i2, xs, ys;
      xs = spread(pt.t, fp.x, fp.w);
      for (i2 = 0; i2 < xs.length; i2++) push(xs[i2], fp.y, 't');
      xs = spread(pt.b, fp.x, fp.w);
      for (i2 = 0; i2 < xs.length; i2++) push(xs[i2], fp.y + fp.h, 'b');
      ys = spread(pt.l, fp.y, fp.h);
      for (i2 = 0; i2 < ys.length; i2++) push(fp.x, ys[i2], 'l');
      ys = spread(pt.r, fp.y, fp.h);
      for (i2 = 0; i2 < ys.length; i2++) push(fp.x + fp.w, ys[i2], 'r');
      return out;
    },

    drawPorts: function (ctx, b, def, sx, sy, bw, bh, s, alpha) {
      if (!def.ports) return;
      var pf = def.ports;
      if ((pf.t || 0) + (pf.r || 0) + (pf.b || 0) + (pf.l || 0) === 0) return;
      var pts = this.portsOf(b);
      if (!pts.length || s < 7) return;
      ctx.globalAlpha = alpha;
      for (var i = 0; i < pts.length; i++) {
        var px = pts[i].x * s + this.ox, py = pts[i].y * s + this.oy;
        var rr = Math.max(2.2, s * 0.13);
        ctx.beginPath();
        ctx.arc(px, py, rr, 0, Math.PI * 2);
        ctx.fillStyle = '#8fe8ff';
        ctx.fill();
        ctx.strokeStyle = 'rgba(8,14,20,0.95)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },

    // 以中心 (cx,cy) 放置时覆盖的格子（与 footprint 对齐到整格）
    cellsFor: function (item, cx, cy, yaw) {
      var def = global.DSPAPP.buildingsById[item];
      var w = def ? def.w : 1, h = def ? def.h : 1;
      if (Math.abs((yaw || 0) % 180) > 1) { var t = w; w = h; h = t; }
      var x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
      var cells = [];
      for (var x = x0; x < x0 + w; x++) {
        for (var y = y0; y < y0 + h; y++) cells.push(x + ',' + y);
      }
      return cells;
    },

    // 传送带/爪子：按格心算它所在的格子
    cellOf: function (wx, wy) {
      return { x: Math.floor(wx), y: Math.floor(wy) };
    },

    // 只在同一层（z 相近）内做碰撞检测
    collides: function (cells, ignoreUid, z) {
      z = z === undefined ? (this.pendingZ || 0) : z;
      for (var i = 0; i < cells.length; i++) {
        var arr = this.spatial.get(cells[i]);
        if (!arr) continue;
        for (var k = 0; k < arr.length; k++) {
          if (arr[k].uid === ignoreUid) continue;
          if (Math.abs(zKey(arr[k].z) - zKey(z)) < 0.25) return true;
        }
      }
      return false;
    },

    // ---------- 事件 ----------
    _bind: function () {
      var self = this;
      var cv = this.canvas;

      cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

      cv.addEventListener('pointerdown', function (e) {
        cv.setPointerCapture(e.pointerId);
        var rect = cv.getBoundingClientRect();
        var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        var wp = self.toWorld(sx, sy);
        var b = self.pick(wp.x, wp.y);

        // 中键 / 右键：平移
        if (e.button === 1 || e.button === 2) {
          self.drag = { kind: 'pan', sx: sx, sy: sy, ox: self.ox, oy: self.oy };
          return;
        }

        if (self.tool === 'place' && self.pendingItem && e.button === 0) {
          // 传送带：按下先不落，等移动方向确定后按“拖动方向”连成一条线；
          // 没拖就直接松手 = 放一条（按当前朝向）
          if (global.DSPBP.isBelt(self.pendingItem)) {
            self._stroke = {
              rawX: Math.floor(wp.x), rawY: Math.floor(wp.y),
              w0x: wp.x, w0y: wp.y, dir: null, sign: 1,
              lastX: null, lastY: null, placed: 0,
              wx: wp.x, wy: wp.y
            };
            return;
          }
          var x = Math.floor(wp.x) + 0.5, y = Math.floor(wp.y) + 0.5;   // 建筑以格心为锚点
          var cells = self.cellsFor(self.pendingItem, x, y, self.pendingYaw);
          if (!self.collides(cells, null, self.pendingZ)) {
            self.hooks.place && self.hooks.place(self.pendingItem, x, y, self.pendingZ, self.pendingYaw);
          }
          return;
        }

        if (self.tool === 'erase') {
          if (b) self.hooks.erase && self.hooks.erase([b]);
          return;
        }

        if (b) {
          if (e.shiftKey || e.ctrlKey) {
            if (self.selection.has(b.uid)) self.selection.delete(b.uid);
            else self.selection.add(b.uid);
          } else if (!self.selection.has(b.uid)) {
            self.selection.clear();
            self.selection.add(b.uid);
          }
          self.hooks.select && self.hooks.select(self.selectedObjects());
          self.drag = {
            kind: 'move', sx: sx, sy: sy, moved: false, wp: wp,
            origin: self.selectedObjects().map(function (o) { return { ref: o, x: o.x, y: o.y }; })
          };
          self.render();
          return;
        }

        if (!e.shiftKey) self.selection.clear();
        self.drag = { kind: 'marquee', sx: sx, sy: sy, cx: sx, cy: sy, add: e.shiftKey };
        self.hooks.select && self.hooks.select(self.selectedObjects());
        self.render();
      });

      cv.addEventListener('pointermove', function (e) {
        var rect = cv.getBoundingClientRect();
        var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        self.mouse = { x: sx, y: sy };
        var d = self.drag;
        if (!d) {
          var wp = self.toWorld(sx, sy);
          var b = self.pick(wp.x, wp.y);
          if (b !== self.hover) {
            self.hover = b;
            self.hooks.hover && self.hooks.hover(b);
            self.requestRender();
          }
          // 传送带连铺：方向按“相邻两段的实际铺放顺序”定（箭头永远跟手走），落点吸附到最近格线
          if (self.tool === 'place' && self.pendingItem && (e.buttons & 1) && global.DSPBP.isBelt(self.pendingItem)) {
            var st = self._stroke;
            if (st) {
              st.wx = wp.x; st.wy = wp.y;
              // 先用起笔时锁定的方向（第一次明显移动决定横/竖），具体朝哪边按铺放顺序修正
              var ddx0 = wp.x - st.w0x, ddy0 = wp.y - st.w0y;
              if (!st.dir && (Math.abs(ddx0) > 0.35 || Math.abs(ddy0) > 0.35)) {
                st.dir = Math.abs(ddx0) >= Math.abs(ddy0) ? 'h' : 'v';
              }
              var paintYaw = self.pendingYaw;
              if (st.dir === 'h') paintYaw = 90;
              else if (st.dir === 'v') paintYaw = 0;

              var snp = self.beltSnap(wp.x, wp.y, paintYaw);

              function fixYaw(uid, yaw) {
                if (uid === undefined || uid === null) return;
                for (var z = 0; z < self.doc.buildings.length; z++) {
                  if (self.doc.buildings[z].uid === uid) {
                    self.doc.buildings[z].yaw = yaw;
                    self.doc.buildings[z].yaw0 = yaw;
                    return;
                  }
                }
              }

              // 起笔那一格补上，线才连续
              if (st.lastX === null) {
                var snp0 = self.beltSnap(st.w0x, st.w0y, paintYaw);
                if (snp0.x !== snp.x || snp0.y !== snp.y) {
                  var b0 = self.hooks.place && self.hooks.place(self.pendingItem, snp0.x, snp0.y, self.pendingZ, paintYaw);
                  st.prevX = snp0.x; st.prevY = snp0.y; st.prevUid = b0 && b0.uid;
                  st.placed++;
                }
              }

              if (st.lastX !== snp.x || st.lastY !== snp.y) {
                // 真正决定朝向：上一段 → 这一段 的位移
                if (st.prevX !== undefined && st.prevY !== undefined) {
                  var dxs = snp.x - st.prevX, dys = snp.y - st.prevY;
                  if (Math.abs(dxs) >= Math.abs(dys) && Math.abs(dxs) > 0.01) paintYaw = dxs > 0 ? 90 : 270;
                  else if (Math.abs(dys) > 0.01) paintYaw = dys > 0 ? 0 : 180;
                  fixYaw(st.prevUid, paintYaw);   // 同一笔内保持一致
                }
                st.lastX = snp.x; st.lastY = snp.y;
                st.prevX = snp.x; st.prevY = snp.y;
                self.pendingYaw = paintYaw;
                var b1 = self.hooks.place && self.hooks.place(self.pendingItem, snp.x, snp.y, self.pendingZ, paintYaw);
                st.prevUid = b1 && b1.uid;
                st.placed++;
              }
            }
          }
          if (self.tool === 'place') self.requestRender();
          return;
        }
        if (d.kind === 'pan') {
          self.ox = d.ox + (sx - d.sx);
          self.oy = d.oy + (sy - d.sy);
          self.requestRender();
        } else if (d.kind === 'marquee') {
          d.cx = sx; d.cy = sy;
          self.requestRender();
        } else if (d.kind === 'move') {
          var wp2 = self.toWorld(sx, sy);
          var dx = Math.round(wp2.x - d.wp.x), dy = Math.round(wp2.y - d.wp.y);
          if (dx !== 0 || dy !== 0) d.moved = true;
          for (var i = 0; i < d.origin.length; i++) {
            var o = d.origin[i];
            o.ref.x = o.x + dx;
            o.ref.y = o.y + dy;
          }
          self.reindex();
          self.requestRender();
        }
      });

      cv.addEventListener('pointerup', function (e) {
        var d = self.drag;
        self.drag = null;
        self._lastPaint = null;
        // 传送带一笔结束：没拖动过 → 就是单击，放一条（按当前朝向）
        var stroke = self._stroke;
        self._stroke = null;
        if (stroke && stroke.placed === 0) {
          var rectS = cv.getBoundingClientRect();
          var wS = self.toWorld(e.clientX - rectS.left, e.clientY - rectS.top);
          var snpS = self.beltSnap(wS.x, wS.y, self.pendingYaw);
          self.hooks.place && self.hooks.place(self.pendingItem, snpS.x, snpS.y, self.pendingZ, self.pendingYaw);
        }
        if (!d) return;
        var rect = cv.getBoundingClientRect();
        var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        if (d.kind === 'marquee') {
          var w0 = self.toWorld(Math.min(d.sx, sx), Math.min(d.sy, sy));
          var w1 = self.toWorld(Math.max(d.sx, sx), Math.max(d.sy, sy));
          var hit = [];
          var bs = self.doc.buildings;
          for (var i = 0; i < bs.length; i++) {
            if (!self.onLayer(bs[i])) continue;
            var fp = self.footprint(bs[i]);
            if (fp.x + fp.w > w0.x && fp.x < w1.x && fp.y + fp.h > w0.y && fp.y < w1.y) hit.push(bs[i]);
          }
          if (!d.add) self.selection.clear();
          hit.forEach(function (b) { self.selection.add(b.uid); });
          self.hooks.select && self.hooks.select(self.selectedObjects());
          self.render();
        } else if (d.kind === 'move' && d.moved) {
          self.hooks.moved && self.hooks.moved(d.origin);
          self.reindex();
          self.render();
        }
      });

      cv.addEventListener('wheel', function (e) {
        e.preventDefault();
        var rect = cv.getBoundingClientRect();
        var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        var before = self.toWorld(sx, sy);
        var factor = Math.pow(1.0015, -e.deltaY);
        self.scale = Math.min(64, Math.max(1.5, self.scale * factor));
        var after = self.toWorld(sx, sy);
        self.ox += (after.x - before.x) * self.scale;
        self.oy += (after.y - before.y) * self.scale;
        self.requestRender();
      }, { passive: false });

      global.addEventListener('keydown', function (e) {
        var t = e.target;
        if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')) return;
        if (e.key === 'Escape') {
          // 取消放置 & 清除高亮 & 清空选择
          self.pendingItem = null;
          self.tool = 'select';
          self.highlight.clear();
          self.selection.clear();
          self.hooks.cancel && self.hooks.cancel();
          self.requestRender();
          return;
        }
        if (e.key === 'r' || e.key === 'R') {
          self.pendingYaw = (self.pendingYaw + 90) % 360;
          self.hooks.yaw && self.hooks.yaw(self.pendingYaw);
          self.requestRender();
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          var list = self.selectedObjects();
          if (list.length) {
            e.preventDefault();
            self.hooks.erase && self.hooks.erase(list);
          }
        }
      });
    },

    selectedObjects: function () {
      var self = this;
      var out = [];
      this.doc.buildings.forEach(function (b) { if (self.selection.has(b.uid)) out.push(b); });
      return out;
    },

    // 高亮与某物品相关的建筑（生产或消耗它）
    highlightItem: function (itemId) {
      var self = this;
      this.highlight.clear();
      if (!itemId) { this.requestRender(); return 0; }
      var n = 0;
      this.doc.buildings.forEach(function (b) {
        if (!b.recipe) return;
        var r = global.DSPAPP.recipesById[b.recipe];
        if (!r) return;
        var hit = false;
        for (var i = 0; i < r.outs.length; i++) if (r.outs[i][0] === itemId) hit = true;
        for (var k = 0; k < r.ins.length; k++) if (r.ins[k][0] === itemId) hit = true;
        if (hit) { self.highlight.add(b.uid); n++; }
      });
      this.requestRender();
      return n;
    },

    centerOn: function (bb) {
      if (!bb) return;
      var cv = this.canvas;
      var w = cv.clientWidth, h = cv.clientHeight;
      var s = Math.min(w / Math.max(6, bb.w + 6), h / Math.max(6, bb.h + 6));
      this.scale = Math.min(40, Math.max(1.5, s));
      var cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
      this.ox = w / 2 - cx * this.scale;
      this.oy = h / 2 - cy * this.scale;
      this.requestRender();
    }
  };

  global.DSPEditor = Editor;
})(window);
