// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for appendNormalizedMantissaExponent (ROM 0xbd3e-0xbd9f) -- appends a two-byte entry to the table at ($74)+$a9:
// small $57 emits a fixed pair, otherwise it drives the math coprocessor and normalizes the result. Live-out
// is memory only (registers at RTS incidental), so each side runs on a clone and the contract is RAM
// (dumpState, minus stack scratch below the entry SP). A leaf: the module omits the ROM ret and the seam completes it. The math
// coprocessor is instantaneous and deterministic, so the crafted seeds are reproducible.
// Run: node --test games/tempest/idiomatic/test/equivalence-bd3e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_bd3e } from "../../translated/loc_bd3e.js";
import { appendNormalizedMantissaExponent } from "../appendNormalizedMantissaExponent.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { OBJ_DEPTH, DEPTH_LO, DEPTH_HI, DRAW_CURSOR_LO, DRAW_CURSOR_HI, SEG_SPREAD_A_LO, loc_a0, DRAW_CURSOR_OFFSET } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xbd3e;
const oracle = atEntry(loc_bd3e);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

// ptr ($74/$75) points into work RAM so the two entry writes land in the diffed dump.
const seedElse = (m) => {
  m.mem.write8(OBJ_DEPTH, 0x40); m.mem.write8(DEPTH_HI, 0x10); m.mem.write8(DEPTH_LO, 0x00);
  m.mem.write8(loc_a0, 0x02); m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x06); m.mem.write8(DRAW_CURSOR_OFFSET, 0x10);
};
const seedTrivial = (m) => {
  m.mem.write8(OBJ_DEPTH, 0x05); m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x06); m.mem.write8(DRAW_CURSOR_OFFSET, 0x20);
};

test("CAPTURE: real 0xbd3e dispatches -- appendNormalizedMantissaExponent == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); appendNormalizedMantissaExponent(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: math-coprocessor branch ($57>=0x10) matches the oracle", () => {
  const o = new Machine(ROM, OPTS); seedElse(o);
  const c = new Machine(ROM, OPTS); seedElse(c);
  oracle(o); const y = appendNormalizedMantissaExponent(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the coprocessor path");
  // LIVE-OUT: the oracle leaves the real Y register at RTS; the module must return it.
  assert.equal(y, o.regs.y, "returned Y == oracle exit Y (else path)");
  assert.equal(y, (c.mem.read8(DRAW_CURSOR_OFFSET) + 2) & 0xff, "exit Y == ($a9 + 2) & 0xff");
});

test("CRAFTED: trivial branch ($57<0x10) writes the fixed (0x00, 0x71) entry", () => {
  const o = new Machine(ROM, OPTS); seedTrivial(o);
  const c = new Machine(ROM, OPTS); seedTrivial(c);
  oracle(o); const y = appendNormalizedMantissaExponent(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the trivial path");
  assert.equal(c.mem.read8(SEG_SPREAD_A_LO), 0x01, "$78 = 0x01");
  assert.equal(c.mem.read8(0x0620), 0x00, "first entry byte = 0x00");
  assert.equal(c.mem.read8(0x0621), 0x71, "second entry byte = 0x71");
  // LIVE-OUT: exit Y is set in the shared convergence, so the trivial path returns it too.
  assert.equal(y, o.regs.y, "returned Y == oracle exit Y (trivial path)");
  assert.equal(y, (c.mem.read8(DRAW_CURSOR_OFFSET) + 2) & 0xff, "exit Y == ($a9 + 2) & 0xff");
});

test("TEETH: a wrong exit-Y return ($a9 + 1) diverges from the oracle's Y", () => {
  const o = new Machine(ROM, OPTS); seedElse(o);
  oracle(o);
  // The most tempting off-by-one: stopping at the first iny (bd99) instead of bd9f.
  const wrongY = (o.mem.read8(DRAW_CURSOR_OFFSET) + 1) & 0xff;
  assert.notEqual(wrongY, o.regs.y, "a return of $a9+1 must NOT equal the oracle exit Y ($a9+2)");
});

test("TEETH: a twin that skips the second entry byte diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedTrivial(o);
  const c = new Machine(ROM, OPTS); seedTrivial(c);
  oracle(o);
  const brokenBd3e = (m) => {
    const mem = m.mem8;
    mem[SEG_SPREAD_A_LO] = 0x01;
    const ptr = mem[DRAW_CURSOR_LO] | (mem[DRAW_CURSOR_HI] << 8);
    mem[(ptr + mem[DRAW_CURSOR_OFFSET]) & 0xffff] = 0x00; // BUG: never writes the exponent byte
  };
  brokenBd3e(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the missing exponent byte");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seedTrivial(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, appendNormalizedMantissaExponent, TARGET, m);
  assert.equal(r.placeable, true, `appendNormalizedMantissaExponent must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
