// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for zeroSpriteListAndActorArena (ROM 0x02b9) — "zero the board-init RAM regions": clear the
 * sprite display-list run (0x60 bytes from SPRITE_DISPLAY_LIST) and the actor/object arena (0x237
 * bytes from ACTOR_TABLE) to zero.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES work RAM, so every case
 * uses a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the declared register live-out (A, B, HL).
 *
 * pc/SP/cycles are NOT compared. The routine takes NO register inputs (it loads HL/B/A itself), so
 * every case is crafted only by pre-dirtying cells so the clear is observable. The live-outs are
 * derived from the oracle's exit: A = 0 (the xor-a fill byte, never restored), B = 0 (the fill
 * counter drained by the last fill) and HL = ACTOR_TABLE + 0x237 (the advanced fill pointer). Most
 * callers overwrite these, but one (fetchWordFromTableIndex) tail-returns them, so they are set + checked.
 *
 * Jobs: 1. EQUAL over pre-dirtied clones (RAM−stack + A/B/HL, with SET side-effect arms);
 * 2. WRITE-SET (every change is a zero-write inside the two ranges); 3. CRAFTED (sentinels in both
 * ranges overwritten to zero); 4. TEETH (a wrong cleared byte + a wrong live-out).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-02b9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_02b9 as oracle } from "../../translated/loc_02b9.js";
import { zeroSpriteListAndActorArena } from "../zeroSpriteListAndActorArena.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SPRITE_DISPLAY_LIST, ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

// The two cleared ranges [lo, hi) and the exit pointer.
const SPRITE_LO = SPRITE_DISPLAY_LIST, SPRITE_HI = SPRITE_DISPLAY_LIST + 0x60;
const ARENA_LO = ACTOR_TABLE, ARENA_HI = ACTOR_TABLE + 0x237;
const HL_END = ARENA_HI; // ACTOR_TABLE + 0x237 = 0x8cb7
const inRange = (a) => (a >= SPRITE_LO && a < SPRITE_HI) || (a >= ARENA_LO && a < ARENA_HI);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

// A few sentinel cells inside each range, plus the range edges, so the clear is observable.
const DIRTY = [
  SPRITE_LO, SPRITE_LO + 1, SPRITE_HI - 1,
  ARENA_LO, ARENA_LO + 1, ARENA_LO + 0x100, ARENA_LO + 0x200, ARENA_HI - 1,
];

function craft(sentinel) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // in dead stack scratch; the ret only pops (reads)
  if (sentinel != null) for (const a of DIRTY) m.mem.write8(a, sentinel);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: zeroSpriteListAndActorArena == oracle in RAM (−stack) + A/B/HL live-outs", () => {
  for (const sentinel of [null, 0xaa, 0x01, 0xff]) {
    const o = craft(sentinel);
    const c = craft(sentinel);
    oracle(o);
    const ret = zeroSpriteListAndActorArena(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (sentinel=${sentinel})`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `A return mismatch (sentinel=${sentinel})`);
    // SET side-effect arms: fetchWordFromTableIndex tail-returns these, so the module must WRITE them.
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `module must SET A (sentinel=${sentinel})`);
    assert.equal(c.regs.b & 0xff, o.regs.b & 0xff, `module must SET B (sentinel=${sentinel})`);
    assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `module must SET HL (sentinel=${sentinel})`);
  }
  // Anchor the derived live-outs to their known constants.
  const o = craft(0xaa);
  oracle(o);
  assert.equal(o.regs.a & 0xff, 0x00, "oracle A live-out is the zero fill byte");
  assert.equal(o.regs.b & 0xff, 0x00, "oracle B live-out is the drained fill counter");
  assert.equal(o.regs.hl & 0xffff, HL_END, `oracle HL live-out is ${hx(HL_END)}`);
  console.log(`  EQUAL: 4 sentinel cases identical (RAM −stack + A=0/B=0/HL=${hx(HL_END)})`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: every oracle change is a zero-write inside the two cleared ranges", () => {
  const before = craft(0xaa);
  const after = craft(0xaa);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  let changes = 0;
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the ret's stack pops are dead-scratch
    changes++;
    assert.ok(inRange(addr), `change outside the cleared ranges at ${hx(addr)}`);
    assert.equal(a1[off], 0x00, `cleared cell ${hx(addr)} must be 0, got ${a1[off]}`);
  }
  // The 8 sentinels sat in the ranges, so at least those 8 zero-writes are observed.
  assert.ok(changes >= DIRTY.length, `expected >= ${DIRTY.length} zero-writes, saw ${changes}`);
  console.log(`  WRITE-SET: ${changes} zero-writes, all inside [${hx(SPRITE_LO)},${hx(SPRITE_HI)}) ∪ [${hx(ARENA_LO)},${hx(ARENA_HI)})`);
});

// -- 3. CRAFTED (overwrite) ---------------------------------------------------

test("CRAFTED: sentinel cells across both ranges are overwritten to zero identically", () => {
  const o = craft(0xaa);
  const c = craft(0xaa);
  oracle(o);
  zeroSpriteListAndActorArena(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  for (const a of DIRTY) assert.equal(c.mem.read8(a), 0x00, `sentinel not cleared at ${hx(a)}`);
  console.log(`  CRAFTED: ${DIRTY.length} sentinels (0xAA) cleared to 0x00 on both sides`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong cleared byte is CAUGHT by the RAM diff", () => {
  const o = craft(0xaa);
  const c = craft(0xaa);
  oracle(o);
  zeroSpriteListAndActorArena(c);
  const bug = ARENA_LO + 0x100;
  c.mem.write8(bug, 0x55); // BUG: this cell must be cleared to 0x00

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong cleared byte — it is worthless");
  assert.equal(d.addr, bug, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(bug)})`);
  console.log(`  TEETH/RAM: wrong cleared byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong HL live-out is CAUGHT by the register check", () => {
  const o = craft(0xaa);
  oracle(o);
  // an unadvanced HL (still at ACTOR_TABLE) is a plausible bug the === check must reject
  assert.notEqual(ACTOR_TABLE & 0xffff, o.regs.hl & 0xffff, "the HL check must reject an unadvanced pointer");
  assert.equal(o.regs.hl & 0xffff, HL_END, "sanity: oracle HL is the advanced pointer");
  console.log(`  TEETH/HL: oracle HL ${hx(o.regs.hl)}; unadvanced ${hx(ACTOR_TABLE)} is rejected`);
});
