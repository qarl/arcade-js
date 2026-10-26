// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for advanceDigTarget (ROM 0x2d06) — advance the dig target one step and
 * route on the tile it now covers: embed it into the terrain on solid ground, else re-stage it.
 *
 * The routine advances the target's position (HAZARD_Y += 1), builds the video-RAM cell it now
 * covers (row from HAZARD_X, column from the advanced position), leaves that cell as the live carve
 * cursor (0x80af), and reads the tile a fixed step ahead of it. Three "solid" codes (42/43/65) route
 * to the embed continuation landDigTarget — the idiomatic routine, called with the cell as an argument —
 * which stamps the wall tile into that cell, requests the dig sound, and resets the target's small
 * state block; anything else routes to loc_2bd3, still the frozen ORACLE record builder, which
 * rebuilds the target's four-byte sprite record. A wrong advance, cell, or route diverges the
 * resulting RAM. Declared LIVE-OUT is memory-only (the cell crosses the embed boundary as an
 * argument, not a register), so the diff is RAM-only.
 *
 * CRAFTED ENTRY. The attract demo never digs, so 0x2d06 is never dispatched and cannot be captured
 * directly. Per the crafted-entry method the gate seeds from a REAL captured attract state (cloned at
 * a routine that IS reached, loc_3dae) — a valid machine with real video RAM and a live stack — then
 * pokes only the inputs this routine reads: the target coordinates and the probed tile (stamped into
 * the exact cell the geometry lands on). The three axes that shape the output are then swept: the
 * whole tile domain (0..255, pinning the embed-vs-continue boundary), and the target's position
 * across both axes (0..255, pinning the row/column/advance arithmetic incl. the byte wraps).
 *
 * THE STACK SCRATCH. The still-oracle record-builder tail (loc_2bd3 → loc_2f71) and the embed path's
 * dig-sound enqueue save and restore register pairs on the stack, and the oracle leaves its
 * arithmetic in those registers while the stack-free idiomatic path does not — so a few dead bytes
 * just below the entry stack pointer differ (The Pit's stack is real diffed work RAM, ~0x83f7 here).
 * Classic dead scratch, restored before anything reads it. The diff excludes exactly that [SP-N, SP)
 * window and compares everything else byte-for-byte; every real output lives far below the stack
 * (0x80a9..0x80ac, 0x80af plus the sprite record at 0x8228 and video RAM), so the window can hide
 * none — the teeth confirm it. Registers/flags/pc/SP are excluded per the honest-signature contract.
 *
 * Checks:
 *   0. IDENTITY (harness) — oracle vs oracle on a crafted entry is EQUAL (capture/replay works and
 *      the whole still-oracle cascade is deterministic).
 *   1. EQUAL (tile sweep 0..255) — for every possible tile ahead, advanceDigTarget leaves the same
 *      state as the oracle; the sweep spans both the embed route (3 codes) and the continue route.
 *   2. EQUAL (position sweep, both axes) — sweeping the advanced axis and the row axis 0..255 with a
 *      passable tile, every advance/cell is identical, including the top-of-range byte wraps.
 *   3. NON-VACUOUS — a crafted entry actually advances HAZARD_Y and writes the carve cursor (a no-op
 *      twin cannot pass), and agrees with the oracle on both routes.
 *   4. TEETH (advance) — a twin with the wrong advanced position is CAUGHT at HAZARD_Y.
 *   5. TEETH (cursor) — a twin with the wrong carve cursor is CAUGHT at 0x80af.
 *   6. TEETH (route) — a twin that never embeds is CAUGHT on a solid-tile entry (the embed path's
 *      dig-sound request + state reset are all missing).
 *   7. TEETH (embed cell) — a twin that hands the embed continuation the wrong cell is CAUGHT in
 *      video RAM (the wall stamp lands in the wrong cell), proving the cell argument is exercised.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-2d06.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2d06 as oracle } from "../../translated/loc_2d06.js";
import { advanceDigTarget as idiomatic } from "../advanceDigTarget.js";
import { landDigTarget } from "../landDigTarget.js";
import { loc_3dae as captureRoutine } from "../../translated/loc_3dae.js";
import { makeMachineFactory } from "../../machine.js";
import { HAZARD_X, HAZARD_Y } from "../names.js";
import { u8 } from "../../../../core/int.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const CAPTURE_AT = 0x3dae; // a routine reached in attract — seeds a valid machine to craft from
const CARVE_CURSOR = 0x80af; // the live carve cursor this routine stores (no names.js name yet)
const VRAM_BASE = 0x9000;
const PROBE_OFFSET = 30; // the tile is read this many cells before the target's cell
const EMBED_TILES = [42, 43, 65]; // codes that route to the embed continuation landDigTarget
const STACK_SCRATCH = 32; // dead-scratch window below entry SP (the dig-sound enqueue parks a few
// register saves here; no real output lives in 0x83xx, so the window can hide none — the teeth prove it)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async, so build the
// factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/** Clone a real mid-attract machine at the first dispatch of a routine that IS reached, letting the
 *  host game proceed on the oracle. A valid state to craft dig-target entries from. */
