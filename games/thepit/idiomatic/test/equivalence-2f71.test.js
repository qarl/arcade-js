// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for advanceChamberCreature (ROM 0x2f71, The Pit) — the per-frame
 * monolith that steps the animated background sprite (sideways bounce + accelerating
 * fall + shimmer flip), publishes its screen-relative sprite record, reveals one column
 * of terrain once the goal is reached, and tail-jumps into the object-record pass (0x312d).
 *
 * The routine is dispatched EVERY frame in attract, so its always-run arms (shimmer
 * clock, bounce, publish) are gated against real captured entry states: hook 0x2f71,
 * clone the machine at each dispatch, and run idiomatic-vs-oracle on the clones.
 *
 * Two things force crafted entries. (1) Attract never reaches the goal tile, so the
 * terrain-reveal stage and its reveal-sound trigger are never taken by a real capture;
 * a captured entry is poked (goal latch on, gate/cursor set) to drive the reveal, the
 * gate-skip, the cursor-exhausted skip, and the sound gate — identically on both sides.
 * (2) The floor clamp that draws a fresh random fall step is periodic; a captured entry
 * is poked to force the oscillator to run with Y at the floor so both sides advance the
 * shared PRNG in lockstep.
 *
 * ONE WRINKLE — the oracle path brackets its two internal calls (the reveal-sound
 * trigger 0x4c7b and the random generator 0x4b1a) with stack pushes, and The Pit's
 * stack is real diffed work RAM. Those pushes leave dead scratch just below the entry
 * stack pointer that the stack-free idiomatic JS (which calls those leaves directly)
 * does not reproduce. It is classic dead stack scratch — overwritten by the object-
 * record pass both sides run next, and never read before that — so the RAM diff excludes
 * a window just below the entry stack pointer and compares everything else byte-for-byte.
 * pc/SP are not compared: both sides reach the object-record pass (the idiomatic side
 * calls the decompiled updateEnemy1 directly, the oracle side m.calls the frozen
 * loc_312d — memory-equivalent), so excluding pc/SP keeps the gate independent of that
 * pass's exact stack trace.
 *
 * Checks:
 *   0. HARNESS — capture real 0x2f71 entries and confirm the oracle run is deterministic
 *      (oracle vs oracle → identical whole state incl. stack).
 *   1. EQUAL (real captured entries) — advanceChamberCreature == oracle over RAM (outside the
 *      dead stack scratch) on every naturally-occurring attract state.
 *   2. EQUAL (crafted reveal) — goal latch on: full 6-tile reveal + reveal sound, the
 *      gate-not-yet-zero skip, and the cursor-exhausted skip all match the oracle.
 *   3. EQUAL (crafted floor clamp) — oscillator forced with Y at the floor: the clamp,
 *      the random fall-step reseed, and the colour bump match (PRNG stays in lockstep).
 *   4. TEETH (wrong published X) — a twin that corrupts the published X byte is CAUGHT.
 *   5. TEETH (dropped reveal tile) — a twin that corrupts a revealed video tile is CAUGHT.
 *   6. TEETH (dropped horizontal step) — a twin that fails to move X is CAUGHT at the
 *      sprite's X byte (a genuine logic bug, not a post-hoc poke).
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-2f71.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2f71 as oracle } from "../../translated/loc_2f71.js";
import { advanceChamberCreature as idiomatic } from "../advanceChamberCreature.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import {
  GOAL_TILE_LATCH,
  PIT_CROSS_ACTIVE,
  PLAYER_X,
  PIT_FLOOR_REVEAL_GATE,
  PIT_FLOOR_REVEAL_PERIOD,
  PIT_FLOOR_REVEAL_CURSOR,
  CHAMBER_CREATURE_ANIM_PHASE,
  CHAMBER_CREATURE_X,
  CHAMBER_CREATURE_FALL_Y,
} from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) =>
      nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x2f71;
const SPRITE_SLOT = 0x822c; // the background sprite's 4-byte staging slot (unnamed RAM)
const REVEAL_BOTTOM_CELL = 0x938c; // the video-RAM cell of a revealed column's bottom tile
const FALL_STEP = 0x80e0; // the accelerating fall step (unnamed RAM)
const GOAL_ROW = 107; // PLAYER_X value that arms the reveal sound
const STACK_SCRATCH = 16; // bytes just below entry SP the oracle's call brackets dirty
const CAPTURE_FRAMES = 900; // 0x2f71 first runs ~frame 695
const CAPTURE_LIMIT = 128; // real states to collect (they span the phase + fall cycle)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- capture ------------------------------------------------------------------

/** Collect up to CAPTURE_LIMIT pristine machine states at 0x2f71's entry. The hook
 *  clones the entry, then runs the real routine so attract proceeds undisturbed. */
