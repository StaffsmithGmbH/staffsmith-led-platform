// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 StaffSmith GmbH
//
// StaffSmith LED — Web-UI ↔ device WebSocket protocol (v1) + browser/Node mock device.
// Loadable in the browser (window.SmithProto) and in Node (globalThis.SmithProto).
//
// The protocol is pure JSON messaging. The MockDevice implements the *device* side so the
// control UI runs and is testable WITHOUT hardware; the real firmware implements the same
// contract. Params reuse the engine's `effect.controls` via SmithEffects.resolve (single source).
//
// Safety: there is intentionally NO "setCeiling" message. The hardware brightness/thermal ceiling
// is reported (brightnessCeiling) but cannot be raised over the wire — effective = min(req, ceiling).
//
// `preview` frames (low-rate, opt-in via `setPreview`): the device pushes the rendered RGB of
// every LED so the UI can show what the prop is doing without a full on-device video stream.
// Rate-limited (default 5 Hz, max 15 Hz) — this is a preview, not a frame-accurate mirror.

(function (root) {
  var V = 1;
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function clampHz(x) { x = x || 5; return x < 1 ? 1 : x > 15 ? 15 : x; }

  // --- message builders (client → device) ------------------------------------
  // `scope`: 'self' (this module) or 'group' (leader fans out to the group, see mesh-sync.md).
  var build = {
    hello:         function ()                  { return { v: V, type: 'hello' }; },
    setPattern:    function (id, scope)         { return { v: V, type: 'setPattern', id: id, scope: scope || 'self' }; },
    setParam:      function (id, value, scope)  { return { v: V, type: 'setParam', id: id, value: value, scope: scope || 'self' }; },
    setParams:     function (params, scope)     { return { v: V, type: 'setParams', params: params, scope: scope || 'self' }; },
    setBrightness: function (value, scope)      { return { v: V, type: 'setBrightness', value: value, scope: scope || 'self' }; },
    group:         function (action, groupId)   { var m = { v: V, type: 'group', action: action }; if (groupId != null) m.groupId = groupId; return m; },
    setPreview:    function (enabled, rateHz)   { var m = { v: V, type: 'setPreview', enabled: !!enabled }; if (rateHz != null) m.rateHz = rateHz; return m; }
  };

  // --- lightweight validation ------------------------------------------------
  var CLIENT_TYPES = { hello: 1, setPattern: 1, setParam: 1, setParams: 1, setBrightness: 1, group: 1, setPreview: 1 };
  var DEVICE_TYPES = { state: 1, ack: 1, error: 1, preview: 1 };
  function validate(msg, dir) {
    if (!msg || typeof msg !== 'object') return 'not an object';
    if (msg.v !== V) return 'bad version';
    var set = dir === 'device' ? DEVICE_TYPES : CLIENT_TYPES;
    if (!set[msg.type]) return 'unknown type: ' + msg.type;
    if (msg.type === 'setPattern' && typeof msg.id !== 'string') return 'setPattern needs string id';
    if (msg.type === 'setParam' && typeof msg.id !== 'string') return 'setParam needs string id';
    if (msg.type === 'setParam' && typeof msg.value !== 'number') return 'setParam needs numeric value';
    if (msg.type === 'setBrightness' && typeof msg.value !== 'number') return 'setBrightness needs numeric value';
    if (msg.type === 'group' && typeof msg.action !== 'string') return 'group needs action';
    if (msg.type === 'setPreview' && typeof msg.enabled !== 'boolean') return 'setPreview needs boolean enabled';
    return null; // ok
  }

  // --- mock device (implements the device side; uses the engine for param defaults) ---
  function MockDevice(opts) {
    opts = opts || {};
    var effects = opts.effects || root.SmithEffects || null;
    var map = opts.map || null; // LED map (engine/maps/*.js) — needed for preview frames only
    var st = {
      pattern: opts.pattern || (effects ? effects.list[0].id : 'axis-gradient'),
      params: {},
      brightness: opts.brightness != null ? opts.brightness : 0.5,
      brightnessCeiling: opts.ceiling != null ? opts.ceiling : 0.7, // HW limit, not overridable
      group: { id: 0, role: 'standalone', peers: 0 },
      battery: opts.battery != null ? opts.battery : 0.82,
      previewEnabled: false, previewRateHz: 5, previewLastAt: -Infinity, previewSeq: 0
    };
    function loadDefaults() { if (effects && effects.resolve) st.params = effects.resolve(st.pattern, {}); }
    loadDefaults();

    function effectiveBrightness() { return Math.min(st.brightness, st.brightnessCeiling); }

    function state() {
      return {
        v: V, type: 'state', pattern: st.pattern, params: st.params,
        brightness: st.brightness, brightnessCeiling: st.brightnessCeiling,
        group: { id: st.group.id, role: st.group.role, peers: st.group.peers }, battery: st.battery,
        previewEnabled: st.previewEnabled, previewRateHz: st.previewRateHz
      };
    }

    // Render one preview frame at time t (seconds): resolved effect over every LED of `map`,
    // host brightness ceiling applied (same invariant as the real firmware), quantized to 0..255.
    // Mock has no IMU/orientation, so world == head-fixed coordinates here (fine for a preview).
    var led = {}, ctx = { up: [0, 1, 0] };
    function renderPreviewFrame(t) {
      if (!map || !effects) return null;
      var eff = effects.byId(st.pattern).fn;
      ctx.params = st.params;
      var b = effectiveBrightness();
      var rgb = new Array(map.count * 3);
      for (var k = 0; k < map.leds.length; k++) {
        var L = map.leds[k];
        led.i = L.i; led.face = L.face;
        led.x = L.p[0]; led.y = L.p[1]; led.z = L.p[2];
        led.u = L.uv[0]; led.v = L.uv[1];
        led.nx = L.n[0]; led.ny = L.n[1]; led.nz = L.n[2];
        led.wx = L.p[0]; led.wy = L.p[1]; led.wz = L.p[2];
        led.wnx = L.n[0]; led.wny = L.n[1]; led.wnz = L.n[2];
        var c = eff(led, t, ctx);
        rgb[k * 3]     = Math.round(clamp01(c[0]) * b * 255);
        rgb[k * 3 + 1] = Math.round(clamp01(c[1]) * b * 255);
        rgb[k * 3 + 2] = Math.round(clamp01(c[2]) * b * 255);
      }
      return { v: V, type: 'preview', seq: ++st.previewSeq, t: t, count: map.count, rgb: rgb };
    }

    // Call periodically (e.g. from rAF/setInterval) with a monotonic ms clock. Returns a
    // `preview` message when one is due (rate-limited to previewRateHz), else null — never
    // sends anything unless a client opted in via `setPreview`.
    function tick(nowMs) {
      if (!st.previewEnabled) return null;
      var minGapMs = 1000 / st.previewRateHz;
      if (nowMs - st.previewLastAt < minGapMs) return null;
      st.previewLastAt = nowMs;
      return renderPreviewFrame(nowMs / 1000);
    }

    function handle(msg) {
      var err = validate(msg, 'client');
      if (err) return { v: V, type: 'error', code: 'badmsg', msg: err };
      switch (msg.type) {
        case 'hello': break;
        case 'setPattern': st.pattern = msg.id; loadDefaults(); break;
        case 'setParam': st.params[msg.id] = msg.value; break;
        case 'setParams': for (var k in msg.params) st.params[k] = msg.params[k]; break;
        case 'setBrightness': st.brightness = clamp01(msg.value); break;
        case 'group':
          if (msg.action === 'join')   { st.group.id = msg.groupId | 0; st.group.role = 'follower'; st.group.peers = 1; }
          else if (msg.action === 'leave')  { st.group.id = 0; st.group.role = 'standalone'; st.group.peers = 0; }
          else if (msg.action === 'leader') { st.group.role = 'leader'; }
          break;
        case 'setPreview':
          st.previewEnabled = !!msg.enabled;
          if (msg.rateHz != null) st.previewRateHz = clampHz(msg.rateHz);
          st.previewLastAt = -Infinity; // next due tick fires immediately
          break;
      }
      return state();
    }
    return {
      handle: handle, state: state, tick: tick, renderPreviewFrame: renderPreviewFrame, _st: st,
      effectiveBrightness: effectiveBrightness
    };
  }

  // --- mock transport: wires a client to a MockDevice with no network --------
  function MockTransport(device) {
    var self = { onmessage: null, onopen: null };
    self.send = function (msg) { var reply = device.handle(msg); if (self.onmessage) self.onmessage(reply); };
    self.open = function () { if (self.onopen) self.onopen(); if (self.onmessage) self.onmessage(device.state()); };
    return self;
  }

  root.SmithProto = { V: V, build: build, validate: validate, MockDevice: MockDevice, MockTransport: MockTransport };
})(typeof window !== 'undefined' ? window : globalThis);
