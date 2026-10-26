// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1d11 (ROM 0x1D11) — the shared climb-animation step body.
 *
 * loc_1d11 WRITES memory and is not a leaf. It advances MARIO_Y (0x6205) by the caller's
 * step (delivered in the accumulator — the honest `climbStep` parameter), flips the
 * two-phase ladder-centering toggle (0x6222), then dispatches to exactly one of three
 * already-idiomatic callees:
 *   - centerMarioAndCommitClimbStep (0x1D51) on the phase that flips the toggle non-zero;
 *   - endClimbAtLadderLimit (0x1D67) when (MARIO_Y + 8) equals either ladder extent limit
 *     (MARIO_CLIMB_LIMIT_B 0x621C, then MARIO_CLIMB_LIMIT_A 0x621B);
 *   - setClimbSpriteFrame (0x1D3F, frame 5/4/3) otherwise, chosen by distance above the
 *     near limit.
 * It is gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — never a
 * register file (live-out is memory-only; see the routine header), on a FRESH clone per
 * case (it writes RAM). The candidate calls the idiomatic callees directly; the oracle
 * runs the translated body which reaches those same three routines by `m.call`, so this
 * also composes the callees' own equivalence.
 *
 * The Z80 reaches its return by tail-jumping into whichever callee it selects, and each
 * callee's tail chain ends in a single `ret` — that is loc_1d11's single net return (both
 * callers, entry_1d03 / loc_1cf2, tail into this body, so the `ret` returns on their
 * behalf). The idiomatic routine models no stack (direct calls + a plain JS return), so
 * the harness performs ONE m.ret() on the candidate clone after the call to line pc + SP
 * up with the oracle. Transient push/pop the oracle's callees do lands in STACK_SCRATCH.
 *
 *   1. EQUAL (real dispatches) — hook 0x1D11 in a real attract run (the 25m demo climbs,
 *      so the step body dispatches here). oracle vs candidate must agree on RAM + pc + SP
 *      for every capture; the candidate takes its step from the captured accumulator.
 *
 *   2. EQUAL (crafted) — from a real captured state, force each control-flow arm: the
 *      center phase, both ladder-end exits (via LIMIT_B and via LIMIT_A), all three climb
 *      frames (distance 8/12/other), and a non-zero step to pin the MARIO_Y update+wrap.
 *      Each compared identically on both sides.
 *
 *   3. TEETH — three deliberately-broken twins, each MUST be caught:
 *      (a) dropped-step — skips the MARIO_Y update; diverges on MARIO_Y for a non-zero step.
 *      (b) dropped-toggle — skips the 0x6222 write; diverges on that byte.
 *      (c) wrong-frame — always picks frame 3; diverges on MARIO_SPRITE_CODE where the
 *          correct frame is 5 or 4.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1d11.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1d11 as oracle } from "../../translated/loc_1d11.js";
import { advanceClimbStep as loc_1d11 } from "../advanceClimbStep.js";
import { centerMarioAndCommitClimbStep } from "../centerMarioAndCommitClimbStep.js";
import { endClimbAtLadderLimit } from "../endClimbAtLadderLimit.js";
import { setClimbSpriteFrame } from "../setClimbSpriteFrame.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_Y,
  MARIO_CLIMB_LIMIT_A,
  MARIO_CLIMB_LIMIT_B,
  MARIO_ON_LADDER,
  MARIO_SPRITE_CODE,
} from "../names.js";
import { u8 } from "../../../../core/int.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1d11;
const CENTERING_PHASE = 0x6222; // shared climb-centering toggle (unnamed in names.js)
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead
 *  stack region the standard gate excludes — the oracle's callee `ret`/`call` pops read it). */
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

/** Run the ORACLE on a fresh clone. It reads its step from the accumulator, and its
 *  selected callee's tail chain ends in a `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone — passing the step from the captured accumulator, the
 *  honest live-in — then model its single net return with one m.ret() so pc + SP match the
 *  oracle's (the idiomatic routine uses the JS call stack and never touches pc/SP itself). */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c, c.regs.a);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. NO
 *  registers — live-out is memory-only. Returns human-readable mismatches. */
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

