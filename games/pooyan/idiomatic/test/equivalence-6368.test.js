// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence (caller) gate for resolveProjectileCollisionsBothActorSlots (ROM 0x6368) — the two-pass projectile-proximity
 * driver. It runs the scan seeder seedAndRunTargetProximityScan (which hands off to the scan scanTargetSlotsAndSpawnOnProximityHit) once per pass:
 * the first box at the actor-record slot base with the I=0 hit-flag selector, the second box one
 * stride on with the stride (=4) as the selector. The instant a pass CLAIMS a hit, the scan reports
 * it (seedAndRunTargetProximityScan forwards `false`) and this driver ABORTS — the remaining pass is not run. With no
 * hit it runs both passes and falls through.
 *
 * This is a CALLER gate per the cluster brief: it COMPOSES the real idiomatic subtree. The test
 * imports the idiomatic resolveProjectileCollisionsBothActorSlots, which imports the idiomatic seedAndRunTargetProximityScan -> scanTargetSlotsAndSpawnOnProximityHit -> its idiomatic
 * leaves (setActorAnimation, queueSoundCommand07, enqueueDisplayCommand). The ORACLE resolveProjectileCollisionsBothActorSlots runs the FROZEN translated
 * subtree internally via m.call, whose skip path (pop af; ret) aborts pass 2. The two must land
 * byte-identical in RAM (dumpState) MINUS stack scratch below the entry SP. There is no register live-out: runActorUpdatePipeline
 * (the per-frame updater) calls this and reads nothing back, so the contract is RAM−stack only.
 * pc / the full register file / cycles are deliberately NOT compared.
 *
 * The routine seats IY/I itself (it takes no register inputs), so every case is a CRAFTED memory
 * state — record presence bytes, coordinate-slot X/Y, actor-box X/Y and the flip flag poked
 * identically on both sides. The distance test needs both |dx| and |dy| below 6; a box is placed
 * ON a slot (bias-corrected) to force a hit and far from every slot to force a miss.
 *
 * Jobs:
 *   1. EQUAL — three crafted states: pass-1 hit (abort before pass 2), pass-2 hit (pass 1 exhausts
 *      then pass 2 aborts, selecting the I=1 flag), and no hit (both passes exhaust). oracle ==
 *      resolveProjectileCollisionsBothActorSlots in RAM (−stack) in every case.
 *   2. WRITE-SET — on the pass-2 hit, document the claimed record's stamp, its animation pointer,
 *      and that the I=1 hit flag (not the I=0 flag) is the one raised.
 *   3. TEETH/RAM — a wrong byte poked into a stamped record cell MUST be caught by the RAM diff.
 *   4. TEETH/ABORT — a broken twin that ignores the scan's abort and runs pass 2 anyway stamps a
 *      SECOND record; the diff MUST catch that extra footprint.
 *   5. TEETH/SELECTOR — a broken twin that never switches the selector to the stride raises the
 *      I=0 flag on a pass-2 hit instead of the I=1 flag; the diff MUST catch the swapped flag.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6368.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6368 as oracle } from "../../translated/loc_6368.js";
import { resolveProjectileCollisionsBothActorSlots } from "../resolveProjectileCollisionsBothActorSlots.js";
import { seedAndRunTargetProximityScan } from "../seedAndRunTargetProximityScan.js";
import { u16 } from "../../../../core/int.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  SPRITE_ACTOR_RECORD_SLOTS,
  SPRITE_TARGET_SLOTS,
  PROJECTILE_TABLE,
  FLIP_SCREEN_FLAG,
  OBJ_HIT_FLAG_I0,
  OBJ_HIT_FLAG_I1,
  ANIM_SEQ_63FB,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// Box / slot / record layout (offsets from each table base).
const BOX0_X = SPRITE_ACTOR_RECORD_SLOTS + 0x00;
const BOX0_Y = SPRITE_ACTOR_RECORD_SLOTS + 0x02;
const BOX1_X = SPRITE_ACTOR_RECORD_SLOTS + 0x04; // second box: base + one stride
const BOX1_Y = SPRITE_ACTOR_RECORD_SLOTS + 0x06;
const SLOT0_X = SPRITE_TARGET_SLOTS + 0x00;
const SLOT0_Y = SPRITE_TARGET_SLOTS + 0x02;
const SLOT1_X = SPRITE_TARGET_SLOTS + 0x04;
const SLOT1_Y = SPRITE_TARGET_SLOTS + 0x06;
const SLOT2_X = SPRITE_TARGET_SLOTS + 0x08;
const SLOT2_Y = SPRITE_TARGET_SLOTS + 0x0a;
const REC0 = PROJECTILE_TABLE + 0x00;
const REC1 = PROJECTILE_TABLE + 0x18; // second record (stride 0x18)
const REC2 = PROJECTILE_TABLE + 0x30;
const X_BIAS = 0x05; // flip flag set -> slot X biased +5, so a box ON a slot uses coordX + 5

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

