// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for advanceMarioAirborneFrame (ROM 0x1BB2) — the airborne frame's head: snapshot Mario's
 * pre-motion position, advance the ballistic arc, then let the horizontal position gate
 * steer him toward one of the two edge arms.
 *
 * advanceMarioAirborneFrame is NOT a leaf. It direct-calls two already-idiomatic leaves (stepBallisticMotion
 * 0x239C, limitMarioHorizontalTravel 0x241F) and then TAIL-CALLS the airborne arms loc_1bf2 (0x1BF2) and
 * reverseMarioVerticalArc (0x1BD8), which are idiomatic too and run on — through their own still-oracle
 * remainder — to the sprite commit. The REFERENCE side is the frozen oracle end to end, so
 * the whole downstream cascade is part of the comparison: a wrong hand-off — a missed
 * snapshot, a wrong velocity byte, a stale facing bit, a flipped branch, a context-block
 * base the tails inherit wrong — surfaces as divergent RAM many routines later, not just
 * here. That also makes this an independent corroboration of the two tail routines.
 *
 * CONTRACT COMPARED: RAM − the stack scratch below the entry SP plus the routine's return value. The stack exclusion is
 * the standard memory-equivalence contract — the oracle brackets its leaf calls with push16/ret
 * that the direct calls dissolve. pc, SP and the register file are NOT compared: the airborne
 * cascade's tail m.call(0x1C05) was dissolved to a direct loc_1c05 call, so the terminal ret
 * leaves a different pc/SP/register file that no downstream game code reads (advanceMarioAirborneFrame's
 * LIVE-OUT is memory-only). The whole-game SP-inertness tests carry the SP guard, and RAM through
 * the ENTIRE tail cascade is byte-identical on every case below.
 *
 *   1. REACHABILITY — 0x1BB2 is naturally dispatched during plain attract (Mario jumps
 *      barrels unaided). No pokes, no coin.
 *
 *   2. EQUAL (captured) — replay every real attract dispatch oracle-vs-candidate. These all
 *      take the ROM 0x1BF2 arm: attract plays 25m with Mario low on the girders, so the
 *      position gate always returns its (0,0) verdict. Stated honestly rather than claimed
 *      as full-arm coverage — the fall-through arm is crafted below.
 *
 *   3. CRAFTED (arms attract never reaches) — take a REAL captured state and poke only the
 *      position/velocity inputs the gate reads, identically on both sides, to drive: the
 *      far-left push-right arm (with the landing tail's fatal-fall split both ways), the
 *      in-band push-right arm, the far-right edge arm (which proves the verdict flag loc_1bf2
 *      reads out of the register bank is intact), and an even-board entry.
 *
 *   4. TEETH — four broken twins, each of which the gate MUST catch at a live cell:
 *      (a) snapshot taken AFTER the motion instead of before,
 *      (b) branch polarity inverted (the two arms swapped),
 *      (c) the push-right velocity written leftward,
 *      (d) the facing bit cleared instead of set.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1bb2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1bb2 as oracle } from "../../translated/loc_1bb2.js";
import { advanceMarioAirborneFrame as candidate } from "../advanceMarioAirborneFrame.js";
import { stepBallisticMotion } from "../stepBallisticMotion.js";
import { limitMarioHorizontalTravel } from "../limitMarioHorizontalTravel.js";
import { loc_1bf2 } from "../loc_1bf2.js";
import { reverseMarioVerticalArc } from "../reverseMarioVerticalArc.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_ACTIVE,
  MARIO_X,
  MARIO_X_FRAC,
  MARIO_Y,
  MARIO_Y_FRAC,
  MARIO_SPRITE_CODE,
  MARIO_AIR_PREV_X,
  MARIO_AIR_PREV_Y,
  MARIO_AIR_VX_HI,
  MARIO_AIR_VX_LO,
  MARIO_AIR_VY_HI,
  MARIO_AIR_VY_LO,
  MARIO_AIR_FRAMES,
  MARIO_FATAL_FALL,
  BOARD,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1bb2;
const ATTRACT_FRAMES = 2000;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** First differing RAM byte outside the stack scratch below the entry SP, or null. */
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

/** EVERY differing live (non-stack) RAM address between two machines. */
function ramDiffAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = new Set();
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (!dead(addr)) out.add(addr);
  }
  return out;
}

/** Diffs inside the excluded stack region (diagnostic only — proves the exclusion is used). */
function stackDiffCount(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  let c = 0;
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] !== db[i] && dead(a.stateOffsetToAddr(i))) c++;
  }
  return c;
}

