// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for resolveActorTerrainStep (ROM 0x1704) — resolve a moving actor's horizontal step
 * against the terrain it is entering: collect a loot tile, hold against a wall, bump-react on a
 * blocked diagonal, or walk on.
 *
 * Given the actor's tile-cell pointer (register live-in, surfaced as tilePtr) and its move
 * direction (moveDir), it writes the whole outcome of the step to work RAM and then hands off to
 * either walkActor (walk on) or stageObjectSpriteRecord (hold / rebuild in place) — both already
 * idiomatic, so resolveActorTerrainStep calls them directly; no register hand-off survives. Its declared
 * LIVE-OUT is MEMORY-ONLY: the pickup counters (0x8081/0x8082), the score/digits/sound on a
 * collect, the blanked cell, the bump-reaction state/timer/sprite (0x80a2/0x80a4/0x8069), the
 * walk position/frame, and the display record.
 *
 * THE STACK SCRATCH. The comparison runs the still-frozen ORACLE resolveActorTerrainStep, whose tail-jumps and
 * loot-award calls thread through the stack (push16 / m.call / the sound + score sub-calls save
 * register pairs), against the stack-free idiomatic handler chain. The two therefore leave
 * different dead bytes just below the entry stack pointer (The Pit's stack is real diffed work
 * RAM, entry SP 0x83fd here) — classic dead scratch, overwritten by the caller's next push before
 * anything reads it. The diff excludes exactly that [SP-N, SP) window and compares everything else
 * byte-for-byte; every real output sits far below (0x8020..0x80bd plus video RAM), so the window
 * can never hide one — the teeth confirm it. Registers/flags/pc/SP are excluded (the honest-
 * signature contract); the two register live-ins default to the registers so a no-arg call
 * reproduces the oracle exactly.
 *
 * Checks:
 *   0. IDENTITY (harness) — oracle vs oracle on a captured attract entry; proves the
 *      capture/clone/replay harness reaches 0x1704 in a real run.
 *   1. EQUAL (real dispatches) — every captured attract dispatch leaves identical state outside
 *      the stack scratch. Attract exercises the wall-block, bump-react and walk-on paths.
 *   2. EQUAL (crafted loot collect) — force the collect paths attract never aligns onto: tile 58
 *      (+10) and tiles 59..61 (+20) across latch-open / first-open-guard-clear / guard-set.
 *   3. EQUAL (crafted bump-react) — a real grid-step entry poked to a walkable-band tile whose
 *      direction table mismatches, arming the bump reaction; both arms agree.
 *   4. NON-VACUOUS — a tile-58 collect actually bumps the counter, blanks the cell, queues the
 *      sound and advances the walk (a no-op twin cannot pass), and agrees with the oracle.
 *   5. TEETH (loot count) — a twin that fails to bump the pickup counter is CAUGHT at 0x8081.
 *   6. TEETH (bump reaction) — on an arming entry, a twin that skips the reaction sprite is CAUGHT
 *      at PLAYER_FACING.
 *   7. TEETH (walk) — on a walk entry, a twin that corrupts the walk position is CAUGHT at PLAYER_Y.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-1704.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1704 as oracle } from "../../translated/loc_1704.js";
import { resolveActorTerrainStep as idiomatic } from "../resolveActorTerrainStep.js";
import { makeMachineFactory } from "../../machine.js";
import { PLAYER_Y, PLAYER_FACING, REACTION_STATE, PLAYER_CELL_PTR, SOUND_HEAD, SOUND_RING } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x1704;
const STACK_SCRATCH = 32; // dead bytes the oracle's tail-jumps + loot-award sub-calls park below
// entry SP (measured a handful; 32 leaves ample margin, and no real work-RAM output lives in 0x83xx)
const FIRST_LOOT_COUNT = 0x8081; // tile-58 pickup counter
const SECOND_LOOT_COUNT = 0x8082; // tile-59..61 pickup counter
const SECOND_LOOT_LATCH = 0x8078; // one-shot latch that opens the +20 loot
const SPAWN_GUARD = 0x80bd; // first-open guard for the +20 loot
const TWENTY_SOUND = 16 | 0x80; // 0x90 — the score sound (command 16), pending
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async, so build
// the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Hook 0x1704 in a real attract run and clone the machine at up to K real dispatches. The wrapper
 * snapshots the entry state, then runs the oracle so the host game proceeds undisturbed. The
 * collision arm reaches it repeatedly during the attract demo.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  makeMachine(snapshot).runFrames(maxFrames);
  return caps;
}

/**
 * First differing state byte between two machines, EXCLUDING the dead stack scratch the oracle's
 * stack-threaded tails park just below the entry stack pointer (which the stack-free idiomatic
 * handler chain does not reproduce). Null when otherwise identical.
 */