/** First RAM difference minus the stack scratch below the entry SP (only the oracle touches the stack). */
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

// clone() neutralises the frame machinery (nextNmi/nextBoundary = Infinity), so the oracle's
// m.step cannot trip a boundary/NMI mid-routine.
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the crafted memory state seated; the routine seats its own IY/I. */
function craft(cells) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // in work RAM inside STACK_SCRATCH; the oracle's pushes/ret stay there
  for (const [addr, val] of cells) m.mem.write8(addr, val);
  return m;
}

// --- crafted states ----------------------------------------------------------
// slotX = coordX + 5 (flip set). A box at (slotX, coordY) hits; at (0,0) it is far.

// Pass-1 hit: box0 lands on slot0 -> pass 1 hits and the driver aborts before pass 2.
// rec1 is ALSO reachable by box1 (on slot1), so a driver that fails to abort would stamp it too.
const CASE_PASS1_HIT = [
  [FLIP_SCREEN_FLAG, 0x01],
  [REC0, 0x01], [REC1, 0x01], [REC2, 0x00],
  [SLOT0_X, 0x40], [SLOT0_Y, 0x50], // slotX0 = 0x45, slotY0 base 0x50
  [SLOT1_X, 0x60], [SLOT1_Y, 0x50], // slotX1 = 0x65
  [BOX0_X, 0x45], [BOX0_Y, 0x50], // on slot0 -> pass-1 hit
  [BOX1_X, 0x65], [BOX1_Y, 0x50], // on slot1 -> would hit if pass 2 ran
  [OBJ_HIT_FLAG_I0, 0x00], [OBJ_HIT_FLAG_I1, 0x00],
];

// Pass-2 hit: box0 far from every slot -> pass 1 exhausts; box1 lands on slot0 -> pass 2 hits,
// raising the I=1 flag because the second pass selects on the stride (=4, non-zero).
const CASE_PASS2_HIT = [
  [FLIP_SCREEN_FLAG, 0x01],
  [REC0, 0x01], [REC1, 0x00], [REC2, 0x00],
  [SLOT0_X, 0x40], [SLOT0_Y, 0x50], // slotX0 = 0x45
  [BOX0_X, 0x00], [BOX0_Y, 0x00], // far -> pass-1 miss
  [BOX1_X, 0x45], [BOX1_Y, 0x50], // on slot0 -> pass-2 hit
  [OBJ_HIT_FLAG_I0, 0x00], [OBJ_HIT_FLAG_I1, 0x00],
];

// No hit: every box far from every (present) slot -> both passes run the distance math and exhaust.
const CASE_NO_HIT = [
  [FLIP_SCREEN_FLAG, 0x01],
  [REC0, 0x01], [REC1, 0x01], [REC2, 0x01],
  [SLOT0_X, 0x40], [SLOT0_Y, 0x50],
  [SLOT1_X, 0x40], [SLOT1_Y, 0x50],
  [SLOT2_X, 0x40], [SLOT2_Y, 0x50],
  [BOX0_X, 0x00], [BOX0_Y, 0x00],
  [BOX1_X, 0x00], [BOX1_Y, 0x00],
  [OBJ_HIT_FLAG_I0, 0x00], [OBJ_HIT_FLAG_I1, 0x00],
];

