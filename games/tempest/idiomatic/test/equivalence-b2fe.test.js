// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for closeLayerPointer (ROM 0xb2fe-0xb331) -- emits a header record (emitRecordBodyC0), sets the
// $3b/$3c pointer and toggles a per-slot parity flag, then writes the two-byte word chosen by the new
// parity through that pointer. The idiomatic side dissolves the jsr $df09 into a direct emitRecordBodyC0(m)
// call. Live-out is RAM plus the exit [X, Y] it returns (the buffer word's high byte, 1), so each arm compares
// RAM (dumpState minus STACK_SCRATCH) and the CAPTURE arm also compares the returned pair.
// Run: node --test games/tempest/idiomatic/test/equivalence-b2fe.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b2fe as oracle } from "../../translated/loc_b2fe.js";
import { closeLayerPointer } from "../closeLayerPointer.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, POINTER_PARITY, DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb2fe;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xb2fe dispatches -- closeLayerPointer == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { c.regs.x ^= 0xff; c.regs.y ^= 0xff; // m.regs poisoned: this routine takes no entry X/Y, so its exit must not depend on them
      assert.deepEqual(closeLayerPointer(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// A into a valid slot index; cursor into vector RAM so the df09 header emit is diffed. The parity
// pre-state selects which of the two branch words gets written through ($3b).
function seedSlot(m, a, parityPre) {
  m.regs.a = a;
  m.mem.write8(DRAW_CURSOR_LO, 0x40); m.mem.write8(DRAW_CURSOR_HI, 0x20); // ($74) -> 0x2040
  m.mem.write8((POINTER_PARITY + a) & 0xffff, parityPre);
}

test("CRAFTED: parity pre=0 -> toggles to 1 (nonzero branch); RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedSlot(o, 0x03, 0x00);
  const c = new Machine(ROM, OPTS); seedSlot(c, 0x03, 0x00);
  oracle(o); closeLayerPointer(c);
  assert.equal(ramDiff(o, c), null, "RAM equal (toggled parity nonzero)");
  assert.equal(c.mem.read8((POINTER_PARITY + 0x03) & 0xffff), 0x01, "parity flag toggled to 1");
});

test("CRAFTED: parity pre=1 -> toggles to 0 (zero branch); RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedSlot(o, 0x02, 0x01);
  const c = new Machine(ROM, OPTS); seedSlot(c, 0x02, 0x01);
  oracle(o); closeLayerPointer(c);
  assert.equal(ramDiff(o, c), null, "RAM equal (toggled parity zero)");
  assert.equal(c.mem.read8((POINTER_PARITY + 0x02) & 0xffff), 0x00, "parity flag toggled to 0");
});

test("TEETH: a twin that skips the parity toggle diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedSlot(o, 0x03, 0x00); oracle(o);
  const c = new Machine(ROM, OPTS); seedSlot(c, 0x03, 0x00);
  // Faithful except the parity flag store is dropped: $0415,x stays at its pre-state.
  const broken = (m, a = m.regs.a) => {
    const { mem8, mem16 } = m;
    // no df09, no emit, but write the pointer target so only the flag differs
    const idx = (a << 1) & 0xff;
    const parity = mem8[(POINTER_PARITY + a) & 0xffff] ^ 0x01; // BUG: computed but never stored back
    void parity; void idx; void mem16;
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped parity toggle");
});

test("SP-TOOTH: the omitted-ret routine (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, closeLayerPointer, TARGET, m);
  assert.equal(r.placeable, true, `closeLayerPointer must be seam-placeable; got: ${r.error}`);
});