function captureEntries() {
  const states = [];
  const overrides = new Map([
    [TARGET, (mm) => {
      if (states.length < CAPTURE_LIMIT) states.push(mm.clone());
      return oracle(mm);
    }],
  ]);
  const host = makeMachine(overrides);
  host.runFrames(CAPTURE_FRAMES);
  return states;
}

const STATES = ROM_PRESENT ? captureEntries() : [];

// -- diff ---------------------------------------------------------------------

/** First differing RAM byte between two machines, EXCLUDING the dead stack scratch the
 *  oracle's internal call brackets leave just below the entry stack pointer. */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_SCRATCH, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the oracle and a candidate on two clones of one entry and diff RAM (outside the
 *  dead stack scratch). Value registers / pc / SP are the dead live-out and not compared. */
function runPair(entry, candidate) {
  const sp = entry.regs.sp;
  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  candidate(b);
  return ramDiffOutsideStack(a, b, sp);
}

// -- 0. HARNESS ---------------------------------------------------------------

test("HARNESS: real 0x2f71 entries captured and the oracle run is deterministic", () => {
  assert.ok(STATES.length > 0, "expected 0x2f71 to be dispatched during attract");
  const entry = STATES[0];
  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  assert.equal(a.pc, b.pc, "oracle pc not deterministic");
  console.log(`  HARNESS: captured ${STATES.length} real entries (SP=${hx(entry.regs.sp)}); oracle run deterministic`);
});

// -- 1. EQUAL: every naturally-occurring captured state -----------------------

test("EQUAL (captured): advanceChamberCreature == oracle on every real attract state", () => {
  assert.ok(STATES.length > 0, "need captured attract states");
  for (const entry of STATES) {
    const ram = runPair(entry, idiomatic);
    assert.equal(
      ram,
      null,
      ram && `RAM diverged at ${hx(ram.addr ?? 0)} (oracle=${ram.a} idiomatic=${ram.b})`,
    );
  }
  console.log(`  EQUAL/captured: ${STATES.length} real states identical (memory outside stack scratch)`);
});

// -- 2. EQUAL: crafted terrain-reveal entries --------------------------------

test("EQUAL (crafted reveal): full reveal + sound, gate-skip, and cursor-exhausted skip all match", () => {
  assert.ok(STATES.length > 0, "need a captured state to craft from");

  // Full reveal: gate reaches zero, cursor still inside the table -> 6 tiles stamped +
  // the reveal sound is cued (crossing latch set, object on the goal row).
  {
    const entry = STATES[0].clone();
    entry.mem.write8(GOAL_TILE_LATCH, 1);
    entry.mem.write8(PIT_CROSS_ACTIVE, 1);
    entry.mem.write8(PLAYER_X, GOAL_ROW);
    entry.mem.write8(PIT_FLOOR_REVEAL_GATE, 1); // -> 0, reveal this frame
    entry.mem.write8(PIT_FLOOR_REVEAL_PERIOD, 5);
    entry.mem.write8(PIT_FLOOR_REVEAL_CURSOR, 12); // -> 6, source = table + 6 (inside the table)
    const ram = runPair(entry, idiomatic);
    assert.equal(ram, null, ram && `reveal-full diverged at ${hx(ram.addr ?? 0)} (oracle=${ram.a} idiomatic=${ram.b})`);
    // Prove the reveal really wrote the column (guards against a vacuous pass).
    const c = entry.clone();
    idiomatic(c);
    assert.equal(c.mem.read8(REVEAL_BOTTOM_CELL), c.mem.read8(0x3048 + 6), "reveal did not stamp the bottom tile");
  }

  // Gate not yet zero: nothing revealed, straight to the animation.
  {
    const entry = STATES[0].clone();
    entry.mem.write8(GOAL_TILE_LATCH, 1);
    entry.mem.write8(PIT_CROSS_ACTIVE, 0);
    entry.mem.write8(PIT_FLOOR_REVEAL_GATE, 5); // -> 4, skip
    const ram = runPair(entry, idiomatic);
    assert.equal(ram, null, ram && `reveal-gate-skip diverged at ${hx(ram.addr ?? 0)}`);
  }

  // Cursor exhausted: gate reaches zero but the cursor underflows -> draw nothing.
  {
    const entry = STATES[0].clone();
    entry.mem.write8(GOAL_TILE_LATCH, 1);
    entry.mem.write8(PIT_CROSS_ACTIVE, 0);
    entry.mem.write8(PIT_FLOOR_REVEAL_GATE, 1); // -> 0
    entry.mem.write8(PIT_FLOOR_REVEAL_PERIOD, 5);
    entry.mem.write8(PIT_FLOOR_REVEAL_CURSOR, 3); // -> -3, underflow, no copy
    const ram = runPair(entry, idiomatic);
    assert.equal(ram, null, ram && `reveal-cursor-skip diverged at ${hx(ram.addr ?? 0)}`);
  }
  console.log("  EQUAL/reveal: full reveal + sound, gate-skip and cursor-skip all identical to the oracle");
});

