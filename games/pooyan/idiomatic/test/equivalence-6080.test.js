// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for gateEvenRoundOverlapAndRouteHit (ROM 0x6080, Pooyan) — the proximity gate ahead of the hit
 * handler. It measures the axis gaps between the actor (x biased by the flip flag) and the target;
 * too wide on either axis skips the record to the outer-scan epilogue (a continue), and within
 * range it advances the record pointer to its tag and enters the hit handler with that key.
 *
 * SEATING: TAIL-CALL. The oracle has no ret of its own — every miss `jp`s to the epilogue and the
 * hit falls through into the hit handler; its effective seating is the delegatee's (the epilogue is
 * balanced, the hit handler is a +4 caller-skip). The module returns the delegatee's boolean:
 * true = the scan continues to normal completion, false = a caller-skip must unwind the caller's
 * frame. Compared on RAM (dumpState) minus stack scratch below the entry SP; the register file is not compared (no
 * register survives the terminating tail). Entry registers HL/IX/IY/B/I are the param-default bridge.
 *
 * Cases are CRAFTED: a plain boot does not seat this record/actor/target geometry.
 *
 * Jobs:
 *   1. EQUAL — a miss (gap too wide), a hit reaching the finder's no-match main path (marks the
 *      parity hit flag, seeds the record, enqueues sound; boolean true), and a hit reaching the
 *      skip path (flags the parity target pair; boolean false): oracle == module in RAM (−stack)
 *      + forwarded boolean.
 *   2. WRITE-SET — the hit/main path marks the parity hit-flag slot and seeds the record base; the
 *      miss path writes nothing.
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; a miss-returns-false twin and a
 *      skip-returns-true twin are caught by the boolean check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6080.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6080 as oracle } from "../../translated/loc_6080.js";
import { gateEvenRoundOverlapAndRouteHit } from "../gateEvenRoundOverlapAndRouteHit.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const FLIP = 0x881f; //   flip flag: nonzero -> +6 x-bias (small coords land in range)
const EAT = 0x8ae0; //    enemy-actor table (the hit handler scans this)
const STRIDE = 0x18;
const TYPE = 0x8d44; //   ACTIVE_OBJECT_TYPE
const REC0 = 0x8c90; //   parity target rec (I == 0)
const REC1 = 0x8ca8; //   parity target rec (I != 0)
const FLAG_I0 = 0x8d1b; // hit flag (I == 0)
const SOUND_RING_PTR = 0x8a40;
const OBJ = 0x8c50; //    object record base (HL); gateEvenRoundOverlapAndRouteHit advances +0x14 to reach the tag
const IXA = 0x8840; //    actor record (position at +0/+2)
const IYA = 0x8848; //    target record (position at +0/+2)
const KEY = 0x42;
const SEED_FIELDS = [0x00, 0x01, 0x02, 0x12, 0x16, 0x17];
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the entry register interface plus the shared world; positions default to a hit. */
function seat(m, { ireg = 0x00, ixX = 0, ixY = 0, iyX = 0, iyY = 0 } = {}) {
  m.regs.hl = OBJ;
  m.regs.ix = IXA;
  m.regs.iy = IYA;
  m.regs.b = 0x01; //     a miss falls to the epilogue and completes at once
  m.regs.i = ireg & 0xff;
  m.regs.iff2 = false;
  m.regs.sp = SP0;
  m.mem.write8(FLIP, 0x01); //   +6 bias
  m.mem.write8(TYPE, 0x02); //   not the engaged type -> the finder enqueues sound
  m.mem.write8(IXA + 0, ixX);
  m.mem.write8(IXA + 2, ixY);
  m.mem.write8(IYA + 0, iyX);
  m.mem.write8(IYA + 2, iyY);
  m.mem.write8(OBJ + 0x14, KEY); //   the tag gateEvenRoundOverlapAndRouteHit reads after advancing
  for (const off of SEED_FIELDS) m.mem.write8(OBJ + off, 0xee); // pre-dirty so each seed write is a change
  m.mem.write8(SOUND_RING_PTR, 0x43);
  for (let i = 0; i < 6; i++) {
    m.mem.write8(EAT + i * STRIDE + 0x14, (KEY ^ 0x5a) & 0xff); // no accidental tag match
    m.mem.write8(EAT + i * STRIDE + 0x16, 0x00);
  }
  return m;
}

function craftMiss(ireg) {
  return seat(BASE.clone(), { ireg, iyX: 0x40 }); // target far in x -> gap >= 9 -> miss
}
function craftHitMain(ireg) {
  return seat(BASE.clone(), { ireg }); // in range, no enemy tag match -> finder main path
}
function craftHitSkip(ireg) {
  const m = seat(BASE.clone(), { ireg });
  m.mem.write8(EAT + 2 * STRIDE + 0x14, KEY); // matching enemy record...
  m.mem.write8(EAT + 2 * STRIDE + 0x16, 0x02); // ...with state bit1 set -> skip path (type != 3)
  return m;
}

const CASES = [
  { name: "miss -> epilogue completes", craft: () => craftMiss(0x00), ret: true },
  { name: "hit -> finder main (I==0)", craft: () => craftHitMain(0x00), ret: true },
  { name: "hit -> finder main (I!=0)", craft: () => craftHitMain(0x0a), ret: true },
  { name: "hit -> skip path (I!=0)", craft: () => craftHitSkip(0x0a), ret: false },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: gateEvenRoundOverlapAndRouteHit == oracle in RAM (−stack) + forwarded boolean", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    const ret = gateEvenRoundOverlapAndRouteHit(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, cfg.ret, `${cfg.name}: forwarded boolean must be ${cfg.ret}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack + boolean)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a hit/main marks the parity hit flag + seeds the record; a miss writes nothing", () => {
  const hit = craftHitMain(0x00);
  const before = hit.dumpState();
  oracle(hit);
  const after = hit.dumpState();
  const changed = new Set();
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== after[off]) {
      const addr = hit.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.add(addr);
    }
  }
  assert.ok(changed.has(FLAG_I0), "I == 0 must mark the even-parity hit flag");
  for (const off of SEED_FIELDS) assert.ok(changed.has(OBJ + off), `seed must write record +${hx(off)}`);

  const miss = craftMiss(0x00);
  const b0 = miss.dumpState();
  oracle(miss);
  assert.deepEqual([...miss.dumpState()], [...b0], "a miss must leave RAM untouched");
  console.log("  WRITE-SET: hit seeds + flags; miss is inert");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftHitMain(0x00);
  const c = craftHitMain(0x00);
  oracle(o);
  gateEvenRoundOverlapAndRouteHit(c);
  c.mem.write8(OBJ + 0x12, (o.mem.read8(OBJ + 0x12) ^ 0xff) & 0xff); // corrupt a seeded byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted seed byte");
  assert.equal(d.addr, OBJ + 0x12, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a miss-returns-false twin and a skip-returns-true twin are CAUGHT by the boolean", () => {
  assert.throws(
    () => assert.equal(((m) => (gateEvenRoundOverlapAndRouteHit(m), false))(craftMiss(0x00)), true),
    "a miss must continue -> true",
  );
  assert.throws(
    () => assert.equal(((m) => (gateEvenRoundOverlapAndRouteHit(m), true))(craftHitSkip(0x0a)), false),
    "a skip must abort -> false",
  );
  console.log("  TEETH(boolean): miss-false and skip-true twins caught");
});
