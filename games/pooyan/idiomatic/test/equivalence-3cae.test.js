// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for seedFormationChildIntoFreeSlotAndLaunchParent (ROM 0x3cae, Pooyan) — per-record spawn helper,
 * a CALLER-SKIP dissolved into a BOOLEAN-returning module.
 *
 * The oracle ends one path with `ret nz` (the slot is already active -> keep scanning) and the
 * other with `pop af; ret` (it seated a child -> abort the caller's scan by returning to the
 * caller's caller). The idiomatic module drops the stack plumbing and returns a boolean instead:
 * true = the plain-ret path, false = the pop-af skip path. This gate seats one input per path and
 * asserts BOTH the RAM(-stack) footprint AND that the boolean tracks which oracle path actually ran
 * (derived independently from the oracle's SP movement: +2 for a lone ret, +4 for pop-af + ret).
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). Each case runs the oracle on one
 * FRESH clone and seedFormationChildIntoFreeSlotAndLaunchParent on another and compares RAM (dumpState, minus stack scratch below the entry SP). The seat
 * path composes the idiomatic setActorAnimation/advanceActorAnimFrame on the module side against the
 * translated loc_381e/loc_403c the oracle dispatches; the two must land byte-identical. IY (the
 * formation record) and IX (the parent) are the inputs; SP is seated in the dead stack. pc and the
 * full register file are NOT compared — no register survives that the caller reads (the caller keeps
 * scanning on true, aborts on false), so the contract is RAM(-stack) + the boolean.
 *
 * Both paths are CRAFTED (a plain boot never reaches this per-record helper): OCCUPIED pokes the
 * slot's first byte nonzero, FREE zeroes the slot's first two bytes.
 *
 * Jobs:
 *   1. EQUAL — OCCUPIED (ret/true, no writes) and FREE (pop-af/false, full seat) both agree in
 *      RAM(-stack), and the module's boolean matches the oracle's actual path (from SP movement).
 *   2. WRITE-SET — the FREE seat marks the slot active, stamps the parent's launch fields, copies
 *      the parent coordinates into the child, and links the child pointer back into the parent.
 *   3. TEETH — a wrong seated byte is caught by the RAM diff; a flipped boolean is caught by the
 *      path check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3cae.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3cae as oracle } from "../../translated/loc_3cae.js";
import { seedFormationChildIntoFreeSlotAndLaunchParent } from "../seedFormationChildIntoFreeSlotAndLaunchParent.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, FORMATION_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const CHILD = FORMATION_TABLE; // 0x8c30: a formation record base, clear of STACK_SCRATCH
const PARENT = 0x8a80; // an actor record base, clear of the child record and the dead stack
const SP_START = 0x8ff8; // inside STACK_SCRATCH; leaves room for the oracle's push/pop/ret
const DIRT = 0xaa;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_START);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/**
 * A fresh clone with IY=child, IX=parent, SP in the dead stack. `occupied` selects the path:
 * true pokes the slot's first byte nonzero (already active), false zeroes the slot's first two
 * bytes (free). The parent's coordinate source fields are seeded so the child copies are concrete.
 */
function craft({ occupied }) {
  const m = BASE.clone();
  m.regs.sp = SP_START;
  m.regs.iy = CHILD;
  m.regs.ix = PARENT;
  m.mem.write8(CHILD + 0x00, occupied ? 0x01 : 0x00);
  m.mem.write8(CHILD + 0x01, 0x00);
  m.mem.write8(PARENT + 0x03, 0x40);
  m.mem.write8(PARENT + 0x04, 0x80);
  m.mem.write8(PARENT + 0x05, 0x30);
  m.mem.write8(PARENT + 0x06, 0x50);
  return m;
}

