// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for spawnPendingDigObject (ROM 0x2c04) — the routine that
 * dequeues a random queued column and spawns a dig object there.
 *
 * Its whole effect is memory: the spawn-active flag, the dig-object staging bytes, the
 * cleared queue slot, the target coordinates, the painted tilemap cell, and the
 * player-overlap flag. Declared live-out is MEMORY-ONLY, so the gate compares RAM, not
 * the value registers/flags the oracle leaves behind (the honest-signature contract).
 *
 * WHY A CRAFTED ENTRY. The dig-object spawn path is never dispatched in a plain attract
 * run (0x2c04 is not entered over thousands of frames), so the capture/replay harness
 * cannot hook it directly. Per the crafted-entry method the gate instead runs the routine
 * from a REAL captured attract machine, poked so the spawn has something to do: the
 * 24-slot column queue is cleared and specific slots filled, and the tracked-object
 * position is set to place the spawn on or off the player. Each shape forces one control
 * path — a left-only column (keeps the left slot), a right-only column (skips pairing), a
 * paired column (switches to the right slot), all-left / all-right fills, and the wrap
 * edge of the on-player window — and a broad randomized sweep covers the rest. The
 * generator is seeded so the retry loop lands on the intended slot deterministically.
 *
 * ONE WRINKLE — the oracle marshals its two helper calls (the spawn sound and the random
 * draw) through the Z80 stack, which is real diffed work RAM; each push leaves dead bytes
 * just below the entry stack pointer that the stack-free idiomatic JS does not reproduce.
 * Measured, they occupy a fixed 6-byte window; the RAM diff excludes [entrySP-16, entrySP)
 * to cover it with margin (isolated from every real output — the work-RAM cells sit well
 * below it and the tilemap well above) and compares everything else byte-for-byte. The
 * tail hand-off to the sprite-record builder is identical on both sides, so pc/SP line up
 * without a fixup and the diff stays RAM-only.
 *
 * Checks:
 *   0. HARNESS — capture a real attract entry, craft a spawnable state, and confirm the
 *      oracle run is deterministic (oracle vs oracle identical outside the stack window).
 *   1. EQUAL (deterministic shapes) — over each crafted control path the idiomatic
 *      routine leaves the same RAM as the oracle, and the spawn outputs (queue cleared,
 *      tile painted, coordinates, overlap flag) hold the hand-computed values.
 *   2. EQUAL (randomized sweep) — random generator seed + random queue + random object
 *      position; RAM identical to the oracle every time.
 *   3. TEETH (overlap flag) — a twin that flips the published player-overlap flag is CAUGHT.
 *   4. TEETH (target coordinate) — a twin that corrupts the spawn X coordinate is CAUGHT.
 *   5. TEETH (painted tile) — a twin that paints the wrong tile into the cell is CAUGHT.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-2c04.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2c04 as oracle } from "../../translated/loc_2c04.js";
import { spawnPendingDigObject as idiomatic } from "../spawnPendingDigObject.js";
import { advanceRandom } from "../advanceRandom.js";
import { makeMachineFactory } from "../../machine.js";
import {
  HAZARD_ACTIVE_COUNT,
  HAZARD_STATE,
  HAZARD_TYPE,
  HAZARD_X,
  HAZARD_Y,
  PLAYER_Y,
  PLAYER_X,
  MOVE_BLOCK_FLAG,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const QUEUE = 0x80c3; // base of the 24-slot pending-spawn column queue
const PRNG_LOW = 0x800d;
const PRNG_HIGH = 0x800e;
const SPAWN_TILE = 37; // 0x25 — the tile painted into the spawned cell
const STACK_WINDOW = 16; // exclude [entrySP-16, entrySP): the oracle's dead helper-call pushes
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- helpers ------------------------------------------------------------------

/** Clone a real attract machine at `frame` — a genuine in-play state with frame
 *  machinery neutralised (safe to run the oracle/idiomatic on). */
function captureRealAttractEntry(frame) {
  const m = makeMachine();
  m.runFrames(frame);
  return m.clone();
}

/** Find a generator seed (low,high) whose FIRST advanceRandom draw masks to `target`
 *  (0..23), using the real generator so the test never re-implements the LFSR. */
function seedForDraw(base, target) {
  for (let high = 0; high < 2; high++) {
    for (let low = 0; low < 256; low++) {
      const s = base.clone();
      s.mem.write8(PRNG_LOW, low);
      s.mem.write8(PRNG_HIGH, high);
      if ((advanceRandom(s) & 0x1f) === target) return [low, high];
    }
  }
  throw new Error(`no seed produced draw ${target}`);
}

/** Craft a spawnable entry: clear the queue, fill `slots` ([index,value]), optionally
 *  place the tracked object and seed the generator. */
function craft(base, { slots, objX = null, objY = null, seed = null }) {
  const e = base.clone();
  for (let i = 0; i < 24; i++) e.mem.write8(QUEUE + i, 0);
  for (const [i, v] of slots) e.mem.write8(QUEUE + i, v);
  if (objX !== null) e.mem.write8(PLAYER_Y, objX);
  if (objY !== null) e.mem.write8(PLAYER_X, objY);
  if (seed) {
    e.mem.write8(PRNG_LOW, seed[0]);
    e.mem.write8(PRNG_HIGH, seed[1]);
  }
  return e;
}

/** First differing RAM byte between two machines, excluding [entrySP-16, entrySP) — the
 *  dead stack scratch the oracle's dissolved helper calls leave behind. Null when equal. */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_WINDOW, hi: entrySP }, entrySP)(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the oracle and a candidate on independent clones of `entry` and return the first
 *  RAM difference outside the stack scratch (null == EQUAL). */
function contractDiff(entry, fn) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);
  return ramDiffOutsideStack(o, c, sp);
}

