// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for clearAimIndicatorUnlessProximityHit (ROM 0x6c18, Pooyan) — the proximity-scan caller that
 * dissolves the testTargetProximityAndSetAimDirection caller-skip. The oracle fixes ix = SPRITE_DISPLAY_LIST and walks three
 * projectile records (iy stride 4, hl stride 0x18), calling testTargetProximityAndSetAimDirection per pass; the skip's
 * `pop af; ret` aborts the whole scan on the first hit. If no pass hits, the oracle clears the
 * above/below aim bits on PLAYER_AIM_FLAGS and zeroes PROXIMITY_HIT_FLAG.
 *
 * This gate COMPOSES the real idiomatic skip: the imported idiomatic clearAimIndicatorUnlessProximityHit imports the
 * idiomatic testTargetProximityAndSetAimDirection, and the oracle clearAimIndicatorUnlessProximityHit runs the TRANSLATED testTargetProximityAndSetAimDirection through m.call (the
 * default registry). The two must land byte-identical. The oracle's push16/call trampolines
 * write only STACK_SCRATCH (sp seated there), which is excluded; the module spends no stack. So
 * the contract compared is RAM (dumpState, minus stack scratch below the entry SP). No register is a live-out (the
 * caller of clearAimIndicatorUnlessProximityHit reads nothing back), so RAM is the whole contract. pc/sp/cycles are not
 * compared.
 *
 * The routine runs only during live aim-indicator gameplay, so every state is CRAFTED. Three
 * states are seated:
 *   - "no hit"      — all three gate records inactive: the loop completes and the post-loop
 *                     clears run (proves skip-NOT-taken).
 *   - "hit pass 0"  — the first record is a hit: the scan aborts immediately (skip taken on the
 *                     first pass, no post-loop clears).
 *   - "hit pass 2"  — passes 0,1 inactive, pass 2 a hit: proves the loop advances iy/hl across
 *                     passes and still aborts (skip taken on the last pass).
 *
 * Jobs:
 *   1. EQUAL — each state: oracle == clearAimIndicatorUnlessProximityHit in RAM (−stack).
 *   2. WRITE-SET — the no-hit state's only writes are the AIM clear and the HIT zero.
 *   3. TEETH — a wrong post-loop byte is caught by the RAM diff; a twin that fails to abort on a
 *      hit (runs the post-loop clears anyway) is caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6c18.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6c18 as oracle } from "../../translated/loc_6c18.js";
import { clearAimIndicatorUnlessProximityHit } from "../clearAimIndicatorUnlessProximityHit.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RECORD = 0x8840; //  ix, fixed (+0 X source, +2 Y/type)
const AIM = 0x8a87; //     PLAYER_AIM_FLAGS
const HIT = 0x8d54; //     PROXIMITY_HIT_FLAG
const GATE0 = 0x8be8; //   pass-0 gate (PROJECTILE_TABLE)
const GATE1 = 0x8c00; //   pass-1 gate (GATE0 + 0x18)
const GATE2 = 0x8c18; //   pass-2 gate (GATE0 + 0x30)
const TARGET0 = 0x887c; // pass-0 target (SPRITE_TARGET_SLOTS)
const TARGET2 = 0x8884; // pass-2 target (TARGET0 + 8)
const SP_SEAT = 0x8fe0; // in STACK_SCRATCH: the oracle's push16/pop/ret only touch dead RAM

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SEAT);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat a caller state on a fresh clone. AIM/HIT are pre-dirtied so post-loop clears show. */
function craftCaller(state) {
  const m = BASE.clone();
  m.regs.sp = SP_SEAT;
  m.mem.write8(AIM, 0xff); // bits 2,3 set -> a post-loop clear is observable
  m.mem.write8(HIT, 0x01); // -> a post-loop zero is observable
  // a hit config for the fixed record: recX=0x50, type/recY=0x60 (a "hit above, no latch" case)
  const seatHitRecord = () => {
    m.mem.write8(RECORD + 0, 0x40);
    m.mem.write8(RECORD + 2, 0x60);
  };
  const seatHitTarget = (base) => {
    m.mem.write8(base + 0, 0x30); // tgtX=0x50 (in x-band)
    m.mem.write8(base + 2, 0x5c); // tgtY=0x64 (y>=0, in y-band)
  };
  if (state === "no hit") {
    m.mem.write8(GATE0, 0x00);
    m.mem.write8(GATE1, 0x00);
    m.mem.write8(GATE2, 0x00);
  } else if (state === "hit pass 0") {
    seatHitRecord();
    seatHitTarget(TARGET0);
    m.mem.write8(GATE0, 0x01);
  } else if (state === "hit pass 2") {
    seatHitRecord();
    m.mem.write8(GATE0, 0x00);
    m.mem.write8(GATE1, 0x00);
    m.mem.write8(GATE2, 0x01);
    seatHitTarget(TARGET2);
  }
  return m;
}

const STATES = ["no hit", "hit pass 0", "hit pass 2"];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: each caller state — clearAimIndicatorUnlessProximityHit == oracle in RAM (−stack)", () => {
  for (const state of STATES) {
    const o = craftCaller(state);
    const c = craftCaller(state);
    oracle(o);
    clearAimIndicatorUnlessProximityHit(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${state}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${STATES.length} caller states identical (RAM −stack), skip composed over both branches`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the no-hit scan's only writes are AIM cleared and HIT zeroed", () => {
  const before = craftCaller("no hit").dumpState();
  const after = craftCaller("no hit");
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Map();
  for (let off = 0; off < before.length; off++) {
    const addr = after.stateOffsetToAddr(off);
    if (before[off] !== a1[off] && !inDeadStack(addr)) changed.set(addr, a1[off]);
  }
  assert.equal(changed.size, 2, `expected exactly 2 written cells, got ${changed.size}`);
  assert.equal(changed.get(AIM), 0xf3, "AIM: bits 2,3 cleared (0xff -> 0xf3)");
  assert.equal(changed.get(HIT), 0x00, "HIT zeroed");
  console.log(`  WRITE-SET: ${hx(AIM)}=0xf3 ${hx(HIT)}=0x00 (2 cells)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong post-loop AIM byte is CAUGHT by the RAM diff", () => {
  const o = craftCaller("no hit");
  const c = craftCaller("no hit");
  oracle(o);
  clearAimIndicatorUnlessProximityHit(c);
  c.mem.write8(AIM, (c.mem.read8(AIM) ^ 0xff) & 0xff); // BUG: corrupt the cleared aim byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong AIM byte — it is worthless");
  assert.equal(d.addr, AIM, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(AIM)})`);
  console.log(`  TEETH/RAM: wrong AIM caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a twin that fails to abort on a hit (runs the post-loop) is CAUGHT", () => {
  const o = craftCaller("hit pass 0");
  const c = craftCaller("hit pass 0");
  oracle(o); // aborts: AIM=0xf7 (bit2 set/bit3 clear), HIT stays 1
  clearAimIndicatorUnlessProximityHit(c);
  // simulate a non-aborting caller: apply the post-loop clears it should have skipped
  c.mem.write8(AIM, c.mem.read8(AIM) & ~0x0c);
  c.mem.write8(HIT, 0x00);

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a caller that did not abort on a hit");
  console.log(`  TEETH/abort: a non-aborting twin caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});