/** +2 => the oracle took the plain `ret` (true); +4 => it took `pop af; ret` (the skip, false). */
function oracleNormalRet(o) {
  const delta = (o.regs.sp - SP_START) & 0xffff;
  assert.ok(delta === 2 || delta === 4, `unexpected oracle SP delta ${delta} (expected 2 or 4)`);
  return delta === 2;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: seedFormationChildIntoFreeSlotAndLaunchParent == oracle in RAM (−stack), and the boolean tracks the oracle path", () => {
  for (const occupied of [true, false]) {
    const o = craft({ occupied });
    const c = craft({ occupied });
    oracle(o);
    const ret = seedFormationChildIntoFreeSlotAndLaunchParent(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${occupied ? "OCCUPIED" : "FREE"}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

    const normalRet = oracleNormalRet(o);
    // the input we seated must select the expected path, tying the two together
    assert.equal(normalRet, occupied, `${occupied ? "OCCUPIED" : "FREE"}: oracle took the wrong path`);
    // the module's boolean must equal the oracle's actual control-flow choice
    assert.equal(ret, normalRet, `${occupied ? "OCCUPIED" : "FREE"}: module boolean ${ret} != oracle path ${normalRet}`);
  }
  console.log("  EQUAL: OCCUPIED(true) / FREE(false) identical in RAM(−stack); boolean matches oracle path");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the FREE seat marks the slot active, stamps the parent, links the child", () => {
  const o = craft({ occupied: false });
  oracle(o);
  const r8 = (a) => o.mem.read8(a & 0xffff);
  assert.equal(r8(CHILD + 0x01), 0x01, "slot marked active");
  assert.equal(r8(CHILD + 0x02), 0x10, "child field +0x02 stamped");
  assert.equal(r8(CHILD + 0x04), (0x80 - 1) & 0xff, "child coord +0x04 = parent +0x04 - 1");
  assert.equal(r8(CHILD + 0x03), 0x40, "child coord +0x03 = parent +0x03");
  assert.equal(r8(CHILD + 0x06), (0x50 + 1) & 0xff, "child coord +0x06 = parent +0x06 + 1");
  assert.equal(r8(CHILD + 0x05), 0x30, "child coord +0x05 = parent +0x05");
  assert.equal(r8(CHILD + 0x08), 0x01, "child +0x08 active");
  assert.equal(r8(CHILD + 0x0a), 0xe8, "child +0x0a velocity");
  assert.equal(r8(PARENT + 0x02), 0x06, "parent flipped to launch state 6");
  assert.equal(r8(PARENT + 0x08), 0x01, "parent +0x08 set");
  assert.equal(r8(PARENT + 0x0a), 0xe8, "parent +0x0a velocity");
  assert.equal(r8(PARENT + 0x14), CHILD & 0xff, "parent link low = child pointer low");
  assert.equal(r8(PARENT + 0x15), CHILD >> 8, "parent link high = child pointer high");
  console.log("  WRITE-SET: slot active, parent launch fields, child coords copied, child pointer linked");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seated byte is CAUGHT by the RAM diff", () => {
  const o = craft({ occupied: false });
  const c = craft({ occupied: false });
  oracle(o);
  seedFormationChildIntoFreeSlotAndLaunchParent(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  c.mem.write8(CHILD + 0x01, DIRT); // BUG: the seated slot-active marker must be 0x01
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seated byte — it is worthless");
  assert.equal(d.addr, (CHILD + 0x01) & 0xffff, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong slot-active byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a flipped boolean is CAUGHT by the path check", () => {
  for (const occupied of [true, false]) {
    const o = craft({ occupied });
    const c = craft({ occupied });
    oracle(o);
    const ret = seedFormationChildIntoFreeSlotAndLaunchParent(c);
    const normalRet = oracleNormalRet(o);
    assert.equal(ret, normalRet, "sanity: the module boolean matches the oracle path");
    // a twin that returned the OPPOSITE boolean would fail the path check above
    assert.notEqual(!ret, normalRet, `${occupied ? "OCCUPIED" : "FREE"}: a flipped boolean must be rejected`);
  }
  console.log("  TEETH/bool: a flipped return would be rejected on both paths");
});
