// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitRecordBodyByte (ROM 0xdf12, second entry of emitHeaderedBodyRecord.js) vs the
// frozen loc_df12, whole path: store A at ($74),0, then dfac stores A at ($74),1 and df5f advances the cursor
// by 2 and rts. Input is register A (real callers enter via df09 with A=0xc0). Contract: RAM minus
// STACK_SCRATCH. No register live-out: the oracle leaves A=new $74, Y=1, C; every caller overwrites them
// before reading (b2fe: pla/tax/asl/tay; b8ba: tail into b944 ldx/ldy/lda, C next set by b2fe's asl in
// b1b6; aa13 -> c16e: lda #$80, then c235/c2e8 set X/Y and cmp before any C read).
// Run: node --test games/tempest/idiomatic/test/equivalence-df12.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_df12 as oracle } from "../../translated/loc_df0d.js";
import { emitRecordBodyByte } from "../emitHeaderedBodyRecord.js";
import { emitRecordTailByte } from "../emitCoordinateRecord.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdf12;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xdf12 dispatches -- emitRecordBodyByte == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitRecordBodyByte(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked; A values: ${[...new Set(CAPS.map((m) => m.regs.a))]}`);
  assert.ok(CAPS.length > 0, "positive control: no real 0xdf12 dispatch was captured");
});

// A real captured state with the cursor (diffed vector RAM) and A poked identically on both sides; the body
// pair is pre-filled with 0xa5 so the A=0 store is visible.
function arm(lo, hi, a) {
  const mk = () => {
    const m = (CAPS[0] ?? new Machine(ROM, OPTS)).clone();
    m.mem.write8(DRAW_CURSOR_LO, lo); m.mem.write8(DRAW_CURSOR_HI, hi); m.regs.a = a;
    m.mem.write8((hi << 8) | lo, 0xa5); m.mem.write8(((hi << 8) | lo) + 1 & 0xffff, 0xa5);
    return m;
  };
  return { o: mk(), c: mk() };
}
const ARMS = [
  ["cursor 0x2000, A=0xc0 (no carry)", 0x00, 0x20, 0xc0, 0x2002],
  ["cursor 0x24fe, A=0x20 (carry into $75)", 0xfe, 0x24, 0x20, 0x2500],
  ["cursor 0x28ff, A=0x00 (body pair straddles a page)", 0xff, 0x28, 0x00, 0x2901],
  ["cursor 0x2000, A=0x5b (odd)", 0x00, 0x20, 0x5b, 0x2002],
];

for (const [label, lo, hi, a, next] of ARMS) {
  test(`CRAFTED (${label}): RAM equal`, () => {
    const { o, c } = arm(lo, hi, a);
    oracle(o); emitRecordBodyByte(c);
    const base = (hi << 8) | lo;
    assert.equal(o.mem.read8(base), a); assert.equal(o.mem.read8((base + 1) & 0xffff), a);
    assert.equal(o.mem.read16(DRAW_CURSOR_LO), next, "oracle advanced the cursor by 2");
    assert.equal(ramDiff(o, c), null);
  });
}

// BUG twin: hands the shared tail an off-by-one slot (Y=1 instead of 0).
const broken = (m, a = m.regs.a) => { m.mem8[m.mem16[DRAW_CURSOR_LO]] = a; return emitRecordTailByte(m, a, 1); };

test("TEETH: the off-by-one-slot twin diverges (crafted + every real dispatch)", () => {
  const { o, c } = arm(0x00, 0x20, 0xc0);
  oracle(o); broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "off-by-one slot NOT caught");
  console.log(`  TEETH: crafted caught at 0x${d.addr.toString(16)}`);
  for (const cap of CAPS) {
    const oo = cap.clone(), cc = cap.clone();
    oracle(oo); broken(cc);
    assert.notEqual(ramDiff(oo, cc), null, "twin escaped at a real dispatch");
  }
});

test("SP-TOOTH: emitRecordBodyByte omits its ret and is seam-placeable (moved 0)", () => {
  const { c: m } = arm(0x00, 0x20, 0xc0);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, emitRecordBodyByte, TARGET, m);
  assert.equal(r.placeable, true, `emitRecordBodyByte must be seam-placeable; got: ${r.error}`);
});