// -- capture ------------------------------------------------------------------

/** Hook 0x1D11 in a real attract run and clone the machine at up to K real dispatches.
 *  The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 *  undisturbed. entry_1d03/loc_1cf2 reach here by `m.call(0x1d11)`, resolved through the
 *  registry the override overlays, so every real climb-step dispatch is caught. */
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

/** A real captured state with the step (accumulator) and the cells that steer the arm
 *  poked. The real SP is kept (a valid return stack the game itself produced), so the ret
 *  modeling is honest. */
function craft(seed, { delta, marioY, phase, limitA, limitB }) {
  const e = seed.clone();
  e.regs.a = delta & 0xff;
  if (marioY !== undefined) e.mem.write8(MARIO_Y, marioY);
  if (phase !== undefined) e.mem.write8(CENTERING_PHASE, phase);
  if (limitA !== undefined) e.mem.write8(MARIO_CLIMB_LIMIT_A, limitA);
  if (limitB !== undefined) e.mem.write8(MARIO_CLIMB_LIMIT_B, limitB);
  return e;
}

// -- teeth twins (same signature as loc_1d11) ---------------------------------

/** Broken twin (a): DROPPED-STEP — never updates MARIO_Y, so for a non-zero step MARIO_Y
 *  diverges (the oracle wrote MARIO_Y + step). */
function brokenDropStep(m, climbStep) {
  const { mem } = m;
  const newY = mem.read8(MARIO_Y); // BUG: forgot `+ climbStep` and the store
  const phase = mem.read8(CENTERING_PHASE) ^ 1;
  mem.write8(CENTERING_PHASE, phase);
  if (phase !== 0) { centerMarioAndCommitClimbStep(m); return; }
  const probe = u8(newY + 8);
  if (probe === mem.read8(MARIO_CLIMB_LIMIT_B)) { endClimbAtLadderLimit(m); return; }
  const nearLimit = mem.read8(MARIO_CLIMB_LIMIT_A);
  if (probe === nearLimit) { endClimbAtLadderLimit(m); return; }
  const dist = u8(probe - nearLimit);
  setClimbSpriteFrame(m, dist === 8 ? 5 : dist === 12 ? 4 : 3);
}

/** Broken twin (b): DROPPED-TOGGLE — never writes the centering phase back, so 0x6222
 *  diverges (still takes the correct arm this entry). */
function brokenDropToggle(m, climbStep) {
  const { mem } = m;
  const newY = u8(mem.read8(MARIO_Y) + climbStep);
  mem.write8(MARIO_Y, newY);
  const phase = mem.read8(CENTERING_PHASE) ^ 1; // BUG: missing the write-back
  if (phase !== 0) { centerMarioAndCommitClimbStep(m); return; }
  const probe = u8(newY + 8);
  if (probe === mem.read8(MARIO_CLIMB_LIMIT_B)) { endClimbAtLadderLimit(m); return; }
  const nearLimit = mem.read8(MARIO_CLIMB_LIMIT_A);
  if (probe === nearLimit) { endClimbAtLadderLimit(m); return; }
  const dist = u8(probe - nearLimit);
  setClimbSpriteFrame(m, dist === 8 ? 5 : dist === 12 ? 4 : 3);
}

/** Broken twin (c): WRONG-FRAME — always picks frame 3, so MARIO_SPRITE_CODE diverges
 *  wherever the correct climb frame is 5 or 4. */