function captureSeed(maxFrames) {
  let seed = null;
  const snapshot = new Map([[CAPTURE_AT, (mm) => {
    if (seed === null) seed = mm.clone();
    return captureRoutine(mm);
  }]]);
  makeMachine(snapshot).runFrames(maxFrames);
  return seed;
}

const SEED = ROM_PRESENT ? captureSeed(1500) : null;

/** The video-RAM cell advanceDigTarget lands on for a given target position, replicated so a crafted
 *  entry can stamp the exact tile the routine will probe. */
function cellFor(targetX, targetY) {
  const row = 31 - (targetX >> 3);
  const advancedY = u8(targetY + 1);
  const col = u8(advancedY + 1) >> 3;
  return VRAM_BASE + row * 32 + col;
}

/** Craft an entry from the seed: set the target coordinates, then stamp `tile` into the exact cell the
 *  routine probes (a fixed step ahead of the target's cell). Both arms then see that tile there. */
function craft(targetX, targetY, tile) {
  const e = SEED.clone();
  e.mem.write8(HAZARD_X, targetX);
  e.mem.write8(HAZARD_Y, targetY);
  const cell = cellFor(targetX, targetY);
  const aheadAddr = (cell - PROBE_OFFSET) & 0xffff;
  e.mem.write8(aheadAddr, tile);
  return { entry: e, cell, aheadAddr };
}

/** First differing state byte between two machines, EXCLUDING the dead stack scratch the oracle's
 *  stack-threaded dig-sound request parks just below the entry stack pointer. Null when otherwise
 *  identical. */
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

/** Run the oracle and a candidate on independent clones of `entry` (both drive the real still-oracle
 *  continuation), and return the first differing state byte outside the stack scratch, or null. */
function stateDiff(entry, fn) {
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  fn(b);
  return stateDiffOutsideStack(a, b, sp);
}

// -- 0. IDENTITY (harness sanity) --------------------------------------------

test("IDENTITY: a crafted entry replays and oracle-vs-oracle is EQUAL (cascade is deterministic)", () => {
  assert.ok(SEED, "expected a real attract capture at 0x3dae to seed from");
  const { entry } = craft(0x50, 0x40, EMBED_TILES[0]);
  assert.equal(stateDiff(entry, oracle), null, "oracle vs oracle must be identical");
  console.log(
    `  IDENTITY: seeded a real state (SP=${hx(SEED.regs.sp)}); crafted a dig-target embed entry; ` +
      `oracle vs oracle -> EQUAL`,
  );
});

// -- 1. EQUAL across the whole tile domain (both routes) ---------------------

