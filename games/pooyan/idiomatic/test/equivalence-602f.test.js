// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for resolveObjectProximityHitsBothSlots (ROM 0x602f, Pooyan) — run the per-slot proximity scan
 * once for each of the two target slots. It tags each pass with its slot selector and target
 * base, runs the scan, and aborts the whole routine the instant a pass reports a hit.
 *
 * SEATING: BALANCED / WIRED. The oracle has its own `ret` and detects the deep hit-exit by the
 * skipped return address, then early-returns; its caller runs it as a plain call. The module
 * reproduces both paths — continue the loop on a normal pass, early-return on a hit — by branching
 * on the scan's boolean, so the seam places it with its own ret. Compared on RAM (dumpState) minus
 * stack scratch below the entry SP; pc/SP/registers are not compared. No register is read back by the caller.
 *
 * The oracle runs the TRANSLATED resolveObjectProximityHitsBothSlots, which m.call()s the scan through the registry; the
 * module composes the idiomatic scan by direct import. Cases are CRAFTED — a plain boot does not
 * seat this block/record/enemy geometry. The two slots carry DISTINCT block lead bytes so a pass
 * that should have been skipped is observable in the latched type.
 *
 * Jobs:
 *   1. EQUAL — both slots inert (no writes), both slots live over empty records (both scanned),
 *      and slot 0 a hit (slot 1 left untouched): oracle == module in RAM (−stack).
 *   2. WRITE-SET — a slot-0 hit latches slot 0's type and never slot 1's.
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; a skip-ignoring twin (which runs
 *      slot 1 after a slot-0 hit) diverges from the oracle, proving the abort is load-bearing.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-602f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_602f as oracle } from "../../translated/loc_602f.js";
import { resolveObjectProximityHitsBothSlots } from "../resolveObjectProximityHitsBothSlots.js";
import { latchObjectTypeAndEnterProximityScan } from "../latchObjectTypeAndEnterProximityScan.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const BLOCK_A = 0x8c90; // slot-0 presence block
const BLOCK_B = 0x8ca8; // slot-1 presence block
const TYPE = 0x8d44; //     active hit type, latched from the running slot's block lead byte
const OBJTAB = 0x8b70; //   the record table each slot's scan sweeps
const ACTORS = 0x8868;
const TARGET = 0x8848; //   slot-0 base; slot 1 is +4
const FLIP = 0x881f;
const ROUND = 0x8907;
const EAT = 0x8ae0;
const STRIDE = 0x18;
const SOUND_RING_PTR = 0x8a40;
const KEY = 0x42;
const SLOT0_KIND = 0x02; // distinct so the latched type shows which slot ran last
const SLOT1_KIND = 0x05;
const SP0 = 0x8fe0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the shared world for both slots; records empty (a miss) by default. */
function seat(m, { blockA = SLOT0_KIND, blockB = SLOT1_KIND, lead = 0x00 } = {}) {
  m.regs.sp = SP0;
  m.regs.iff2 = false;
  m.mem.write8(BLOCK_A, blockA);
  m.mem.write8(BLOCK_B, blockB);
  m.mem.write8(FLIP, 0x01); //  bias +6 -> a zero/zero pair is in range
  m.mem.write8(ROUND, 0x00); // even round -> the proximity gate
  m.mem.write8(ACTORS + 0, 0x00);
  m.mem.write8(ACTORS + 2, 0x00);
  m.mem.write8(TARGET + 0, 0x00); //     slot-0 target
  m.mem.write8(TARGET + 2, 0x00);
  m.mem.write8(TARGET + 4, 0x00); //     slot-1 target (+4)
  m.mem.write8(TARGET + 6, 0x00);
  m.mem.write8(OBJTAB + 0x00, lead);
  m.mem.write8(OBJTAB + 0x02, 0x05); //  record kind = live kind
  m.mem.write8(OBJTAB + 0x14, KEY);
  m.mem.write8(SOUND_RING_PTR, 0x43);
  for (let i = 0; i < 6; i++) {
    m.mem.write8(EAT + i * STRIDE + 0x14, (KEY ^ 0x5a) & 0xff);
    m.mem.write8(EAT + i * STRIDE + 0x16, 0x00);
  }
  return m;
}

