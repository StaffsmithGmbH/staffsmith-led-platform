// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 StaffSmith GmbH
//
// External LED strip map (Discus dual-role: as a controller driving an external installation).
// A linear strip is just another map the same engine renders — same effects, new geometry.
// Format: frozen engine/SPEC.md v1.

(function (root) {
  function buildStrip(n) {
    n = n || 60;
    var leds = [];
    for (var i = 0; i < n; i++) {
      var x = n > 1 ? -1 + (2 * i) / (n - 1) : 0; // span [-1,1] along X
      leds.push({
        i: i,
        face: 'ext',
        p: [x, 0, 0],
        uv: [n > 1 ? i / (n - 1) : 0, 0],
        n: [0, 0, 1],
        group: 'external'
      });
    }
    return {
      name: 'strip-' + n,
      space: 'normalized [-1, 1]',
      count: n,
      leds: leds,
      body: 'line',
      dotSize: 0.09
    };
  }
  root.SmithMaps = root.SmithMaps || {};
  root.SmithMaps.strip = buildStrip;
})(typeof window !== 'undefined' ? window : globalThis);
