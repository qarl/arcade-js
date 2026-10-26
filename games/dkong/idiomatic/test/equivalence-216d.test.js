// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for startBarrelDescentAtLadder (ROM 0x216D) — grade an object against
 * difficulty/position/input and, on a pass, advance its record.
 *
 * startBarrelDescentAtLadder looks the caller's key up in the type-0 object table (findOppositeLadderEnd). A table MISS
 * unwinds on the caller's behalf; a hit tagged 0 (not 1) is rejected. A tag-1 hit always
 * stamps record field +0x17 with (paired-slot − 5), then runs a chain of gates deciding
 * whether the object ALSO advances (bump +0x07, set bit0 of +0x02). Its only work-RAM
 * effects are those three record fields (indexed off the object pointer); it leaves no
 * live register (the sole caller's tail swaps the bank and overwrites the accumulator),
 * so the contract is memory-only:
 *   - RAM identical minus the stack scratch below the entry SP. The oracle's `call 0x236e` push, findOppositeLadderEnd's
 *     internal push/pop, and startBarrelDescentAtLadder's `ret`/double-unwind all churn the stack; the
 *     idiomatic routine dissolves them (direct call + JS returns), so the dead stack
 *     region is the one exclusion this gate needs. No register or pc/SP is compared —
 *     they are all dead live-out.
 *
 *   1. REACHABILITY — 0x216D dispatches during boot/attract (object grading runs in the
 *      25m demo; ~600 dispatches / 4000 frames).
 *
 *   2. EQUAL (captured) — hook 0x216D in a real attract run, clone at each dispatch, and
 *      confirm startBarrelDescentAtLadder == oracle on RAM − the stack scratch below the entry SP over every real state. Real runs
 *      span the clear/set spawn-gate arms and the advance path.
 *
 *   3. EQUAL (crafted) — plant a controlled table + pokes in a real attract base to hit
 *      every arm: the table MISS, the tag-0 reject, the clear-gate advance, a rescan then
 *      tag-1 advance, the vertical reject, the throttle reject, on-column advance, both
 *      held-input advances, and the random-0x18 tail (advance and reject). Each asserts
 *      the oracle's own arm non-vacuously (no write / stamp only / full advance).
 *
 *   4. TEETH — two broken twins the SAME contract MUST catch:
 *        (a) wrong stamp — writes (slot − 4) into +0x17; caught by RAM@+0x17.
 *        (b) skipped grading — advances even when a gate should reject; caught by RAM@+0x07.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-216d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_216d as oracle } from "../../translated/loc_216d.js";
