#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 StaffSmith GmbH
//
// gen-dmx-map.js — generates the DMX/GDTF fixture-map sections of dmx-mapping.md
// straight from engine/effects.js `controls` metadata (the same source that feeds the
// Web-UI and the Simulator, see SPEC.md §6). Keeps code and fixture doc in sync: a new
// effect, or a changed control, regenerates its band + param table + GDTF ChannelSet
// automatically instead of relying on a hand-updated doc.
// (Closes the "Offen / nächste Schritte" item in dmx-mapping.md — L9-Vorgriff.)
//
// Usage (from repos/staffsmith-led-platform):
//   node tools/gen-dmx-map.js                 print generated sections to stdout (dry run)
//   node tools/gen-dmx-map.js --check         exit 1 if the target doc has drifted
//   node tools/gen-dmx-map.js --write         rewrite the marked sections in-place
//   node tools/gen-dmx-map.js --doc=<path>    target a different dmx-mapping.md
//
// The doc currently lives at the top-level project docs/ (pre-repo planning doc, DMX/OSC
// egress is a Pro-tier feature — see dmx-mapping.md header); default path below points
// there. --doc lets this move into a repo-local docs/ later without touching the script.

'use strict';
const fs = require('fs');
const path = require('path');

const STD_PARAM_CHANNELS = 4; // Standard-Mode: Ch3..Ch6 = Param1..4 (dmx-mapping.md §Standard-Mode)

const args = process.argv.slice(2);
const mode = args.includes('--write') ? 'write' : args.includes('--check') ? 'check' : 'print';
const docArg = args.find((a) => a.startsWith('--doc='));
const DOC_PATH = docArg
  ? path.resolve(docArg.slice('--doc='.length))
  : path.join(__dirname, '..', '..', '..', 'docs', 'dmx-mapping.md');

require(path.join(__dirname, '..', 'engine', 'effects.js'));
const EFFECTS = globalThis.SmithEffects.list;

for (const e of EFFECTS) {
  if (e.controls.length > STD_PARAM_CHANNELS) {
    throw new Error(
      `gen-dmx-map: "${e.id}" declares ${e.controls.length} controls > ${STD_PARAM_CHANNELS} ` +
      `Standard-Mode param channels (Ch3..Ch6) — needs an Extended-Mode or fewer controls.`
    );
  }
}

// --- band math: even split of DMX 0..255 across N effects -----------------------
// boundary(i) = floor(i * 256 / n); band i = [boundary(i), boundary(i+1) - 1]
function bands(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const lo = Math.floor((i * 256) / n);
    const hi = Math.floor(((i + 1) * 256) / n) - 1;
    out.push([lo, hi]);
  }
  return out;
}
const BANDS = bands(EFFECTS.length);

function paramRange(c) {
  if (c.type === 'toggle') return '<128 off / ≥128 on';
  return `${c.min} … ${c.max} (def ${c.def})`;
}

function controlsKey(controls) {
  return JSON.stringify(controls.map((c) => [c.id, c.type, c.min, c.max, c.step, c.def]));
}

function genBandsSection() {
  const lines = ['| DMX-Wert | Effekt |', '|---|---|'];
  EFFECTS.forEach((e, i) => {
    const [lo, hi] = BANDS[i];
    lines.push(`| ${lo}–${hi} | ${e.id} |`);
  });
  return lines.join('\n');
}

function genParamSection() {
  const seen = new Map(); // controlsKey -> first effect id with that exact control schema
  const blocks = EFFECTS.map((e) => {
    const key = controlsKey(e.controls);
    let note = '';
    if (seen.has(key)) {
      note = ` — identisch zu ${seen.get(key)}`;
    } else {
      seen.set(key, e.id);
      const unused = STD_PARAM_CHANNELS - e.controls.length;
      if (unused === 1) note = ' — P4 ungenutzt';
      else if (unused > 1) note = ` — P${STD_PARAM_CHANNELS - unused + 1}-P${STD_PARAM_CHANNELS} ungenutzt`;
    }
    const lines = [`**${e.id}**${note}`, '| Ch | Param | Typ | Bereich |', '|---|---|---|---|'];
    e.controls.forEach((c, ci) => lines.push(`| ${3 + ci} | ${c.id} | ${c.type} | ${paramRange(c)} |`));
    return lines.join('\n');
  });
  return blocks.join('\n\n');
}

function genGdtfSection() {
  return EFFECTS.map((e, i) => {
    const [lo] = BANDS[i];
    return `          <ChannelSet Name="${e.id}" DMXFrom="${lo}/1"/>`;
  }).join('\n');
}

const SECTIONS = { bands: genBandsSection(), params: genParamSection(), gdtf: genGdtfSection() };

// --- marker-based patching of the doc --------------------------------------------
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patch(content) {
  let out = content;
  const drifted = [];
  for (const name of Object.keys(SECTIONS)) {
    const start = `<!-- gen-dmx-map:start:${name} -->`;
    const end = `<!-- gen-dmx-map:end:${name} -->`;
    const re = new RegExp(`${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}`);
    if (!re.test(out)) {
      throw new Error(`gen-dmx-map: marker pair "${name}" not found in ${DOC_PATH}`);
    }
    const replacement = `${start}\n${SECTIONS[name]}\n${end}`;
    const before = out;
    out = out.replace(re, replacement);
    if (out !== before) drifted.push(name);
  }
  return { out, drifted };
}

if (mode === 'print') {
  for (const name of Object.keys(SECTIONS)) {
    console.log(`--- ${name} ---`);
    console.log(SECTIONS[name]);
    console.log('');
  }
  process.exit(0);
}

const original = fs.readFileSync(DOC_PATH, 'utf8');
const { out, drifted } = patch(original);

if (mode === 'check') {
  if (drifted.length) {
    console.error(`gen-dmx-map: DRIFT in ${drifted.join(', ')} — run with --write to regenerate.`);
    process.exit(1);
  }
  console.log('gen-dmx-map: OK, dmx-mapping.md matches engine/effects.js.');
  process.exit(0);
}

if (mode === 'write') {
  fs.writeFileSync(DOC_PATH, out, 'utf8');
  console.log(
    drifted.length
      ? `gen-dmx-map: updated section(s): ${drifted.join(', ')}.`
      : 'gen-dmx-map: already up to date, no changes written.'
  );
}
