// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for carryMarioDownWithLift (ROM 0x2787) — the vertical mover that advances
 * Mario's Y toward the 232 limit and, at the limit, hands off to the edge reset.
 *
 * The routine's entire memory-observable behaviour is a function of ONE byte —
 * MARIO_Y (0x6205). It reads that, and either:
 *   • below 232 — writes MARIO_Y+1, then mirrors it to the sprite-record Y field
 *     (MARIO_SPRITE_RECORD + SPRITE_Y = 0x694F); or
 *   • at/above 232 — runs killMarioAtEndOfLiftTravel, which clears MARIO_ACTIVE (0x6200) and
 *     EDGE_REPOSITION_FLAG (0x6398) to 0.
 * Nothing else is read; no other prior byte changes the branch or the writes, so
 * a sweep over all 256 MARIO_Y values is EXHAUSTIVE — a proof, not a sample.
 *
 * The oracle models its `jp nc,0x277F` tail-jump as a call and ends every path
 * with a `ret` that only POPS (reads) the stack — it never writes it. The
 * idiomatic routine drops that ret bracket and direct-calls killMarioAtEndOfLiftTravel, so the
 * memory-equivalence contract excludes the dead STACK_SCRATCH and keeps every
 * live cell. 0x2787 is a gameplay-only mover — NOT dispatched during attract (0
 * in 3000 frames) — so there are no real captured dispatches; the exhaustive
 * sweep on a real attract base IS the gate.
 *
 *   1. EQUAL (exhaustive) — carryMarioDownWithLift == oracle on RAM − the stack scratch below the entry SP across all
 *      256 MARIO_Y values (both the step arm and the edge-reset arm).
 *
 *   2. TEETH (exhaustive) — three deliberately-broken twins the same sweep MUST
 *      catch:
 *        (a) wrong threshold (`>` not `>=`) — at MARIO_Y == 232 the twin steps
 *            where the oracle resets; proves the boundary is `>=`.
 *        (b) dropped sprite mirror — skips the 0x694F write on the step arm.
 *        (c) skipped edge reset — omits killMarioAtEndOfLiftTravel on the reset arm, so
 *            MARIO_ACTIVE / EDGE_REPOSITION_FLAG stay uncleared.
 *      Sentinel values in the three written cells make every write observable.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2787.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2787 as oracle } from "../../translated/loc_2787.js";
import { carryMarioDownWithLift } from "../carryMarioDownWithLift.js";
import { killMarioAtEndOfLiftTravel } from "../killMarioAtEndOfLiftTravel.js"; // idiomatic edge reset, used by the twins
import {
  STACK_SCRATCH,
  MARIO_Y,
  MARIO_ACTIVE,
  EDGE_REPOSITION_FLAG,
  MARIO_SPRITE_RECORD,
  SPRITE_Y,
} from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const MARIO_SPRITE_Y = MARIO_SPRITE_RECORD + SPRITE_Y; // 0x694F
const Y_LIMIT = 232; // 0xE8

// The oracle's terminal `ret` pops the stack; point SP at dead stack scratch so
// the pop reads valid RAM (never I/O). The oracle writes no RAM through the stack
// (it only pops), so this choice never affects the compared memory.
const SAFE_SP = 0x6bf8;

