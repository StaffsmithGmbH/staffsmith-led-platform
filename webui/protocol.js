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

(function (root) {
  var V = 1;
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  // --- message builders (client → device) ------------------------------------
  // `scope`: 'self' (this module) or 'group' (leader fans out to the group, see mesh-sync.md).
  var build = {
    hello:         function ()                  { return { v: V, type: 'hello' }; },
    setPattern:    function (id, scope)         { return { v: V, type: 'setPattern', id: id, scope: scope || 'self' }; },
    setParam:      function (id, value, scope)  { return { v: V, type: 'setParam', id: id, value: value, scope: scope || 'self' }; },
    setParams:     function (params, scope)     { return { v: V, type: 'setParams', params: params, scope: scope || 'self' }; },
    setBrightness: function (value, scope)      { return { v: V, type: 'setBrightness', value: value, scope: scope || 'self' }; },
    group:         function (action, groupId)   { var m = { v: V, type: 'group', action: action }; if (groupId != null) m.groupId = groupId; return m; }
  };

  // --- lightweight validation ------------------------------------------------
  var CLIENT_TYPES = { hello: 1, setPattern: 1, setParam: 1, setParams: 1, setBrightness: 1, group: 1 };
  var DEVICE_TYPES = { state: 1, ack: 1, error: 1 };
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
    return null; // ok
  }

  // --- mock device (implements the device side; uses the engine for param defaults) ---
  function MockDevice(opts) {
    opts = opts || {};
    var effects = opts.effects || root.SmithEffects || null;
    var st = {
      pattern: opts.pattern || (effects ? effects.list[0].id : 'axis-gradient'),
      params: {},
      brightness: opts.brightness != null ? opts.brightness : 0.5,
      brightnessCeiling: opts.ceiling != null ? opts.ceiling : 0.7, // HW limit, not overridable
      group: { id: 0, role: 'standalone', peers: 0 },
      battery: opts.battery != null ? opts.battery : 0.82
    };
    function loadDefaults() { if (effects && effects.resolve) st.params = effects.resolve(st.pattern, {}); }
    loadDefaults();

    function state() {
      return {
        v: V, type: 'state', pattern: st.pattern, params: st.params,
        brightness: st.brightness, brightnessCeiling: st.brightnessCeiling,
        group: { id: st.group.id, role: st.group.role, peers: st.group.peers }, battery: st.battery
      };
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
      }
      return state();
    }
    return {
      handle: handle, state: state, _st: st,
      effectiveBrightness: function () { return Math.min(st.brightness, st.brightnessCeiling); }
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
