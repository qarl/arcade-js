// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for initChildActorRecordFromParent (ROM 0x142c, Pooyan) — "spawn/init a child actor record".
 *
 * The cycle-free / memory-equivalence gate (docs/decompiler-pipeline): a fresh clone per side,
 * the oracle on one and initChildActorRecordFromParent on the other, compared on RAM (dumpState, minus stack scratch below the entry SP)
 * PLUS the declared register live-out A. pc/SP/cycles are deliberately not compared.
 *
 * INPUTS: IX (parent record), IY (child record), C (copied to child+0x14). The routine also reads
 * SPEED_INDEX (0x8900), ROUND_COUNTER (0x8907), the inline ROM speed table at 0x148e (via the
 * rst-0x20 lookup), and the parent's position bytes at IX+3/4/5/6.
 *
 * LIVE-OUT A: initChildActorRecordFromParent tail-jumps to queueSoundCommand04IfNotBusy (the spawn-sound enqueue), whose A becomes this
 * routine's result. It is checked equal to the oracle and asserted SET on the module's clone.
 *
 * The child record (0x8b40), the parent (0x8b00) and the two gameplay cells are isolated work RAM;
 * queueSoundCommand04IfNotBusy's own writes land on the page-0x8a sound ring, which the WRITE-SET job treats as the
 * callee's domain (covered by queueSoundCommand04IfNotBusy's own gate). The leaf is not reached in a plain boot, so
 * every case is CRAFTED: IX/IY/C and the input cells are poked identically on both clones.
 *
 * Jobs:
 *   1. EQUAL — over crafted (speedIndex, round, C, parent-position) cases spanning the clamp and
 *      the negate branches, oracle == initChildActorRecordFromParent in RAM (−stack) and A.
 *   2. WRITE-SET — the child record's 14 fields + parent+0x0a hold the exact contract values
 *      (fixed slots, biased position copies, mirrored velocity, anim vector, timer); any other
 *      changed cell lies on the page-0x8a ring.
 *   3. TEETH — a wrong child cell (RAM) and a wrong A (live-out) are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-142c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_142c as oracle } from "../../translated/loc_142c.js";
import { initChildActorRecordFromParent } from "../initChildActorRecordFromParent.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PARENT = 0x8b00;
const CHILD = 0x8b40;
const SPEED_INDEX_ADDR = 0x8900;
const ROUND_COUNTER_ADDR = 0x8907;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the parent/child bases, C, the input cells and parent position seated. */
function craft(spec) {
  const m = BASE.clone();
  m.regs.ix = PARENT;
  m.regs.iy = CHILD;
  m.regs.c = spec.c & 0xff;
  m.regs.sp = 0x8ffe; // stack lives in STACK_SCRATCH; oracle rst/tail only touch it there
  m.mem8[SPEED_INDEX_ADDR] = spec.speedIndex & 0xff;
  m.mem8[ROUND_COUNTER_ADDR] = spec.round & 0xff;
  m.mem8[PARENT + 0x03] = spec.pos[0] & 0xff;
  m.mem8[PARENT + 0x04] = spec.pos[1] & 0xff;
  m.mem8[PARENT + 0x05] = spec.pos[2] & 0xff;
  m.mem8[PARENT + 0x06] = spec.pos[3] & 0xff;
  return m;
}

const CASES = [
  { name: "index<8, even round (no clamp, no negate)", speedIndex: 0x03, round: 0x00, c: 0x11, pos: [0x40, 0x50, 0x60, 0x70] },
  { name: "index>=8, odd round (clamp to 7, negate)", speedIndex: 0x0a, round: 0x01, c: 0x22, pos: [0x00, 0xff, 0x80, 0x01] },
  { name: "index==7 boundary, even round", speedIndex: 0x07, round: 0x02, c: 0x33, pos: [0x7f, 0x80, 0x81, 0x82] },
  { name: "index==0, odd round (negate)", speedIndex: 0x00, round: 0x03, c: 0x44, pos: [0x10, 0x20, 0x30, 0x40] },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted spawn cases — initChildActorRecordFromParent == oracle in RAM (−stack) + A", () => {
  for (const spec of CASES) {
    const o = craft(spec);
    oracle(o);
    const c = craft(spec);
    const ret = initChildActorRecordFromParent(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${spec.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `[${spec.name}] A return mismatch`);
    // SIDE-EFFECT arm: the module must SET A on its own clone (queueSoundCommand04IfNotBusy return-assignment bridge).
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `[${spec.name}] module must SET A`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted spawn cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the child record fields + parent+0x0a hold the contract values", () => {
  // initChildActorRecordFromParent's own footprint is the child record + parent+0x0a; the tail call to queueSoundCommand04IfNotBusy adds
  // the sound-ring cells (0x8d20 pending byte, 0x8a40 write ptr, ring slot), documented by
  // queueSoundCommand04IfNotBusy's own gate. EQUAL already proves the module writes NO stray cell; here we pin the
  // exact contract VALUES initChildActorRecordFromParent lays into the record.
  const spec = CASES[0];
  const m = craft(spec);
  oracle(m);

  const velocity = m.mem8[CHILD + 0x0a];
  const expected = new Map([
    [CHILD + 0x00, 0x01],
    [CHILD + 0x02, 0x04],
    [CHILD + 0x14, spec.c],
    [CHILD + 0x07, 0x00],
    [CHILD + 0x0e, 0x00],
    [CHILD + 0x05, (spec.pos[2] + 0x80) & 0xff],
    [CHILD + 0x03, (spec.pos[0] + 0x80) & 0xff],
    [CHILD + 0x04, (spec.pos[1] - 0x01) & 0xff],
    [CHILD + 0x06, (spec.pos[3] + 0x01) & 0xff],
    [CHILD + 0x0a, velocity],
    [CHILD + 0x0b, velocity],
    [CHILD + 0x0c, 0xcb],
    [CHILD + 0x0d, 0x38],
    [CHILD + 0x11, 0x28],
    [PARENT + 0x0a, velocity],
  ]);

  for (const [addr, val] of expected) {
    assert.equal(m.mem8[addr], val, `field ${hx(addr)} expected ${hx(val)} got ${hx(m.mem8[addr])}`);
  }
  console.log(`  WRITE-SET: 14 child fields + parent+0x0a set; velocity=${hx(velocity)}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong child field is CAUGHT by the RAM diff", () => {
  const spec = CASES[0];
  const o = craft(spec);
  const c = craft(spec);
  oracle(o);
  initChildActorRecordFromParent(c);
  c.mem8[CHILD + 0x0c] = 0x00; // BUG: the anim vector low byte must be 0xcb

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong child field — it is worthless");
  assert.equal(d.addr, CHILD + 0x0c, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong child+0x0c caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong A is CAUGHT by the live-out check", () => {
  const spec = CASES[0];
  const o = craft(spec);
  const c = craft(spec);
  oracle(o);
  const ret = initChildActorRecordFromParent(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: module A matches oracle");
  const broken = (o.regs.a ^ 0xff) & 0xff; // a wrong A the === check must reject
  assert.notEqual(broken, o.regs.a & 0xff, "the live-out check must reject a wrong A");
  console.log(`  TEETH/A: module A ${hx(ret)} == oracle; a flipped ${hx(broken)} is rejected`);
});
