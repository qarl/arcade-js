// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for advancePlayerLaser (ROM 0x24f3, The Pit) — the per-frame
 * driver of the tracked object's dig/push reaction. Each frame it either forces the rest
 * sprite (a goal crossing / armed dig owns the frame), advances an in-progress horizontal
 * scroll across the terrain, services an edge collision (maybe seeding a scroll), or runs
 * the active reaction phase (one of four 8-pixel directions): sliding the object while its
 * timer ticks, and on expiry settling it, writing the resolved tiles into the actor's map
 * cell, and (except the 3rd phase) spawning the dug entity. Every path builds the object's
 * sprite record and tails into the dig-object driver advanceDigCarveObject.
 *
 * CONTRACT. The routine has NO register live-ins — every input is read from RAM — and every
 * hand-off is an idiomatic callee (spawnDigEntity, requestSound9/12, advanceDigCarveObject) that is
 * memory-equivalent to its oracle but returns via plain JS instead of the Z80 stack dance.
 * So the gate is a RAM-only diff via dumpState: pc/SP and value-registers are the dead Z80
 * trace and are NOT compared, and the stack scratch below the entry SP is
 * excluded (the oracle's bracketed calls + tail park return addresses there; the routine's
 * own writes are the reaction object's position/sprite bytes 0x8094-0x8097, the scroll
 * step/window/sub-phase 0x80a1/0x809a/0x809e, the resolved map cell around PLAYER_CELL_PTR,
 * the sprite slot at 0x8224, plus the delegated dig/spawn writes — all far below the stack).
 *
 * REACHABILITY. 0x24f3 is dispatched every frame from the main loop, so the entry is
 * captured live via the dispatch/m.call override hook. Its natural inputs sit on the idle
 * arm (no reaction active), so the four phases, the scroll walk and the seed/clear branches
 * of the edge-collision arm are driven by poking the decision bytes identically on both
 * sides (the crafted-entry method).
 *
 * Checks:
 *   0. HARNESS — capture a real 0x24f3 entry; the oracle run is deterministic.
 *   1. EQUAL (real entry) — idiomatic == oracle over RAM (minus stack) on the natural inputs.
 *   2. EQUAL (skip arm) — a goal crossing / armed dig forces the rest sprite + record.
 *   3. EQUAL (every phase, running + expiry) — the four reaction phases both while the timer
 *      ticks and on the frame it expires (resolve tiles + facing + spawn), incl. the timer==24
 *      sound cue; plus positive checks on the slid position and the ended reaction.
 *   4. EQUAL (scroll arm) — an in-progress scroll over several window/sub-phase seeds, and a
 *      forced stop-tile hit that parks the object and ends the scroll (positive check).
 *   5. EQUAL (edge-collision arm) — every gate of the HAZARD_ACTIVE_COUNT==2 arm: busy sub-systems
 *      pass through, the facing-driven scroll seed, the dig-held/clear scroll-mode branches.
 *   6. TEETH — a genuine logic twin (phase 1 sliding the WRONG way) is CAUGHT at the object's
 *      X, and a dropped live-out (the settled facing code) is CAUGHT at its address.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-24f3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_24f3 as oracle } from "../../translated/loc_24f3.js";
import { advancePlayerLaser as idiomatic } from "../advancePlayerLaser.js";
import { advanceDigCarveObject } from "../advanceDigCarveObject.js";
import { makeMachineFactory } from "../../machine.js";
import { u8 } from "../../../../core/int.js";
import {
  PIT_CROSS_ACTIVE,
  DIG_COLLISION_STATE,
  HAZARD_ACTIVE_COUNT,
  REACTION_STATE,
  REACTION_TIMER,
  REACTION_OBJ_X,
  REACTION_OBJ_Y,
  PLAYER_Y,
  PLAYER_X,
  PLAYER_CELL_PTR,
  EXPECTED_TILE,
  NEXT_TILE,
  PLAYER_FACING,
  PLAYER_ACTIVE,
  BOARD_END_PHASE,
  GOAL_TILE_LATCH,
  IN0_DEBOUNCED,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x24f3;
// Addresses this routine touches that have no names.js name yet.
const REACTION_SPRITE_CODE = 0x8095;
const REACTION_ANIM = 0x8096;
const REACTION_SPRITE_SLOT = 0x8224; // sprite slot 1 (the reaction object's record)
const SCROLL_STEP = 0x80a1;
const LASER_SCAN_PTR = 0x809a;
const SCROLL_SUBPHASE = 0x809e;
const STOP_TILE_TABLE = 0x277a;
// Stack window at the top of The Pit's work RAM; only the part below the entry SP is dead scratch.
const STACK_LO = 0x8380;
const STACK_HI = 0x8400;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async,
// so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- helpers ------------------------------------------------------------------

/** Hook 0x24f3 in a real attract run and clone the machine at its first entry — a genuine
 *  reaction-driver state (valid stack + live object/reaction bytes). */
function captureRealEntry(maxFrames) {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return oracle(mm);
  }]]);
  makeMachine(snapshot).runFrames(maxFrames);
  return entry;
}

