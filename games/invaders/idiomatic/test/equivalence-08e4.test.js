// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for blankScreenStrip -- if the mode-guard cell (0x20ce) is nonzero it returns unchanged;
// otherwise it blanks a fixed 0x20-column screen strip from 0x391c (dissolved into clearScreenStrip ->
// fillScreenRow). Live-out: the cleared cells (RAM) AND HL (the strip's end pointer, or entry HL when the
// guard short-circuits). The oracle push/pops BC through the stack scratch below the entry SP; the module
// drops the save/restore, so CAPTURE excludes relative to that SP and CRAFTED excludes STACK_SCRATCH below the entry SP.
// Run: node --test games/invaders/idiomatic/test/equivalence-08e4.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_08e4 as oracleBody } from "../../translated/loc_08e4.js";
import { blankScreenStrip } from "../blankScreenStrip.js";
import { clearScreenStrip } from "../clearScreenStrip.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x08e4;
const GUARD = 0x20ce;
const STRIP = 0x391c;
const STRIP_END = (STRIP + 0x20 * 0x20) & 0xffff; // 0x391c + 0x20 columns * 0x20 stride
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x08e4 dispatches -- blankScreenStrip == oracle in RAM (-stack) and HL", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp; // the oracle's per-row `push b` residue sits just below the entry SP
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); blankScreenStrip(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seat(m, { guard, hl }) {
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.regs.hl = hl; m.regs.b = 0x11; // HL/B at entry are ignored by the module (fixed strip)
  m.mem.write8(GUARD, guard);
  for (let k = 0; k < 0x20; k++) m.mem.write8((STRIP + k * 0x20) & 0xffff, 0xff); // pre-mark the strip
}

test("CRAFTED: guard set -> no clear, HL untouched; guard clear -> strip blanked, HL := end", () => {
  // guard nonzero: short-circuit, nothing cleared, HL unchanged
  {
    const CASE = { guard: 0x05, hl: 0x1234 };
    const o = new Machine(ROM); seat(o, CASE);
    const c = new Machine(ROM); seat(c, CASE);
    oracle(o); blankScreenStrip(c);
    assert.equal(ramDiff(o, c), null, "guard set: identical RAM (-stack)");
    assert.equal(c.regs.hl, CASE.hl, "guard set: HL is left at entry HL");
    assert.equal(c.regs.hl, o.regs.hl, "guard set: HL matches oracle");
    assert.equal(c.mem.read8(STRIP), 0xff, "guard set: the strip is NOT cleared");
  }
  // guard zero: clear the 0x20-column strip from 0x391c
  {
    const CASE = { guard: 0x00, hl: 0x1234 };
    const o = new Machine(ROM); seat(o, CASE);
    const c = new Machine(ROM); seat(c, CASE);
    oracle(o); blankScreenStrip(c);
    assert.equal(ramDiff(o, c), null, "guard clear: identical RAM (-stack)");
    assert.equal(c.regs.hl, STRIP_END, "guard clear: HL := strip end pointer");
    assert.equal(c.regs.hl, o.regs.hl, "guard clear: HL matches oracle");
    assert.equal(c.mem.read8(STRIP), 0x00, "guard clear: first strip column zeroed");
    assert.equal(c.mem.read8((STRIP + 0x1f * 0x20) & 0xffff), 0x00, "guard clear: last strip column zeroed");
  }
});

test("TEETH: a twin that drops the guard clears the strip even when the guard is set", () => {
  // Broken twin: always clears -- omits the `if (guard) return` short-circuit.
  const brokenTwin = (m) => clearScreenStrip(m, 0x20, STRIP);
  const CASE = { guard: 0x05, hl: 0x1234 };
  const o = new Machine(ROM); seat(o, CASE);
  const c = new Machine(ROM); seat(c, CASE);
  oracle(o); brokenTwin(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a dropped guard");
  assert.equal(d.addr, STRIP, "first divergence is the strip the guard should have protected");
});