test("EQUAL (tile sweep 0..255): every tile ahead resolves identically to the oracle, both routes", () => {
  assert.ok(SEED, "need a seed");
  let embeds = 0;
  for (let tile = 0; tile < 256; tile++) {
    const { entry } = craft(0x50, 0x40, tile);
    const d = stateDiff(entry, idiomatic);
    assert.equal(d, null, d && `tile ${hx(tile)}: state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
    if (EMBED_TILES.includes(tile)) {
      // Confirm this tile really drives the embed route on the oracle (it clears HAZARD_X to 0).
      const probe = entry.clone();
      oracle(probe);
      assert.equal(probe.mem.read8(HAZARD_X), 0, `tile ${hx(tile)} did not drive the embed route`);
      embeds++;
    }
  }
  assert.equal(embeds, EMBED_TILES.length, "the embed route was not exercised for every solid code");
  console.log(`  EQUAL/tile: 256 tiles identical to the oracle; ${embeds} drove the embed route, the rest continued`);
});

// -- 2. EQUAL sweeping the target position on both axes ----------------------

test("EQUAL (position sweep, both axes): advance + row/column arithmetic identical across 0..255", () => {
  assert.ok(SEED, "need a seed");
  const PASSABLE = 0x99; // not an embed code -> the continue route

  for (let targetY = 0; targetY < 256; targetY++) {
    const { entry } = craft(0x50, targetY, PASSABLE);
    const d = stateDiff(entry, idiomatic);
    assert.equal(d, null, d && `Y=${hx(targetY)}: state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  for (let targetX = 0; targetX < 256; targetX++) {
    const { entry } = craft(targetX, 0x40, PASSABLE);
    const d = stateDiff(entry, idiomatic);
    assert.equal(d, null, d && `X=${hx(targetX)}: state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log("  EQUAL/position: 256 advanced-axis + 256 row-axis states identical to the oracle (byte wraps included)");
});

// -- 3. NON-VACUOUS: the routine really advances the target + writes the cursor --

test("NON-VACUOUS: a crafted entry advances HAZARD_Y and writes the carve cursor, agreeing with the oracle", () => {
  assert.ok(SEED, "need a seed");
  const targetX = 0x50, targetY = 0x40;
  const { entry, cell } = craft(targetX, targetY, 0x99);

  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(HAZARD_Y), u8(targetY + 1), "target position was not advanced");
  assert.equal(c.mem.read16(CARVE_CURSOR), cell, "carve cursor was not written");

  assert.equal(stateDiff(entry, idiomatic), null, "the crafted dispatch must also match the oracle");
  console.log(`  NON-VACUOUS: HAZARD_Y ${hx(targetY)}->${hx(u8(targetY + 1))}, carve cursor -> ${hx(cell)}; arms agree`);
});

// -- 4. TEETH (advance): a wrong advanced position is CAUGHT -----------------

function twinWrongAdvance(m) {
  idiomatic(m);
  m.mem.write8(HAZARD_Y, m.mem.read8(HAZARD_Y) ^ 0xff);
}

test("TEETH (advance): a twin with the wrong advanced position is CAUGHT at HAZARD_Y", () => {
  const { entry } = craft(0x50, 0x40, 0x99);
  const d = stateDiff(entry, twinWrongAdvance);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong advance — it proves nothing");
  assert.equal(d.addr, HAZARD_Y, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(HAZARD_Y)})`);
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/advance: wrong-advance twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 5. TEETH (cursor): a wrong carve cursor is CAUGHT -----------------------

function twinWrongCursor(m) {
  idiomatic(m);
  m.mem.write16(CARVE_CURSOR, m.mem.read16(CARVE_CURSOR) ^ 0xffff);
}

test("TEETH (cursor): a twin with the wrong carve cursor is CAUGHT at 0x80af", () => {
  const { entry } = craft(0x50, 0x40, 0x99);
  const d = stateDiff(entry, twinWrongCursor);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong carve cursor — it proves nothing");
  assert.equal(d.addr, CARVE_CURSOR, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(CARVE_CURSOR)})`);
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/cursor: wrong-cursor twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 6. TEETH (route): never embedding is CAUGHT on a solid-tile entry --------

/** A twin that computes everything correctly but always takes the continue route — so on a solid tile
 *  it fails to embed (leaves HAZARD_X, which the real embed path clears). */
function twinNeverEmbeds(m) {
  const { mem8, mem16 } = m;
  const row = 31 - (mem8[HAZARD_X] >> 3);
  const advancedY = mem8[HAZARD_Y] + 1;
  mem8[HAZARD_Y] = advancedY;
  const col = u8(advancedY + 1) >> 3;
  const cell = VRAM_BASE + row * 32 + col;
  mem16[CARVE_CURSOR] = cell;
  return m.call(0x2bd3); // BUG: never routes to the embed continuation
}

test("TEETH (route): a twin that never embeds is CAUGHT on a solid-tile entry", () => {
  const { entry } = craft(0x50, 0x40, EMBED_TILES[0]); // a solid tile -> the oracle embeds
  const d = stateDiff(entry, twinNeverEmbeds);
  assert.notEqual(d, null, "the gate FAILED to catch a mis-route — it proves nothing");
  // The embed route's effects (dig-sound request, state reset, wall stamp) are all missing on the
  // twin, so the divergence is real work RAM, never the excluded stack scratch.
  assert.ok(d.addr < entry.regs.sp - STACK_SCRATCH || d.addr >= entry.regs.sp, "caught only stack scratch");
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/route: never-embed twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 7. TEETH (embed cell): the wrong cell handed to the embed continuation is CAUGHT --

/** A twin identical to the routine but for handing the embed continuation the wrong cell — so the
 *  wall stamp lands one cell off in video RAM. Proves the cell argument is a real, tested output. */
function twinWrongEmbedCell(m) {
  const { mem8, mem16 } = m;
  const row = 31 - (mem8[HAZARD_X] >> 3);
  const advancedY = mem8[HAZARD_Y] + 1;
  mem8[HAZARD_Y] = advancedY;
  const col = u8(advancedY + 1) >> 3;
  const cell = VRAM_BASE + row * 32 + col;
  mem16[CARVE_CURSOR] = cell;
  const aheadTile = mem8[cell - PROBE_OFFSET];
  if (aheadTile === 42 || aheadTile === 43 || aheadTile === 65) return landDigTarget(m, cell + 1); // BUG: wrong cell
  return m.call(0x2bd3);
}

test("TEETH (embed cell): handing the embed continuation the wrong cell is CAUGHT in video RAM", () => {
  const { entry, cell } = craft(0x50, 0x40, EMBED_TILES[0]); // solid tile -> the embed path stamps
  const d = stateDiff(entry, twinWrongEmbedCell);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong embed cell — the cell argument is untested");
  assert.ok(d.addr >= VRAM_BASE, `teeth caught a non-video address ${hx(d.addr ?? 0)} (expected the wall stamp in VRAM)`);
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(
    `  TEETH/cell: wrong embed cell caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b}); ` +
      `correct stamp cell ${hx(cell - 31)}`,
  );
});