/** The tilemap cell the spawn paints, computed from the target coordinates left in RAM. */
function paintedCell(m) {
  const targetX = m.mem.read8(HAZARD_X);
  const targetY = m.mem.read8(HAZARD_Y);
  return 0x9000 + (31 - (targetX >> 3)) * 32 + ((targetY + 1) >> 3) - 31;
}

// -- 0. HARNESS ---------------------------------------------------------------

test("HARNESS: a real attract entry is captured, crafted spawnable, and the oracle run is deterministic", () => {
  const cap = captureRealAttractEntry(200);
  const entry = craft(cap, { slots: [[3, 0x40]], objX: 0x42, objY: 0xc3, seed: seedForDraw(cap, 3) });

  const a = entry.clone();
  oracle(a);
  const b = entry.clone();
  oracle(b);
  const d = ramDiffOutsideStack(a, b, entry.regs.sp);
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr)}`);
  console.log(`  HARNESS: captured a real entry (SP=${hx(entry.regs.sp)}); oracle run of 0x2c04 deterministic`);
});

// -- 1. EQUAL over deterministic control-path shapes --------------------------

test("EQUAL (control-path shapes): idiomatic == oracle over RAM, outputs hand-checked", () => {
  const cap = captureRealAttractEntry(200);

  // Each shape: [name, craft opts, expected {column, value, targetY, overlap?}].
  const shapes = [
    // Left-only column 3 (pair 15 empty): keeps the left slot; on-player window hit.
    ["left-only, on player", { slots: [[3, 0x40]], objX: 0x42, objY: 0xc3, seed: seedForDraw(cap, 3) },
      { column: 3, value: 0x40, targetY: 0xb7, overlap: 1 }],
    // Right-only column 15: skips the pairing check entirely.
    ["right-only", { slots: [[15, 0x22]], seed: seedForDraw(cap, 15) },
      { column: 15, value: 0x22, targetY: 0xbf, overlap: 0 }],
    // Left column 5 with its pair 17 queued: switches to the right slot.
    ["paired -> switch", { slots: [[5, 0x11], [17, 0x22]], seed: seedForDraw(cap, 5) },
      { column: 17, value: 0x22, targetY: 0xbf, overlap: 0 }],
    // Same column band but object one row off: no overlap.
    ["left-only, off player (row)", { slots: [[3, 0x40]], objX: 0x42, objY: 0xc4, seed: seedForDraw(cap, 3) },
      { column: 3, value: 0x40, targetY: 0xb7, overlap: 0 }],
    // On the band, object just outside the 8px window: no overlap.
    ["left-only, off player (window)", { slots: [[3, 0x40]], objX: 0x4a, objY: 0xc3, seed: seedForDraw(cap, 3) },
      { column: 3, value: 0x40, targetY: 0xb7, overlap: 0 }],
    // Wrap edge: X+8 overflows a byte; the oracle compares the wrapped value, so no overlap.
    ["wrap edge (X+8 overflow)", { slots: [[6, 250]], objX: 0xfd, objY: 0xc3, seed: seedForDraw(cap, 6) },
      { column: 6, value: 250, targetY: 0xb7, overlap: 0 }],
  ];

  for (const [name, opts, exp] of shapes) {
    const entry = craft(cap, opts);
    const d = contractDiff(entry, idiomatic);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr)} oracle=${d.a} idiomatic=${d.b}`);

    // Positive checks against hand-computed expectations.
    const c = entry.clone();
    idiomatic(c);
    assert.equal(c.mem.read8(QUEUE + exp.column), 0, `${name}: chosen queue slot not cleared`);
    assert.equal(c.mem.read8(HAZARD_ACTIVE_COUNT), 1, `${name}: spawn-active flag not raised`);
    assert.equal(c.mem.read8(HAZARD_STATE), 16, `${name}: dig-object state not seeded`);
    assert.equal(c.mem.read8(HAZARD_TYPE), 6, `${name}: dig-object attr not seeded`);
    assert.equal(c.mem.read8(HAZARD_X), (exp.value + 1) & 0xff, `${name}: target X wrong`);
    assert.equal(c.mem.read8(HAZARD_Y), exp.targetY, `${name}: target Y (column base) wrong`);
    assert.equal(c.mem.read8(paintedCell(c)), SPAWN_TILE, `${name}: spawn tile not painted`);
    assert.equal(c.mem.read8(MOVE_BLOCK_FLAG), exp.overlap, `${name}: player-overlap flag wrong`);
  }
  console.log(`  EQUAL/shapes: ${shapes.length} control paths — RAM identical, spawn outputs hand-verified`);
});

