// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for testAndCatchActorSlotOnOverlap (ROM 0x5ebd, Pooyan) — one iteration of the actor-sweep
 * loop body.
 *
 * The cycle-free / memory-equivalence gate: a fresh clone per side, the oracle on one and testAndCatchActorSlotOnOverlap
 * on the other, compared on RAM (dumpState) minus stack scratch below the entry SP. pc/SP/cycles are NOT compared, and
 * there is no register live-out — it is tail-reached from a sweep dispatcher and its output is the
 * caught slot, the zero-filled struck target and the hit-sound ring writes. The advanced HL/IX/B
 * cursors handed to the loop tail are registers no caller reads back.
 *
 * INPUTS: HL (slot record), IX (paired actor record, read by the bounds precheck), IY (target box),
 * B (loop count — pinned to 1 so a miss's loop tail is a no-op and a hit tail-hands to the enqueue),
 * and FLIP 0x881f (the precheck's x-bias select). The struck-target latch 0x8d65 points at the
 * record cleared on a hit; its flag byte bit0 gates the zero-fill.
 *
 * Jobs:
 *   1. EQUAL — over empty / busy / off-screen / dx-reject / dy-reject / hit-fill / hit-skip cases,
 *      oracle == testAndCatchActorSlotOnOverlap in RAM (−stack).
 *   2. WRITE-SET — a hit clears the slot lead byte, stamps 01/08, and (flag bit0 clear) zero-fills
 *      the struck target while a set flag leaves it dirty; an empty slot is inert.
 *   3. TEETH — a wrong caught-slot byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5ebd.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5ebd as oracle } from "../../translated/loc_5ebd.js";
import { testAndCatchActorSlotOnOverlap } from "../testAndCatchActorSlotOnOverlap.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8c30; //  slot record (lead +0, state +2), marked on a hit
const ACTOR = 0x8888; //  paired actor record the precheck reads (+0, +2)
const BOX = 0x8848; //  proximity target box (IY: +0, +2)
const FLIP = 0x881f; //  precheck x-bias select
const LATCH = 0x8d65; //  struck-target latch reloaded on a hit
const LFILL = 0x8b00; //  struck target that gets zero-filled (flag bit0 clear)
const LSKIP = 0x8b40; //  struck target that keeps its record (flag bit0 set)
const FILL_LEN = 0x17;
const SP0 = 0x8ff0; //  inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the sweep geometry seated; defaults are a hit against LFILL. */
function craft(spec = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.hl = REC;
  m.regs.ix = ACTOR;
  m.regs.iy = BOX;
  m.regs.b = 0x01; // single iteration: a miss's loop tail is a no-op
  m.mem8[FLIP] = (spec.flip ?? 0x01) & 0xff; // bias +6
  m.mem8[REC + 0] = (spec.lead ?? 0x01) & 0xff;
  m.mem8[REC + 2] = (spec.state ?? 0x02) & 0xff;
  m.mem8[ACTOR + 0] = (spec.recX ?? 0x30) & 0xff; // E = 0x30 + 6 = 0x36
  m.mem8[ACTOR + 2] = (spec.recY ?? 0x40) & 0xff; // A = 0x48 (on-screen)
  m.mem8[BOX + 0] = (spec.boxX ?? 0x30) & 0xff; // dx = |0x30 - 0x36| = 6 (< 0x0a)
  m.mem8[BOX + 2] = (spec.boxY ?? 0x38) & 0xff; // dy = |0x40 - 0x48| = 8 (< 0x09)
  const t = spec.latch ?? LFILL;
  m.mem.write16(LATCH, t);
  for (let i = 0; i < FILL_LEN; i++) m.mem8[t + i] = 0xee; // pre-dirty the struck target
  if (spec.targetFlagBit0) m.mem8[t + 7] = 0x01; // bit0 set -> skip the fill
  return m;
}

const CASES = [
  { name: "empty slot -> loop tail", spec: { lead: 0x00 } },
  { name: "busy slot (state >= 4) -> loop tail", spec: { state: 0x04 } },
  { name: "off-screen (biased Y >= 0xe0) -> loop tail", spec: { recY: 0xf0 } },
  { name: "dx reject (|dx| >= 0x0a) -> loop tail", spec: { boxX: 0x50 } },
  { name: "dy reject (|dy| >= 0x09) -> loop tail", spec: { boxY: 0x60 } },
  { name: "HIT, fill (flag bit0 clear)", spec: { latch: LFILL } },
  { name: "HIT, skip fill (flag bit0 set)", spec: { latch: LSKIP, targetFlagBit0: true } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted sweep-body cases — testAndCatchActorSlotOnOverlap == oracle in RAM (−stack)", () => {
  for (const { name, spec } of CASES) {
    const o = craft(spec);
    oracle(o);
    const c = craft(spec);
    testAndCatchActorSlotOnOverlap(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted sweep-body cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a hit catches the slot + gates the target fill; an empty slot is inert", () => {
  const fill = craft({ latch: LFILL });
  oracle(fill);
  assert.equal(fill.mem8[REC + 0], 0x00, "caught slot lead byte cleared");
  assert.equal(fill.mem8[REC + 1], 0x01, "caught slot +1 <- 0x01");
  assert.equal(fill.mem8[REC + 2], 0x08, "caught slot +2 <- 0x08");
  for (let i = 0; i < FILL_LEN; i++) assert.equal(fill.mem8[LFILL + i], 0x00, `fill zeroed byte +${i}`);

  const skip = craft({ latch: LSKIP, targetFlagBit0: true });
  oracle(skip);
  assert.equal(skip.mem8[REC + 0], 0x00, "skip case still catches the slot");
  assert.equal(skip.mem8[LSKIP + 0], 0xee, "flag bit0 set -> target record left dirty");

  const empty = craft({ lead: 0x00 });
  const b0 = empty.dumpState();
  oracle(empty);
  assert.deepEqual([...empty.dumpState()], [...b0], "an empty slot must leave RAM untouched");
  console.log("  WRITE-SET: hit catches + fills, set-flag skips, empty inert");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong caught-slot byte is CAUGHT by the RAM diff", () => {
  const o = craft({ latch: LFILL });
  const c = craft({ latch: LFILL });
  oracle(o);
  testAndCatchActorSlotOnOverlap(c);
  c.mem8[REC + 0] = 0x01; // BUG: a hit must clear the slot lead byte to 0x00
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong caught-slot byte — it is worthless");
  assert.equal(d.addr, REC + 0, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong caught slot caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
