// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnChildActorIntoFreeSpriteSlot (ROM 0x13bc, Pooyan) — "find a free sprite-object slot and
 * spawn a child there".
 *
 * The cycle-free / memory-equivalence gate (docs/decompiler-pipeline): a fresh clone per side, the
 * oracle on one and spawnChildActorIntoFreeSpriteSlot on the other, compared on RAM (dumpState, minus stack scratch below the entry SP) PLUS
 * the declared register live-out A. pc/SP/cycles are deliberately not compared.
 *
 * INPUTS: IX (the parent record). The routine sets IY/DE/B itself as it scans the five 0x18-byte
 * slots at 0x8b70; it reads the wrapping counter at 0x8d41, and (on the spawn path, via the tail
 * call to initChildActorRecordFromParent) SPEED_INDEX 0x8900, ROUND_COUNTER 0x8907 and the parent's position bytes.
 *
 * LIVE-OUT A: on the spawn path A is initChildActorRecordFromParent's tail-call result; on the no-free path A is the last
 * scanned pair's `rrca` byte. Checked equal to the oracle and asserted SET on the module's clone.
 * A caller reading it back is unconfirmed, so A is reproduced and compared on both exits (a set that
 * matches the oracle can never false-fail).
 *
 * The leaf is not reached in a plain boot, so every case is CRAFTED: IX, the five slots, the counter
 * and the spawn inputs are poked identically on both clones.
 *
 * Jobs:
 *   1. EQUAL — over no-free and spawn (keep / wrap / later-slot / nonzero-but-free) cases, oracle ==
 *      spawnChildActorIntoFreeSpriteSlot in RAM (−stack) and A.
 *   2. WRITE-SET — the spawn path lays the six parent fields + the bumped counter; the no-free path
 *      writes nothing. (The child slot + sound-ring cells are the tail callee's domain.)
 *   3. TEETH — a wrong parent field (RAM) and a wrong A (live-out) are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-13bc.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_13bc as oracle } from "../../translated/loc_13bc.js";
import { spawnChildActorIntoFreeSpriteSlot } from "../spawnChildActorIntoFreeSpriteSlot.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PARENT = 0x8ae0; //          isolated parent record
const SLOT_BASE = 0x8b70; //       sprite-object table
const STRIDE = 0x18;
const SLOT = (i) => (SLOT_BASE + i * STRIDE) & 0xffff;
const ANIM_COUNTER = 0x8d41;
const SPEED_INDEX = 0x8900;
const ROUND = 0x8907;
const ANIM_PTR = 0x3988; //        the fixed animation vector written into the parent

const OCC = [0x01, 0x00]; //  an occupied slot (bit0 set)
const FREE = [0x00, 0x00]; // a free slot (bit0 clear)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with IX, the five slots, the counter and the spawn inputs seated. */
function craft(spec) {
  const m = BASE.clone();
  m.regs.ix = PARENT;
  m.regs.sp = 0x8ffe; // stack lives in STACK_SCRATCH; the tail call's ret only reads it
  for (let i = 0; i < 5; i++) {
    m.mem8[SLOT(i)] = spec.slots[i][0] & 0xff;
    m.mem8[SLOT(i) + 1] = spec.slots[i][1] & 0xff;
  }
  m.mem8[ANIM_COUNTER] = spec.counter & 0xff;
  m.mem8[SPEED_INDEX] = (spec.speedIndex ?? 0x03) & 0xff;
  m.mem8[ROUND] = (spec.round ?? 0x00) & 0xff;
  const pos = spec.pos ?? [0x40, 0x50, 0x60, 0x70];
  m.mem8[PARENT + 0x03] = pos[0] & 0xff;
  m.mem8[PARENT + 0x04] = pos[1] & 0xff;
  m.mem8[PARENT + 0x05] = pos[2] & 0xff;
  m.mem8[PARENT + 0x06] = pos[3] & 0xff;
  return m;
}

// rrca of an occupied pair (bit0 set): the no-free live-out A.
const rrca = (v) => ((v >> 1) | ((v & 0x01) << 7)) & 0xff;

