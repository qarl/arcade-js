// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for scheduleBarrelRelease (ROM 0x2C03) — the board-1 (25m) periodic bonus-event
 * scheduler (rst 0x30 board gate, rst 0x10 alive gate, an event-gate bit, then a
 * bonus/difficulty/spin decision that tails into the bonus-event slot-claim cluster).
 *
 * The oracle (scheduleBarrelRelease) `m.call`s five routines (0x0030, 0x0010, and — on its three tail
 * jumps — 0x2c7b, 0x2c86, 0x2c41) through the machine's address registry, which resolves each
 * to its frozen translated copy; those subtrees `push16` their return brackets and thread
 * multi-way `ret`s. scheduleBarrelRelease DIRECT-calls the five idiomatic callees (each memory-equivalent
 * to its oracle) and models no stack. Both sides reach identical work RAM; the only residual
 * difference is the dead STACK_SCRATCH the oracle's push16/ret churn writes, excluded by the
 * memory-equivalence contract (mirrors equivalence-2c41 / equivalence-0350).
 *
 * LIVE-OUT is memory-only: every exit either wrote nothing (or only the cluster's writes) or
 * tail-dispatched a void cluster entry, and the board-1 caller reads back no register/flag the
 * oracle leaves — so this compares RAM − the stack scratch below the entry SP only, no pc/SP shim.
 *
 *   0. REACHABILITY — 0x2c03 is dispatched during 25m attract.
 *   1. EQUAL (captured) — hook 0x2c03 in a real attract run, clone at each dispatch, and
 *      confirm scheduleBarrelRelease == oracle (RAM − the stack scratch below the entry SP) on every real state.
 *   2. EQUAL (crafted) — poke the gates/thresholds identically on both sides to drive every
 *      path: the three gate-closed skips, the zero-bonus early-out, the loc_2c7b tail, the
 *      loc_2c86 tail, the loc_2c41 tail by BOTH the phase-match jump and the odd-spin
 *      fall-through, the no-phase-match return, and the even-spin return.
 *   3. TEETH — two broken twins, each MUST be caught:
 *      (a) inverts the odd-spin parity gate — caught at RANDOM (the cluster head it wrongly
 *          skips / wrongly runs stirs it).
 *      (b) forwards the un-stepped bonus-start to loc_2c7b (drops the −2) — flips the entry's
 *          own +2 compare and so the recorded mode byte; caught at 0x6382.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2c03.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2c03 as oracle } from "../../translated/loc_2c03.js";
import { scheduleBarrelRelease } from "../scheduleBarrelRelease.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, BOARD, MARIO_ACTIVE, BONUS, BONUS_START, DIFFICULTY, FRAME, SPIN_COUNT, RANDOM, BARREL_CLAIM_MODE } from "../names.js";
// The teeth twins reuse the real callees (their faithfulness is proven by their own gates, not
// under test here) so only the scheduleBarrelRelease-level logic error is what diverges.
import { u8 } from "../../../../core/int.js";
import { boardBitGate as boardBitGateRef } from "../boardBitGate.js";
import { marioActiveGuard as marioActiveGuardRef } from "../marioActiveGuard.js";
import { loc_2c7b as loc_2c7bRef } from "../loc_2c7b.js";
import { loc_2c86 as loc_2c86Ref } from "../loc_2c86.js";
import { loc_2c41 as loc_2c41Ref } from "../loc_2c41.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2c03;
// Cells scheduleBarrelRelease touches directly that are UNNAMED in names.js (rejected-as-shared 0x63xx scratch).
const EVENT_GATE = 0x6393;   // gate 3: bit0 SET -> skip
// Cluster scratch the body writes when a tail fires (for the write-set / non-vacuity checks).
const SCRATCH_MODE = 0x638f;
const SCRATCH_FLAG = 0x6392;
const SAFE_SP = 0x6bf8; // the oracle's terminal `ret`s pop here; its `call` pushes land in STACK_SCRATCH.

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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

// All non-stack RAM addresses that changed between two machines (for the no-write / exact-write
// checks on the skip and early-out paths).
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out;
}

/** Run oracle and candidate on two FRESH, byte-identical entries; return the first non-stack RAM diff. */
function ramDiff(entry, fn) {
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  fn(b);
  return firstRamDiff(a, b, entry.regs.sp);
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds realistic values.
// The specific paths are crafted by poking on top of this.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted 0x2c03 dispatch onto a clone of the base: a safe stack, the three gate inputs,
// the two bonus thresholds, BARREL_CLAIM_MODE, the difficulty/frame phase inputs, and the spin bit.
// Cluster scratch cells are pre-dirtied so a body write is visible and a mis-forward is exposed.
function craft(base, {
  board = 1, alive = 1, gate = 0x00, bonus = 0x20, start = 0x10,
  req = 0x00, diff = 3, frame = 10, spin = 0x00,
} = {}) {
  const m = base.clone();
  m.regs.sp = SAFE_SP;
  m.mem.write8(BOARD, board);
  m.mem.write8(MARIO_ACTIVE, alive);
  m.mem.write8(EVENT_GATE, gate);
  m.mem.write8(BONUS, bonus);
  m.mem.write8(BONUS_START, start);
  m.mem.write8(BARREL_CLAIM_MODE, req);
  m.mem.write8(DIFFICULTY, diff);
  m.mem.write8(FRAME, frame);
  m.mem.write8(SPIN_COUNT, spin);
  m.mem.write8(SCRATCH_MODE, 0xee); // noise: a fired cluster entry rewrites it
  m.mem.write8(SCRATCH_FLAG, 0xee); // noise: a fired cluster entry rewrites it
  m.nextNmi = Infinity;
  m.nextBoundary = Infinity;
  return m;
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2c03 is dispatched during 25m attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(4000);
  assert.ok(count > 0, "0x2c03 should be dispatched — the board-1 barrel-release path calls it");
  console.log(`  REACHABILITY: ${count} natural 0x2c03 dispatches in 4000 frames`);
});

