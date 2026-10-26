// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnChildActorIfInRange (ROM 0x1383) — "B-range guard before the child spawn".
 *
 * spawnChildActorIfInRange does `ld a,b; cp 0x20; ret nc` — when B >= 0x20 it returns with A = B and no memory
 * effect — else it tail-jumps to spawnChildActorIntoFreeSpriteSlot (find a free sprite-object slot and spawn a child
 * actor). spawnChildActorIntoFreeSpriteSlot's result (register A) therefore becomes spawnChildActorIfInRange's result on the in-range
 * path. The only caller (matchActorScheduleThenSpawnOrAnimate) reaches spawnChildActorIfInRange by a `jp z` tail, so its live-out is A.
 *
 * CYCLE-FREE / memory-equivalence gate. The in-range path can WRITE work RAM (through spawnChildActorIntoFreeSpriteSlot /
 * initChildActorRecordFromParent), so each case uses a FRESH clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP) PLUS the register live-out A. pc/SP/cycles are NOT compared. A is derived from
 * the oracle: it is B on the guard path and spawnChildActorIntoFreeSpriteSlot's spawn/no-free result on the tail path.
 *
 * NOTE ON THE JS RETURN: the translated guard path does a bare `return;` (JS undefined) while the
 * idiomatic guard path returns `(m.regs.a = b)`. Both set the SAME register A, which is the actual
 * contract, so the gate compares the register — not the raw JS return — on that path.
 *
 * Cases: guard (B >= 0x20); tail with NO free slot (all five slots' bit0 set -> spawnChildActorIntoFreeSpriteSlot returns
 * the last rotate-right byte, no writes); tail with a free slot (slot 0 free -> full spawn).
 *
 * Jobs:
 *   1. EQUAL — oracle == spawnChildActorIfInRange in RAM (−stack) AND in the A live-out; the module SET A on its
 *      own clone (the register the translated caller reads).
 *   2. WRITE-SET — the guard and no-free tail write nothing; the spawn tail bumps ANIM_FRAME_COUNTER.
 *   3. TEETH — a wrong A is caught by the live-out check; a wrong written byte by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1383.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1383 as oracle } from "../../translated/loc_1383.js";
import { spawnChildActorIfInRange } from "../spawnChildActorIfInRange.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SPRITE_OBJECT_TABLE, ANIM_FRAME_COUNTER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SLOT_STRIDE = 0x18;
const SLOT_COUNT = 5;
const IX_PARENT = 0x8ac0; // a scratch parent record, disjoint from the slot table
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff8);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with B and IX seated, and the slot table set to the requested occupancy. */
function craft({ b, slots }) {
  const m = BASE.clone();
  m.regs.b = b;
  m.regs.ix = IX_PARENT;
  m.regs.sp = 0x8ff8; // inside STACK_SCRATCH; the tail's nested push/pop/ret stay in the dead region
  if (slots === "full") {
    for (let i = 0; i < SLOT_COUNT; i++) {
      m.mem.write8((SPRITE_OBJECT_TABLE + i * SLOT_STRIDE) & 0xffff, 0x01); // bit0 set -> occupied
      m.mem.write8((SPRITE_OBJECT_TABLE + i * SLOT_STRIDE + 1) & 0xffff, 0x00);
    }
  } else if (slots === "free0") {
    m.mem.write8(SPRITE_OBJECT_TABLE, 0x00); // slot 0 free
    m.mem.write8((SPRITE_OBJECT_TABLE + 1) & 0xffff, 0x00);
  }
  return m;
}

const CASES = [
  { label: "guard: B == 0x20 -> A=B, no work", b: 0x20 },
  { label: "guard: B == 0x50 -> A=B, no work", b: 0x50 },
  { label: "guard: B == 0xff -> A=B, no work", b: 0xff },
  { label: "tail, no free slot -> A=last rotate byte, no work", b: 0x00, slots: "full" },
  { label: "tail, no free slot (B=0x1f edge)", b: 0x1f, slots: "full" },
  { label: "tail, spawn into free slot 0", b: 0x05, slots: "free0" },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted cases — spawnChildActorIfInRange == oracle in RAM (−stack) + A live-out", () => {
  for (const c of CASES) {
    const o = craft(c);
    const k = craft(c);
    oracle(o);
    spawnChildActorIfInRange(k);
    const d = ramDiffMinusStack(o, k);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (${c.label})`);
    // A is the load-bearing live-out; the module must SET it on its own clone (the register the
    // translated dispatch reads back), not merely return a value.
    assert.equal(k.regs.a & 0xff, o.regs.a & 0xff, `A live-out mismatch (${c.label})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: guard + no-free tail write nothing; spawn tail bumps ANIM_FRAME_COUNTER", () => {
  for (const c of [CASES[0], CASES[3]]) {
    const before = craft(c);
    const after = craft(c);
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    let changed = 0;
    for (let off = 0; off < b0.length; off++) if (b0[off] !== a1[off]) changed++;
    assert.equal(changed, 0, `expected no writes for "${c.label}", got ${changed}`);
  }

  const spawn = CASES.find((x) => x.slots === "free0");
  const before = craft(spawn);
  const after = craft(spawn);
  const animBefore = before.mem.read8(ANIM_FRAME_COUNTER);
  oracle(after);
  assert.notEqual(after.mem.read8(ANIM_FRAME_COUNTER), animBefore, "spawn must bump ANIM_FRAME_COUNTER");
  console.log("  WRITE-SET: guard/no-free write nothing; spawn bumps the anim counter");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong A live-out is CAUGHT by the register check", () => {
  const c = CASES[1]; // guard: A must equal B
  const o = craft(c);
  const k = craft(c);
  oracle(o);
  spawnChildActorIfInRange(k);
  assert.equal(k.regs.a & 0xff, o.regs.a & 0xff, "sanity: A matches the oracle (A = B)");
  assert.notEqual((c.b + 1) & 0xff, o.regs.a & 0xff, "the live-out check must reject an off-by-one A");
  console.log(`  TEETH/A: A live-out ${hx(o.regs.a)} == oracle; an off-by-one is rejected`);
});

test("TEETH: a wrong written byte on the spawn tail is CAUGHT by the RAM diff", () => {
  const c = CASES.find((x) => x.slots === "free0");
  const o = craft(c);
  const k = craft(c);
  oracle(o);
  spawnChildActorIfInRange(k);
  assert.equal(ramDiffMinusStack(o, k), null, "sanity: the spawn tail is memory-equivalent before tampering");
  k.mem.write8(ANIM_FRAME_COUNTER, (k.mem.read8(ANIM_FRAME_COUNTER) ^ 0xff) & 0xff); // BUG
  const d = ramDiffMinusStack(o, k);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong spawn write — it is worthless");
  assert.equal(d.addr, ANIM_FRAME_COUNTER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong spawn byte caught at ${hx(d.addr)}`);
});
