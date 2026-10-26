// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clearPlayfield (ROM 0x09d6) -- clear the play-field framebuffer from 0x2402, skip
// the 6-byte column margin whenever (L & 0x1f) >= 0x1c, loop until H==0x40. The routine takes NO input
// register and its live-out is MEMORY ONLY (no caller reads back HL/A/DE/flags -- verified against every
// call site), so each side runs on a fresh clone and the contract is RAM (dumpState, minus stack scratch below the entry SP).
// Interrupts are disabled on the oracle clone so its cycle-driven clear runs atomically like the idiomatic
// module (the mid-clear RST ISRs are an emulation artifact the idiomatic layer elides; they touch RAM the
// module never does). RAM is pre-filled 0xAA so cleared cells are distinguishable from skipped ones.
// Run: node --test games/invaders/idiomatic/test/equivalence-09d6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_09d6 as oracleBody } from "../../translated/loc_09d6.js";
import { clearPlayfield } from "../clearPlayfield.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { PLAYFIELD_VRAM_BASE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x09d6;

// Pre-fill the framebuffer with a non-zero pattern so a cleared cell (0x00) is distinguishable from a
// skipped one (still the pattern).
const fillVideo = (mm, v) => { for (let a = 0x2400; a <= 0x3fff; a++) mm.mem.write8(a, v); };
// Isolate the clear: no mid-routine RST interrupts (the idiomatic module runs atomically).
const noInt = (mm) => { mm.io.inte = false; return mm; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x09d6 dispatches -- clearPlayfield == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = noInt(cap.clone()), c = noInt(cap.clone());
    oracle(o); clearPlayfield(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: clears 0x2402.. with the 6-byte gap skip; skipped cells survive", () => {
  const o = noInt(new Machine(ROM)), c = noInt(new Machine(ROM));
  fillVideo(o, 0xaa); fillVideo(c, 0xaa);
  oracle(o); clearPlayfield(c);

  assert.equal(ramDiff(o, c), null, "module clears identically to the oracle");
  // live-out is MEMORY only -- spot-check the module's clear pattern against the ROM goldens.
  assert.equal(c.mem.read8(PLAYFIELD_VRAM_BASE), 0x00, "first cell cleared");
  assert.equal(c.mem.read8(0x241b), 0x00, "last cell before the first gap cleared");
  assert.equal(c.mem.read8(0x241c), 0xaa, "gap start skipped");
  assert.equal(c.mem.read8(0x2422), 0x00, "first cell after the gap cleared");
  assert.equal(c.mem.read8(0x3ffb), 0x00, "last cleared cell");
  assert.equal(c.mem.read8(0x3fff), 0xaa, "tail past the last write untouched");
  assert.equal(c.mem.read8(0x2400), 0xaa, "0x2400/0x2401 untouched (clear starts at 0x2402)");
});

test("CRAFTED: a different pre-fill pattern still matches the oracle", () => {
  const o = noInt(new Machine(ROM)), c = noInt(new Machine(ROM));
  fillVideo(o, 0xff); fillVideo(c, 0xff);
  oracle(o); clearPlayfield(c);
  assert.equal(ramDiff(o, c), null);
  assert.equal(c.mem.read8(0x241c), 0xff, "gap cell keeps the fill");
});

// A broken twin of the module: it forgets to skip the 6-byte column margin, so it clears the gap cells.
function loc_09d6_broken(m) {
  let p = PLAYFIELD_VRAM_BASE;
  for (;;) {
    m.mem8[p] = 0;
    p += 1;
    // BUG: the `(p & 0x1f) >= 0x1c -> p += 6` gap skip is removed
    if ((p >> 8) >= 0x40) break;
  }
}

test("TEETH: a twin that clears the gap cells is caught by the diff", () => {
  const o = noInt(new Machine(ROM)), c = noInt(new Machine(ROM));
  fillVideo(o, 0xaa); fillVideo(c, 0xaa);
  oracle(o); loc_09d6_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the diff FAILED to catch a twin that clears the gap");
  assert.equal(d.addr, 0x241c, "first divergence is the first skipped gap cell");
});