// -- 1. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): scheduleBarrelRelease == oracle on every real dispatch", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 128) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(6000);
  assert.ok(caps.length >= 1, "expected at least one real 0x2c03 dispatch during attract");

  let bodyRuns = 0, skips = 0;
  for (const entry of caps) {
    entry.nextNmi = Infinity;
    entry.nextBoundary = Infinity;
    const diff = ramDiff(entry, scheduleBarrelRelease);
    assert.equal(diff, null, diff && `captured dispatch: RAM@${hx(diff.addr)} oracle=${diff.a} cand=${diff.b}`);
    // Classify for reporting: body (any non-stack write) vs skip.
    const after = entry.clone(); oracle(after);
    if (changedAddrs(entry, after, entry.regs.sp).length > 0) bodyRuns++; else skips++;
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical to the oracle (${bodyRuns} body, ${skips} skip)`);
});

// -- 2. EQUAL (crafted, all arms) ---------------------------------------------

test("EQUAL (crafted): every gate/threshold path matches the oracle", () => {
  const base = attractBase();

  const cases = [
    // three gate-closed skips -> nothing written at all
    { name: "gate1 board closed (75m)", opts: { board: 3 }, writes: [] },
    { name: "gate2 mario dead", opts: { alive: 0 }, writes: [] },
    { name: "gate3 event-bit set", opts: { gate: 0x01 }, writes: [] },
    // live bonus is zero -> nothing to schedule
    { name: "zero-bonus early-out", opts: { bonus: 0x00 }, writes: [] },
    // (start-2) < bonus -> loc_2c7b tail (records a mode byte; gate closed here -> no slot claim)
    { name: "loc_2c7b tail", opts: { start: 0x10, bonus: 0x20 }, body: true },
    // (start-2) >= bonus, BARREL_CLAIM_MODE bit1 set -> loc_2c86 tail
    { name: "loc_2c86 tail", opts: { start: 0x50, bonus: 0x10, req: 0x02 }, body: true },
    // phase test with no match -> return, nothing written
    { name: "no phase match (return)", opts: { start: 0x50, bonus: 0x10, req: 0x00, diff: 3, frame: 10 }, writes: [] },
    // phase match, half(start) < bonus -> loc_2c41 tail via the jump
    { name: "loc_2c41 tail (phase jump)", opts: { start: 0x40, bonus: 0x30, diff: 3, frame: 2 }, body: true, stirs: true },
    // phase match at frame low-bits == 1 (matches the countdown's last value)
    { name: "loc_2c41 tail (match at 1)", opts: { start: 0x40, bonus: 0x30, diff: 3, frame: 1 }, body: true, stirs: true },
    // phase match, half(start) >= bonus, odd spin -> fall through into loc_2c41
    { name: "loc_2c41 tail (odd-spin fall-through)", opts: { start: 0x40, bonus: 0x20, diff: 3, frame: 2, spin: 0x01 }, body: true, stirs: true },
    // phase match, half(start) >= bonus, even spin -> return, nothing written
    { name: "even-spin return", opts: { start: 0x40, bonus: 0x20, diff: 3, frame: 2, spin: 0x00 }, writes: [] },
  ];

  for (const { name, opts, writes, body, stirs } of cases) {
    const entry = craft(base, opts);
    const diff = ramDiff(entry, scheduleBarrelRelease);
    assert.equal(diff, null, diff && `${name}: RAM@${hx(diff.addr)} oracle=${diff.a} cand=${diff.b}`);

    const after = entry.clone(); oracle(after);
    if (writes) {
      // Exact non-stack write set — proves the path was genuinely the skip / early-out / return one.
      assert.deepEqual(changedAddrs(entry, after, entry.regs.sp).sort(), [...writes].sort(),
        `${name}: unexpected non-stack write set`);
    } else if (body) {
      // A cluster entry fired: it stamped the mode byte and the entry flag (sentinels gone).
      assert.notEqual(after.mem.read8(BARREL_CLAIM_MODE), 0xee, `${name}: BARREL_CLAIM_MODE not written`);
      assert.notEqual(after.mem.read8(SCRATCH_MODE), 0xee, `${name}: cluster mode scratch not written`);
      assert.notEqual(after.mem.read8(SCRATCH_FLAG), 0xee, `${name}: cluster entry flag not raised`);
      if (stirs) {
        // The loc_2c41 head stirs the random seed before dispatching a mode entry.
        assert.ok(changedAddrs(entry, after, entry.regs.sp).includes(RANDOM), `${name}: cluster head did not stir RANDOM`);
      }
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} paths (3 skips, zero-bonus, 2 return, loc_2c7b/loc_2c86/loc_2c41 tails) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): inverts the odd-spin parity gate — returns on odd spin, fires on even. On the
 *  odd-spin fall-through case the cluster head is wrongly skipped, so RANDOM (which it would
 *  stir) diverges. */
function brokenInvertedSpin(m) {
  const { regs, mem } = m;
  regs.a = 0x01;
  if (!boardBitGateRef(m)) return;
  if (!marioActiveGuardRef(m)) return;
  if ((mem.read8(EVENT_GATE) & 0x01) !== 0) return;
  const bonus = mem.read8(BONUS);
  if (bonus === 0) return;
  const stepped = u8(mem.read8(BONUS_START) - 2);
  if (stepped < bonus) { regs.a = stepped; regs.c = bonus; return loc_2c7bRef(m); }
  if ((mem.read8(BARREL_CLAIM_MODE) & 0x02) !== 0) { regs.c = bonus; return loc_2c86Ref(m); }
  const framePhase = mem.read8(FRAME) & 0x1f;
  let countdown = mem.read8(DIFFICULTY);
  let matched = false;
  for (;;) { if (framePhase === countdown) { matched = true; break; } countdown = u8(countdown - 1); if (countdown === 0) break; }
  if (!matched) return;
  const halfStart = mem.read8(BONUS_START) >> 1;
  if (halfStart < bonus) { regs.c = bonus; return loc_2c41Ref(m); }
  if ((mem.read8(SPIN_COUNT) & 0x01) !== 0) return; // BUG: parity inverted
  regs.c = bonus; return loc_2c41Ref(m);
}

/** Twin (b): forwards the un-stepped bonus-start to loc_2c7b (drops the −2). loc_2c7b re-adds 2,
 *  so the compare it makes against the bonus flips when start == bonus, changing which mode byte
 *  it records. Caught at 0x6382. */
function brokenStepForward(m) {
  const { regs, mem } = m;
  regs.a = 0x01;
  if (!boardBitGateRef(m)) return;
  if (!marioActiveGuardRef(m)) return;
  if ((mem.read8(EVENT_GATE) & 0x01) !== 0) return;
  const bonus = mem.read8(BONUS);
  if (bonus === 0) return;
  const stepped = u8(mem.read8(BONUS_START) - 2);
  if (stepped < bonus) { regs.a = mem.read8(BONUS_START); regs.c = bonus; return loc_2c7bRef(m); } // BUG: un-stepped
  if ((mem.read8(BARREL_CLAIM_MODE) & 0x02) !== 0) { regs.c = bonus; return loc_2c86Ref(m); }
  const framePhase = mem.read8(FRAME) & 0x1f;
  let countdown = mem.read8(DIFFICULTY);
  let matched = false;
  for (;;) { if (framePhase === countdown) { matched = true; break; } countdown = u8(countdown - 1); if (countdown === 0) break; }
  if (!matched) return;
  const halfStart = mem.read8(BONUS_START) >> 1;
  if (halfStart < bonus) { regs.c = bonus; return loc_2c41Ref(m); }
  if ((mem.read8(SPIN_COUNT) & 0x01) === 0) return;
  regs.c = bonus; return loc_2c41Ref(m);
}

test("TEETH: the inverted-spin twin and the un-stepped-forward twin are CAUGHT", () => {
  const base = attractBase();

  // (a) inverted odd-spin parity, on the odd-spin fall-through case -> the head's RANDOM stir is skipped.
  const spinEntry = craft(base, { start: 0x40, bonus: 0x20, diff: 3, frame: 2, spin: 0x01 });
  const spinDiff = ramDiff(spinEntry, brokenInvertedSpin);
  assert.ok(spinDiff, "the inverted-spin twin escaped — the gate is worthless");
  assert.equal(spinDiff.addr, RANDOM, `expected the inverted-spin diff at RANDOM (${hx(RANDOM)}), got ${hx(spinDiff.addr)}`);

  // (b) un-stepped forward to loc_2c7b, on a start == bonus case -> the entry's +2 compare flips.
  const stepEntry = craft(base, { start: 0x20, bonus: 0x20 });
  const stepDiff = ramDiff(stepEntry, brokenStepForward);
  assert.ok(stepDiff, "the un-stepped-forward twin escaped — the gate is worthless");
  assert.equal(stepDiff.addr, BARREL_CLAIM_MODE, `expected the un-stepped diff at ${hx(BARREL_CLAIM_MODE)}, got ${hx(stepDiff.addr)}`);

  console.log(`  TEETH: inverted-spin caught (RAM@${hx(spinDiff.addr)} ${spinDiff.a}->${spinDiff.b}); un-stepped caught (RAM@${hx(stepDiff.addr)} ${stepDiff.a}->${stepDiff.b})`);
});
