// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for collectLootTile (ROM 0x18cf) — the tile-boundary "collect a scoring
 * tile" arm of the actor-movement dispatch. On the final sub-step before the actor crosses
 * into a new tile column it collects two kinds of scoring tile (tile 58 -> +10, tiles 59..61
 * -> +20, the latter gated by an enable flag and a one-shot latch with a guard), awarding
 * score, bumping that kind's pickup counter, blanking the collected cell, and continuing the
 * movement; any other phase or tile is handed to the dig-arm classifier triggerDigReaction.
 *
 * Its declared LIVE-OUT is MEMORY-ONLY: the two pickup counters (0x8081/0x8082), the score
 * and its on-screen digits, the queued sound, the blanked cell, and whatever the movement
 * tail leaves — all work/video RAM. The oracle's residual registers are dead ABI, and because
 * the idiomatic layer dissolves its tails (triggerDigReaction / awardTenPoints called directly, the
 * +20 award and movement tail via the still-frozen oracle) rather than the oracle's
 * stack-threaded jumps, comparing the full register file or SP would false-fail an honest
 * rewrite. So the gate is the RAM state dump only, with ONE wrinkle:
 *
 *   THE STACK SCRATCH. The Pit's stack is real diffed work RAM (entry SP ~0x83fd here). On the
 *   award paths the oracle pushes return addresses and the sound enqueue saves two register
 *   pairs — up to eight dead bytes parked in [SP-8, SP) that the stack-free idiomatic never
 *   writes; and neither side writes ABOVE the entry SP (the movement tail is pop-only). Classic
 *   dead stack scratch, overwritten by the caller's next push before anything reads it — so the
 *   diff excludes exactly the [SP-8, SP) window and compares everything else byte-for-byte. The
 *   real outputs all sit far below the stack (0x8020..0x8082, plus video/colour RAM), so the
 *   window never hides one — the teeth confirm it.
 *
 * SIX checks:
 *   0. IDENTITY (harness) — oracle vs oracle on a captured entry; EQUAL proves the
 *      capture/clone/replay harness reaches 0x18cf in a real attract run.
 *   1. EQUAL (real dispatches) — every captured attract dispatch leaves identical state
 *      outside the stack scratch. Attract only ever takes the decline path into triggerDigReaction.
 *   2. EQUAL (crafted branch sweep) — force every branch identically on both arms: the
 *      boundary gate, tile 58, tiles 59..61 across enabled / latch-open / first-open-guard,
 *      and the unrecognised-tile declines.
 *   3. NON-VACUOUS — on a tile-58 award entry, the idiomatic run actually bumps the counter,
 *      blanks the cell, and queues the sound (so a no-op twin cannot pass), and agrees with
 *      the oracle.
 *   4. TEETH (counter) — a twin that fails to bump the pickup counter is CAUGHT at 0x8081.
 *   5. TEETH (blank) — a twin that stamps the wrong tile over the collected cell is CAUGHT at
 *      the cell.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-18cf.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_18cf as oracle } from "../../translated/loc_18cf.js";
import { collectLootTile as idiomatic } from "../collectLootTile.js";
import { makeMachineFactory } from "../../machine.js";
import { PLAYER_CELL_PTR, SOUND_HEAD, SOUND_RING } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x18cf;
const STACK_SCRATCH = 8; // dead bytes the oracle's award/sound path parks just below entry SP
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const FIRST_TILE_COUNT = 0x8081; // tile-58 pickup counter
const SECOND_TILE_COUNT = 0x8082; // tile-59..61 pickup counter
const SECOND_TILE_ENABLED = 0x8076; // enable flag for the second pickup kind
const SECOND_TILE_LATCH = 0x8078; // one-shot latch
const SECOND_TILE_GUARD = 0x80bd; // first-open guard
const TEN_POINT_SOUND = 16 | 0x80; // 0x90 — sound command 16 (the +10 score sound), pending

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async, so
// build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Hook 0x18cf in a real attract run and clone the machine at up to K real dispatches. The
 * wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. The classifier reaches it repeatedly during the attract demo.
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
 * First differing state byte between two machines, EXCLUDING the dead stack scratch the
 * oracle's award/sound path parks just below the entry stack pointer (which the stack-free
 * idiomatic does not reproduce). Null when otherwise identical.
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

/** Run oracle and candidate on independent clones of `entry`; return the first differing
 *  state byte outside the stack scratch (or null). */
function stateDiff(entry, fn) {
  const sp = entry.regs.sp;
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  fn(b);
  return stateDiffOutsideStack(a, b, sp);
}

/**
 * Force a branch: poke the register live-ins (tile code, position accumulator) and, where the
 * branch needs them, the second-kind enable / latch / guard bytes — identically on both arms.
 * Returns a fresh entry clone.
 */
function craft(base, { tile, pos, enabled, latch, guard }) {
  const e = base.clone();
  e.regs.b = tile;
  e.regs.e = pos;
  if (enabled !== undefined) e.mem.write8(SECOND_TILE_ENABLED, enabled);
  if (latch !== undefined) e.mem.write8(SECOND_TILE_LATCH, latch);
  if (guard !== undefined) e.mem.write8(SECOND_TILE_GUARD, guard);
  return e;
}

// -- 0. IDENTITY (harness sanity) --------------------------------------------

test("IDENTITY: the harness reaches 0x18cf in attract and oracle-vs-oracle is EQUAL", () => {
  const [entry] = captureDispatches(1, 3000);
  assert.ok(entry, "expected at least one real 0x18cf dispatch during attract");
  assert.equal(stateDiff(entry, oracle), null, "oracle vs oracle must be identical");
  console.log(
    `  IDENTITY: captured a real 0x18cf dispatch (SP=${hx(entry.regs.sp)}), ` +
      "oracle vs oracle -> EQUAL",
  );
});