const NAMED = { CASE_PASS1_HIT, CASE_PASS2_HIT, CASE_NO_HIT };

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: composed idiomatic subtree == oracle in RAM (−stack) over all three states", () => {
  for (const [name, cells] of Object.entries(NAMED)) {
    const o = craft(cells);
    const c = craft(cells);
    oracle(o);
    resolveProjectileCollisionsBothActorSlots(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} (${name})`);
  }
  console.log(`  EQUAL: 3 crafted states identical (RAM −stack): pass-1 hit, pass-2 hit, no hit`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: pass-2 hit stamps rec0, points its animation, and raises the I=1 flag only", () => {
  const before = craft(CASE_PASS2_HIT);
  const after = craft(CASE_PASS2_HIT);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changedAddrs = new Set();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changedAddrs.add(after.stateOffsetToAddr(off));
  }

  // Claimed record stamp + teardown countdown.
  assert.equal(after.mem.read8(REC0 + 0x00), 0x00);
  assert.equal(after.mem.read8(REC0 + 0x01), 0x01);
  assert.equal(after.mem.read8(REC0 + 0x02), 0x02);
  assert.equal(after.mem.read8(REC0 + 0x11), 0x28);
  // Animation pointer (little-endian) + frame reset.
  assert.equal(after.mem.read8(REC0 + 0x0c), ANIM_SEQ_63FB & 0xff);
  assert.equal(after.mem.read8(REC0 + 0x0d), (ANIM_SEQ_63FB >> 8) & 0xff);
  assert.equal(after.mem.read8(REC0 + 0x0e), 0x00);
  // I=1 flag raised (second pass, selector != 0); I=0 flag left clear.
  assert.equal(after.mem.read8(OBJ_HIT_FLAG_I1), 0x01);
  assert.equal(after.mem.read8(OBJ_HIT_FLAG_I0), 0x00);
  for (const cell of [REC0 + 0x01, REC0 + 0x11, REC0 + 0x0c, OBJ_HIT_FLAG_I1]) {
    assert.ok(changedAddrs.has(cell), `expected a write at ${hx(cell)}`);
  }
  assert.ok(!changedAddrs.has(OBJ_HIT_FLAG_I0), "the I=0 flag must NOT change on a pass-2 hit");
  console.log(`  WRITE-SET: rec0 stamped + anim ${hx(ANIM_SEQ_63FB)} + I=1 flag ${hx(OBJ_HIT_FLAG_I1)} raised`);
});

// -- 3. TEETH/RAM -------------------------------------------------------------

test("TEETH/RAM: a wrong stamped-record byte is CAUGHT by the RAM diff", () => {
  const o = craft(CASE_PASS2_HIT);
  const c = craft(CASE_PASS2_HIT);
  oracle(o);
  resolveProjectileCollisionsBothActorSlots(c);
  c.mem.write8(REC0 + 0x01, 0x99); // BUG: stamp byte must be 0x01
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stamped byte — it is worthless");
  assert.equal(d.addr, REC0 + 0x01, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong stamp byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. TEETH/ABORT -----------------------------------------------------------
// A twin that ignores the scan's abort and runs pass 2 regardless.
function brokenNoAbort(m) {
  let box = SPRITE_ACTOR_RECORD_SLOTS;
  let selector = 0x00;
  for (let pass = 2; pass > 0; pass--) {
    seedAndRunTargetProximityScan(m, box, selector); // BUG: never early-returns on a claimed hit
    box = u16(box + 0x04);
    selector = 0x04;
  }
}

test("TEETH/ABORT: failing to abort after a pass-1 hit stamps a second record and is CAUGHT", () => {
  const o = craft(CASE_PASS1_HIT);
  const c = craft(CASE_PASS1_HIT);
  oracle(o); // aborts after pass 1 -> only rec0 stamped
  brokenNoAbort(c); // runs pass 2 too -> rec1 also stamped
  assert.equal(o.mem.read8(REC1), 0x01, "sanity: the oracle leaves rec1 untouched (aborted)");
  assert.equal(c.mem.read8(REC1), 0x00, "sanity: the broken twin overwrote rec1's presence byte");
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missing abort — it is worthless");
  console.log(`  TEETH/ABORT: extra pass-2 stamp caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});

// -- 5. TEETH/SELECTOR --------------------------------------------------------
// A twin that never switches the interrupt-parity selector to the stride for pass 2.
function brokenNoSelector(m) {
  let box = SPRITE_ACTOR_RECORD_SLOTS;
  for (let pass = 2; pass > 0; pass--) {
    if (!seedAndRunTargetProximityScan(m, box, 0x00)) return; // BUG: always selector 0
    box = u16(box + 0x04);
  }
}

test("TEETH/SELECTOR: a pass-2 hit with the wrong selector raises the I=0 flag and is CAUGHT", () => {
  const o = craft(CASE_PASS2_HIT);
  const c = craft(CASE_PASS2_HIT);
  oracle(o); // pass-2 hit -> I=1 flag
  brokenNoSelector(c); // pass-2 hit with selector 0 -> I=0 flag
  assert.equal(o.mem.read8(OBJ_HIT_FLAG_I1), 0x01, "sanity: oracle raised the I=1 flag");
  assert.equal(c.mem.read8(OBJ_HIT_FLAG_I0), 0x01, "sanity: the broken twin raised the I=0 flag");
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a swapped hit flag — it is worthless");
  console.log(`  TEETH/SELECTOR: swapped hit flag caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});