// -- 2. EQUAL over a randomized sweep -----------------------------------------

test("EQUAL (randomized sweep): random seed + queue + object position, RAM identical to the oracle", () => {
  const cap = captureRealAttractEntry(200);
  let rng = 0x12345678 >>> 0;
  const rnd = (n) => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng % n; };

  const ITER = 400;
  let switchSeen = 0, backupSeen = 0, rightSeen = 0, overlapSeen = 0;
  for (let it = 0; it < ITER; it++) {
    // 3..8 random non-empty slots (guarantees the retry loop terminates).
    const count = 3 + rnd(6);
    const slots = [];
    const used = new Set();
    while (slots.length < count) {
      const i = rnd(24);
      if (used.has(i)) continue;
      used.add(i);
      slots.push([i, 1 + rnd(255)]);
    }
    const entry = craft(cap, {
      slots,
      objX: rnd(256),
      objY: rnd(256),
      seed: [1 + rnd(255), rnd(256)],
    });
    entry.mem.write8(0x80c2, rnd(256)); // random lifetime reload byte

    const d = contractDiff(entry, idiomatic);
    assert.equal(d, null, d && `iter ${it}: RAM diff at ${hx(d.addr)} oracle=${d.a} idiomatic=${d.b}`);

    const c = entry.clone();
    idiomatic(c);
    if (c.mem.read8(MOVE_BLOCK_FLAG) === 1) overlapSeen++;
    // Classify which control path ran from the painted column base.
    const ty = c.mem.read8(HAZARD_Y);
    if (ty === 0xbf) rightSeen++; else backupSeen++;
  }
  // Track that a paired-switch is reachable: force it once and confirm.
  const sw = craft(cap, { slots: [[4, 0x33], [16, 0x44]], seed: seedForDraw(cap, 4) });
  const swc = sw.clone();
  idiomatic(swc);
  if (swc.mem.read8(QUEUE + 16) === 0 && swc.mem.read8(HAZARD_Y) === 0xbf) switchSeen = 1;

  // Overlap needs an exact band+window alignment that random object positions rarely hit;
  // it is covered exhaustively (true and false) by the deterministic shapes test above.
  assert.ok(rightSeen > 0 && backupSeen > 0, "sweep must exercise both column halves");
  assert.equal(switchSeen, 1, "the paired-switch path must be reachable");
  console.log(
    `  EQUAL/sweep: ${ITER} random states identical to the oracle ` +
      `(rightHalf=${rightSeen}, leftHalf=${backupSeen}, overlaps=${overlapSeen}, switch reachable)`,
  );
});

// -- 3. TEETH: a flipped overlap flag is caught -------------------------------

test("TEETH (overlap flag): a twin that flips the published player-overlap flag is CAUGHT", () => {
  const cap = captureRealAttractEntry(200);
  const entry = craft(cap, { slots: [[3, 0x40]], objX: 0x42, objY: 0xc3, seed: seedForDraw(cap, 3) });

  const twin = (m) => {
    idiomatic(m);
    m.mem.write8(MOVE_BLOCK_FLAG, m.mem.read8(MOVE_BLOCK_FLAG) ^ 1); // BUG: wrong overlap verdict
  };
  const d = contractDiff(entry, twin);
  assert.notEqual(d, null, "the gate FAILED to catch a flipped overlap flag — it proves nothing");
  assert.equal(d.addr, MOVE_BLOCK_FLAG, `teeth caught the wrong address ${hx(d.addr)} (expected ${hx(MOVE_BLOCK_FLAG)})`);
  console.log(`  TEETH/overlap: flipped flag caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. TEETH: a corrupted target coordinate is caught ------------------------

test("TEETH (target coordinate): a twin that corrupts the spawn X coordinate is CAUGHT", () => {
  const cap = captureRealAttractEntry(200);
  const entry = craft(cap, { slots: [[15, 0x22]], seed: seedForDraw(cap, 15) });

  const twin = (m) => {
    idiomatic(m);
    m.mem.write8(HAZARD_X, m.mem.read8(HAZARD_X) ^ 0xff); // BUG: wrong spawn coordinate
  };
  const d = contractDiff(entry, twin);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted target coordinate");
  assert.equal(d.addr, HAZARD_X, `teeth caught the wrong address ${hx(d.addr)} (expected ${hx(HAZARD_X)})`);
  console.log(`  TEETH/coord: corrupted target X caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 5. TEETH: a wrong painted tile is caught ---------------------------------

test("TEETH (painted tile): a twin that paints the wrong tile into the cell is CAUGHT", () => {
  const cap = captureRealAttractEntry(200);
  const entry = craft(cap, { slots: [[15, 0x22]], seed: seedForDraw(cap, 15) });

  const twin = (m) => {
    idiomatic(m);
    m.mem.write8(paintedCell(m), SPAWN_TILE - 1); // BUG: wrong tile code painted
  };
  const d = contractDiff(entry, twin);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong painted tile");
  console.log(`  TEETH/tile: wrong tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