// -- 3. EQUAL: crafted floor-clamp entry (forces the PRNG-drawing arm) --------

test("EQUAL (crafted clamp): oscillator with Y at the floor reseeds the fall step, in lockstep", () => {
  assert.ok(STATES.length > 0, "need a captured state to craft from");
  const entry = STATES[0].clone();
  entry.mem.write8(GOAL_TILE_LATCH, 0); // skip reveal, isolate the fall/clamp
  entry.mem.write8(CHAMBER_CREATURE_ANIM_PHASE, 1); // -> phase 0: reload + flip, then run the oscillator
  entry.mem.write8(CHAMBER_CREATURE_FALL_Y, 0x84); // near the floor
  entry.mem.write8(FALL_STEP, 8); // -> +9, Y = 0x8d >= floor -> clamp + advanceRandom
  const ram = runPair(entry, idiomatic);
  assert.equal(ram, null, ram && `clamp diverged at ${hx(ram.addr ?? 0)} (oracle=${ram.a} idiomatic=${ram.b})`);

  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(CHAMBER_CREATURE_FALL_Y), 0x86, "Y did not clamp to the floor");
  console.log("  EQUAL/clamp: floor clamp + random fall-step reseed + colour bump identical (PRNG in lockstep)");
});

// -- 4/5/6. TEETH: broken twins the RAM diff MUST catch -----------------------

/** Twin: the real routine, then one wrong store to the published X byte. */
function twinWrongPublishedX(m) {
  idiomatic(m);
  m.mem8[SPRITE_SLOT] = m.mem8[SPRITE_SLOT] ^ 0xff; // BUG: corrupts the published X
}

/** Twin: the real routine, then one wrong store to a revealed video tile. */
function twinDroppedRevealTile(m) {
  idiomatic(m);
  m.mem8[REVEAL_BOTTOM_CELL] = m.mem8[REVEAL_BOTTOM_CELL] ^ 0xff; // BUG: corrupts a revealed tile
}

test("TEETH (wrong published X): a corrupted publish is CAUGHT at the sprite slot", () => {
  const entry = STATES[0];
  const ram = runPair(entry, twinWrongPublishedX);
  assert.notEqual(ram, null, "the gate FAILED to catch a wrong published X — it is worthless");
  assert.equal(ram.addr, SPRITE_SLOT, `teeth caught ${hx(ram.addr ?? 0)} (expected ${hx(SPRITE_SLOT)})`);
  console.log(`  TEETH/publish: wrong published X caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH (dropped reveal tile): a corrupted revealed tile is CAUGHT in video RAM", () => {
  const entry = STATES[0].clone();
  entry.mem.write8(GOAL_TILE_LATCH, 1);
  entry.mem.write8(PIT_CROSS_ACTIVE, 0);
  entry.mem.write8(PIT_FLOOR_REVEAL_GATE, 1);
  entry.mem.write8(PIT_FLOOR_REVEAL_PERIOD, 5);
  entry.mem.write8(PIT_FLOOR_REVEAL_CURSOR, 12);
  const ram = runPair(entry, twinDroppedRevealTile);
  assert.notEqual(ram, null, "the gate FAILED to catch a dropped reveal tile — it is worthless");
  assert.equal(ram.addr, REVEAL_BOTTOM_CELL, `teeth caught ${hx(ram.addr ?? 0)} (expected ${hx(REVEAL_BOTTOM_CELL)})`);
  console.log(`  TEETH/reveal: dropped reveal tile caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH (dropped horizontal step): a twin that fails to move X is CAUGHT at the sprite X byte", () => {
  // Force the oscillator to run so X actually moves; the twin then restores X to its
  // entry value — a genuine "forgot to commit the horizontal step" logic bug.
  const entry = STATES[0].clone();
  entry.mem.write8(GOAL_TILE_LATCH, 0);
  entry.mem.write8(CHAMBER_CREATURE_ANIM_PHASE, 1); // reload -> oscillator runs
  const savedX = entry.mem.read8(CHAMBER_CREATURE_X);
  const twinDroppedHorizontalStep = (m) => {
    idiomatic(m);
    m.mem8[CHAMBER_CREATURE_X] = savedX; // BUG: undoes the committed horizontal step
  };
  const ram = runPair(entry, twinDroppedHorizontalStep);
  assert.notEqual(ram, null, "the gate FAILED to catch a dropped horizontal step — it is worthless");
  assert.equal(ram.addr, CHAMBER_CREATURE_X, `teeth caught ${hx(ram.addr ?? 0)} (expected ${hx(CHAMBER_CREATURE_X)})`);
  console.log(`  TEETH/bounce: dropped horizontal step caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
