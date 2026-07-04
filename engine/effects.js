// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 StaffSmith GmbH
//
// Effect library (Loop L1). An effect is a pure function of an LED and time:
//
//   fn(led, t, ctx) -> [r, g, b]   with r,g,b in 0..1
//
// led fields (see engine/SPEC.md — frozen effect API):
//   i, face                         LED index, face id
//   x, y, z      head-fixed coords  (rotate WITH the prop)
//   u, v         face coords 0..1
//   nx, ny, nz   head-fixed normal
//   wx, wy, wz   world coords        (stay fixed in the room while the prop spins)
//   wnx,wny,wnz  world normal
// t   : seconds since start
// ctx : { up:[x,y,z] world-up (gravity), params:{...} , ... }
//
// PARAMETERS (additive, does NOT break SPEC v1):
//   Each effect declares a `controls` array (Pixelblaze-style UI vars: slider/hue/toggle).
//   Live values arrive in `ctx.params` (keyed by control id). The engine resolves them
//   against the declared defaults and passes the resolved object as a 4th convenience arg
//   to the raw effect body. The PUBLIC contract stays `fn(led, t, ctx)` — params live in
//   `ctx.params`, which SPEC §3 already allows as an additive ctx extension.
//   `controls` is also the source for the DMX/GDTF channel map (L9).

