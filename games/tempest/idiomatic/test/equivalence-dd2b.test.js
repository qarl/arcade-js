// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_dd2b (ROM 0xdd2b-0xdd40) -- stashes Y at $35, scales A,X via loc_df75, then
// shifts $35 out MSB-first over 8 passes ($37 = 7..0), emitting each carry bit through loc_df1f. The
// idiomatic side dissolves the two jsr into direct loc_df75(m, a, x) and loc_df1f(m, bit) calls. Live-out is
// memory ($35 ends 0x00, $37 ends 0xff, plus the emitted records) PLUS exit A -- the LAST loc_df1f return
// (the cursor value), threaded up the chain to dd0d; the arms compare RAM AND A. Run:
// node --test games/tempest/idiomatic/test/equivalence-dd2b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_dd2b as oracle } from "../../translated/loc_dd2b.js";
import { loc_dd2b } from "../loc_dd2b.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_df75 } from "../loc_df75.js";
import { loc_df1f } from "../loc_df1f.js";
import { STACK_SCRATCH, loc_35, loc_37, loc_74 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdd2b;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xdd2b dispatches -- loc_dd2b == oracle in RAM (-stack) and A live-out", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_dd2b(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out (last df1f cursor value) matches");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Distinct A/Y/X and a mixed bit pattern in Y (0xb4) so MSB-first emission order matters; ($74) cursor into
// vector RAM so the eight emitted digits land in diffed RAM.
function seedDistinct(m) {
  m.regs.a = 0x11; m.regs.y = 0xb4; m.regs.x = 0x33;
  m.mem.write8(loc_74, 0x00); m.mem.write8(loc_74 + 1, 0x21); // ($74) -> 0x2100
}

test("CRAFTED: distinct A/X and a mixed bit pattern -- loc_dd2b == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seedDistinct(o);
  const c = new Machine(ROM, OPTS); seedDistinct(c);
  oracle(o); loc_dd2b(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after scale + 8 digit emits");
  assert.equal(c.regs.a, o.regs.a, "A live-out (last df1f cursor value) matches");
  assert.equal(c.mem.read8(loc_35), 0x00, "$35 shifted fully out to 0");
  assert.equal(c.mem.read8(loc_37), 0xff, "$37 loop counter ran to 0xff");
});

test("TEETH: a twin that skips the digit loop diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedDistinct(o);
  const c = new Machine(ROM, OPTS); seedDistinct(c);
  oracle(o);
  const brokenDd2b = (m, y = m.regs.y, a = m.regs.a, x = m.regs.x) => {
    const mem8 = m.mem8;
    mem8[loc_35] = y;
    loc_df75(m, a, x); // BUG: never runs the 8-pass digit-emit loop
  };
  brokenDd2b(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped digit loop");
});

test("TEETH (marshalling): a twin that scales X,A swapped diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedDistinct(o); oracle(o);
  const c = new Machine(ROM, OPTS); seedDistinct(c);
  const swappedTwin = (m, y = m.regs.y, a = m.regs.a, x = m.regs.x) => {
    const mem8 = m.mem8;
    mem8[loc_35] = y;
    loc_df75(m, x, a); // BUG: A and X args swapped
    mem8[loc_37] = 0x07;
    do {
      const shifted = mem8[loc_35] << 1;
      mem8[loc_35] = shifted;
      loc_df1f(m, (shifted >> 8) & 1);
      mem8[loc_37] = mem8[loc_37] - 1;
    } while (mem8[loc_37] < 0x80);
  };
  swappedTwin(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the swapped scale args");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, loc_dd2b, TARGET, m);
  assert.equal(r.placeable, true, `loc_dd2b must be seam-placeable; got: ${r.error}`);
});
