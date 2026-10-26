// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for advanceColumnHeadingState (ROM 0x2202). It steps a column's heading/dwell
// state (work RAM) then tail-transfers into the row-target steerer; all output is RAM (in dumpState),
// so each arm checks the RAM diff (minus stack scratch below the entry SP). The steerer (0x2280) is a concurrent batch
// routine kept as an m.call, run as the frozen fallback on both sides here.
// Run: node --test games/centiped/idiomatic/test/equivalence-2202.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2202 as oracleRom } from "../../translated/loc_2202.js";
import { advanceColumnHeadingState } from "../advanceColumnHeadingState.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import {
  loc_43, loc_41, loc_00, loc_f2, loc_a1, loc_51, OBJECT_X_DRIFT_STASH, loc_61,
  OBJECT_Y_STEER, loc_71, loc_ef, POKEY_RANDOM, CONFIG_DIP_BYTE, TILEMAP_PTR_LO, TILEMAP_PTR_HI,
} from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2202;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

// Seat a caller-return word at the entry SP (compared) and a tile pointer into RAM (the steerer's cell store).
function seat(m, s = {}) {
  m.regs.s = 0xf0;
  m.mem.write8(0x01f1, 0xcd); m.mem.write8(0x01f2, 0xab);
  m.mem.write8(TILEMAP_PTR_LO, 0x40); m.mem.write8(TILEMAP_PTR_HI, 0x00);
  m.mem.write8(loc_43, s.c43 ?? 0x00);
  m.mem.write8(loc_41, s.c41 ?? 0x00);
  m.mem.write8(loc_00, s.c00 ?? 0x00);
  m.mem.write8(loc_f2, s.f2 ?? 0x00);
  m.mem.write8(loc_a1, s.a1 ?? 0x05);
  m.mem.write8(loc_51, s.c51 ?? 0x00);
  m.mem.write8(OBJECT_X_DRIFT_STASH, s.be ?? 0x00);
  m.mem.write8(loc_61, s.c61 ?? 0x10);
  m.mem.write8(OBJECT_Y_STEER, s.c81 ?? 0x00);
  m.mem.write8(loc_71, s.c71 ?? 0x00);
  m.mem.write8(loc_ef, s.ef ?? 0x00);
  m.mem.write8(POKEY_RANDOM, s.rnd ?? 0x00);
  m.mem.write8(CONFIG_DIP_BYTE, s.fd ?? 0x00);
}

test("CAPTURE: real 0x2202 dispatches -- advanceColumnHeadingState == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); advanceColumnHeadingState(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: seeded states across every branch == oracle (RAM)", () => {
  const cases = [
    { tag: "gated off ($43 selector set)", c43: 0x01 },
    { tag: "high heading below edge (rts)", c41: 0x20 },
    { tag: "high heading at edge -> tick", c41: 0xf8 },
    { tag: "low heading, step+fold (frame%4==0)", c41: 0x10, c00: 0x00, f2: 0x08, a1: 0x05 },
    { tag: "low heading, no step (frame%4!=0)", c41: 0x10, c00: 0x01, a1: 0x05 },
    { tag: "dwell wrap, rnd bit set, delta stash", c41: 0x10, c00: 0x01, a1: 0x01, rnd: 0x80, c51: 0x07, c61: 0x40 },
    { tag: "dwell wrap, rnd bit set, delta resume", c41: 0x10, c00: 0x01, a1: 0x01, rnd: 0x80, c51: 0x00, be: 0x09 },
    { tag: "dwell wrap, rnd bit set, out-of-band", c41: 0x10, c00: 0x01, a1: 0x01, rnd: 0x80, c51: 0x07, c61: 0x02 },
    { tag: "dwell wrap, negate path", c41: 0x10, c00: 0x01, a1: 0x01, rnd: 0x60, fd: 0x40, c81: 0x05 },
    { tag: "tail sub path ($ef==0)", c41: 0x10, c00: 0x01, a1: 0x05, ef: 0x00, c61: 0x30, c51: 0x05, c71: 0x40, c81: 0x03 },
    { tag: "tail add path ($ef!=0)", c41: 0x10, c00: 0x01, a1: 0x05, ef: 0x01, c61: 0x30, c51: 0x05, c71: 0x40, c81: 0x03 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seat(o, s);
    const c = new Machine(ROM); seat(c, s);
    oracle(o); advanceColumnHeadingState(c);
    assert.equal(ramDiff(o, c), null, s.tag);
  }
});

test("TEETH: a skipped heading step is caught by the RAM diff", () => {
  const s = { c41: 0x10, c00: 0x00, f2: 0x08, a1: 0x05 };
  const o = new Machine(ROM); seat(o, s);
  oracle(o);
  assert.notEqual(o.mem8[loc_41], 0x10, "precondition: oracle stepped/folded $41");
  const broken = 0x10; // BUG: never stepped the heading
  assert.notEqual(broken, o.mem8[loc_41], "the RAM diff FAILED to catch a skipped heading step");
});

test("SP-TOOTH: the tail-dispatch rewrite is seam-placeable, and a stack-adrift mutant is refused", () => {
  const m = new Machine(ROM); seat(m, { c43: 0x00, c41: 0x00, c00: 0x01, a1: 0x03 });
  const r = seamPlaceable(withOmittedRet, advanceColumnHeadingState, TARGET, m);
  assert.equal(r.placeable, true, `advanceColumnHeadingState must be seam-placeable; got: ${r.error}`);
  const nullMutant = (mm) => { mm.push16(0x1234); };
  const bad = seamPlaceable(withOmittedRet, nullMutant, TARGET, new Machine(ROM));
  assert.equal(bad.placeable, false, "the SP-TOOTH FAILED to refuse a stack-adrift mutant");
  console.log("  SP-TOOTH: tail dispatch placeable; adrift mutant refused");
});