function stateDiffOutsideStack(a, b, entrySP) {
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

/** Run oracle and candidate on independent clones of `entry`; return the first differing state
 *  byte outside the stack scratch (or null). The idiomatic live-ins default to the registers, so
 *  a no-arg call matches the oracle exactly. */
function stateDiff(entry, fn) {
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  fn(b);
  return stateDiffOutsideStack(a, b, sp);
}

/** Classify what the oracle does with an entry, so tests can pick a real WALK / ARM / STAGE state. */
function outcome(entry) {
  const c = entry.clone();
  const objxBefore = c.mem.read8(PLAYER_Y);
  oracle(c);
  if (c.mem.read8(PLAYER_FACING) === 0x35 && c.mem.read8(REACTION_STATE) === 2) return "ARM";
  if (c.mem.read8(PLAYER_Y) !== objxBefore) return "WALK";
  return "STAGE";
}

/** A captured on-grid entry (move direction low bits clear) with the tile under the actor poked to
 *  `tile`, plus optional latch/guard pokes — the base for crafting the loot-collect arms. */
function craftOnGrid(base, tile, { latch, guard } = {}) {
  const e = base.clone();
  e.regs.d = e.regs.d & ~7; // force an on-grid step
  e.mem.write8(e.regs.ix & 0xffff, tile);
  if (latch !== undefined) e.mem.write8(SECOND_LOOT_LATCH, latch);
  if (guard !== undefined) e.mem.write8(SPAWN_GUARD, guard);
  return e;
}

// -- 0. IDENTITY (harness sanity) --------------------------------------------

test("IDENTITY: the harness reaches 0x1704 in attract and oracle-vs-oracle is EQUAL", () => {
  const [entry] = captureDispatches(1, 4000);
  assert.ok(entry, "expected at least one real 0x1704 dispatch during attract");
  assert.equal(stateDiff(entry, oracle), null, "oracle vs oracle must be identical");
  console.log(
    `  IDENTITY: captured a real 0x1704 dispatch (SP=${hx(entry.regs.sp)}, ` +
      `D=${hx(entry.regs.d)}); oracle vs oracle -> EQUAL`,
  );
});

// -- 1. EQUAL over real captured attract dispatches --------------------------

test("EQUAL: resolveActorTerrainStep leaves the same state as the oracle over every real attract dispatch", () => {
  const caps = captureDispatches(500, 4000);
  assert.ok(caps.length >= 1, "expected at least one captured attract dispatch");

  const outcomes = {};
  for (const cap of caps) {
    outcomes[outcome(cap)] = (outcomes[outcome(cap)] || 0) + 1;
    const d = stateDiff(cap, idiomatic);
    assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical to the oracle; outcomes ${JSON.stringify(outcomes)}`,
  );
});

// -- 2. EQUAL over the crafted loot-collect arms attract never reaches --------

test("EQUAL (crafted loot collect): the +10 and gated +20 collect paths match the oracle", () => {
  const caps = captureDispatches(200, 4000);
  const base = caps.find((c) => (c.regs.d & 7) === 0);
  assert.ok(base, "need a real on-grid capture to craft the loot arms from");

  const arms = [
    ["tile 58 -> +10", 58, {}],
    ["tile 59, latch open -> +20", 59, { latch: 1 }],
    ["tile 60, first open (guard clear) -> +20, arm latch", 60, { latch: 0, guard: 0 }],
    ["tile 61, first open (guard set) -> decline", 61, { latch: 0, guard: 1 }],
    ["tile 59, latch open, guard set -> +20", 59, { latch: 1, guard: 1 }],
  ];

  for (const [name, tile, gates] of arms) {
    const d = stateDiff(craftOnGrid(base, tile, gates), idiomatic);
    assert.equal(d, null, d && `[${name}] state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(`  EQUAL/collect: ${arms.length} loot arms identical to the oracle`);
});

// -- 3. EQUAL on a crafted bump-react entry ----------------------------------

test("EQUAL (crafted bump-react): a grid-step wall mismatch arms the reaction, identical to the oracle", () => {
  const caps = captureDispatches(200, 4000);
  const base = caps.find((c) => (c.regs.d & 7) === 0);
  assert.ok(base, "need a real on-grid capture");

  // A walkable-band tile that mismatches its direction table on a grid step arms the reaction.
  const entry = craftOnGrid(base, 0x74);
  assert.equal(outcome(entry), "ARM", "precondition: the crafted entry must drive the bump reaction");

  const d = stateDiff(entry, idiomatic);
  assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);

  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(REACTION_STATE), 2, "reaction state not armed");
  assert.equal(c.mem.read8(PLAYER_FACING), 0x35, "bump sprite not set");
  console.log("  EQUAL/bump: reaction armed (state 2, sprite 0x35); identical to the oracle");
});