import { startBarrelDescentAtLadder } from "../startBarrelDescentAtLadder.js";
import { findOppositeLadderEnd } from "../findOppositeLadderEnd.js";
import { Machine } from "../../machine.js";
import { u8 } from "../../../../core/int.js";
import {
  STACK_SCRATCH,
  OBJ_PARAM_TABLE0,
  MARIO_X,
  MARIO_Y,
  DIFFICULTY,
  RANDOM,
  P1_INPUT,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x216d;
const SPAWN_MODE_GATE = 0x6348; // names.js keeps it hex (multiplexed engine scratch)
const NEAR = 0x15;              // near paired-slot offset past the matched byte
const FAR = 0x2a;               // far paired-slot offset past the matched byte

// Crafted-entry constants.
const SAFE_SP = 0x6bf8;         // stack inside STACK_SCRATCH so dead pushes land excluded
const RET_ADDR = 0x216a;        // 216d's real return target (loc_215f's jp); pc is never compared
const KEY = 0x42;               // the search key planted in the table and set in the register
const FILLER = 0x00;            // != KEY, so a cleared table slot never fakes a hit
const IX_BASE = 0x6500;         // object record base; +0x17/+0x07/+0x02 land in clean work RAM
const DISC = 0x30;              // discriminator for tag-1 hits (planted as the near slot)
const FAR_SLOT = 0x77;          // far slot value returned on a tag-1 hit
const STAMP = u8(FAR_SLOT - 5); // what +0x17 becomes on a tag-1 hit (0x72)
const PRE17 = 0xee;             // record +0x17 pre-value (!= STAMP, so the stamp is observable)
const PRE07 = 0x40;             // record +0x07 pre-value (advance bumps it to 0x41)
const PRE02 = 0x00;             // record +0x02 pre-value (advance sets bit0 -> 0x01)

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs, skipping the stack scratch below the entry SP. { addr, a, b } | null.
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

// All non-stack RAM addresses that changed between two machines (for non-vacuity checks).
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

/**
 * Run the oracle and a candidate on two fresh, byte-identical clones (frame machinery
 * neutralised so a stray NMI cannot masquerade as a side effect) and return the memory
 * contract diffs: RAM − the stack scratch below the entry SP. Live-out is memory-only, so no register/pc/SP.
 */
function contractDiffs(entry, candidate) {
  const a = entry.clone(); a.nextNmi = Infinity; a.nextBoundary = Infinity;
  const b = entry.clone(); b.nextNmi = Infinity; b.nextBoundary = Infinity;
  oracle(a);
  candidate(b);
  const diffs = [];
  const ram = firstRamDiff(a, b, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  return diffs;
}

/** Run the oracle alone on a fresh clone and return the resulting machine. */
function runOracle(entry) {
  const p = entry.clone(); p.nextNmi = Infinity; p.nextBoundary = Infinity;
  oracle(p);
  return p;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds
// realistic values. clone() neutralises the frame machinery (nextNmi/nextBoundary = Inf).
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

/**
 * Plant a controlled object table onto a clone of `base`, seed the object record, set the
 * register live-ins, and apply optional cell pokes. `entries` are { off, near, far }: the
 * key at 0x6300+off with its near (+0x15) and far (+0x2A) slots. The scan window is cleared
 * to FILLER first so the search matches ONLY the planted keys, in order.
 */
function craft(base, { count = 0x15, disc = DISC, entries = [], gate, marioY, marioX, difficulty, rng, input }) {
  const m = base.clone();
  m.regs.sp = SAFE_SP;
  m.push16(RET_ADDR);
  for (let i = 0; i < 0x40; i++) m.mem.write8((OBJ_PARAM_TABLE0 + i) & 0xffff, FILLER);
  for (const e of entries) {
    m.mem.write8((OBJ_PARAM_TABLE0 + e.off) & 0xffff, KEY);
    m.mem.write8((OBJ_PARAM_TABLE0 + e.off + NEAR) & 0xffff, e.near);
    m.mem.write8((OBJ_PARAM_TABLE0 + e.off + FAR) & 0xffff, e.far);
  }
  // Seed the object record so writes are observable.
  m.mem.write8((IX_BASE + 0x17) & 0xffff, PRE17);
  m.mem.write8((IX_BASE + 0x07) & 0xffff, PRE07);
  m.mem.write8((IX_BASE + 0x02) & 0xffff, PRE02);
  m.regs.ix = IX_BASE;
  m.regs.a = KEY;
  m.regs.bc = count;
  m.regs.d = disc;
  if (gate !== undefined) m.mem.write8(SPAWN_MODE_GATE, gate);
  if (marioY !== undefined) m.mem.write8(MARIO_Y, marioY);
  if (marioX !== undefined) m.mem.write8(MARIO_X, marioX);
  if (difficulty !== undefined) m.mem.write8(DIFFICULTY, difficulty);
  if (rng !== undefined) m.mem.write8(RANDOM, rng);
  if (input !== undefined) m.mem.write8(P1_INPUT, input);
  return m;
}

const rec = (off) => (IX_BASE + off) & 0xffff;

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x216D is dispatched during boot/attract", () => {
  let count = 0;
  const orig = new Machine(ROM).routines.get(TARGET);
  const snap = new Map([[TARGET, (mm) => { count++; return orig(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  assert.ok(count > 0, "0x216D should dispatch — object grading runs during the attract demo");
  console.log(`  REACHABILITY: ${count} natural 0x216D dispatches in 1500 frames`);
});

// -- 2. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): startBarrelDescentAtLadder == oracle on every real dispatch", () => {
  const orig = new Machine(ROM).routines.get(TARGET);
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 250) caps.push(mm.clone());
    return orig(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x216D dispatch during attract");

  let sawGateClear = 0, sawGateSet = 0, sawAdvance = 0;
  for (const cap of caps) {
    const diffs = contractDiffs(cap, startBarrelDescentAtLadder);
    assert.equal(diffs.length, 0, `captured dispatch (A=${hx(cap.regs.a)} BC=${hx(cap.regs.bc)} D=${hx(cap.regs.d)} IX=${hx(cap.regs.ix)}): ${diffs.join("; ")}`);
    // Classify the oracle's arm for coverage evidence.
    if (cap.mem.read8(SPAWN_MODE_GATE) === 0) sawGateClear++; else sawGateSet++;
    const before = cap.mem.read8((cap.regs.ix + 0x07) & 0xffff);
    if (runOracle(cap).mem.read8((cap.regs.ix + 0x07) & 0xffff) !== before) sawAdvance++;
  }
  assert.ok(sawGateSet > 0, `real dispatches should exercise the set-gate grading path (set=${sawGateSet})`);
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical to the oracle (gate-clear ${sawGateClear}, gate-set ${sawGateSet}, advance ${sawAdvance})`);
});

// -- 3. EQUAL (crafted, all arms) ---------------------------------------------

test("EQUAL (crafted): every miss/reject/advance arm matches the oracle", () => {
  const base = attractBase();

  // expect: "none" = no non-stack write; "stamp" = only +0x17; "advance" = +0x17,+0x07,+0x02.
  const cases = [
    { name: "table miss", expect: "none",
      opts: { entries: [] } },
    { name: "tag-0 hit reject", expect: "none",
      opts: { entries: [{ off: 2, near: 0x11, far: DISC }] } },
    { name: "clear spawn-gate advance", expect: "advance",
      opts: { entries: [{ off: 2, near: DISC, far: FAR_SLOT }], gate: 0 } },
    { name: "rescan then tag-1 advance", expect: "advance",
      opts: { entries: [{ off: 2, near: 0x11, far: 0x22 }, { off: 5, near: DISC, far: FAR_SLOT }], gate: 0 } },
    { name: "vertical gate reject", expect: "stamp",
      opts: { entries: [{ off: 2, near: DISC, far: FAR_SLOT }], gate: 1, marioY: 0x10 } },
    { name: "throttle reject", expect: "stamp",
      opts: { entries: [{ off: 2, near: DISC, far: FAR_SLOT }], gate: 1, marioY: 0x80, difficulty: 4, rng: 0x03 } },
    { name: "on-column advance", expect: "advance",
      opts: { entries: [{ off: 2, near: DISC, far: FAR_SLOT }], gate: 1, marioY: 0x80, difficulty: 4, rng: 0x00, marioX: KEY } },
    { name: "past-column + Left held advance", expect: "advance",
      opts: { entries: [{ off: 2, near: DISC, far: FAR_SLOT }], gate: 1, marioY: 0x80, difficulty: 4, rng: 0x00, marioX: 0x50, input: 0x02 } },
    { name: "past-column + no input, random tail reject", expect: "stamp",
      opts: { entries: [{ off: 2, near: DISC, far: FAR_SLOT }], gate: 1, marioY: 0x80, difficulty: 4, rng: 0x08, marioX: 0x50, input: 0x00 } },
    { name: "past-column + no input, random tail advance", expect: "advance",
      opts: { entries: [{ off: 2, near: DISC, far: FAR_SLOT }], gate: 1, marioY: 0x80, difficulty: 4, rng: 0x00, marioX: 0x50, input: 0x00 } },
    { name: "before-column + Right held advance", expect: "advance",
      opts: { entries: [{ off: 2, near: DISC, far: FAR_SLOT }], gate: 1, marioY: 0x80, difficulty: 4, rng: 0x00, marioX: 0x30, input: 0x01 } },
    { name: "before-column + no input, random tail reject", expect: "stamp",
      opts: { entries: [{ off: 2, near: DISC, far: FAR_SLOT }], gate: 1, marioY: 0x80, difficulty: 4, rng: 0x10, marioX: 0x30, input: 0x00 } },
  ];

  for (const { name, expect, opts } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, startBarrelDescentAtLadder);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    // Non-vacuity: confirm the oracle really took the arm this case is meant to cover.
    const after = runOracle(entry);
    if (expect === "none") {
      assert.deepEqual(changedAddrs(entry, after, entry.regs.sp), [], `${name}: expected no non-stack write`);
    } else {
      assert.equal(after.mem.read8(rec(0x17)), STAMP, `${name}: +0x17 not stamped`);
      if (expect === "stamp") {
        assert.equal(after.mem.read8(rec(0x07)), PRE07, `${name}: +0x07 changed but should not have`);
        assert.equal(after.mem.read8(rec(0x02)), PRE02, `${name}: +0x02 changed but should not have`);
        assert.deepEqual(changedAddrs(entry, after, entry.regs.sp), [rec(0x17)], `${name}: expected ONLY +0x17 written`);
      } else { // advance
        assert.equal(after.mem.read8(rec(0x07)), u8(PRE07 + 1), `${name}: +0x07 not bumped`);
        assert.equal(after.mem.read8(rec(0x02)), PRE02 | 0x01, `${name}: +0x02 bit0 not set`);
      }
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (miss, tag-0, clear-gate, rescan, vertical, throttle, on-column, both held-input, both random-tail) identical to the oracle`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin (a): stamps (slot − 4) into +0x17 instead of (slot − 5). */
function brokenWrongStamp(m) {
  const { regs, mem } = m;
  const r = (off) => (regs.ix + off) & 0xffff;
  if (!findOppositeLadderEnd(m).hit) return;
  if (regs.a !== 1) return;
  mem.write8(r(0x17), u8(regs.b - 4)); // BUG: -4
  if (mem.read8(SPAWN_MODE_GATE) === 0) { // clear-gate advance path (matches the test case)
    mem.write8(r(0x07), mem.read8(r(0x07)) + 1);
    mem.write8(r(0x02), mem.read8(r(0x02)) | 0x01);
  }
}

/** Broken twin (b): advances unconditionally once the gate is set, skipping the grading. */
function brokenSkipGates(m) {
  const { regs, mem } = m;
  const r = (off) => (regs.ix + off) & 0xffff;
  if (!findOppositeLadderEnd(m).hit) return;
  if (regs.a !== 1) return;
  mem.write8(r(0x17), u8(regs.b - 5)); // correct stamp
  // BUG: no vertical / throttle / input grading — always advance.
  mem.write8(r(0x07), mem.read8(r(0x07)) + 1);
  mem.write8(r(0x02), mem.read8(r(0x02)) | 0x01);
}

test("TEETH: the wrong-stamp and skipped-grading twins are both CAUGHT", () => {
  const base = attractBase();

  // (a) wrong stamp — a clear-gate advance case: correct +0x17 = STAMP, twin = STAMP+1.
  const stampEntry = craft(base, { entries: [{ off: 2, near: DISC, far: FAR_SLOT }], gate: 0 });
  const stampDiffs = contractDiffs(stampEntry, brokenWrongStamp);
  assert.ok(stampDiffs.length > 0, "the wrong-stamp twin escaped — the RAM check is worthless");
  assert.ok(stampDiffs[0].startsWith(`RAM@${hx(rec(0x17))}`), `expected a +0x17 diff, got: ${stampDiffs.join("; ")}`);

  // (b) skipped grading — a vertical-reject case: oracle stamps only, twin also advances.
  const rejectEntry = craft(base, { entries: [{ off: 2, near: DISC, far: FAR_SLOT }], gate: 1, marioY: 0x10 });
  const skipDiffs = contractDiffs(rejectEntry, brokenSkipGates);
  assert.ok(skipDiffs.length > 0, "the skipped-grading twin escaped — the gate chain is unverified");
  const advanceCell = skipDiffs[0].startsWith(`RAM@${hx(rec(0x02))}`) || skipDiffs[0].startsWith(`RAM@${hx(rec(0x07))}`);
  assert.ok(advanceCell, `expected an advance-field (+0x02/+0x07) diff, got: ${skipDiffs.join("; ")}`);

  console.log(`  TEETH: wrong-stamp caught (${stampDiffs.join("; ")}); skipped-grading caught (${skipDiffs.join("; ")})`);
});
