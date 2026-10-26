// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for gateAndRunProjectileTargetSweep (Pooyan) — the proximity-sweep gate/seeder, COMPOSING the
 * whole idiomatic sweep chain (sweepTargetSlotsForGrab -> testTargetSlotGrabAndCatchObject -> setActorAnimation / queueSoundCommand0D).
 *
 * gateAndRunProjectileTargetSweep bails when the grab latch is set or when the formation/teardown states are non-zero;
 * otherwise it aims the sweep at three fixed tables (the sprite display list as the reference
 * source, the sprite target slots as the per-slot comparison coords, the projectile table as the
 * records) and runs three slots. In the frozen layer it falls through into the sweep, whose grab
 * hit unwinds two frames back to this routine's caller; the idiomatic gateAndRunProjectileTargetSweep calls the idiomatic
 * sweepTargetSlotsForGrab (which early-returns on a hit) and then returns normally. This gate runs the WHOLE
 * routine both ways and requires RAM-equivalence: the oracle gateAndRunProjectileTargetSweep (which internally runs the
 * translated sweep chain) versus gateAndRunProjectileTargetSweep (which runs the idiomatic chain), compared on dumpState
 * minus stack scratch below the entry SP. pc/SP/cycles are not compared — the oracle's pushes/pops land in
 * STACK_SCRATCH and the idiomatic side keeps no stack.
 *
 * LIVE-OUT: none — the sweep is a tail delegate with no live-out and the per-frame caller reads
 * nothing back, so only RAM (−stack) is compared.
 *
 * Cases exercise every branch: GUARD-1 (grab already latched -> bail), GUARD-2 via the formation
 * byte and via the teardown byte (either non-zero -> bail), a full no-hit SWEEP (three present
 * records all out of range -> exhaust with no writes), a HIT on slot 0 (grab fires, record stamped,
 * sweep aborts), and a HIT on slot 1 (advance past a miss, then fire). Each case's oracle grab-latch
 * value is asserted so a case cannot silently no-op. gateAndRunProjectileTargetSweep hard-seeds IX/IY/HL/B itself, so the
 * only inputs are the guard cells, the flip flag, and the source/target/record cells at fixed bases.
 *
 * Jobs: EQUAL (RAM −stack over all cases, oracle grab-latch tied to intent), WRITE-SET (the stamp a
 * slot-0 hit leaves), TEETH (a wrong stamped byte caught by the RAM diff).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5df7.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5df7 as oracle } from "../../translated/loc_5df7.js";
import { gateAndRunProjectileTargetSweep } from "../gateAndRunProjectileTargetSweep.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  FLIP_SCREEN_FLAG,
  GRAB_ACTIVE_FLAG,
  FORMATION_STATE,
  WAVE_TEARDOWN_STATE,
  SPRITE_DISPLAY_LIST,
  SPRITE_TARGET_SLOTS,
  PROJECTILE_TABLE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SRC_BASE = SPRITE_DISPLAY_LIST; //  0x8840, reference coords: X at +0, Y at +2 (fixed across slots)
const COORD_BASE = SPRITE_TARGET_SLOTS; // 0x887c, per-slot compare coords, stride 4 (X at +0, Y at +2)
const REC_BASE = PROJECTILE_TABLE; //      0x8be8, per-slot record, stride 0x18 (state at +0)
const COORD_STRIDE = 0x04;
const REC_STRIDE = 0x18;
const SP_ENTRY = 0x8ffe; // top of STACK_SCRATCH; the oracle's pushes/pops stay inside the dead region

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_ENTRY);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the guard cells, flip flag, source coords, and per-slot compare/record cells seated. */
function craft(spec) {
  const m = BASE.clone();
  m.regs.sp = SP_ENTRY;
  m.mem8[GRAB_ACTIVE_FLAG] = (spec.grab ?? 0x00) & 0xff;
  m.mem8[FORMATION_STATE] = (spec.formation ?? 0x00) & 0xff;
  m.mem8[WAVE_TEARDOWN_STATE] = (spec.teardown ?? 0x00) & 0xff;
  m.mem8[FLIP_SCREEN_FLAG] = (spec.flip ?? 0x01) & 0xff;
  m.mem8[SRC_BASE + 0] = (spec.srcX ?? 0x10) & 0xff;
  m.mem8[SRC_BASE + 2] = (spec.srcY ?? 0x20) & 0xff;
  const slots = spec.slots ?? [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    m.mem8[COORD_BASE + i * COORD_STRIDE + 0] = (s.x ?? 0x00) & 0xff;
    m.mem8[COORD_BASE + i * COORD_STRIDE + 2] = (s.y ?? 0x00) & 0xff;
    m.mem8[REC_BASE + i * REC_STRIDE + 0] = (s.state ?? 0x00) & 0xff;
  }
  return m;
}