// -- 4. NON-VACUOUS: a tile-58 collect really produces its outputs -----------

test("NON-VACUOUS: a tile-58 collect bumps the counter, blanks the cell, queues sound, and walks", () => {
  const caps = captureDispatches(200, 4000);
  const base = caps.find((c) => (c.regs.d & 7) === 0);
  assert.ok(base, "need a real on-grid capture");
  const entry = craftOnGrid(base, 58);

  const head = entry.mem.read8(SOUND_HEAD);
  const count = entry.mem.read8(FIRST_LOOT_COUNT);
  const cell = entry.mem.read16(PLAYER_CELL_PTR);
  const objxBefore = entry.mem.read8(PLAYER_Y);

  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(FIRST_LOOT_COUNT), (count + 1) & 0xff, "the pickup counter did not advance");
  assert.equal(c.mem.read8(cell), 112, "the collected cell was not blanked to tile 112");
  assert.equal(c.mem.read8(SOUND_HEAD), (head + 1) % 8, "the sound write pointer did not advance");
  assert.equal(c.mem.read8(SOUND_RING + head), TWENTY_SOUND, "the score sound was not queued");
  assert.notEqual(c.mem.read8(PLAYER_Y), objxBefore, "the actor did not walk on after collecting");

  assert.equal(stateDiff(entry, idiomatic), null, "the collect entry must also match the oracle");
  console.log(
    `  NON-VACUOUS: counter ${count}->${(count + 1) & 0xff}, cell ${hx(cell)}=112, sound ring[${head}]=${hx(TWENTY_SOUND)}, walked`,
  );
});

// -- 5. TEETH (loot count): a missed pickup-counter bump is CAUGHT ------------

/** Broken twin: does the real work, then undoes the pickup-counter bump. */
function twinNoCount(m) {
  idiomatic(m);
  m.mem.write8(FIRST_LOOT_COUNT, (m.mem.read8(FIRST_LOOT_COUNT) - 1) & 0xff); // BUG: unbump
}

test("TEETH (loot count): a twin that fails to bump the pickup counter is CAUGHT at 0x8081", () => {
  const caps = captureDispatches(200, 4000);
  const base = caps.find((c) => (c.regs.d & 7) === 0);
  const entry = craftOnGrid(base, 58); // the +10 collect bumps 0x8081

  const d = stateDiff(entry, twinNoCount);
  assert.notEqual(d, null, "the gate FAILED to catch a missed counter bump — it proves nothing");
  assert.equal(d.addr, FIRST_LOOT_COUNT, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(FIRST_LOOT_COUNT)})`);
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/count: missed-bump twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 6. TEETH (bump reaction): a skipped reaction sprite is CAUGHT ------------

/** Broken twin: does the real work, then reverts the bump-reaction sprite. */
function makeTwinNoBumpSprite(before) {
  return (m) => {
    idiomatic(m);
    m.mem.write8(PLAYER_FACING, before);
  };
}

test("TEETH (bump reaction): on an arming entry, a twin that skips the reaction sprite is CAUGHT at PLAYER_FACING", () => {
  const caps = captureDispatches(200, 4000);
  const base = caps.find((c) => (c.regs.d & 7) === 0);
  const entry = craftOnGrid(base, 0x74);
  assert.equal(outcome(entry), "ARM", "precondition: the crafted entry must drive the bump reaction");
  const before = entry.mem.read8(PLAYER_FACING);
  assert.notEqual(before, 0x35, "precondition: the sprite must start un-armed for this teeth check");

  const d = stateDiff(entry, makeTwinNoBumpSprite(before));
  assert.notEqual(d, null, "the gate FAILED to catch a skipped bump sprite — it proves nothing");
  assert.equal(d.addr, PLAYER_FACING, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(PLAYER_FACING)})`);
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/bump: skipped-sprite twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 7. TEETH (walk): a corrupted walk position is CAUGHT --------------------

/** Broken twin: does the real work, then corrupts the walk position accumulator. */
function twinCorruptWalk(m) {
  idiomatic(m);
  m.mem.write8(PLAYER_Y, m.mem.read8(PLAYER_Y) ^ 0xff);
}

test("TEETH (walk): on a walk entry, a twin that corrupts the walk position is CAUGHT at PLAYER_Y", () => {
  const caps = captureDispatches(500, 4000);
  const entry = caps.find((c) => outcome(c) === "WALK");
  assert.ok(entry, "expected at least one real walk dispatch");

  const d = stateDiff(entry, twinCorruptWalk);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted walk — it proves nothing");
  assert.equal(d.addr, PLAYER_Y, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(PLAYER_Y)})`);
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/walk: corrupted-walk twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
