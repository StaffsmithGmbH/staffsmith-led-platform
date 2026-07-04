// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 StaffSmith GmbH
//
// External 2D LED matrix map (Discus dual-role: driving an addressable raster/display).
// A matrix is an addressable raster (WS2812/APA102) — covered by the §5 outputs + §8 (u,v)
// mapping; no HUB75 needed. Same engine, new geometry. Format: frozen engine/SPEC.md v1.

(function (root) {
  function buildMatrix(w, h) {
    w = w || 16; h = h || 16;
    var leds = [];
    var i = 0;
    for (var r = 0; r < h; r++) {        // rows (y, top→bottom)
      for (var c = 0; c < w; c++) {      // cols (x, left→right)
        var x = w > 1 ? -1 + (2 * c) / (w - 1) : 0;
        var y = h > 1 ?  1 - (2 * r) / (h - 1) : 0;
        leds.push({
          i: i++,
          face: 'ext',
          p: [x, y, 0],
          uv: [(c + 0.5) / w, (r + 0.5) / h],
          n: [0, 0, 1],
          group: 'external'
        });
      }
    }
    return {
      name: 'matrix-' + w + 'x' + h,
      space: 'normalized [-1, 1]',
      count: leds.length,
      leds: leds,
      body: 'plane',
      dotSize: 0.085
    };
  }
  root.SmithMaps = root.SmithMaps || {};
  root.SmithMaps.matrix = buildMatrix;
})(typeof window !== 'undefined' ? window : globalThis);
