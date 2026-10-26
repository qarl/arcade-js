// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceObjectAscentStep (ROM 0x6857, Pooyan) — object ascent step on the IX record.
 *
 * SEATING: BALANCED (plain ret / tail-calls) -> WIRE. Void handler on the record at IX: no register
 * survives, LIVE-OUT is memory only, comparison is RAM (dumpState) minus stack scratch below the entry SP. SP parked in
 * STACK_SCRATCH so the animation-sequencer / append pushes drop out. The animation frame-hold is
 * seeded non-zero so the sequencer just decrements (no ROM walk).
 *
 * Crafted paths: reached-top (rec+6 >= 0x1b -> ret early), and below-top with the tile-block cells
 * tuned so the two-pass checksum resolves to zero -> the enqueueDisplayCommand append path (self-contained). The
 * checksum-mismatch arm tails to sibling resetToAttractScreenStart and is left to that routine's own gate.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6857.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6857 as oracle } from "../../translated/loc_6857.js";
import { advanceObjectAscentStep } from "../advanceObjectAscentStep.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, HUD_INTEGRITY_STRIP_B } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0;
const REC = 0x8b00;
const REF = 0x68a3; // ROM reference-checksum bytes
const u8 = (v) => v & 0xff;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

// pass-1 block cells (0x86bc, -0x20 stride, 8 deep) and the pass-2 cell (h-=4 -> 0x81bc)
const PASS1 = ROM_PRESENT ? Array.from({ length: 8 }, (_, i) => HUD_INTEGRITY_STRIP_B - i * 0x20) : [];
const PASS2 = 0x81bc;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat(m, { d6 = 0x30 } = {}) {
  m.regs.sp = SP0;
  m.regs.ix = REC;
  for (let i = 0; i < 0x18; i++) m.mem.write8(REC + i, 0x55); // pre-dirty for observability
  m.mem.write8(REC + 0x0e, 0x05); // frame-hold non-zero -> sequencer just decrements
  m.mem.write8(REC + 0x05, 0x50); // position low
  m.mem.write8(REC + 0x09, 0x10); // decrement -> a=0x40, no borrow
  m.mem.write8(REC + 0x06, d6); // position high: >=0x1b tops out, <0x1b runs the checksum
  m.mem.write8(REC + 0x02, 0x00); // state counter
  return m;
}

/** Tune the block so the two-pass checksum resolves to zero -> enqueueDisplayCommand append (no mismatch tail). */
function seatChecksumZero(m) {
  seat(m, { d6: 0x10 });
  for (const a of PASS1) m.mem.write8(a, 0x00);
  m.mem.write8(PASS2, 0x00);
  let s = m.mem.read8(REF + 8); // the trailing byte the result is tested against
  for (let i = 0; i < 8; i++) s = u8(s + m.mem.read8(REF + i));
  m.mem.write8(HUD_INTEGRITY_STRIP_B, u8(256 - s)); // one pass-1 cell absorbs the residue
  return m;
}

const CASES = {
  "reached top -> ret early": (m) => seat(m, { d6: 0x30 }),
  "below top -> checksum zero -> append": (m) => seatChecksumZero(m),
};

test("EQUAL: advanceObjectAscentStep == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    advanceObjectAscentStep(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

test("WRITE-SET: reached-top leaves state; below-top advances it and appends", () => {
  const top = CASES["reached top -> ret early"](BASE.clone());
  oracle(top);
  assert.equal(top.mem.read8(REC + 0x02), 0x00, "reached-top must not advance the state counter");
  assert.equal(top.mem.read8(REC + 0x05), 0x40, "0x50 - 0x10 = 0x40 at rec+5");

  const run = CASES["below top -> checksum zero -> append"](BASE.clone());
  oracle(run);
  assert.equal(run.mem.read8(REC + 0x02), 0x01, "below-top advances the state counter");
  console.log("  WRITE-SET: top inert on state; below-top +1");
});

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["reached top -> ret early"](BASE.clone());
  const c = CASES["reached top -> ret early"](BASE.clone());
  oracle(o);
  advanceObjectAscentStep(c);
  c.mem.write8(REC + 0x05, (o.mem.read8(REC + 0x05) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, REC + 0x05, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the position subtract diverges", () => {
  const o = CASES["reached top -> ret early"](BASE.clone());
  const c = CASES["reached top -> ret early"](BASE.clone());
  oracle(o); // writes rec+5 = 0x40 (and steps the frame-hold)
  // twin: do nothing -> the pre-seeded rec+5 = 0x50 survives
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped subtract must be caught by the RAM diff");
  console.log(`  TEETH(sub): caught at ${hx(d.addr ?? 0)}`);
});
