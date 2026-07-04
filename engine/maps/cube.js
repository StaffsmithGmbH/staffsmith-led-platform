// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 StaffSmith GmbH
//
// Cube head coordinate map generator (Loop L1).
// Five lit faces; the 6th face (-Z) is the spearmount socket and carries no LEDs.
// Coordinate space: normalized cube spanning [-1, 1] on each axis, centered at origin.
//
// Output shape (see engine/SPEC.md — this is the frozen map format):
//   { name, space, n, count, leds: [ { i, face, p:[x,y,z], uv:[u,v], n:[nx,ny,nz] }, ... ] }

(function (root) {
  // Each lit face: a base point and two edge vectors spanning the [-1,1] square,
  // plus an outward normal. u runs along du, v along dv; both in (0,1) cell centers.
  var FACES = [
    { face: 'px', base: [ 1, -1, -1], du: [0, 2, 0], dv: [0, 0, 2], n: [ 1, 0, 0] },
    { face: 'nx', base: [-1, -1, -1], du: [0, 2, 0], dv: [0, 0, 2], n: [-1, 0, 0] },
    { face: 'py', base: [-1,  1, -1], du: [2, 0, 0], dv: [0, 0, 2], n: [ 0, 1, 0] },
    { face: 'ny', base: [-1, -1, -1], du: [2, 0, 0], dv: [0, 0, 2], n: [ 0,-1, 0] },
    { face: 'pz', base: [-1, -1,  1], du: [2, 0, 0], dv: [0, 2, 0], n: [ 0, 0, 1] }
    // 'nz' (z = -1) omitted on purpose: spearmount socket.
  ];

  function buildCube(n) {
    n = n || 5;
    var leds = [];
    var i = 0;
    for (var f = 0; f < FACES.length; f++) {
      var F = FACES[f];
      for (var iv = 0; iv < n; iv++) {
        for (var iu = 0; iu < n; iu++) {
          var u = (iu + 0.5) / n; // cell center, avoids the very edge
          var v = (iv + 0.5) / n;
          var p = [
            F.base[0] + F.du[0] * u + F.dv[0] * v,
            F.base[1] + F.du[1] * u + F.dv[1] * v,
            F.base[2] + F.du[2] * u + F.dv[2] * v
          ];
          leds.push({ i: i++, face: F.face, p: p, uv: [u, v], n: F.n.slice() });
        }
      }
    }
    return {
      name: 'cube-v1',
      space: 'normalized [-1, 1]',
      n: n,
      count: leds.length,
      leds: leds
    };
  }

  root.SmithMaps = root.SmithMaps || {};
  root.SmithMaps.cube = buildCube;
})(typeof window !== 'undefined' ? window : globalThis);