/**
 * Run the oracle and `fn` on two fresh clones of `entry` and report every contract
 * violation: RAM − the stack scratch below the entry SP and the forwarded return value (pc/SP/registers are seam artifacts, excluded).
 */
function contractDiffs(entry, fn) {
  const a = entry.clone(); const wantRet = oracle(a);
  const b = entry.clone(); const gotRet = fn(b);
  const diffs = [];
  const ram = firstRamDiff(a, b, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  // pc/SP and the whole register file dropped: the tail m.call(0x1C05) was dissolved to a direct
  // loc_1c05 call in the airborne cascade, so pc, SP and the register file left by the terminal
  // ret are now seam artifacts. advanceMarioAirborneFrame's LIVE-OUT is memory-only (no register
  // live-out), so RAM − the stack scratch below the entry SP + the return value is the whole contract; whole-game
  // SP-inertness tests guard SP.
  if (wantRet !== gotRet) diffs.push(`return oracle=${wantRet} cand=${gotRet}`);
  return diffs;
}

/**
 * Which arm does this entry take? Decided with the FROZEN pieces only — replay the head
 * (snapshot + 0x239C + 0x241F) on a throwaway clone by ROM address and read the gate's D.
 * Classification only; never used as the equivalence assertion.
 */
function armOf(entry) {
  const c = entry.clone();
  const { regs, mem } = c;
  regs.ix = MARIO_ACTIVE;
  mem.write8(MARIO_AIR_PREV_X, mem.read8(MARIO_X));
  mem.write8(MARIO_AIR_PREV_Y, mem.read8(MARIO_Y));
  c.call(0x239c);
  c.call(0x241f);
  return regs.d === 1 ? "push-right" : "edge-arm";
}

/** Hook 0x1BB2 in a plain attract run and clone the machine at each real dispatch. */
function captureDispatches(frames, cap = Infinity) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < cap) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(frames);
  return caps;
}

/** Apply a poke set (addr -> byte) to a machine. */
function poke(m, pokes) {
  for (const [addr, val] of pokes) m.mem.write8(addr, val);
}

/** A real captured state with `pokes` applied — the crafted-entry construction. */
function craft(base, pokes) {
  const c = base.clone();
  poke(c, pokes);
  return c;
}

// The crafted arms. Each poke set touches ONLY the cells the position gate and the ballistic
// step read, so the rest of the state stays the real mid-jump machine it was captured from.
const ZERO_MOTION = [
  [MARIO_X_FRAC, 0], [MARIO_AIR_VX_HI, 0], [MARIO_AIR_VX_LO, 0],
  [MARIO_Y_FRAC, 0], [MARIO_AIR_VY_HI, 0], [MARIO_AIR_VY_LO, 0], [MARIO_AIR_FRAMES, 0],
];

const CRAFTED = [
  {
    label: "far-left (post-motion X < 0x16) -> push-right, landing tail with fatal-fall clear",
    pokes: [...ZERO_MOTION, [MARIO_X, 0x10], [MARIO_Y, 0x90], [MARIO_FATAL_FALL, 0]],
    arm: "push-right",
  },
  {
    label: "far-left -> push-right, landing tail with fatal-fall SET (skips the 0x2407 arm)",
    pokes: [...ZERO_MOTION, [MARIO_X, 0x10], [MARIO_Y, 0x90], [MARIO_FATAL_FALL, 1]],
    arm: "push-right",
  },
  {
    label: "in-band (odd board, X in [0x16,0x6C), Y < 0x58) -> push-right",
    pokes: [...ZERO_MOTION, [MARIO_X, 0x40], [MARIO_Y, 0x30], [BOARD, 1], [MARIO_FATAL_FALL, 0]],
    arm: "push-right",
  },
  {
    label: "far-right (post-motion X >= 0xEA) -> edge arm's mirrored left push",
    pokes: [...ZERO_MOTION, [MARIO_X, 0xf0], [MARIO_Y, 0x90], [MARIO_FATAL_FALL, 0]],
    arm: "edge-arm",
  },
  {
    label: "even board blocks the gate -> edge arm falls through to the 0x1C05 dispatch",
    pokes: [...ZERO_MOTION, [MARIO_X, 0x40], [MARIO_Y, 0x30], [BOARD, 2]],
    arm: "edge-arm",
  },
];

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x1BB2 is naturally dispatched during plain attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(ATTRACT_FRAMES);
  assert.ok(count > 0, "0x1BB2 should be dispatched — attract jumps barrels, and every airborne frame lands here");
  console.log(`  REACHABILITY: ${count} natural 0x1BB2 dispatches in ${ATTRACT_FRAMES} attract frames`);
});