// -- 1. EQUAL over real captured attract dispatches --------------------------

test("EQUAL: collectLootTile leaves the same state as the oracle over every real attract dispatch", () => {
  const caps = captureDispatches(400, 3000);
  assert.ok(caps.length >= 1, "expected at least one captured attract dispatch");

  const tilesSeen = new Set();
  const boundaryHits = new Set();
  for (const cap of caps) {
    tilesSeen.add(cap.regs.b);
    boundaryHits.add((cap.regs.e + 1) % 8 === 0);
    const d = stateDiff(cap, idiomatic);
    assert.equal(d, null, d && `tile=${hx(cap.regs.b)}: state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical to the oracle; ` +
      `tile codes {${[...tilesSeen].sort((x, y) => x - y).map(hx).join(",")}}, ` +
      `boundary-hit {${[...boundaryHits].sort().join(",")}}`,
  );
});

// -- 2. EQUAL over a crafted sweep of every branch ---------------------------

test("EQUAL (crafted): every branch of the collector matches the oracle", () => {
  const [base] = captureDispatches(1, 3000);
  assert.ok(base, "need a real capture to craft branch entries from");

  const arms = [
    ["non-boundary tile 58 -> decline", { tile: 58, pos: 0 }],
    ["boundary tile 58 -> award +10", { tile: 58, pos: 7 }],
    ["boundary tile 59, disabled -> decline", { tile: 59, pos: 7, enabled: 0 }],
    ["boundary tile 59, enabled + latch open -> award +20", { tile: 59, pos: 7, enabled: 1, latch: 1 }],
    ["boundary tile 60, enabled + first open (guard clear) -> award +20, arm latch", { tile: 60, pos: 7, enabled: 1, latch: 0, guard: 0 }],
    ["boundary tile 61, enabled + first open (guard set) -> decline", { tile: 61, pos: 7, enabled: 1, latch: 0, guard: 1 }],
    ["boundary unrecognised tile, enabled -> decline", { tile: 100, pos: 7, enabled: 1 }],
    ["boundary unrecognised tile, disabled -> decline", { tile: 100, pos: 7, enabled: 0 }],
  ];

  for (const [name, spec] of arms) {
    const d = stateDiff(craft(base, spec), idiomatic);
    assert.equal(d, null, d && `[${name}] state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(`  EQUAL/crafted: ${arms.length} branch arms identical to the oracle`);
});

// -- 3. NON-VACUOUS: a tile-58 award really produces its outputs --------------

test("NON-VACUOUS: a tile-58 award bumps the counter, blanks the cell, and queues the sound", () => {
  const [base] = captureDispatches(1, 3000);
  const entry = craft(base, { tile: 58, pos: 7 }); // boundary + tile 58 -> the +10 award

  const head = entry.mem.read8(SOUND_HEAD);
  const count = entry.mem.read8(FIRST_TILE_COUNT);
  const cell = entry.mem.read16(PLAYER_CELL_PTR);

  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(FIRST_TILE_COUNT), (count + 1) & 0xff, "the pickup counter did not advance");
  assert.equal(c.mem.read8(cell), 112, "the collected cell was not blanked to tile 112");
  assert.equal(c.mem.read8(SOUND_HEAD), (head + 1) % 8, "the sound write pointer did not advance");
  assert.equal(c.mem.read8(SOUND_RING + head), TEN_POINT_SOUND, "the +10 score sound was not queued");

  assert.equal(stateDiff(entry, idiomatic), null, "the award entry must also match the oracle");
  console.log(
    `  NON-VACUOUS: counter ${count}->${(count + 1) & 0xff}, cell ${hx(cell)}=112, ` +
      `sound ring[${head}]=${hx(TEN_POINT_SOUND)}; arms agree`,
  );
});

// -- 4. TEETH (counter): a missed pickup-counter bump is CAUGHT ---------------

/** Broken twin: does the real work, then undoes the pickup-counter bump. */
function twinNoCount(m) {
  idiomatic(m);
  m.mem.write8(FIRST_TILE_COUNT, (m.mem.read8(FIRST_TILE_COUNT) - 1) & 0xff); // BUG: unbump
}

test("TEETH (counter): a twin that fails to bump the pickup counter is CAUGHT at 0x8081", () => {
  const [base] = captureDispatches(1, 3000);
  const entry = craft(base, { tile: 58, pos: 7 }); // the +10 award bumps 0x8081

  const d = stateDiff(entry, twinNoCount);
  assert.notEqual(d, null, "the gate FAILED to catch a missed counter bump — it proves nothing");
  assert.equal(d.addr, FIRST_TILE_COUNT, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(FIRST_TILE_COUNT)})`);

  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/counter: missed-bump twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 5. TEETH (blank): a wrong blank tile is CAUGHT --------------------------

/** Broken twin: does the real work, then stamps the wrong tile over the collected cell. */
function twinWrongBlank(m) {
  const cell = m.mem.read16(PLAYER_CELL_PTR);
  idiomatic(m);
  m.mem.write8(cell, 113); // BUG: should be the blank tile 112
}

test("TEETH (blank): a twin that stamps the wrong tile over the collected cell is CAUGHT", () => {
  const [base] = captureDispatches(1, 3000);
  const entry = craft(base, { tile: 58, pos: 7 }); // the +10 award blanks the cell
  const cell = entry.mem.read16(PLAYER_CELL_PTR);

  const d = stateDiff(entry, twinWrongBlank);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong blank-tile twin — it proves nothing");
  assert.equal(d.addr, cell, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected the cell ${hx(cell)})`);

  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/blank: wrong-blank twin caught at the cell ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
