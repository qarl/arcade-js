// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for collectAlignedLootElseResolveTile (ROM 0x1515) — resolve the tile the object is sitting on:
 * collect a loot tile it has landed squarely on (score + remove it), otherwise hand the step to
 * the terrain resolver resolveObjectTerrainStep.
 *
 * Given the object's biased tile column (column; low 3 bits = the sub-tile offset) and its
 * tile-cell pointer (cellPtr; the tile under the object is at cellPtr, the cell ahead is the next
 * byte), it records the under tile as the saved-current / expected-tile, then either collects loot
 * (tile 58 -> +10; tiles 59..61 -> +20, gated by a one-shot latch and a dig-spawn guard) or, for
 * every non-collect case, delegates to resolveObjectTerrainStep. Its declared LIVE-OUT is MEMORY-ONLY.
 *
 * STACK-TOP WINDOW. Unlike resolveObjectTerrainStep (all tail-jumps, no pushing CALL), collectAlignedLootElseResolveTile's two loot awards
 * reach the score adder through the oracle's ordinary calls (0x467b / 0x4683), which push a return
 * address the stack-free idiomatic never writes. Measured: the oracle parks at most a handful of
 * dead bytes just below the entry stack pointer (SP=0x83fb, lowest write 0x83f3). So the diff
 * excludes a small [SP-16, SP) stack-top window — well above the real work RAM this routine writes
 * (its highest is the sprite record at 0x8223) — and compares everything else byte-for-byte. The
 * terrain-delegation paths push nothing, so they are compared with the window in force but never
 * touch it.
 *
 * CRAFTED ENTRIES. Attract never digs an object into this case (measured: 0 dispatches in 4000
 * frames), so the capture/replay harness cannot hook 0x1515 directly. Per the crafted-entry method
 * the gate runs it from REAL captured attract clones (valid stack, video RAM, object record) with
 * its inputs poked — and because the behaviour depends only on the under tile and the low 3 bits of
 * the column, the under tile is swept exhaustively across every sub-offset.
 *
 * Checks:
 *   0. HARNESS — confirm attract never dispatches 0x1515, and oracle-vs-oracle on a crafted entry
 *      is deterministic (the capture/clone/replay plumbing works on a real attract clone).
 *   1. EQUAL (real attract clones) — a representative terrain step over real captured states.
 *   2. EQUAL (under-tile sweep) — every under-tile id 0..255 across every sub-offset (aligned +
 *      off-grid): both loot kinds when aligned, and the terrain delegation everywhere else.
 *   3. EQUAL (loot paths) — tile 58; tiles 59..61 over the latch-armed / arm-now / guard-blocked
 *      branches; each matches the oracle, and the pickup count, latch, and blanked cell land as
 *      expected (or, when blocked, do not).
 *   4. NON-VACUOUS — a +10 collect really bumps the count and blanks the cell; a no-op twin cannot
 *      pass, and the real routine agrees with the oracle.
 *   5. TEETH (pickup count) — a twin that skips the +10 count bump is CAUGHT at CRYSTAL_COUNT.
 *   6. TEETH (blank cell) — a twin that skips blanking the collected cell is CAUGHT at that cell.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-1515.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1515 as oracle } from "../../translated/loc_1515.js";
import { collectAlignedLootElseResolveTile as idiomatic } from "../collectAlignedLootElseResolveTile.js";
import { makeMachineFactory } from "../../machine.js";
import {
  CUR_TILE,
  EXPECTED_TILE,
  CRYSTAL_COUNT,
  DIAMOND_COUNT,
  HAZARD_ACTIVE_COUNT,
  PLAYER_CELL_PTR,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x1515;
const CELL = 0x8700; // isolated high work-RAM cell IX points at (tile under object; ahead at CELL+1)
const SECOND_LOOT_LATCH = 0x8078; // one-shot latch opening the +20 loot (kept hex in the routine)
const BLANK_TILE = 112; // the empty-cell tile stamped over a collected pickup
const STACK_WINDOW = 16; // dead stack-top bytes below entry SP the oracle's award CALLs park
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async, so build the
// factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Real attract machine states: run the game and clone it at a spread of frames. Each clone is a
 * genuine in-play machine (real RAM, valid stack, video RAM) independent of the source run — a
 * faithful base for the crafted steps 0x1515 is never naturally reached with.
 */
function captureStates(count, stride, startFrame) {
  const m = makeMachine();
  m.runFrames(startFrame);
  const caps = [];
  for (let i = 0; i < count; i++) {
    m.runFrames(stride);
    caps.push(m.clone());
  }
  return caps;
}

/**
 * Craft an entry from a real base: point the object's cell pointer at an isolated cell, set the
 * tile under it (underTile) and the tile one step ahead (aheadTile), the column, and — so the
 * collect path's cell-blank is deterministic — the cell-pointer work-RAM word PLAYER_CELL_PTR.
 */
function craft(base, { underTile, column, aheadTile = 0 }) {
  const e = base.clone();
  e.regs.d = column;
  e.regs.ix = CELL;
  e.mem.write8(CELL, underTile);
  e.mem.write8((CELL + 1) & 0xffff, aheadTile);
  e.mem.write8(PLAYER_CELL_PTR, CELL & 0xff);
  e.mem.write8((PLAYER_CELL_PTR + 1) & 0xffff, (CELL >> 8) & 0xff);
  return e;
}

/**
 * Run oracle and candidate on independent clones of `entry`; return the first differing RAM byte
 * OUTSIDE the dead stack-top window [SP-STACK_WINDOW, SP) (which the oracle's award CALLs park and
 * the stack-free idiomatic never writes), or null. Registers/flags/pc/SP are the honest-signature
 * dead live-out and never compared; the idiomatic live-ins default to the registers.
 */
function ramDiff(entry, fn) {
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  fn(b);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: sp - STACK_WINDOW, hi: sp }, sp)(addr)) continue; // dead stack-top scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

