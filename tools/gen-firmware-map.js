#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 StaffSmith GmbH
//
// gen-firmware-map.js — generates firmware/generated/<map>_map.c (smith_map_t/smith_led_t
// constants, firmware/include/smith_engine.h §3) straight from an engine/maps/*.js generator
// (the same JSON shape engine/SPEC.md §2 freezes). Analogous to tools/gen-dmx-map.js, but the
// target is a C source file instead of a Markdown/GDTF doc. Closes the "Was diese Spec bewusst
// offenlässt" item in firmware/SPEC.md §9 (codegen tool was explicitly out of scope of SPEC v1).
//
// Usage (from repos/staffsmith-led-platform):
//   node tools/gen-firmware-map.js discus [full|annular]         print C to stdout (dry run)
//   node tools/gen-firmware-map.js cube [n]                      (default n=5)
//   node tools/gen-firmware-map.js strip [n]                     (default n=60)
//   node tools/gen-firmware-map.js matrix [w] [h]                (default 16x16)
//   ... --check     exit 1 if firmware/generated/<map>_map.c has drifted from the generator
//   ... --write     (re)write firmware/generated/<map>_map.c
//   ... --out=<path>  target a different output file
//
// Invariants this tool enforces (see validateMap()/resolveFaceId()/resolveGroupId() below):
//   - smith_map_t.count / smith_led_t.i must fit uint16_t (hard error otherwise — a real C-type
//     ceiling, not a style preference).
//   - JSON `count` must equal `leds.length`, and every `i` must be unique and < count (data
//     integrity — a drifted map JSON must never silently compile).
//   - Every `face` string must have an explicit numeric mapping (FACE_TABLES) or be the
//     external-LED sentinel 'ext' -> SMITH_FACE_NONE; an unmapped face is a hard error rather
//     than a silent guess, same "explicit over silent" call the header makes for
//     smith_registry_find() (SPEC.md §3 mapping table).
//   - This tool never emits anything touching smith_brightness_t / .ceiling — the brightness/
//     thermal safety ceiling (smith_engine.h §10) is a structurally separate, non-map concern.
//     The one *design*-ceiling this tool does reason about is firmware/SPEC.md §8's onboard
//     frame-budget/SRAM sizing figure (SMITH_DESIGN_CEILING_LEDS = 100 px) — exceeding it is
//     only ever an informational NOTE in the generated file's banner comment, never a hard
//     failure: the exact onboard power ceiling is still a pending product decision (loops/
//     STATE.md 2026-06-27 L2 pre-decision floats a lower ≤50px number), and external groups
//     (strip/matrix, separately powered) are excluded from the count on purpose.

'use strict';
const fs = require('fs');
const path = require('path');

const SMITH_FACE_NONE = 0xff;
const SMITH_GROUP_ONBOARD = 0;
const GROUP_IDS = { onboard: 0, external: 1 };

// Per-body-type face-string -> small numeric id (smith_led_t.face, smith_engine.h §3 comment).
// External maps (strip/matrix) use face 'ext', handled generically below -> SMITH_FACE_NONE,
// same as an entirely absent `face` field.
const FACE_TABLES = {
  discus: { a: 0, b: 1 },
  cube: { px: 0, nx: 1, py: 2, ny: 3, pz: 4 },
  strip: {},
  matrix: {},
};

// firmware/SPEC.md §8 design-ceiling figure (frame-budget/SRAM sizing), NOT the brightness/
// thermal safety ceiling (§10) — see banner comment above.
const SMITH_DESIGN_CEILING_LEDS = 100;

const MAP_DEFS = {
  discus: {
    file: 'discus.js',
    call: (a) => globalThis.SmithMaps.discus(a[0] || 'full'),
  },
  cube: {
    file: 'cube.js',
    call: (a) => globalThis.SmithMaps.cube(a[0] !== undefined ? Number(a[0]) : undefined),
  },
  strip: {
    file: 'strip.js',
    call: (a) => globalThis.SmithMaps.strip(a[0] !== undefined ? Number(a[0]) : undefined),
  },
  matrix: {
    file: 'matrix.js',
    call: (a) =>
      globalThis.SmithMaps.matrix(
        a[0] !== undefined ? Number(a[0]) : undefined,
        a[1] !== undefined ? Number(a[1]) : undefined
      ),
  },
};

