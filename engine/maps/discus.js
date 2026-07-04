// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 StaffSmith GmbH
//
// Discus head coordinate map generator (Loop L1 → feeds L7 Discus PCB).
// Dual-role module: onboard LEDs on BOTH flat sides (face 'a' = +Z, 'b' = -Z).
// Onboard layout per side: single outer ring of N LEDs near the rim.
// Two body variants share the SAME LED map (form only changes the PCB outline / center bore):
//   'full'    — solid disc
//   'annular' — central bore for the spearmount shaft (keepout, no LEDs in center)
//
// Format: frozen engine/SPEC.md v1. Optional additive field `group` ('onboard') — does not
// break the v1 contract (required i,p; recommended face,uv,n).

(function (root) {
  function buildDiscus(form) {
    form = form === 'annular' ? 'annular' : 'full';
    var perSide = 16;     // outer-ring LEDs per side
    var R = 0.85;         // ring radius in normalized [-1,1]
    var tz = 0.12;        // half-thickness: face A at +tz, face B at -tz
    var bore = 0.33;      // central bore radius (annular only)

    var sides = [
      { face: 'a', z:  tz, n: [0, 0,  1] },
      { face: 'b', z: -tz, n: [0, 0, -1] }
    ];
    var leds = [];
    var i = 0;
    for (var s = 0; s < sides.length; s++) {
      var S = sides[s];
      for (var k = 0; k < perSide; k++) {
        var ang = (2 * Math.PI * k) / perSide;
        leds.push({
          i: i++,
          face: S.face,
          p: [R * Math.cos(ang), R * Math.sin(ang), S.z],
          uv: [k / perSide, 0.5],        // u = angle around ring, single ring → v = 0.5
          n: S.n.slice(),
          group: 'onboard'
        });
      }
    }
    return {
      name: 'discus-' + form,
      space: 'normalized [-1, 1]',
      form: form,
      count: leds.length,                // 32
      leds: leds,
      // sim-only body hints (not part of the per-LED contract):
      body: 'discus',
      ring: { r: R, tz: tz },
      bore: form === 'annular' ? bore : 0,
      dotSize: 0.16
    };
  }

  root.SmithMaps = root.SmithMaps || {};
  root.SmithMaps.discus = buildDiscus;
})(typeof window !== 'undefined' ? window : globalThis);