// -- 2. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): advanceMarioAirborneFrame == oracle on every real attract dispatch", () => {
  const caps = captureDispatches(ATTRACT_FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x1BB2 dispatch");

  let stackExcluded = 0;
  const arms = new Map();
  for (const cap of caps) {
    const diffs = contractDiffs(cap, candidate);
    assert.equal(
      diffs.length,
      0,
      `real dispatch (X=${hx(cap.mem.read8(MARIO_X))} Y=${hx(cap.mem.read8(MARIO_Y))}): ${diffs.join("; ")}`,
    );
    const arm = armOf(cap);
    arms.set(arm, (arms.get(arm) ?? 0) + 1);
    const a = cap.clone(); oracle(a);
    const b = cap.clone(); candidate(b);
    stackExcluded += stackDiffCount(a, b, cap.regs.sp);
  }

  // Honest reachability statement: attract only ever produces the gate's blocked verdict.
  assert.equal(
    arms.get("push-right") ?? 0,
    0,
    "attract reached the push-right arm — the header's crafted-only claim would be stale",
  );
  console.log(
    `  EQUAL/captured: ${caps.length} real dispatches identical (RAM−stack + return); ` +
      `arms seen: ${[...arms.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}; ` +
      `${stackExcluded} byte(s) of excluded stack scratch`,
  );
});

// -- 3. CRAFTED (arms attract never reaches) ----------------------------------

test("CRAFTED: every gate arm driven from a real state — advanceMarioAirborneFrame == oracle", () => {
  const [base] = captureDispatches(ATTRACT_FRAMES, 1);
  assert.ok(base, "expected a real 0x1BB2 dispatch to seed the crafted states");

  const seen = new Set();
  for (const c of CRAFTED) {
    const entry = craft(base, c.pokes);
    // The poke set must actually drive the arm it claims, or the case proves nothing.
    assert.equal(armOf(entry), c.arm, `crafted case "${c.label}" did not reach the ${c.arm} arm`);
    const diffs = contractDiffs(entry, candidate);
    assert.equal(diffs.length, 0, `crafted "${c.label}": ${diffs.join("; ")}`);
    seen.add(c.arm);
  }
  assert.deepEqual([...seen].sort(), ["edge-arm", "push-right"], "crafted set must cover BOTH arms");
  console.log(`  CRAFTED: ${CRAFTED.length} real-state arms identical to the oracle (both arms covered)`);
});

// -- 4. TEETH -----------------------------------------------------------------

/**
 * Broken twins. Each is a copy of advanceMarioAirborneFrame with exactly one thing wrong; each must be caught
 * at a LIVE (non-stack) cell, never at a stack-scratch ghost.
 */

/** (a) Snapshot taken AFTER the ballistic step — the previous-position pair is a frame late. */
function brokenSnapshotAfterMotion(m) {
  const { regs, mem } = m;
  regs.ix = MARIO_ACTIVE;
  stepBallisticMotion(m);
  mem.write8(MARIO_AIR_PREV_X, mem.read8(MARIO_X)); // BUG: after the motion, not before
  mem.write8(MARIO_AIR_PREV_Y, mem.read8(MARIO_Y));
  const { d } = limitMarioHorizontalTravel(m);
  if (d !== 1) return loc_1bf2(m);
  mem.write8(MARIO_AIR_VX_HI, 0);
  mem.write8(MARIO_AIR_VX_LO, 128);
  mem.write8(MARIO_SPRITE_CODE, mem.read8(MARIO_SPRITE_CODE) | 0x80);
  return reverseMarioVerticalArc(m);
}

/** (b) Branch polarity inverted — the two arms swapped. */
function brokenArmsSwapped(m) {
  const { regs, mem } = m;
  regs.ix = MARIO_ACTIVE;
  mem.write8(MARIO_AIR_PREV_X, mem.read8(MARIO_X));
  mem.write8(MARIO_AIR_PREV_Y, mem.read8(MARIO_Y));
  stepBallisticMotion(m);
  const { d } = limitMarioHorizontalTravel(m);
  if (d === 1) return loc_1bf2(m); // BUG: polarity inverted
  mem.write8(MARIO_AIR_VX_HI, 0);
  mem.write8(MARIO_AIR_VX_LO, 128);
  mem.write8(MARIO_SPRITE_CODE, mem.read8(MARIO_SPRITE_CODE) | 0x80);
  return reverseMarioVerticalArc(m);
}