const craftBothInert = () => seat(BASE.clone(), { blockA: 0x00, blockB: 0x00 });
const craftBothMiss = () => seat(BASE.clone(), { lead: 0x00 }); // live blocks, empty records
function craftSlot0Hit() {
  const m = seat(BASE.clone(), { lead: 0x01 }); // live record for slot 0's in-range hit
  m.mem.write8(EAT + 0 * STRIDE + 0x14, KEY); // enemy record 0 matches...
  m.mem.write8(EAT + 0 * STRIDE + 0x16, 0x02); // ...bit1 set -> skip path -> abort
  return m;
}

// Slot 0 inert (skipped) so the hit lands on slot 1, whose parity selector is 2 (REC1/I1). We
// pre-seat I to 0 so a dropped ireg thread would wrongly write REC0/I0 and diverge from the oracle.
function craftSlot1HitParity() {
  const m = seat(BASE.clone(), { blockA: 0x00, lead: 0x01 });
  m.mem.write8(EAT + 0 * STRIDE + 0x14, KEY); // enemy record 0 matches...
  m.mem.write8(EAT + 0 * STRIDE + 0x16, 0x02); // ...bit1 set -> resolveShotHitEngageOrSeedRecord parity write -> abort
  m.regs.i = 0x00; // != slot-1 selector (2); the oracle re-seats it, so only a dropped thread reads this
  return m;
}

const CASES = [
  { name: "both slots inert", craft: craftBothInert },
  { name: "both slots live, empty records", craft: craftBothMiss },
  { name: "slot 0 hit -> slot 1 untouched", craft: craftSlot0Hit },
  { name: "slot 1 hit -> parity REC1 (guards the ireg thread)", craft: craftSlot1HitParity },
];

/** A 602f that ignores the scan's boolean: it always runs both slots. Used only as a teeth twin. */
function skipIgnoringTwin(m) {
  let target = TARGET;
  for (let slot = 0; slot < 2; slot++) {
    m.regs.iy = target;
    m.regs.i = slot === 0 ? 0 : 2;
    latchObjectTypeAndEnterProximityScan(m); // return ignored -> the abort is dropped
    target = (target + 4) & 0xffff;
  }
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: resolveObjectProximityHitsBothSlots == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    resolveObjectProximityHitsBothSlots(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a slot-0 hit latches slot 0's type and never reaches slot 1", () => {
  const m = craftSlot0Hit();
  oracle(m);
  assert.equal(m.mem.read8(TYPE), SLOT0_KIND, "the abort must leave slot 0's type latched, not slot 1's");
  console.log("  WRITE-SET: slot-0 hit aborts before slot 1");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftBothMiss();
  const c = craftBothMiss();
  oracle(o);
  resolveObjectProximityHitsBothSlots(c);
  c.mem.write8(TYPE, (o.mem.read8(TYPE) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted type byte");
  assert.equal(d.addr, TYPE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a skip-ignoring twin (runs slot 1 after a hit) DIVERGES from the oracle", () => {
  const o = craftSlot0Hit();
  const twin = craftSlot0Hit();
  oracle(o);
  skipIgnoringTwin(twin);
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "the skip-ignoring twin must diverge — the abort is load-bearing");
  assert.equal(twin.mem.read8(TYPE), SLOT1_KIND, "the twin wrongly ran slot 1 and latched its type");
  console.log(`  TEETH(skip): twin caught at ${hx(d.addr ?? 0)} (oracle type=${o.mem.read8(TYPE)} twin=${twin.mem.read8(TYPE)})`);
});
