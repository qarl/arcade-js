// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1b38 (ROM 0x1B38) — the Down half of the ladder-climb input
 * dispatch.
 *
 * loc_1b38 branches on two cells, P1_INPUT (0x6010) and MARIO_ON_LADDER (0x6215):
 *   - DOWN bit (bit 3 = 0x08) SET: hand off to the climb-DOWN driver climbMarioDown, which
 *     paces and advances Mario's descent this frame. This arm does NOT read the on-ladder
 *     flag — holding Down drives the climb-down driver directly.
 *   - DOWN bit CLEAR + on-ladder flag ZERO: do nothing and return; no memory is written.
 *   - DOWN bit CLEAR + on-ladder flag NON-ZERO: fall through to climbUpWhileHeld, which
 *     tests the UP bit and climbs up if it is held.
 * climbMarioDown and climbUpWhileHeld are already idiomatic and direct-called; the oracle
 * reaches them by `m.call`, so this gate also composes their own equivalence (and callees').
 *
 * The oracle is entered by a tail-call from dispatchMarioMovement / armMarioClimbAtLadderEnd, takes no register
 * live-in it does not immediately overwrite, and every path nets exactly ONE `ret`: the
 * Down arm tail-jumps into 0x1CF2 whose chain ends in a single `ret`, the Up-fall-through
 * arm tail-jumps into 0x1B45 whose chain ends in a single `ret`, and the idle arm does its
 * own `ret`. The idiomatic routine models no stack (a direct call + a plain JS return), so
 * the harness performs ONE m.ret() on the candidate clone after the call to line pc + SP up
 * with the oracle. Transient push/pop the oracle's deeper callees do lands in STACK_SCRATCH,
 * excluded by the memory-equivalence contract (RAM − the stack scratch below the entry SP + pc + SP; live-out is
 * memory-only).
 *
 *   1. EQUAL (real dispatches) — hook 0x1B38 in a real attract run and compare oracle vs
 *      candidate on RAM + pc + SP for every captured entry. The movement machine reaches
 *      here only while Mario is on a ladder, and the attract demo only ever climbs UP, so
 *      every real dispatch takes the Up fall-through arm; the Down arm and the idle arm are
 *      covered by the crafted sweeps.
 *
 *   2. EQUAL (input sweep) — from a real captured state, sweep P1_INPUT over all 256 values
 *      (with the ladder flag forced non-zero, then forced zero), comparing both sides each
 *      time. This pins the exact bit-3 Down test and the on-ladder guard: exactly the 128
 *      values with bit 3 set take the Down arm regardless of the ladder flag, and with the
 *      ladder flag zero the bit-3-clear values idle. Non-vacuity: a crafted Down-held
 *      timer==0 entry reloads the move-step timer to 3 (climbMarioDown's climb pace); a
 *      crafted Up-held timer==0 entry reloads it to 4 (climbMarioUp's pace); and an idle
 *      entry writes nothing.
 *
 *   3. TEETH — three deliberately-broken twins, each MUST be caught:
 *      (a) inverted-down-guard — climbs down when Down is NOT held; caught on a Down-held,
 *          ladder-zero, timer==0 entry (oracle climbs down and writes, twin idles).
 *      (b) wrong-bit — tests the UP bit (bit 2) instead of the DOWN bit (bit 3) for the
 *          down branch; caught on a control word with only bit 3 set + ladder non-zero +
 *          timer==0 (oracle climbs down; twin skips down, falls through, Up bit clear, idles).
 *      (c) dropped-ladder-guard — omits the on-ladder gate on the fall-through, so it always
 *          delegates to climbUpWhileHeld; caught on a Down-clear, Up-held, ladder-ZERO,
 *          timer==0 entry (oracle idles; twin climbs up and writes).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1b38.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1b38 as oracle } from "../../translated/loc_1b38.js";
import { climbDownWhileHeld as candidate } from "../climbDownWhileHeld.js";
import { climbMarioDown } from "../climbMarioDown.js";     // ROM 0x1CF2
import { climbUpWhileHeld } from "../climbUpWhileHeld.js"; // ROM 0x1B45
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, P1_INPUT, MARIO_ON_LADDER, MARIO_MOVE_STEP_TIMER } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1b38;
const DOWN_BIT = 0x08; // bit 3 of the cooked control word = Down held
const UP_BIT = 0x04;   // bit 2 = Up held (the fall-through's selector)
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
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

/** Run the ORACLE on a fresh clone with the frame machinery neutralised, so a stray NMI
 *  cannot masquerade as a side effect. Its selected path ends in a `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  c.nextNmi = Infinity;
  c.nextBoundary = Infinity;
  oracle(c);
  return c;
}

function runCandidate(entry, fn) {
  const c = entry.clone();
  c.nextNmi = Infinity;
  c.nextBoundary = Infinity;
  fn(c);
  c.ret();
  return c;
}

function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

/** Clone at up to K real 0x1B38 dispatches. dispatchMarioMovement reaches here by `m.call(0x1b38)`,
 *  resolved through the registry the override overlays, so every real input-dispatch entry is caught. */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

/** Prefer a genuine mid-climb seed (on-ladder flag set) so the crafted climb arms advance a
 *  real ladder rather than a degenerate state. */
function pickSeed(caps) {
  return caps.find((c) => c.mem.read8(MARIO_ON_LADDER) !== 0) ?? caps[0];
}

/** A real captured state with the branch selectors poked: control word, on-ladder flag, and
 *  optionally the move-step pacer (to force climbMarioDown/Up's reload sub-arm). The real SP
 *  is kept (a valid return stack the game itself produced), so the ret modeling is honest. */
function craft(seed, { input, ladder, timer } = {}) {
  const e = seed.clone();
  if (input !== undefined) e.mem.write8(P1_INPUT, input);
  if (ladder !== undefined) e.mem.write8(MARIO_ON_LADDER, ladder);
  if (timer !== undefined) e.mem.write8(MARIO_MOVE_STEP_TIMER, timer);
  return e;
}

/** Broken twin (a): INVERTED-DOWN-GUARD — climbs down when Down is NOT held. */
function brokenInvertedDownGuard(m) {
  const { mem } = m;
  if ((mem.read8(P1_INPUT) & DOWN_BIT) === 0) { // BUG: should climb DOWN when the bit is SET
    climbMarioDown(m);
    return;
  }
  if (mem.read8(MARIO_ON_LADDER) === 0) return;
  climbUpWhileHeld(m);
}

/** Broken twin (b): WRONG-BIT — tests the UP bit (bit 2) instead of the DOWN bit (bit 3). */
function brokenWrongBit(m) {
  const { mem } = m;
  if (mem.read8(P1_INPUT) & UP_BIT) { // BUG: 0x04 is the Up bit, not Down (0x08)
    climbMarioDown(m);
    return;
  }
  if (mem.read8(MARIO_ON_LADDER) === 0) return;
  climbUpWhileHeld(m);
}

/** Broken twin (c): DROPPED-LADDER-GUARD — always delegates to the up-climb path, ignoring
 *  the on-ladder flag on the fall-through. */
function brokenDroppedLadderGuard(m) {
  const { mem } = m;
  if (mem.read8(P1_INPUT) & DOWN_BIT) {
    climbMarioDown(m);
    return;
  }
  climbUpWhileHeld(m); // BUG: dropped the `if (on-ladder == 0) return;` gate
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x1B38 is dispatched during attract (Up fall-through natural; Down/idle crafted)", () => {
  const caps = captureDispatches(256, 8000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1B38 dispatch — the movement machine routes here");
  const down = caps.filter((c) => (c.mem.read8(P1_INPUT) & DOWN_BIT) !== 0).length;
  const onLadder = caps.filter((c) => c.mem.read8(MARIO_ON_LADDER) !== 0).length;
  assert.ok(onLadder >= 1, "expected at least one on-ladder dispatch — attract climbs ladders");
  console.log(`  REACHABILITY: ${caps.length} natural 0x1B38 dispatches (${down} Down-held, ${onLadder} on-ladder; Down/idle arms exercised by crafted sweeps)`);
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): loc_1b38 == oracle on every captured 0x1B38 entry", () => {
  const caps = captureDispatches(256, 8000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1B38 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, candidate); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP`);
});

// -- 2. EQUAL (input + ladder sweep) ------------------------------------------

test("EQUAL (input sweep): all 256 P1_INPUT values match the oracle, ladder set and clear", () => {
  const caps = captureDispatches(4, 8000);
  assert.ok(caps.length >= 1, "need one real capture to seed the input sweep with real RAM");
  const seed = pickSeed(caps);

  // Sweep the control word over every value, once with the ladder flag forced non-zero
  // (exercises Down arm vs Up fall-through) and once forced zero (exercises Down arm vs idle).
  for (const ladder of [1, 0]) {
    let downArm = 0, other = 0;
    for (let v = 0; v < 256; v++) {
      const entry = craft(seed, { input: v, ladder });
      const diffs = contractDiffs(entry, candidate);
      assert.equal(diffs.length, 0, `input=${hx(v)} ladder=${ladder}: ${diffs.join("; ")}`);
      if ((v & DOWN_BIT) !== 0) downArm++; else other++;
    }
    assert.equal(downArm, 128, `ladder=${ladder}: exactly the 128 values with bit 3 set take the Down arm`);
    assert.equal(other, 128, `ladder=${ladder}: exactly the 128 values with bit 3 clear skip the Down arm`);
  }

  // Non-vacuity, Down arm: Down held + move-step pacer expired — the oracle runs the
  // climb-down driver, which reloads the pacer to 3 (its climb pace). Holds even with the
  // ladder flag zero (the Down arm never reads it).
  const downEntry = craft(seed, { input: DOWN_BIT, ladder: 0, timer: 0 });
  const afterDown = runOracle(downEntry);
  assert.equal(afterDown.mem.read8(MARIO_MOVE_STEP_TIMER), 3, "Down arm reloads the move-step pacer to 3 (climb-down pace)");
  assert.ok(changedAddrs(downEntry, afterDown, downEntry.regs.sp).length >= 1, "Down arm must write memory (it climbs)");

  // Non-vacuity, Up fall-through arm: Down clear + Up held + on ladder + pacer expired — the
  // oracle falls through to the up-climb driver, which reloads the pacer to 4 (its pace).
  const upEntry = craft(seed, { input: UP_BIT, ladder: 1, timer: 0 });
  const afterUp = runOracle(upEntry);
  assert.equal(afterUp.mem.read8(MARIO_MOVE_STEP_TIMER), 4, "Up fall-through arm reloads the move-step pacer to 4 (climb-up pace)");

  // Non-vacuity, idle arm: Down clear + ladder zero — nothing non-stack is written.
  const idleEntry = craft(seed, { input: 0x00, ladder: 0 });
  const afterIdle = runOracle(idleEntry);
  assert.deepEqual(changedAddrs(idleEntry, afterIdle, idleEntry.regs.sp), [], "idle arm must not write any non-stack RAM");

  console.log(`  EQUAL/sweep: 512 (input×ladder) entries identical on RAM+pc+SP; Down arm reloads pacer->3, Up fall-through ->4, idle writes nothing`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: inverted-down-guard, wrong-bit, and dropped-ladder-guard twins are CAUGHT", () => {
  const caps = captureDispatches(4, 8000);
  assert.ok(caps.length >= 1, "need a real capture to seed the teeth baits");
  const seed = pickSeed(caps);

  // (a) inverted-down-guard: Down held + ladder zero + pacer expired. The oracle takes the
  //     Down arm and climbs (reloads the pacer, moves Mario); the twin's inverted test skips
  //     the Down arm, then idles (ladder zero). Disjoint memory → caught.
  const invBait = craft(seed, { input: DOWN_BIT, ladder: 0, timer: 0 });
  assert.equal(runOracle(invBait).mem.read8(MARIO_MOVE_STEP_TIMER), 3, "inverted bait must reach the Down climb on the oracle");
  const inverted = contractDiffs(invBait, brokenInvertedDownGuard);
  assert.ok(inverted.length > 0, "the inverted-down-guard twin escaped — the gate is worthless");

  // (b) wrong-bit: only bit 3 set (Up bit clear) + ladder non-zero + pacer expired. The
  //     oracle climbs down (bit 3); the twin tests bit 2 (clear), skips the Down arm, falls
  //     through with Up clear, and idles. Caught — and this pins the "Down" bit (0x08, not 0x04).
  const bitBait = craft(seed, { input: DOWN_BIT, ladder: 1, timer: 0 }); // 0x08: Down set, Up clear
  const wrongBit = contractDiffs(bitBait, brokenWrongBit);
  assert.ok(wrongBit.length > 0, "the wrong-bit twin escaped — the gate is worthless");

  // (c) dropped-ladder-guard: Down clear + Up held + ladder ZERO + pacer expired. The oracle
  //     idles (Down clear, not on ladder); the twin drops the ladder gate, delegates to the
  //     up-climb path, and (Up held) climbs — writing memory. Caught, pinning the ladder guard.
  const ladderBait = craft(seed, { input: UP_BIT, ladder: 0, timer: 0 });
  assert.deepEqual(changedAddrs(ladderBait, runOracle(ladderBait), ladderBait.regs.sp), [], "ladder bait must idle on the oracle");
  const droppedLadder = contractDiffs(ladderBait, brokenDroppedLadderGuard);
  assert.ok(droppedLadder.length > 0, "the dropped-ladder-guard twin escaped — the gate is worthless");

  console.log(`  TEETH: inverted-down-guard caught (${inverted[0]}); wrong-bit caught (${wrongBit[0]}); dropped-ladder-guard caught (${droppedLadder[0]})`);
});