/** First differing RAM byte between two machines, EXCLUDING stack scratch below the entry SP. */
function ramDiffExStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: STACK_LO, hi: STACK_HI }, entrySP)(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Clone `entry` and write whichever decision bytes the spec supplies. */
function seed(entry, s = {}) {
  const e = entry.clone();
  const w8 = (addr, v) => { if (v !== undefined) e.mem.write8(addr, v); };
  w8(PIT_CROSS_ACTIVE, s.goalCross);
  w8(DIG_COLLISION_STATE, s.digArm);
  w8(SCROLL_STEP, s.scrollStep);
  w8(HAZARD_ACTIVE_COUNT, s.spawn);
  w8(REACTION_STATE, s.state);
  w8(REACTION_TIMER, s.timer);
  w8(REACTION_ANIM, s.anim);
  w8(EXPECTED_TILE, s.expTile);
  w8(NEXT_TILE, s.nextTile);
  w8(PLAYER_Y, s.objX);
  w8(PLAYER_X, s.objY);
  w8(PLAYER_ACTIVE, s.active);
  w8(BOARD_END_PHASE, s.spawnPhase);
  w8(GOAL_TILE_LATCH, s.goalLatch);
  w8(IN0_DEBOUNCED, s.in0);
  w8(PLAYER_FACING, s.facing);
  w8(SCROLL_SUBPHASE, s.subphase);
  if (s.actorCell !== undefined) e.mem.write16(PLAYER_CELL_PTR, s.actorCell);
  if (s.windowPtr !== undefined) e.mem.write16(LASER_SCAN_PTR, s.windowPtr);
  if (s.plantAt !== undefined) e.mem.write8(s.plantAt, s.plantVal);
  return e;
}

/** Run oracle vs `fn` on identical clones of a seeded state; return the RAM diff + both. */
function compare(entry, s, fn) {
  const base = seed(entry, s);
  const o = base.clone();
  oracle(o);
  const c = base.clone();
  fn(c);
  return { ram: ramDiffExStack(o, c, base.regs.sp), o, c };
}

// A base state that reaches the phase dispatch: no goal/dig owner, no scroll, spawn!=2.
const DISPATCH = { goalCross: 0, digArm: 0, scrollStep: 0, spawn: 1 };
// A valid writable actor cell (video RAM) so the expiry tile writes never fault.
const CELL = 0x9280;

// -- 0. HARNESS ---------------------------------------------------------------

test("HARNESS: a real 0x24f3 entry is captured and the oracle run is deterministic", () => {
  const entry = captureRealEntry(2000);
  assert.ok(entry, "expected 0x24f3 to be dispatched during attract");

  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  assert.equal(ramDiffExStack(a, b, entry.regs.sp), null, "oracle run of 0x24f3 is not deterministic");
  console.log(
    `  HARNESS: captured a real 0x24f3 entry (SP=${hx(entry.regs.sp)}); ` +
      `REACTION_STATE=${entry.mem.read8(REACTION_STATE)} HAZARD_ACTIVE_COUNT=${entry.mem.read8(HAZARD_ACTIVE_COUNT)}; oracle deterministic`,
  );
});

// -- 1. EQUAL on the real captured entry --------------------------------------

test("EQUAL (real entry): advancePlayerLaser == oracle over RAM (minus stack) on the natural inputs", () => {
  const entry = captureRealEntry(2000);
  assert.ok(entry, "need a captured 0x24f3 entry");
  const { ram } = compare(entry, {}, idiomatic);
  assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  console.log("  EQUAL/real: identical over RAM on the natural captured inputs");
});

// -- 2. EQUAL on the skip arm -------------------------------------------------

test("EQUAL (skip arm): a goal crossing / armed dig forces the rest sprite + record", () => {
  const entry = captureRealEntry(2000);
  assert.ok(entry, "need a captured 0x24f3 entry");
  for (const s of [{ goalCross: 1 }, { goalCross: 0, digArm: 1 }]) {
    const { ram } = compare(entry, s, idiomatic);
    assert.equal(ram, null, ram && `${JSON.stringify(s)}: RAM diff at ${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  }
  const c = seed(entry, { goalCross: 1 });
  idiomatic(c);
  assert.equal(c.mem.read8(REACTION_SPRITE_CODE), 9, "skip arm must force the rest sprite code 9");
  console.log("  EQUAL/skip: goal-crossing + armed-dig arms identical; rest sprite forced");
});

// -- 3. EQUAL over every reaction phase, running + expiry ----------------------

test("EQUAL (phases): all four reaction phases match while ticking and on expiry", () => {
  const entry = captureRealEntry(2000);
  assert.ok(entry, "need a captured 0x24f3 entry");

  const cases = [];
  for (const state of [1, 2, 3, 4]) {
    // Running: timer ticks down but does not reach 0 (slide + animate).
    cases.push({ name: `phase ${state} running`, s: { ...DISPATCH, state, timer: 3, anim: 5, objX: 100, objY: 90 } });
    // Running on the sound-cue frame: timer 25 -> 24 was already passed; 24 itself cues.
    cases.push({ name: `phase ${state} sound-cue`, s: { ...DISPATCH, state, timer: 24, anim: 2, objX: 60, objY: 120 } });
    // Expiry: timer 1 -> 0 (resolve tiles + facing + spawn), no spawn slot commit.
    cases.push({ name: `phase ${state} expiry`, s: { ...DISPATCH, state, timer: 1, expTile: 200, nextTile: 150, actorCell: CELL, objX: 80, objY: 80 } });
  }
  // One expiry with an idle spawn slot so spawnDigEntity runs its commit path identically.
  cases.push({ name: "phase 1 expiry, spawn idle", s: { ...DISPATCH, spawn: 0, state: 1, timer: 1, expTile: 200, nextTile: 150, actorCell: CELL, objX: 80, objY: 80 } });

  for (const { name, s } of cases) {
    const { ram } = compare(entry, s, idiomatic);
    assert.equal(ram, null, ram && `${name}: RAM diff at ${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  }

  // Positive: phase 1 running slides the object to PLAYER_Y-8 / PLAYER_X; phase 3 to PLAYER_X+8.
  const p1 = seed(entry, { ...DISPATCH, state: 1, timer: 3, objX: 100, objY: 90 });
  idiomatic(p1);
  assert.equal(p1.mem.read8(REACTION_OBJ_X), u8(100 - 8), "phase 1 must slide the object to PLAYER_Y-8");
  assert.equal(p1.mem.read8(REACTION_OBJ_Y), 90, "phase 1 must place the object at PLAYER_X");
  const p3 = seed(entry, { ...DISPATCH, state: 3, timer: 3, objX: 100, objY: 90 });
  idiomatic(p3);
  assert.equal(p3.mem.read8(REACTION_OBJ_Y), u8(90 + 8), "phase 3 must slide the object to PLAYER_X+8");

  // Positive: expiry ends the reaction and settles to the rest sprite + facing.
  const ex = seed(entry, { ...DISPATCH, state: 2, timer: 1, expTile: 200, nextTile: 150, actorCell: CELL, objX: 80, objY: 80 });
  idiomatic(ex);
  assert.equal(ex.mem.read8(REACTION_STATE), 0, "expiry must end the reaction");
  assert.equal(ex.mem.read8(REACTION_SPRITE_CODE), 9, "expiry must settle to the rest sprite");
  assert.equal(ex.mem.read8(PLAYER_FACING), 50, "phase 2 expiry must publish facing code 50");
  console.log(`  EQUAL/phases: all ${cases.length} phase arms identical; slide + settle + facing verified`);
});

// -- 4. EQUAL over the scroll arm ---------------------------------------------

test("EQUAL (scroll): an in-progress scroll matches, and a stop-tile hit parks the object", () => {
  const entry = captureRealEntry(2000);
  assert.ok(entry, "need a captured 0x24f3 entry");

  // In-progress scroll (bit 3 of the step set): sweep window + sub-phase (both tile-read
  // branches, both directions).
  const cases = [
    { name: "scroll +8, subphase 0", s: { goalCross: 0, digArm: 0, scrollStep: 0x08, windowPtr: 0x9200, subphase: 0 } },
    { name: "scroll +8, subphase 224", s: { goalCross: 0, digArm: 0, scrollStep: 0x08, windowPtr: 0x9260, subphase: 224 } },
    { name: "scroll -8, subphase 96", s: { goalCross: 0, digArm: 0, scrollStep: 0xf8, windowPtr: 0x9180, subphase: 96 } },
    { name: "scroll -8, subphase 160", s: { goalCross: 0, digArm: 0, scrollStep: 0xf8, windowPtr: 0x9300, subphase: 160 } },
  ];
  for (const { name, s } of cases) {
    const { ram } = compare(entry, s, idiomatic);
    assert.equal(ram, null, ram && `${name}: RAM diff at ${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  }

  // Forced stop-tile hit: step +8 moves the window -32 (0x9200 -> 0x91e0), sub-phase 0 reads
  // that cell; plant the stop list's first byte there so both sides find it and end the scroll.
  const stopByte = entry.mem.read8(STOP_TILE_TABLE);
  const hitSeed = { goalCross: 0, digArm: 0, scrollStep: 0x08, windowPtr: 0x9200, subphase: 0, plantAt: 0x91e0, plantVal: stopByte };
  const { ram: hitRam } = compare(entry, hitSeed, idiomatic);
  assert.equal(hitRam, null, hitRam && `scroll hit: RAM diff at ${hx(hitRam.addr)} oracle=${hitRam.a} cand=${hitRam.b}`);
  const hc = seed(entry, hitSeed);
  idiomatic(hc);
  assert.equal(hc.mem.read8(REACTION_OBJ_X), 0, "a stop-tile hit must park the object at 0");
  assert.equal(hc.mem.read8(SCROLL_STEP), 1, "a stop-tile hit must end the scroll (step -> 1)");
  console.log(`  EQUAL/scroll: ${cases.length} in-progress seeds + a forced stop-tile hit identical`);
});

// -- 5. EQUAL over the edge-collision arm -------------------------------------

test("EQUAL (edge collision): every gate of the HAZARD_ACTIVE_COUNT==2 arm matches", () => {
  const entry = captureRealEntry(2000);
  assert.ok(entry, "need a captured 0x24f3 entry");

  const base = { goalCross: 0, digArm: 0, scrollStep: 0, spawn: 2, objX: 90, objY: 90 };
  const IN0_DIG = 0x10; // the dig bit the arm reads
  const cases = [
    { name: "busy: object inactive", s: { ...base, active: 0 } },
    { name: "busy: spawn phase set", s: { ...base, active: 0xff, spawnPhase: 1 } },
    { name: "busy: goal tile latched", s: { ...base, active: 0xff, spawnPhase: 0, goalLatch: 1 } },
    { name: "no scroll, dig not held", s: { ...base, active: 0xff, spawnPhase: 0, goalLatch: 0, in0: 0 } },
    { name: "no scroll, dig held, facing 178 -> seed -8", s: { ...base, active: 0xff, spawnPhase: 0, goalLatch: 0, in0: IN0_DIG, facing: 178 } },
    { name: "no scroll, dig held, facing 51 -> seed +8", s: { ...base, active: 0xff, spawnPhase: 0, goalLatch: 0, in0: IN0_DIG, facing: 51 } },
    { name: "no scroll, dig held, facing 99 -> pass", s: { ...base, active: 0xff, spawnPhase: 0, goalLatch: 0, in0: IN0_DIG, facing: 99 } },
    // A non-zero scroll step with bit 3 clear (0x04) reaches the arm (entry does not scroll).
    { name: "scroll set, dig held -> keep", s: { ...base, active: 0xff, spawnPhase: 0, goalLatch: 0, scrollStep: 0x04, in0: IN0_DIG } },
    { name: "scroll set, dig not held -> clear", s: { ...base, active: 0xff, spawnPhase: 0, goalLatch: 0, scrollStep: 0x04, in0: 0 } },
  ];
  for (const { name, s } of cases) {
    const { ram } = compare(entry, s, idiomatic);
    assert.equal(ram, null, ram && `${name}: RAM diff at ${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  }

  // Positive: the facing-driven seed runs seedScroll (which loads the 3-frame animation
  // counter — a side-effect nothing downstream overwrites; the step/sprite it also sets can
  // be immediately reset by the stop-tile check in the same frame, so they are not asserted).
  const seedNeg = seed(entry, { ...base, active: 0xff, spawnPhase: 0, goalLatch: 0, in0: IN0_DIG, facing: 178 });
  idiomatic(seedNeg);
  assert.equal(seedNeg.mem.read8(REACTION_ANIM), 3, "facing 178 must seed a scroll (loads the animation counter)");
  // Positive: dig-not-held clears an existing scroll mode.
  const clear = seed(entry, { ...base, active: 0xff, spawnPhase: 0, goalLatch: 0, scrollStep: 0x04, in0: 0 });
  idiomatic(clear);
  assert.equal(clear.mem.read8(SCROLL_STEP), 0, "dig not held must clear the scroll mode");
  console.log(`  EQUAL/edge: all ${cases.length} edge-collision gates identical; seed + clear verified`);
});

// -- 6. TEETH -----------------------------------------------------------------

/**
 * Broken twin: faithful for a running phase-1 state, but slides the reaction object the
 * WRONG way (PLAYER_Y+8 instead of the correct PLAYER_Y-8). Builds the record + tail exactly so
 * the ONLY divergence is the object's X.
 */
function twinPhase1WrongMove(m) {
  const { mem8 } = m;
  mem8[REACTION_SPRITE_CODE] = 168;
  const ticked = u8(mem8[REACTION_TIMER] - 1);
  mem8[REACTION_TIMER] = ticked;
  mem8[REACTION_OBJ_X] = mem8[PLAYER_Y] + 8; // BUG: phase 1 slides -8, not +8
  mem8[REACTION_OBJ_Y] = mem8[PLAYER_X];
  mem8[REACTION_ANIM] = (mem8[REACTION_ANIM] - 1) & 7;
  const bias = mem8[0x8051];
  mem8[REACTION_SPRITE_SLOT] = mem8[REACTION_OBJ_X] - bias;
  mem8[REACTION_SPRITE_SLOT + 1] = mem8[REACTION_SPRITE_CODE];
  mem8[REACTION_SPRITE_SLOT + 2] = mem8[REACTION_ANIM];
  mem8[REACTION_SPRITE_SLOT + 3] = mem8[REACTION_OBJ_Y] + bias;
  return advanceDigCarveObject(m);
}

test("TEETH (wrong-way slide): a phase-1 twin sliding the object the wrong way is CAUGHT", () => {
  const entry = captureRealEntry(2000);
  assert.ok(entry, "need a captured 0x24f3 entry for the teeth check");

  const s = { ...DISPATCH, state: 1, timer: 3, anim: 5, objX: 100, objY: 90 };
  const { ram } = compare(entry, s, twinPhase1WrongMove);
  assert.ok(ram, "the gate FAILED to catch the wrong-way slide — it proves nothing");
  assert.equal(ram.addr, REACTION_OBJ_X, `teeth caught ${hx(ram.addr)} (expected the object X ${hx(REACTION_OBJ_X)})`);
  assert.equal(compare(entry, s, idiomatic).ram, null, "idiomatic must PASS the input the twin fails");
  console.log(`  TEETH/slide: wrong-way slide caught at ${hx(ram.addr)} (oracle=${ram.a} twin=${ram.b})`);
});

test("TEETH (dropped facing): corrupting the settled facing code on expiry is CAUGHT", () => {
  const entry = captureRealEntry(2000);
  assert.ok(entry, "need a captured 0x24f3 entry for the teeth check");

  // A phase-2 expiry settles PLAYER_FACING to the facing; a twin that corrupts it is caught there.
  const s = { ...DISPATCH, state: 2, timer: 1, expTile: 200, nextTile: 150, actorCell: CELL, objX: 80, objY: 80 };
  const { ram } = compare(entry, s, (m) => { idiomatic(m); m.mem.write8(PLAYER_FACING, m.mem.read8(PLAYER_FACING) ^ 0xff); });
  assert.ok(ram, "the gate FAILED to catch the corrupted facing — it proves nothing");
  assert.equal(ram.addr, PLAYER_FACING, `teeth caught ${hx(ram.addr)} (expected the facing ${hx(PLAYER_FACING)})`);
  console.log(`  TEETH/facing: corrupted facing caught at ${hx(ram.addr)} (oracle=${ram.a} twin=${ram.b})`);
});
