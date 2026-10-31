// MD5 变体（游戏蓝图校验用）—— 与《戴森球计划》一致：初始状态与 8 个轮常量被改动
// 依据：公开的 dspbptk / dsp-blueprint-editor 实现所记载的常量
(function (global) {
  'use strict';

  var K = [
    0xd76aa478, 0xe8d7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304623, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b9f1122, 0xfd987193, 0xa679438e, 0x39b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xc9b6c7aa, 0xd62f105d, 0x02443453, 0xd8a1e681, 0xe7d3fbc8,
    0x21f1cde6, 0xc33707d6, 0xf4d50d87, 0x475a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
  ];
  var S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  var INIT = [0x67452301, 0xEFDCAB89, 0x98BADCFE, 0x10325746];

  function rotl(x, s) {
    return (x << s) | (x >>> (32 - s));
  }

  function hexOf(n) {
    var h = (n >>> 0).toString(16);
    while (h.length < 8) h = '0' + h;
    // 输出小端字节序（与 C# MD5 的十六进制串一致）
    return h.slice(6, 8) + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2);
  }

  // 输入：Uint8Array；输出：32 位大写十六进制串
  function md5f(bytes) {
    var len = bytes.length;
    var padLen = ((len % 64) < 56 ? 56 - (len % 64) : 120 - (len % 64));
    var total = len + padLen + 8;
    var buf = new Uint8Array(total);
    buf.set(bytes, 0);
    buf[len] = 0x80;
    var bitLen = len * 8;
    // 低位 32 位
    buf[total - 8] = bitLen & 0xff;
    buf[total - 7] = (bitLen >>> 8) & 0xff;
    buf[total - 6] = (bitLen >>> 16) & 0xff;
    buf[total - 5] = (bitLen >>> 24) & 0xff;
    // 高位（这里忽略 >512MB 的极端情况）
    var hi = Math.floor(bitLen / 4294967296);
    buf[total - 4] = hi & 0xff;

    var a0 = INIT[0], b0 = INIT[1], c0 = INIT[2], d0 = INIT[3];
    var X = new Int32Array(16);
    var dv = new DataView(buf.buffer);

    for (var off = 0; off < total; off += 64) {
      for (var i = 0; i < 16; i++) X[i] = dv.getInt32(off + i * 4, true);
      var a = a0, b = b0, c = c0, d = d0;
      for (var j = 0; j < 64; j++) {
        var f, g;
        if (j < 16) { f = (b & c) | (~b & d); g = j; }
        else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
        else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) % 16; }
        else { f = c ^ (b | ~d); g = (7 * j) % 16; }
        f = (f + a + K[j] + X[g]) | 0;
        a = d; d = c; c = b;
        b = (b + rotl(f, S[j])) | 0;
      }
      a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
    }
    return (hexOf(a0) + hexOf(b0) + hexOf(c0) + hexOf(d0)).toUpperCase();
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  global.DSPMD5 = { hash: md5f, utf8Bytes: utf8Bytes };
})(window);