const CASES = [
  { name: "no-free (all 0x01) — A = rrca(0x01) = 0x80", slots: [OCC, OCC, OCC, OCC, OCC], counter: 0x55 },
  { name: "no-free (last 0x03) — A tracks the LAST pair = rrca(0x03) = 0x81",
    slots: [OCC, OCC, OCC, OCC, [0x03, 0x00]], counter: 0x22 },
  { name: "slot 0 free, counter 0x40 -> 0x41 (kept)", slots: [FREE, OCC, OCC, OCC, OCC], counter: 0x40 },
  { name: "slot 0 free, counter 0xff -> 0x01 (skip-0 wrap)", slots: [FREE, OCC, OCC, OCC, OCC], counter: 0xff },
  { name: "slot 2 free (later slot), odd round -> negate in the spawn",
    slots: [OCC, [0x01, 0x01], FREE, OCC, OCC], counter: 0x10, round: 0x01, speedIndex: 0x0a },
  { name: "slot 0 nonzero-but-free (0x02, bit0 clear) — CRAFT-only edge",
    slots: [[0x02, 0x00], OCC, OCC, OCC, OCC], counter: 0x7f },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted scan cases — spawnChildActorIntoFreeSpriteSlot == oracle in RAM (−stack) + A", () => {
  for (const spec of CASES) {
    const o = craft(spec);
    oracle(o);
    const c = craft(spec);
    const ret = spawnChildActorIntoFreeSpriteSlot(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${spec.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `[${spec.name}] A return mismatch`);
    // SIDE-EFFECT arm: the module must SET A on its own clone (return-assignment / tail bridge).
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `[${spec.name}] module must SET A`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the spawn path lays the six parent fields + the bumped counter", () => {
  const spec = { name: "spawn", slots: [FREE, OCC, OCC, OCC, OCC], counter: 0x40 };
  const m = craft(spec);
  oracle(m);

  const expected = new Map([
    [ANIM_COUNTER, 0x41],
    [PARENT + 0x14, 0x41],
    [PARENT + 0x0c, ANIM_PTR & 0xff],
    [PARENT + 0x0d, (ANIM_PTR >> 8) & 0xff],
    [PARENT + 0x0e, 0x00],
    [PARENT + 0x11, 0x28],
    [PARENT + 0x02, 0x04],
  ]);
  for (const [addr, val] of expected) {
    assert.equal(m.mem8[addr], val, `field ${hx(addr)} expected ${hx(val)} got ${hx(m.mem8[addr])}`);
  }
  console.log(`  WRITE-SET: counter -> 0x41, six parent fields set (child slot + ring = callee domain)`);
});

test("WRITE-SET: the no-free path writes NOTHING", () => {
  const spec = CASES[0];
  const before = craft(spec);
  const after = craft(spec);
  oracle(after);
  const d = ramDiffMinusStack(before, after);
  assert.equal(d, null, d && `no-free path unexpectedly wrote ${hx(d.addr ?? 0)}: ${d.a} -> ${d.b}`);
  console.log(`  WRITE-SET: no-free path leaves RAM pristine`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong parent field is CAUGHT by the RAM diff", () => {
  const spec = { slots: [FREE, OCC, OCC, OCC, OCC], counter: 0x40 };
  const o = craft(spec);
  const c = craft(spec);
  oracle(o);
  spawnChildActorIntoFreeSpriteSlot(c);
  c.mem8[PARENT + 0x0c] = 0x00; // BUG: the anim vector low byte must be 0x88

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong parent field — it is worthless");
  assert.equal(d.addr, PARENT + 0x0c, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong parent+0x0c caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong no-free A is CAUGHT by the live-out check", () => {
  const spec = CASES[0]; // no-free, A = 0x80
  const o = craft(spec);
  const c = craft(spec);
  oracle(o);
  const ret = spawnChildActorIntoFreeSpriteSlot(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: module A matches oracle");
  assert.equal(o.regs.a & 0xff, rrca(0x01), "sanity: the no-free A is rrca(0x01) = 0x80");
  const broken = (o.regs.a ^ 0xff) & 0xff; // a plausible-wrong A the === check must reject
  assert.notEqual(broken, o.regs.a & 0xff, "the live-out check must reject a wrong A");
  console.log(`  TEETH/A: module A ${hx(ret)} == oracle; a flipped ${hx(broken)} is rejected`);
});