// flip=1 -> offX=0x09, offY=0x00; with srcX=0x10/srcY=0x20 the reference is tx=0x19, ty=0x20.
// A hit needs |x - 0x19| < 2 and |(y+8) - 0x20| < 9; x=0x19,y=0x18 hits, x=0x50 misses. A record
// state of 0 or 5 short-circuits to a miss regardless of coords.
const HIT = { state: 0x01, x: 0x19, y: 0x18 };
const MISS = { state: 0x01, x: 0x50, y: 0x20 };

const CASES = [
  { name: "GUARD-1: grab already latched -> bail", grab: 0x01, grabAfter: 0x01,
    slots: [HIT, MISS, MISS] },
  { name: "GUARD-2 (formation): formation byte set -> bail", formation: 0x01, grabAfter: 0x00,
    slots: [HIT, MISS, MISS] },
  { name: "GUARD-2 (teardown): teardown byte set -> bail", teardown: 0x80, grabAfter: 0x00,
    slots: [HIT, MISS, MISS] },
  { name: "SWEEP no hit: three present records all out of range -> exhaust", grabAfter: 0x00,
    slots: [MISS, MISS, MISS] },
  { name: "HIT slot 0: grab fires + sweep aborts", grabAfter: 0x01,
    slots: [HIT, MISS, MISS] },
  { name: "HIT slot 1: advance past a miss, then fire", grabAfter: 0x01,
    slots: [MISS, HIT, MISS] },
];

// -- 1. EQUAL (composing the real idiomatic sweep chain) ----------------------

test("EQUAL: gateAndRunProjectileTargetSweep (idiomatic chain) == oracle (translated chain) in RAM (−stack)", () => {
  for (const spec of CASES) {
    const o = craft(spec);
    oracle(o);
    const c = craft(spec);
    gateAndRunProjectileTargetSweep(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${spec.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    // Path sanity: the oracle's grab latch must land where the case intends, so no case silently no-ops.
    assert.equal(o.mem8[GRAB_ACTIVE_FLAG], spec.grabAfter, `[${spec.name}] oracle grab-latch disagrees with crafted intent`);
  }
  console.log(`  EQUAL: ${CASES.length} guard/sweep/hit cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET (the stamp a slot-0 hit leaves) -----------------------------

test("WRITE-SET: a slot-0 hit raises the grab latch and stamps the record", () => {
  const o = craft(CASES[4]); // HIT slot 0
  oracle(o);
  assert.equal(o.mem8[GRAB_ACTIVE_FLAG], 0x01, "grab latch set");
  assert.equal(o.mem8[REC_BASE + 0x00], 0x00, "record state byte := 0");
  assert.equal(o.mem8[REC_BASE + 0x01], 0x01, "record +1 := 1");
  assert.equal(o.mem8[REC_BASE + 0x02], 0x02, "record +2 := 2");
  assert.equal(o.mem8[REC_BASE + 0x11], 0x0a, "record +0x11 := 0x0a");
  console.log(`  WRITE-SET: grab latch ${hx(GRAB_ACTIVE_FLAG)} + record ${hx(REC_BASE)} stamped on a slot-0 hit`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong stamped byte after a hit is CAUGHT by the RAM diff", () => {
  const spec = CASES[4]; // HIT slot 0
  const o = craft(spec);
  const c = craft(spec);
  oracle(o);
  gateAndRunProjectileTargetSweep(c);
  c.mem8[REC_BASE + 0x11] = 0x00; // BUG: the hit's stamped byte must be 0x0a

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stamped byte — it is worthless");
  assert.equal(d.addr, REC_BASE + 0x11, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong stamped byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