(function (root) {
  function clamp01(a) { return a < 0 ? 0 : a > 1 ? 1 : a; }
  function smooth(a) { return a * a * (3 - 2 * a); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // HSV (0..1) -> RGB (0..1)
  function hsv(h, s, v) {
    h = (h % 1 + 1) % 1;
    var i = Math.floor(h * 6), f = h * 6 - i;
    var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: return [v, t, p];
      case 1: return [q, v, p];
      case 2: return [p, v, t];
      case 3: return [p, q, v];
      case 4: return [t, p, v];
      default: return [v, p, q];
    }
  }

  // Cheap integer-lattice value noise, trilinearly interpolated.
  function vhash(i, j, k) {
    var n = (i | 0) * 374761393 + (j | 0) * 668265263 + (k | 0) * 1274126177;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  }
  function noise3(x, y, z) {
    var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    var ux = smooth(x - ix), uy = smooth(y - iy), uz = smooth(z - iz);
    var x00 = lerp(vhash(ix, iy, iz),     vhash(ix + 1, iy, iz),     ux);
    var x10 = lerp(vhash(ix, iy + 1, iz), vhash(ix + 1, iy + 1, iz), ux);
    var x01 = lerp(vhash(ix, iy, iz + 1), vhash(ix + 1, iy, iz + 1), ux);
    var x11 = lerp(vhash(ix, iy + 1, iz + 1), vhash(ix + 1, iy + 1, iz + 1), ux);
    return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz);
  }
  function fbm(x, y, z) {
    return 0.65 * noise3(x, y, z) + 0.35 * noise3(x * 2.1, y * 2.1, z * 2.1);
  }

  var EMPTY_CTX = { up: [0, 1, 0] };

  // Wrap a raw effect body with its parameter declaration. The wrapper resolves
  // ctx.params against the control defaults once per call and hands the raw body a
  // fully-populated params object as its 4th argument. Public signature stays fn(led,t,ctx).
  function fx(spec) {
    var controls = spec.controls || [];
    var def = {};
    for (var i = 0; i < controls.length; i++) def[controls[i].id] = controls[i].def;
    var raw = spec.fn;
    return {
      id: spec.id,
      label: spec.label,
      controls: controls,
      defaults: def,
      fn: function (led, t, ctx) {
        var over = ctx && ctx.params, p;
        if (!over) { p = def; }                       // no overrides → shared defaults
        else { p = {}; for (var k in def) p[k] = (over[k] != null ? over[k] : def[k]); }
        return raw(led, t, ctx || EMPTY_CTX, p);
      }
    };
  }

  // --- Effects (ordered for the UI) -----------------------------------------
  var EFFECTS = [
    fx({
      id: 'axis-gradient',
      label: 'Axis gradient (head-fixed)',
      controls: [
        { id: 'cycles', label: 'Color cycles', type: 'slider', min: 0.5, max: 4, step: 0.5, def: 1 },
        { id: 'speed',  label: 'Hue drift',    type: 'slider', min: -1,  max: 1, step: 0.01, def: 0 },
        { id: 'sat',    label: 'Saturation',   type: 'slider', min: 0,   max: 1, step: 0.01, def: 1 }
      ],
      fn: function (l, t, ctx, p) {
        return hsv(((l.z + 1) / 2) * p.cycles + t * p.speed * 0.1, p.sat, 1);
      }
    }),
    fx({
      id: 'plane-sweep-world',
      label: 'Plane sweep (world-fixed)',
      controls: [
        { id: 'speed',    label: 'Sweep speed',    type: 'slider', min: 0, max: 3,    step: 0.01,  def: 0.8 },
        { id: 'sharp',    label: 'Edge sharpness',  type: 'slider', min: 0.3, max: 4,  step: 0.05,  def: 1.6 },
        { id: 'hueSpeed', label: 'Hue drift',       type: 'slider', min: 0, max: 0.3,  step: 0.005, def: 0.05 },
        { id: 'sat',      label: 'Saturation',      type: 'slider', min: 0, max: 1,    step: 0.01,  def: 0.7 }
      ],
      fn: function (l, t, ctx, p) {
        var y0 = Math.sin(t * p.speed);              // a horizontal plane in the ROOM
        var inten = clamp01(1 - Math.abs(l.wy - y0) * p.sharp);
        return hsv((t * p.hueSpeed) % 1, p.sat, inten);
      }
    }),
    fx({
      id: 'plane-sweep-head',
      label: 'Plane sweep (head-fixed)',
      controls: [
        { id: 'speed',    label: 'Sweep speed',    type: 'slider', min: 0, max: 3,    step: 0.01,  def: 0.8 },
        { id: 'sharp',    label: 'Edge sharpness',  type: 'slider', min: 0.3, max: 4,  step: 0.05,  def: 1.6 },
        { id: 'hueSpeed', label: 'Hue drift',       type: 'slider', min: 0, max: 0.3,  step: 0.005, def: 0.05 },
        { id: 'sat',      label: 'Saturation',      type: 'slider', min: 0, max: 1,    step: 0.01,  def: 0.7 }
      ],
      fn: function (l, t, ctx, p) {
        var y0 = Math.sin(t * p.speed);              // a plane bound to the PROP
        var inten = clamp01(1 - Math.abs(l.y - y0) * p.sharp);
        return hsv((t * p.hueSpeed + 0.5) % 1, p.sat, inten);
      }
    }),
    fx({
      id: 'radial-pulse',
      label: 'Radial pulse',
      controls: [
        { id: 'speed',    label: 'Pulse speed',   type: 'slider', min: 0, max: 6,   step: 0.01,  def: 2.2 },
        { id: 'freq',     label: 'Ring frequency', type: 'slider', min: 1, max: 8,   step: 0.1,   def: 3.0 },
        { id: 'hueSpeed', label: 'Hue drift',      type: 'slider', min: 0, max: 0.2, step: 0.005, def: 0.03 },
        { id: 'sat',      label: 'Saturation',     type: 'slider', min: 0, max: 1,   step: 0.01,  def: 0.9 }
      ],
      fn: function (l, t, ctx, p) {
        var r = Math.sqrt(l.x * l.x + l.y * l.y + l.z * l.z);
        var inten = 0.5 + 0.5 * Math.sin(r * p.freq - t * p.speed);
        return hsv(r / 1.8 + t * p.hueSpeed, p.sat, inten * inten);
      }
    }),
    fx({
      id: 'noise-field',
      label: 'Noise field (world)',
      controls: [
        { id: 'scale',   label: 'Noise scale', type: 'slider', min: 0.5, max: 4, step: 0.05, def: 1.2 },
        { id: 'speed',   label: 'Flow speed',  type: 'slider', min: 0,   max: 1, step: 0.01, def: 0.2 },
        { id: 'hue',     label: 'Base hue',    type: 'hue',    min: 0,   max: 1, step: 0.01, def: 0.55 },
        { id: 'hueSpan', label: 'Hue span',    type: 'slider', min: 0,   max: 1, step: 0.01, def: 0.4 }
      ],
      fn: function (l, t, ctx, p) {
        var s = p.scale;
        var n = fbm(l.wx * s + t * p.speed, l.wy * s - t * p.speed * 0.5, l.wz * s + t * p.speed * 0.75);
        return hsv(p.hue + n * p.hueSpan, 0.8, 0.25 + 0.75 * smooth(n));
      }
    }),
    fx({
      id: 'world-beam',
      label: 'World beam (IMU demo)',
      controls: [
        { id: 'hue',      label: 'Beam hue',    type: 'hue',    min: 0,   max: 1, step: 0.01, def: 0.12 },
        { id: 'sat',      label: 'Saturation',  type: 'slider', min: 0,   max: 1, step: 0.01, def: 0.55 },
        { id: 'softness', label: 'Softness',    type: 'slider', min: 0.3, max: 3, step: 0.05, def: 1.0 },
        { id: 'invert',   label: 'Invert side', type: 'toggle', def: 0 }
      ],
      fn: function (l, t, ctx, p) {
        var up = ctx && ctx.up ? ctx.up : [0, 1, 0]; // a fixed "sun" from world-up
        var d = l.wnx * up[0] + l.wny * up[1] + l.wnz * up[2]; // dot(worldNormal, up)
        if (p.invert) d = -d;
        var inten = Math.pow(clamp01(d), p.softness);
        return hsv(p.hue, p.sat, inten); // warm; the world-up-facing side glows
      }
    })
  ];

  root.SmithEffects = {
    list: EFFECTS,
    byId: function (id) { for (var i = 0; i < EFFECTS.length; i++) if (EFFECTS[i].id === id) return EFFECTS[i]; return EFFECTS[0]; },
    // Merge UI overrides over an effect's declared defaults → full params object.
    resolve: function (e, over) {
      if (typeof e === 'string') e = this.byId(e);
      var def = e.defaults, r = {};
      for (var k in def) r[k] = (over && over[k] != null ? over[k] : def[k]);
      return r;
    },
    util: { hsv: hsv, noise3: noise3, fbm: fbm, clamp01: clamp01 }
  };
})(typeof window !== 'undefined' ? window : globalThis);