function brokenWrongFrame(m, climbStep) {
  const { mem } = m;
  const newY = u8(mem.read8(MARIO_Y) + climbStep);
  mem.write8(MARIO_Y, newY);
  const phase = mem.read8(CENTERING_PHASE) ^ 1;
  mem.write8(CENTERING_PHASE, phase);
  if (phase !== 0) { centerMarioAndCommitClimbStep(m); return; }
  const probe = u8(newY + 8);
  if (probe === mem.read8(MARIO_CLIMB_LIMIT_B)) { endClimbAtLadderLimit(m); return; }
  const nearLimit = mem.read8(MARIO_CLIMB_LIMIT_A);
  if (probe === nearLimit) { endClimbAtLadderLimit(m); return; }
  setClimbSpriteFrame(m, 3); // BUG: ignores the distance-based 5/4/3 selection
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x1D11 is dispatched during 25m attract", () => {
  const caps = captureDispatches(4, 8000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1D11 dispatch — the attract demo climbs a ladder");
  console.log(`  REACHABILITY: ${caps.length}+ natural 0x1D11 dispatches during attract`);
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): loc_1d11 == oracle on every captured 0x1D11 entry", () => {
  const caps = captureDispatches(64, 8000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1D11 dispatch during 25m attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_1d11); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const steps = new Set(caps.map((c) => hx(c.regs.a)));
  const phases = new Set(caps.map((c) => hx(c.mem.read8(CENTERING_PHASE))));
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP ` +
      `(steps at entry: ${[...steps].join(",")}; centering phase: ${[...phases].join(",")})`,
  );
});

// -- 2. EQUAL (crafted, all arms) ---------------------------------------------

test("EQUAL (crafted): center / both ladder-end exits / all three climb frames match the oracle", () => {
  const caps = captureDispatches(1, 8000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  const Y0 = 0x60;                 // chosen height; probe = (Y0 + 8) with delta 0
  const probe = u8(Y0 + 8);        // 0x68

  const cases = [
    // Center phase: toggle flips 0 -> 1 (non-zero), so the centering path runs (0x1D51).
    { name: "center phase", opts: { delta: 0x02, marioY: Y0, phase: 0x00 },
      expect: (o) => {
        assert.equal(o.mem.read8(CENTERING_PHASE), 1, "toggle must flip to 1");
        assert.equal(o.mem.read8(MARIO_ON_LADDER), 1, "centering path re-asserts on-ladder");
        assert.equal(o.mem.read8(MARIO_Y), u8(Y0 + 0x02), "MARIO_Y must advance by the step");
      } },
    // Ladder-end via LIMIT_B (tested first).
    { name: "end at LIMIT_B", opts: { delta: 0x00, marioY: Y0, phase: 0x01, limitB: probe, limitA: u8(probe + 0x40) },
      expect: (o) => {
        assert.equal(o.mem.read8(MARIO_ON_LADDER), 0, "ladder-end dismount clears on-ladder");
        assert.equal(o.mem.read8(MARIO_SPRITE_CODE), 0x06, "ladder-end pose is 0x06");
      } },
    // Ladder-end via LIMIT_A (LIMIT_B must miss first).
    { name: "end at LIMIT_A", opts: { delta: 0x00, marioY: Y0, phase: 0x01, limitB: u8(probe + 1), limitA: probe },
      expect: (o) => {
        assert.equal(o.mem.read8(MARIO_ON_LADDER), 0, "ladder-end dismount clears on-ladder");
        assert.equal(o.mem.read8(MARIO_SPRITE_CODE), 0x06, "ladder-end pose is 0x06");
      } },
    // Climb frame 5: distance above near limit == 8.
    { name: "climb frame 5 (dist 8)", opts: { delta: 0x00, marioY: Y0, phase: 0x01, limitB: u8(probe + 3), limitA: u8(probe - 8) },
      expect: (o) => {
        assert.equal(o.mem.read8(MARIO_ON_LADDER), 1, "climb-frame path re-asserts on-ladder");
        assert.equal(o.mem.read8(MARIO_SPRITE_CODE) & 0x07, 5, "frame 5 in the sprite code");
      } },
    // Climb frame 4: distance == 12.
    { name: "climb frame 4 (dist 12)", opts: { delta: 0x00, marioY: Y0, phase: 0x01, limitB: u8(probe + 3), limitA: u8(probe - 12) },
      expect: (o) => assert.equal(o.mem.read8(MARIO_SPRITE_CODE) & 0x07, 4, "frame 4 in the sprite code") },
    // Climb frame 3: any other distance (20).
    { name: "climb frame 3 (dist 20)", opts: { delta: 0x00, marioY: Y0, phase: 0x01, limitB: u8(probe + 7), limitA: u8(probe - 20) },
      expect: (o) => assert.equal(o.mem.read8(MARIO_SPRITE_CODE) & 0x07, 3, "frame 3 in the sprite code") },
    // Non-zero step with wrap: 0xFE (−2) from a low Y wraps the byte.
    { name: "stepped wrap (delta -2)", opts: { delta: 0xfe, marioY: 0x01, phase: 0x00 },
      expect: (o) => assert.equal(o.mem.read8(MARIO_Y), u8(0x01 + 0xfe), "MARIO_Y wraps on the step") },
  ];

  for (const { name, opts, expect } of cases) {
    const entry = craft(seed, opts);
    const diffs = contractDiffs(entry, loc_1d11);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
    expect(runOracle(entry)); // confirm the oracle really took the intended arm
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (center, 2x ladder-end, 3x climb frame, stepped wrap) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the dropped-step, dropped-toggle, and wrong-frame twins are CAUGHT", () => {
  const caps = captureDispatches(1, 8000);
  assert.ok(caps.length >= 1, "need a real capture to seed the teeth baits");
  const seed = caps[0];

  const Y0 = 0x60;
  const probe = u8(Y0 + 8);

  // (a) dropped-step bait: a non-zero step on the center phase — only MARIO_Y should move,
  //     so the twin that skips the update diverges on MARIO_Y.
  const stepBait = craft(seed, { delta: 0xfe, marioY: Y0, phase: 0x00 });
  const dropStep = contractDiffs(stepBait, brokenDropStep);
  assert.ok(dropStep.length > 0, "the dropped-step twin escaped — the gate is worthless");
  assert.ok(dropStep[0].startsWith(`RAM@0x${MARIO_Y.toString(16)}`),
    `expected the dropped-step diff at MARIO_Y, got ${dropStep[0]}`);

  // (b) dropped-toggle bait: center phase — the toggle write is the observable, so the twin
  //     that skips it diverges on 0x6222.
  const toggleBait = craft(seed, { delta: 0x00, marioY: Y0, phase: 0x00 });
  const dropToggle = contractDiffs(toggleBait, brokenDropToggle);
  assert.ok(dropToggle.length > 0, "the dropped-toggle twin escaped — the gate is worthless");
  assert.ok(dropToggle[0].startsWith(`RAM@0x${CENTERING_PHASE.toString(16)}`),
    `expected the dropped-toggle diff at 0x6222, got ${dropToggle[0]}`);

  // (c) wrong-frame bait: a frame-5 case (dist 8) — the twin forces frame 3, so
  //     MARIO_SPRITE_CODE diverges.
  const frameBait = craft(seed, { delta: 0x00, marioY: Y0, phase: 0x01, limitB: u8(probe + 3), limitA: u8(probe - 8) });
  const wrongFrame = contractDiffs(frameBait, brokenWrongFrame);
  assert.ok(wrongFrame.length > 0, "the wrong-frame twin escaped — the gate is worthless");
  assert.ok(wrongFrame[0].startsWith(`RAM@0x${MARIO_SPRITE_CODE.toString(16)}`),
    `expected the wrong-frame diff at MARIO_SPRITE_CODE, got ${wrongFrame[0]}`);

  console.log(
    `  TEETH: dropped-step caught (${dropStep[0]}); dropped-toggle caught (${dropToggle[0]}); ` +
      `wrong-frame caught (${wrongFrame[0]})`,
  );
});
