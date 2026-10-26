// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for seedAndRunTargetProximityScan (Pooyan) — the proximity-scan seeder, COMPOSING the
 * dissolved caller-skip scanTargetSlotsAndSpawnOnProximityHit.
 *
 * seedAndRunTargetProximityScan points the coordinate cursor at the sprite target-slot table and the record cursor at
 * the projectile list, sets the slot count, and hands off to scanTargetSlotsAndSpawnOnProximityHit. In the frozen layer that
 * hand-off is a fall-through and scanTargetSlotsAndSpawnOnProximityHit aborts via `pop af; ret`; the idiomatic seedAndRunTargetProximityScan imports
 * the idiomatic scanTargetSlotsAndSpawnOnProximityHit and forwards its boolean instead. This gate runs the WHOLE caller both
 * ways and requires RAM-equivalence: the oracle seedAndRunTargetProximityScan (which internally runs the translated
 * scanTargetSlotsAndSpawnOnProximityHit) versus seedAndRunTargetProximityScan (which runs the idiomatic scanTargetSlotsAndSpawnOnProximityHit), compared on dumpState minus
 * stack scratch below the entry SP. pc/SP/cycles are not compared — the oracle's pushes/pops land in STACK_SCRATCH.
 *
 * Two skip states are seated per the CLUSTER contract: SKIP-TAKEN (a record close to the actor box
 * -> scanTargetSlotsAndSpawnOnProximityHit claims it and aborts) and SKIP-NOT-TAKEN (records present but all out of range ->
 * scanTargetSlotsAndSpawnOnProximityHit runs to exhaustion). A third case hits on the SECOND slot to exercise the advance.
 *
 * seedAndRunTargetProximityScan hard-seeds IX=0x887c / HL=0x8be8 / B=3 itself, so only IY (actor box), I (interrupt
 * parity) and FLIP_SCREEN_FLAG are inputs here; the scanned cells sit at those fixed bases.
 *
 * Jobs: EQUAL (RAM −stack over the three cases) + a boolean tied to the oracle's SP path; TEETH (a
 * wrong stamped byte caught by the RAM diff).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6381.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6381 as oracle } from "../../translated/loc_6381.js";
import { seedAndRunTargetProximityScan } from "../seedAndRunTargetProximityScan.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  FLIP_SCREEN_FLAG,
  OBJ_HIT_FLAG_I0,
  SPRITE_TARGET_SLOTS,
  PROJECTILE_TABLE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const COORD_BASE = SPRITE_TARGET_SLOTS; // 0x887c, stride 4 (X at +0, Y at +2)
const REC_BASE = PROJECTILE_TABLE; //      0x8be8, stride 0x18 (presence at +0)
const IY_BOX = 0x8848; //                  actor box (X at +0, Y at +2)
const SP_ENTRY = 0x8ffe;
const COORD_STRIDE = 0x04;
const REC_STRIDE = 0x18;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_ENTRY);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with IY/I/flip and the fixed coord/record cells seated (IX/HL/B are set by seedAndRunTargetProximityScan). */
function craft(spec) {
  const m = BASE.clone();
  m.regs.sp = SP_ENTRY;
  m.regs.iy = IY_BOX;
  m.regs.i = (spec.ireg ?? 0x00) & 0xff;
  m.mem8[FLIP_SCREEN_FLAG] = (spec.flip ?? 0x01) & 0xff;
  for (let i = 0; i < spec.slots.length; i++) {
    const s = spec.slots[i];
    m.mem8[REC_BASE + i * REC_STRIDE] = (s.present ?? 0x00) & 0xff;
    m.mem8[COORD_BASE + i * COORD_STRIDE + 0] = (s.x ?? 0x00) & 0xff;
    m.mem8[COORD_BASE + i * COORD_STRIDE + 2] = (s.y ?? 0x00) & 0xff;
  }
  m.mem8[IY_BOX + 0] = (spec.boxX ?? 0x00) & 0xff;
  m.mem8[IY_BOX + 2] = (spec.boxY ?? 0x00) & 0xff;
  return m;
}

// flip=1: slotX = x+5, slotY = y+8; a hit needs |boxX - slotX| < 6 and |boxY - y| < 6.
const CASES = [
  { name: "SKIP-TAKEN: slot 0 in range -> claim + abort", expectHit: true, ireg: 0x00, flip: 1,
    slots: [{ present: 0x01, x: 0x10, y: 0x20 }, { present: 0x00 }, { present: 0x00 }],
    boxX: 0x15, boxY: 0x22 },
  { name: "SKIP-NOT-TAKEN: three present slots all out of range -> exhaust", expectHit: false, flip: 1,
    slots: [{ present: 0x01, x: 0x50, y: 0x20 }, { present: 0x01, x: 0x60, y: 0x20 }, { present: 0x01, x: 0x70, y: 0x20 }],
    boxX: 0x15, boxY: 0x22 },
  { name: "SKIP-TAKEN on 2nd slot (advance then hit)", expectHit: true, ireg: 0x00, flip: 1,
    slots: [{ present: 0x01, x: 0x50, y: 0x20 }, { present: 0x01, x: 0x10, y: 0x20 }, { present: 0x00 }],
    boxX: 0x15, boxY: 0x22 },
];

/** true if the oracle exited via the plain-ret path (one pop); false if it took the pop-af skip. */
function oracleNormalPath(o) {
  return ((o.regs.sp - SP_ENTRY) & 0xffff) === 2;
}

// -- 1. EQUAL (composing the real idiomatic skip) -----------------------------

test("EQUAL: seedAndRunTargetProximityScan (idiomatic 638a) == oracle (translated 638a) in RAM (−stack), boolean tied to path", () => {
  for (const spec of CASES) {
    const o = craft(spec);
    oracle(o);
    const c = craft(spec);
    const ret = seedAndRunTargetProximityScan(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${spec.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

    const normal = oracleNormalPath(o);
    assert.equal(normal, !spec.expectHit, `[${spec.name}] oracle SP path disagrees with crafted intent`);
    assert.equal(ret, normal, `[${spec.name}] forwarded boolean ${ret} must equal the oracle normal-path ${normal}`);
  }
  console.log(`  EQUAL: ${CASES.length} skip-taken/not-taken cases identical (RAM −stack), boolean == oracle path`);
});

// -- 2. WRITE-SET (the abort footprint on a hit) ------------------------------

test("WRITE-SET: a claimed slot 0 stamps rec 0x8be8 and the I0 hit flag", () => {
  const o = craft(CASES[0]);
  oracle(o);
  assert.equal(o.mem8[REC_BASE + 0x00], 0x00, "state byte 0");
  assert.equal(o.mem8[REC_BASE + 0x11], 0x28, "teardown countdown");
  assert.equal(o.mem8[REC_BASE + 0x0e], 0x00, "anim frame reset");
  assert.equal(o.mem8[OBJ_HIT_FLAG_I0], 0x01, "I==0 hit flag set");
  console.log(`  WRITE-SET: rec ${hx(REC_BASE)} stamped + hit flag ${hx(OBJ_HIT_FLAG_I0)} on a slot-0 claim`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong stamped byte after the claim is CAUGHT by the RAM diff", () => {
  const spec = CASES[0];
  const o = craft(spec);
  const c = craft(spec);
  oracle(o);
  seedAndRunTargetProximityScan(c);
  c.mem8[REC_BASE + 0x11] = 0x00; // BUG: the claim's teardown countdown must be 0x28

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stamped byte — it is worthless");
  assert.equal(d.addr, REC_BASE + 0x11, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong countdown caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