function resolveFaceId(kind, faceStr) {
  if (faceStr === undefined || faceStr === null || faceStr === 'ext') return SMITH_FACE_NONE;
  const table = FACE_TABLES[kind] || {};
  if (Object.prototype.hasOwnProperty.call(table, faceStr)) return table[faceStr];
  throw new Error(
    `gen-firmware-map: unknown face id "${faceStr}" for map kind "${kind}" — add it to FACE_TABLES before regenerating.`
  );
}

function resolveGroupId(groupStr) {
  if (groupStr === undefined || groupStr === null) return SMITH_GROUP_ONBOARD;
  if (Object.prototype.hasOwnProperty.call(GROUP_IDS, groupStr)) return GROUP_IDS[groupStr];
  throw new Error(`gen-firmware-map: unknown group "${groupStr}" — expected "onboard" or "external".`);
}

function mapSlug(name) {
  return name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// --- validation: engine/SPEC.md §2 required fields + the hard C-type invariants of
// smith_map_t/smith_led_t (uint16_t count / i, count === leds.length, unique in-range i). ------
function validateMap(map) {
  if (!map || typeof map.name !== 'string' || !map.name) {
    throw new Error('gen-firmware-map: map is missing a valid "name"');
  }
  if (!Array.isArray(map.leds)) {
    throw new Error(`gen-firmware-map: "${map.name}" has no "leds" array`);
  }
  if (typeof map.count !== 'number' || map.count !== map.leds.length) {
    throw new Error(
      `gen-firmware-map: "${map.name}" count mismatch — JSON count=${map.count}, leds.length=${map.leds.length}`
    );
  }
  if (map.count > 0xffff) {
    throw new Error(
      `gen-firmware-map: "${map.name}" count=${map.count} exceeds smith_map_t.count's uint16_t range (65535)`
    );
  }
  const seenIndex = new Set();
  for (const led of map.leds) {
    if (typeof led.i !== 'number' || !Number.isInteger(led.i) || led.i < 0) {
      throw new Error(`gen-firmware-map: "${map.name}" led has invalid "i": ${JSON.stringify(led.i)}`);
    }
    if (led.i > 0xffff) {
      throw new Error(
        `gen-firmware-map: "${map.name}" led.i=${led.i} exceeds smith_led_t.i's uint16_t range (65535)`
      );
    }
    if (seenIndex.has(led.i)) {
      throw new Error(
        `gen-firmware-map: "${map.name}" duplicate led.i=${led.i} (must be unique — engine/SPEC.md §2 chain order)`
      );
    }
    seenIndex.add(led.i);
    if (led.i >= map.count) {
      throw new Error(`gen-firmware-map: "${map.name}" led.i=${led.i} >= count=${map.count}`);
    }
    if (
      !Array.isArray(led.p) ||
      led.p.length !== 3 ||
      led.p.some((v) => typeof v !== 'number' || !Number.isFinite(v))
    ) {
      throw new Error(
        `gen-firmware-map: "${map.name}" led i=${led.i} missing/invalid required "p" (engine/SPEC.md §2)`
      );
    }
  }
}

function designCeilingNote(map) {
  const onboard = map.leds.filter((l) => resolveGroupId(l.group) === SMITH_GROUP_ONBOARD).length;
  if (onboard > SMITH_DESIGN_CEILING_LEDS) {
    return (
      `NOTE: ${onboard} onboard LEDs > firmware/SPEC.md §8 design-ceiling figure ` +
      `(${SMITH_DESIGN_CEILING_LEDS}) — informational only, does not block codegen (exact ` +
      `onboard power ceiling is still a pending product decision, loops/STATE.md 2026-06-27 ` +
      `L2 pre-decision). External-group LEDs are excluded from this count on purpose.`
    );
  }
  return null;
}

// --- C emission ---------------------------------------------------------------------------
function f32(x) {
  let n = Number(x);
  if (!Number.isFinite(n)) n = 0;
  if (Object.is(n, -0)) n = 0;
  return `${n.toFixed(6)}f`;
}

function emitC(map, kind, sourceFile) {
  const slug = mapSlug(map.name);
  const ledsSym = `${slug}_leds`;
  const mapSym = `${slug}_map`;

  const rows = map.leds.map((led) => {
    const face = resolveFaceId(kind, led.face);
    const group = resolveGroupId(led.group);
    const [x, y, z] = led.p;
    const [u, v] = Array.isArray(led.uv) ? led.uv : [0, 0];
    const [nx, ny, nz] = Array.isArray(led.n) ? led.n : [0, 0, 0];
    return (
      `    { ${led.i}, ${face}, ${group}, ${f32(x)}, ${f32(y)}, ${f32(z)}, ` +
      `${f32(u)}, ${f32(v)}, ${f32(nx)}, ${f32(ny)}, ${f32(nz)} },`
    );
  });

  const lines = [
    '// SPDX-License-Identifier: Apache-2.0',
    '// Copyright 2026 StaffSmith GmbH',
    '//',
    `// AUTO-GENERATED by tools/gen-firmware-map.js from engine/maps/${sourceFile} — DO NOT EDIT BY HAND.`,
    `// Regenerate: node tools/gen-firmware-map.js ${kind} ... --write (see tool banner for args)`,
    '//',
    `// Source map (engine/SPEC.md §2 JSON, frozen v1): name="${map.name}", count=${map.count}.`,
    '// Conforms to firmware/include/smith_engine.h (SPEC v1 FROZEN 2026-07-05): smith_map_t /',
    '// smith_led_t, field order i,face,group,x,y,z,u,v,nx,ny,nz. Flash-resident (static const,',
    '// .rodata) per SPEC.md §8 — no heap allocation, nothing parsed at runtime. Declares no',
    '// smith_brightness_t / .ceiling — the brightness/thermal safety ceiling (SPEC.md §10) is a',
    '// separate, non-map concern this generator never touches.',
  ];
  const note = designCeilingNote(map);
  if (note) lines.push('//', `// ${note}`);
  lines.push(
    '',
    '#include "smith_engine.h"',
    '',
    '/* i, face, group, x, y, z, u, v, nx, ny, nz */',
    `static const smith_led_t ${ledsSym}[] = {`,
    ...rows,
    '};',
    '',
    `static const smith_map_t ${mapSym} = {`,
    `    "${map.name}",`,
    `    ${map.count},`,
    `    ${ledsSym}`,
    '};',
    ''
  );
  return lines.join('\n');
}

// --- CLI ------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));
const kind = positional[0];
const mapArgs = positional.slice(1);
const mode = flags.includes('--write') ? 'write' : flags.includes('--check') ? 'check' : 'print';
const outFlag = flags.find((a) => a.startsWith('--out='));

if (!kind || !MAP_DEFS[kind]) {
  console.error(
    `Usage: node tools/gen-firmware-map.js <${Object.keys(MAP_DEFS).join('|')}> [args...] [--check|--write] [--out=<path>]`
  );
  process.exit(1);
}

const def = MAP_DEFS[kind];
require(path.join(__dirname, '..', 'engine', 'maps', def.file));
const map = def.call(mapArgs);
validateMap(map);
const code = emitC(map, kind, def.file);

const defaultOut = path.join(__dirname, '..', 'firmware', 'generated', `${mapSlug(map.name)}_map.c`);
const outPath = outFlag ? path.resolve(outFlag.slice('--out='.length)) : defaultOut;

if (mode === 'print') {
  console.log(code);
  process.exit(0);
}

if (mode === 'check') {
  if (!fs.existsSync(outPath)) {
    console.error(`gen-firmware-map: ${outPath} does not exist yet — run with --write.`);
    process.exit(1);
  }
  const existing = fs.readFileSync(outPath, 'utf8');
  if (existing !== code) {
    console.error(`gen-firmware-map: DRIFT in ${outPath} — run with --write to regenerate.`);
    process.exit(1);
  }
  console.log(`gen-firmware-map: OK, ${outPath} matches engine/maps/${def.file}.`);
  process.exit(0);
}

if (mode === 'write') {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, code, 'utf8');
  console.log(`gen-firmware-map: wrote ${outPath}.`);
}