/** (c) The push-right velocity written leftward (high byte 0xFF instead of 0). */
function brokenVelocityLeftward(m) {
  const { regs, mem } = m;
  regs.ix = MARIO_ACTIVE;
  mem.write8(MARIO_AIR_PREV_X, mem.read8(MARIO_X));
  mem.write8(MARIO_AIR_PREV_Y, mem.read8(MARIO_Y));
  stepBallisticMotion(m);
  const { d } = limitMarioHorizontalTravel(m);
  if (d !== 1) return loc_1bf2(m);
  mem.write8(MARIO_AIR_VX_HI, 0xff); // BUG: drifts left instead of right
  mem.write8(MARIO_AIR_VX_LO, 128);
  mem.write8(MARIO_SPRITE_CODE, mem.read8(MARIO_SPRITE_CODE) | 0x80);
  return reverseMarioVerticalArc(m);
}

/** (d) The facing bit CLEARED instead of set. */
function brokenFacingCleared(m) {
  const { regs, mem } = m;
  regs.ix = MARIO_ACTIVE;
  mem.write8(MARIO_AIR_PREV_X, mem.read8(MARIO_X));
  mem.write8(MARIO_AIR_PREV_Y, mem.read8(MARIO_Y));
  stepBallisticMotion(m);
  const { d } = limitMarioHorizontalTravel(m);
  if (d !== 1) return loc_1bf2(m);
  mem.write8(MARIO_AIR_VX_HI, 0);
  mem.write8(MARIO_AIR_VX_LO, 128);
  mem.write8(MARIO_SPRITE_CODE, mem.read8(MARIO_SPRITE_CODE) & 0x7f); // BUG: clears the facing bit
  return reverseMarioVerticalArc(m);
}

/**
 * Run a twin against `entry` and report both the contract violations and the full set of
 * live RAM addresses it corrupted. `mustTouch` names a cell the twin is REQUIRED to have
 * broken — the specific-cell assertion, so a twin caught only by some incidental knock-on
 * still fails the check.
 */
function teeth(entry, twin, label, mustTouch) {
  const diffs = contractDiffs(entry, twin);
  assert.ok(diffs.length > 0, `the ${label} twin escaped the gate entirely — the gate is worthless`);
  const a = entry.clone(); oracle(a);
  const b = entry.clone(); twin(b);
  const addrs = ramDiffAddrs(a, b, entry.regs.sp);
  assert.ok(addrs.size > 0, `the ${label} twin diverged only outside RAM — not a live-cell catch`);
  if (mustTouch !== undefined) {
    assert.ok(
      mustTouch.some((addr) => addrs.has(addr)),
      `the ${label} twin was not caught at ${mustTouch.map(hx).join("/")} — live cells hit: ` +
        [...addrs].sort((x, y) => x - y).map(hx).join(","),
    );
  }
  return `${label}: ${addrs.size} live cell(s), first ${diffs[0]}`;
}

test("TEETH: all four broken twins are CAUGHT at live cells", () => {
  const caps = captureDispatches(ATTRACT_FRAMES);
  assert.ok(caps.length >= 1, "need real dispatches to run the teeth against");
  const [base] = caps;

  // The push-right twins need a state on that arm; force the facing bit clear so a
  // set-vs-clear twin is observable at all.
  const pushRight = craft(base, [
    ...ZERO_MOTION,
    [MARIO_X, 0x10], [MARIO_Y, 0x90], [MARIO_FATAL_FALL, 0],
    [MARIO_SPRITE_CODE, base.mem.read8(MARIO_SPRITE_CODE) & 0x7f],
  ]);
  assert.equal(armOf(pushRight), "push-right", "the teeth state must reach the push-right arm");

  // (a) and (b) are caught on REAL dispatches — the snapshot is written on every entry, and
  // swapping the arms sends every real (0,0) entry down the wrong path.
  const reports = [
    teeth(base, brokenSnapshotAfterMotion, "snapshot-after-motion", [MARIO_AIR_PREV_X, MARIO_AIR_PREV_Y]),
    teeth(base, brokenArmsSwapped, "arms-swapped", [MARIO_AIR_VX_HI, MARIO_AIR_VX_LO]),
    // (c) and (d) need the crafted push-right state.
    teeth(pushRight, brokenVelocityLeftward, "leftward-velocity", [MARIO_AIR_VX_HI]),
    teeth(pushRight, brokenFacingCleared, "cleared-facing", [MARIO_SPRITE_CODE]),
  ];

  console.log(`  TEETH: ${reports.join(" | ")}`);
});