// -- 0. HARNESS: attract never dispatches 0x1515; oracle-vs-oracle is deterministic --------------

test("HARNESS: 0x1515 is never dispatched in attract, and oracle-vs-oracle on a crafted entry is EQUAL", () => {
  let dispatched = 0;
  const probe = new Map([[TARGET, (mm) => { dispatched++; return oracle(mm); }]]);
  makeMachine(probe).runFrames(4000);
  assert.equal(dispatched, 0, `expected 0x1515 to be unreached in attract, saw ${dispatched} dispatches`);

  const [base] = captureStates(1, 1, 300);
  const entry = craft(base, { underTile: 0x72, column: 0, aheadTile: 0x74 });
  assert.equal(ramDiff(entry, oracle), null, "oracle vs oracle must be identical");
  console.log(`  HARNESS: 0x1515 unreached in attract (crafted-entry gate); oracle-vs-oracle EQUAL (SP=${hx(base.regs.sp)})`);
});

// -- 1. EQUAL over real captured attract clones --------------------------------------------------

test("EQUAL: collectAlignedLootElseResolveTile leaves the same RAM as the oracle over real attract clones", () => {
  const caps = captureStates(10, 90, 120);
  assert.ok(caps.length >= 1, "expected at least one captured attract state");
  for (const cap of caps) {
    // An off-grid step over a pushable under tile with a pushable tile ahead (terrain delegation).
    const d = ramDiff(craft(cap, { underTile: 0x72, column: 3, aheadTile: 0x74 }), idiomatic);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(`  EQUAL/real: ${caps.length} real attract clones — RAM identical to the oracle`);
});

// -- 2. EQUAL over the full under-tile sweep (all 256 ids x every sub-offset) ---------------------

test("EQUAL (under-tile sweep): every under-tile id across every sub-offset matches the oracle", () => {
  const [base] = captureStates(1, 1, 200);
  // 0 and 0x28 are grid-aligned (collect eligible); 1..7 exhaust the off-grid sub-offsets; two
  // high-bit off-grid columns for sanity.
  const columns = [0, 1, 2, 3, 4, 5, 6, 7, 0x28, 0x2c, 0xff];
  let n = 0;
  for (let underTile = 0; underTile < 256; underTile++) {
    for (const column of columns) {
      const d = ramDiff(craft(base, { underTile, column, aheadTile: 0x74 }), idiomatic);
      assert.equal(d, null, d && `under=${hx(underTile)} col=${hx(column)}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
      n++;
    }
  }
  console.log(`  EQUAL/under: ${n} (under-tile, column) combinations — RAM identical (all 256 ids)`);
});

// -- 3. EQUAL over the loot-collect branches -----------------------------------------------------

test("EQUAL (loot paths): tile 58 and tiles 59..61 over latch/guard all match the oracle", () => {
  const [base] = captureStates(1, 1, 240);

  // Tile 58 (aligned): +10, count it, blank the cell.
  {
    const e = craft(base, { underTile: 58, column: 0 });
    const before = e.mem.read8(CRYSTAL_COUNT);
    assert.equal(ramDiff(e, idiomatic), null, "tile 58 collect must match the oracle");
    const c = e.clone();
    idiomatic(c);
    assert.equal(c.mem.read8(CRYSTAL_COUNT), (before + 1) & 0xff, "the +10 pickup count did not bump");
    assert.equal(c.mem.read8(CELL), BLANK_TILE, "the collected cell was not blanked");
  }

  // Tiles 59..61, latch already armed (0x8078 != 0): +20 regardless of the guard.
  for (const tile of [59, 60, 61]) {
    const e = craft(base, { underTile: tile, column: 0 });
    e.mem.write8(SECOND_LOOT_LATCH, 1);
    e.mem.write8(HAZARD_ACTIVE_COUNT, 0x55); // guard set — but the armed latch awards anyway
    const before = e.mem.read8(DIAMOND_COUNT);
    assert.equal(ramDiff(e, idiomatic), null, `tile ${tile} (latch armed) must match the oracle`);
    const c = e.clone();
    idiomatic(c);
    assert.equal(c.mem.read8(DIAMOND_COUNT), (before + 1) & 0xff, `tile ${tile}: the +20 pickup count did not bump`);
    assert.equal(c.mem.read8(CELL), BLANK_TILE, `tile ${tile}: the collected cell was not blanked`);
  }

  // Tiles 59..61, latch clear + guard clear: arm the latch and award.
  for (const tile of [59, 60, 61]) {
    const e = craft(base, { underTile: tile, column: 0 });
    e.mem.write8(SECOND_LOOT_LATCH, 0);
    e.mem.write8(HAZARD_ACTIVE_COUNT, 0);
    const before = e.mem.read8(DIAMOND_COUNT);
    assert.equal(ramDiff(e, idiomatic), null, `tile ${tile} (arm now) must match the oracle`);
    const c = e.clone();
    idiomatic(c);
    assert.equal(c.mem.read8(SECOND_LOOT_LATCH), 1, `tile ${tile}: the one-shot latch was not armed`);
    assert.equal(c.mem.read8(DIAMOND_COUNT), (before + 1) & 0xff, `tile ${tile}: the +20 pickup count did not bump`);
    assert.equal(c.mem.read8(CELL), BLANK_TILE, `tile ${tile}: the collected cell was not blanked`);
  }

  // Tiles 59..61, latch clear + guard SET: the first arming is blocked -> plain terrain step, no
  // collect (the cell keeps its tile, the count holds).
  for (const tile of [59, 60, 61]) {
    const e = craft(base, { underTile: tile, column: 0 });
    e.mem.write8(SECOND_LOOT_LATCH, 0);
    e.mem.write8(HAZARD_ACTIVE_COUNT, 0x55);
    const before = e.mem.read8(DIAMOND_COUNT);
    assert.equal(ramDiff(e, idiomatic), null, `tile ${tile} (guard blocked) must match the oracle`);
    const c = e.clone();
    idiomatic(c);
    assert.equal(c.mem.read8(CELL), tile, `tile ${tile}: a guard-blocked tile must not be blanked`);
    assert.equal(c.mem.read8(DIAMOND_COUNT), before, `tile ${tile}: a guard-blocked tile must not score`);
  }

  console.log("  EQUAL/loot: tile 58 (+10) and tiles 59..61 (+20 armed / arm-now / guard-blocked) all match; counts, latch, blank as expected");
});

// -- 4. NON-VACUOUS: a +10 collect really bumps the count and blanks the cell ---------------------

test("NON-VACUOUS: a +10 collect bumps the count and blanks the cell; a no-op twin cannot pass", () => {
  const [base] = captureStates(1, 1, 260);
  const e = craft(base, { underTile: 58, column: 0 });

  // A no-op twin (does nothing) must be caught — proves the entry actually changes RAM.
  const noop = ramDiff(e, () => {});
  assert.notEqual(noop, null, "a no-op twin passed — the collect entry writes nothing, so the gate is vacuous");

  assert.equal(ramDiff(e, idiomatic), null, "the +10 collect must match the oracle");
  console.log(`  NON-VACUOUS: no-op twin caught at ${hx(noop.addr)}; real routine matches the oracle`);
});

// -- 5. TEETH (pickup count): a skipped +10 count bump is CAUGHT ----------------------------------

/** Broken twin: does the real work, then reverts the +10 pickup count. */
function twinNoCountBump(m) {
  const before = m.mem.read8(CRYSTAL_COUNT);
  idiomatic(m);
  m.mem.write8(CRYSTAL_COUNT, before); // BUG: undo the count bump
}

test("TEETH (pickup count): a twin that skips the +10 count bump is CAUGHT at CRYSTAL_COUNT", () => {
  const [base] = captureStates(1, 1, 280);
  const entry = craft(base, { underTile: 58, column: 0 });

  const d = ramDiff(entry, twinNoCountBump);
  assert.notEqual(d, null, "the gate FAILED to catch a dropped pickup count — it proves nothing");
  assert.equal(d.addr, CRYSTAL_COUNT, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(CRYSTAL_COUNT)})`);
  assert.equal(ramDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/count: dropped +10 count caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 6. TEETH (blank cell): a skipped cell blank is CAUGHT ----------------------------------------

/** Broken twin: does the real work, then restores the collected tile (never blanks the cell). */
function twinNoBlank(m) {
  const before = m.mem.read8(CELL);
  idiomatic(m);
  m.mem.write8(CELL, before); // BUG: un-blank the collected cell
}

test("TEETH (blank cell): a twin that skips blanking the collected cell is CAUGHT at that cell", () => {
  const [base] = captureStates(1, 1, 300);
  const entry = craft(base, { underTile: 58, column: 0 });

  const d = ramDiff(entry, twinNoBlank);
  assert.notEqual(d, null, "the gate FAILED to catch an un-blanked cell — it proves nothing");
  assert.equal(d.addr, CELL, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(CELL)})`);
  assert.equal(ramDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/blank: un-blanked cell caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