// Sentinels distinct from every value the routine can write (0 on the reset arm,
// MARIO_Y+1 on the step arm) so a dropped write shows up as a RAM diff.
const SENT_ACTIVE = 0xaa; // MARIO_ACTIVE
const SENT_EDGE = 0xbb; // EDGE_REPOSITION_FLAG
const SENT_SPRITE_Y = 0xcc; // sprite-record Y

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs, skipping the stack scratch below the entry SP
// (memory-equivalence contract = RAM − the stack scratch below the entry SP). { addr, a, b } | null.
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds
// realistic values around the poked input.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// A crafted 0x2787 entry: a clone of `base` with MARIO_Y set to `y`, the three
// written cells set to sentinels (so any write is observable), and a safe stack.
function makeEntry(base, y) {
  const e = base.clone();
  e.mem.write8(MARIO_Y, y);
  e.mem.write8(MARIO_ACTIVE, SENT_ACTIVE);
  e.mem.write8(EDGE_REPOSITION_FLAG, SENT_EDGE);
  e.mem.write8(MARIO_SPRITE_Y, SENT_SPRITE_Y);
  e.regs.sp = SAFE_SP;
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

// Run the oracle and a candidate on two FRESH, byte-identical entries; return the
// first RAM diff (or null). Fresh entries per side because the routine WRITES memory.
function runPair(base, y, candidate) {
  const a = makeEntry(base, y); // oracle
  const aFloor = a.regs.sp;
  const b = makeEntry(base, y); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiff(a, b, aFloor);
}

// Sweep all 256 MARIO_Y values; return the first mismatch (or null) and the count.
function fullSweep(base, candidate) {
  for (let y = 0; y < 256; y++) {
    const ram = runPair(base, y, candidate);
    if (ram) return { mismatch: { y, ram }, count: y + 1 };
  }
  return { mismatch: null, count: 256 };
}

const describe = (mm) =>
  mm && `at MARIO_Y=${hx(mm.y)}: RAM diverges at ${hx(mm.ram.addr)} (${mm.ram.a}->${mm.ram.b})`;

// -- 1. EQUAL (exhaustive) ----------------------------------------------------

test("EQUAL (exhaustive): carryMarioDownWithLift == oracle across all 256 MARIO_Y values", () => {
  const base = attractBase();
  const { mismatch, count } = fullSweep(base, carryMarioDownWithLift);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, 256, "must have compared the whole MARIO_Y input space");
  console.log("  EQUAL/exhaustive: 256 MARIO_Y values — RAM identical to the oracle");
});

// -- 2. TEETH (exhaustive) ----------------------------------------------------

/** BUG (a): `>` instead of `>=`, so at MARIO_Y == 232 it steps where the oracle resets. */
function brokenThreshold(m) {
  const { mem } = m;
  const y = mem.read8(MARIO_Y);
  if (y > Y_LIMIT) { killMarioAtEndOfLiftTravel(m); return; } // BUG: should be `>=`
  const next = y + 1;
  mem.write8(MARIO_Y, next);
  mem.write8(MARIO_SPRITE_Y, next);
}

/** BUG (b): drops the sprite-record Y mirror on the step arm. */
function brokenNoMirror(m) {
  const { mem } = m;
  const y = mem.read8(MARIO_Y);
  if (y >= Y_LIMIT) { killMarioAtEndOfLiftTravel(m); return; }
  const next = y + 1;
  mem.write8(MARIO_Y, next);
  // BUG: no mem.write8(MARIO_SPRITE_Y, next)
}

/** BUG (c): the reset arm does nothing, leaving MARIO_ACTIVE / EDGE_REPOSITION_FLAG uncleared. */
function brokenSkipReset(m) {
  const { mem } = m;
  const y = mem.read8(MARIO_Y);
  if (y >= Y_LIMIT) return; // BUG: should run killMarioAtEndOfLiftTravel
  const next = y + 1;
  mem.write8(MARIO_Y, next);
  mem.write8(MARIO_SPRITE_Y, next);
}

test("TEETH (exhaustive): the wrong-threshold twin is CAUGHT (at the 232 boundary)", () => {
  const base = attractBase();
  const { mismatch } = fullSweep(base, brokenThreshold);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a wrong threshold — the RAM check is worthless");
  assert.equal(mismatch.y, Y_LIMIT, "the wrong-threshold twin must first diverge at MARIO_Y == 232");
  console.log(`  TEETH/threshold: caught — ${describe(mismatch)}`);
});

test("TEETH (exhaustive): the dropped-sprite-mirror twin is CAUGHT (sprite Y diverges)", () => {
  const base = attractBase();
  const { mismatch } = fullSweep(base, brokenNoMirror);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped sprite mirror — worthless");
  assert.equal(mismatch.ram.addr, MARIO_SPRITE_Y, "the dropped-mirror twin must diverge on the sprite-record Y byte");
  console.log(`  TEETH/mirror: caught — ${describe(mismatch)}`);
});

test("TEETH (exhaustive): the skipped-edge-reset twin is CAUGHT (reset arm)", () => {
  const base = attractBase();
  const { mismatch } = fullSweep(base, brokenSkipReset);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a skipped edge reset — worthless");
  assert.ok(mismatch.y >= Y_LIMIT, "the skipped-reset twin must diverge on the reset arm (MARIO_Y >= 232)");
  console.log(`  TEETH/reset: caught — ${describe(mismatch)}`);
});
