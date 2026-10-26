// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for loc_1c4f (ROM 0x1C4F) — the jump/fall LANDING RESET: settle
 * Mario's grounded/alive/pose/lock state, commit a pending item pickup, then tail into the
 * hardware sprite-record refresh.
 *
 * The routine WRITES MEMORY and its two callees are already idiomatic — it direct-calls
 * loc_1d95 (0x1D95, the pickup commit) under a latch, and always tail-calls
 * writeMarioSpriteRecord (0x1DA6). So it is gated on MEMORY-equivalence — RAM (minus the
 * dead STACK_SCRATCH) + pc + SP — never a register file (its live-out is memory-only; see
 * the routine header), and every case runs on a FRESH clone (a reused clone is only safe
 * for a read-only leaf; this writes).
 *
 * STACK MODEL: the idiomatic routine models no stack — it direct-calls both callees and
 * returns plainly. The oracle's only NET stack effect on every path is a single `ret` (the
 * conditional pickup `call z` pushes a return address that loc_1d95's own `ret` immediately
 * pops — net zero, and the pushed bytes land in the excluded STACK_SCRATCH; the tail jump
 * into writeMarioSpriteRecord contributes the one real `ret`). So the harness performs ONE
 * m.ret() on the candidate after the call to line pc + SP up with the oracle — the same
 * pattern as the continueWalkStep (0x1CEB) / writeMarioSpriteRecord (0x1DA6) tests. Real
 * captured dispatches carry SP at 0x6bec/0x6bee (inside STACK_SCRATCH), so the pickup arm's
 * push residue is correctly excluded; crafted entries pin SP to 0x6bfe for the same reason.
 *
 *   1. REACHABILITY — 0x1C4F is dispatched during attract (the demo lands Mario).
 *   2. EQUAL (real dispatches) — hook 0x1C4F in a real attract run, clone at each true
 *      dispatch; oracle vs candidate agree on RAM + pc + SP for every one. Attract lands
 *      Mario only on 25m with the grounded flag 0, and the pickup latch is set on some
 *      landings — so real captures cover the no-pickup arm AND the pickup arm's 25m
 *      (no-sound) path.
 *   3. EQUAL (crafted) — from a real seed, reach the arms attract never does: a NONZERO
 *      grounded-flag store (proves it is not hardcoded), both MARIO_ACTIVE arms (the
 *      fatal-fall flip), the sprite-pose mask over {0x00,0x7f,0x80,0xff}, the off-25m pickup
 *      that makes loc_1d95 queue the tune, and a pickup with a nonzero grounded flag (proves
 *      the grounded store and the pickup-commit value are distinct — the latter is the
 *      cleared 0, not the flag). Each compared identically both sides + targeted assertions.
 *   4. TEETH — deliberately-broken twins, each MUST be caught:
 *      (a) hardcoded grounded flag (stores 0, not the passed flag) — caught at MARIO_AIRBORNE.
 *      (b) skipped pickup commit (never calls loc_1d95) — caught at ITEM_COLLECTED.
 *      (c) wrong pose mask (| 0x0e) — caught at MARIO_SPRITE_CODE.
 *      (d) dropped MARIO_ACTIVE flip (copies the fatal-fall flag) — caught at MARIO_ACTIVE.
 *      (e) wrong pickup-commit value (hands the callee the grounded flag) — caught at
 *          ITEM_COLLECTED on a nonzero-flag pickup.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1c4f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1c4f as oracle } from "../../translated/loc_1c4f.js";
import { settleMarioOnLanding as loc_1c4f } from "../settleMarioOnLanding.js";
import { loc_1d95 } from "../loc_1d95.js";
import { writeMarioSpriteRecord } from "../writeMarioSpriteRecord.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_AIRBORNE,
  MARIO_FATAL_FALL,
  MARIO_ACTIVE,
  MARIO_SPRITE_CODE,
  MARIO_FREEZE_TIMER,
  MARIO_AIR_LANDCHECK,
  ITEM_COLLECTED,
  BOARD,
  SND_PRIORITY,
  SND_PRIORITY_FRAMES,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1c4f;
const FRAMES = 6000; // attract lands Mario a handful of times over this window
const SAFE_SP = 0x6bfe; // inside STACK_SCRATCH, so the pickup `call z` push residue is excluded
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
 *  region (the oracle's tail `ret` pops from there and its pickup `call z` pushes there;
 *  the idiomatic routine uses the JS call stack, so excluding it is the contract). */
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

/** Run the ORACLE on a fresh clone; its net single `ret` advances pc/SP. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model its single net return with ONE m.ret()
 *  so pc + SP match the oracle's (the idiomatic routine replaces the Z80 stack with the
 *  JS call stack, so it does not touch pc/SP itself). */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. */
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

/** Hook 0x1C4F in a real attract run and clone the machine at up to K real dispatches. */
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

/** A real captured state, with the landing flag / pokes applied and a safe SP. `a` is the
 *  grounded flag the caller passes in a register (0 in play). */
function craft(seed, { a = 0, fatalFall, spriteCode, item, board } = {}) {
  const e = seed.clone();
  e.regs.a = a;
  if (fatalFall !== undefined) e.mem.write8(MARIO_FATAL_FALL, fatalFall);
  if (spriteCode !== undefined) e.mem.write8(MARIO_SPRITE_CODE, spriteCode);
  if (item !== undefined) e.mem.write8(ITEM_COLLECTED, item);
  if (board !== undefined) e.mem.write8(BOARD, board);
  e.regs.sp = SAFE_SP;
  return e;
}

// -- teeth twins (each still tail-calls writeMarioSpriteRecord, so ONE net ret) ----

/** (a) hardcodes the grounded flag to 0 instead of storing the passed-in flag. */
function brokenHardcodedAirborne(m) {
  const { regs, mem } = m;
  mem.write8(MARIO_AIRBORNE, 0); // BUG: should store regs.a
  mem.write8(MARIO_ACTIVE, mem.read8(MARIO_FATAL_FALL) ^ 1);
  mem.write8(MARIO_SPRITE_CODE, (mem.read8(MARIO_SPRITE_CODE) & 0x80) | 0x0f);
  mem.write8(MARIO_FREEZE_TIMER, 4);
  mem.write8(MARIO_AIR_LANDCHECK, 0);
  if (mem.read8(ITEM_COLLECTED) === 1) { regs.a = 0; loc_1d95(m); }
  writeMarioSpriteRecord(m);
}

/** (b) never commits a pending pickup — leaves the latch set. */
function brokenSkipPickup(m) {
  const { regs, mem } = m;
  mem.write8(MARIO_AIRBORNE, regs.a);
  mem.write8(MARIO_ACTIVE, mem.read8(MARIO_FATAL_FALL) ^ 1);
  mem.write8(MARIO_SPRITE_CODE, (mem.read8(MARIO_SPRITE_CODE) & 0x80) | 0x0f);
  mem.write8(MARIO_FREEZE_TIMER, 4);
  mem.write8(MARIO_AIR_LANDCHECK, 0);
  // BUG: no pickup commit
  writeMarioSpriteRecord(m);
}

/** (c) wrong pose mask — forces 0x0e instead of 0x0f. */
function brokenPoseMask(m) {
  const { regs, mem } = m;
  mem.write8(MARIO_AIRBORNE, regs.a);
  mem.write8(MARIO_ACTIVE, mem.read8(MARIO_FATAL_FALL) ^ 1);
  mem.write8(MARIO_SPRITE_CODE, (mem.read8(MARIO_SPRITE_CODE) & 0x80) | 0x0e); // BUG
  mem.write8(MARIO_FREEZE_TIMER, 4);
  mem.write8(MARIO_AIR_LANDCHECK, 0);
  if (mem.read8(ITEM_COLLECTED) === 1) { regs.a = 0; loc_1d95(m); }
  writeMarioSpriteRecord(m);
}

/** (d) drops the MARIO_ACTIVE flip — copies the fatal-fall flag unchanged. */
function brokenNoActiveFlip(m) {
  const { regs, mem } = m;
  mem.write8(MARIO_AIRBORNE, regs.a);
  mem.write8(MARIO_ACTIVE, mem.read8(MARIO_FATAL_FALL)); // BUG: no flip
  mem.write8(MARIO_SPRITE_CODE, (mem.read8(MARIO_SPRITE_CODE) & 0x80) | 0x0f);
  mem.write8(MARIO_FREEZE_TIMER, 4);
  mem.write8(MARIO_AIR_LANDCHECK, 0);
  if (mem.read8(ITEM_COLLECTED) === 1) { regs.a = 0; loc_1d95(m); }
  writeMarioSpriteRecord(m);
}

/** (e) commits the wrong pickup value — hands loc_1d95 the grounded flag instead of the
 *  cleared 0, so a nonzero grounded flag lands in ITEM_COLLECTED. */
function brokenCommitWrongValue(m) {
  const { regs, mem } = m;
  mem.write8(MARIO_AIRBORNE, regs.a);
  mem.write8(MARIO_ACTIVE, mem.read8(MARIO_FATAL_FALL) ^ 1);
  mem.write8(MARIO_SPRITE_CODE, (mem.read8(MARIO_SPRITE_CODE) & 0x80) | 0x0f);
  mem.write8(MARIO_FREEZE_TIMER, 4);
  mem.write8(MARIO_AIR_LANDCHECK, 0);
  if (mem.read8(ITEM_COLLECTED) === 1) { loc_1d95(m); } // BUG: regs.a left at the grounded flag
  writeMarioSpriteRecord(m);
}

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x1C4F is dispatched during attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(FRAMES);
  assert.ok(count > 0, "0x1C4F should be dispatched — attract lands Mario");
  console.log(`  REACHABILITY: ${count} natural 0x1C4F dispatches in ${FRAMES} frames`);
});

// -- 2. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): loc_1c4f == oracle on every captured 0x1C4F entry", () => {
  const caps = captureDispatches(256, FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x1C4F dispatch during attract");

  let sawPickup = 0, sawNoPickup = 0;
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_1c4f); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
    if (cap.mem.read8(ITEM_COLLECTED) === 1) sawPickup++; else sawNoPickup++;
  }
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP ` +
      `(${sawPickup} pickup, ${sawNoPickup} no-pickup)`,
  );
});

// -- 3. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): nonzero flag, both MARIO_ACTIVE arms, pose mask, off-25m pickup", () => {
  const caps = captureDispatches(1, FRAMES);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  // (a) nonzero grounded flag -> stored verbatim into MARIO_AIRBORNE (not hardcoded).
  {
    const e = craft(seed, { a: 0x37, item: 0 });
    const diffs = contractDiffs(e, loc_1c4f);
    assert.equal(diffs.length, 0, `nonzero flag: ${diffs.join("; ")}`);
    assert.equal(runCandidate(e, loc_1c4f).mem.read8(MARIO_AIRBORNE), 0x37, "grounded flag not stored");
  }

  // (b) the fatal-fall flip: clear -> alive (1); set -> inert (0).
  for (const [fatalFall, active] of [[0x00, 1], [0x01, 0]]) {
    const e = craft(seed, { fatalFall, item: 0 });
    const diffs = contractDiffs(e, loc_1c4f);
    assert.equal(diffs.length, 0, `fatalFall=${hx(fatalFall)}: ${diffs.join("; ")}`);
    assert.equal(runCandidate(e, loc_1c4f).mem.read8(MARIO_ACTIVE), active, `fatalFall=${hx(fatalFall)}: wrong MARIO_ACTIVE`);
  }

  // (c) sprite-pose mask: keep bit 0x80, force the pose bits to 0x0f.
  for (const [code, expect] of [[0x00, 0x0f], [0x7f, 0x0f], [0x80, 0x8f], [0xff, 0x8f]]) {
    const e = craft(seed, { spriteCode: code, item: 0 });
    const diffs = contractDiffs(e, loc_1c4f);
    assert.equal(diffs.length, 0, `code=${hx(code)}: ${diffs.join("; ")}`);
    assert.equal(runCandidate(e, loc_1c4f).mem.read8(MARIO_SPRITE_CODE), expect, `code=${hx(code)}: wrong pose`);
  }

  // (d) off-25m pickup: loc_1d95 clears the latch AND queues the tune.
  {
    const e = craft(seed, { item: 1, board: 2 });
    const diffs = contractDiffs(e, loc_1c4f);
    assert.equal(diffs.length, 0, `off-25m pickup: ${diffs.join("; ")}`);
    const c = runCandidate(e, loc_1c4f);
    assert.equal(c.mem.read8(ITEM_COLLECTED), 0, "off-25m pickup: latch not cleared");
    assert.equal(c.mem.read8(SND_PRIORITY), 0x0d, "off-25m pickup: tune not queued");
    assert.equal(c.mem.read8(SND_PRIORITY_FRAMES), 0x03, "off-25m pickup: tune length not set");
  }

  // (e) 25m pickup with a NONZERO grounded flag: the flag lands in MARIO_AIRBORNE, but the
  //     latch commit value is the cleared 0 (not the flag), and 25m queues no tune.
  {
    const sndBefore = seed.mem.read8(SND_PRIORITY);
    const e = craft(seed, { a: 0x37, item: 1, board: 1 });
    const diffs = contractDiffs(e, loc_1c4f);
    assert.equal(diffs.length, 0, `25m pickup nonzero flag: ${diffs.join("; ")}`);
    const c = runCandidate(e, loc_1c4f);
    assert.equal(c.mem.read8(MARIO_AIRBORNE), 0x37, "grounded flag not stored on the pickup path");
    assert.equal(c.mem.read8(ITEM_COLLECTED), 0, "latch not cleared to 0 (commit value must be the cleared flag)");
    assert.equal(c.mem.read8(SND_PRIORITY), sndBefore, "25m must not queue the pickup tune");
  }

  // (f) no-pickup latch values (0 and 2) leave the latch untouched.
  for (const item of [0x00, 0x02]) {
    const e = craft(seed, { item });
    const diffs = contractDiffs(e, loc_1c4f);
    assert.equal(diffs.length, 0, `no-pickup item=${hx(item)}: ${diffs.join("; ")}`);
    assert.equal(runCandidate(e, loc_1c4f).mem.read8(ITEM_COLLECTED), item, `item=${hx(item)}: latch changed`);
  }

  console.log("  EQUAL/crafted: nonzero flag, both MARIO_ACTIVE arms, 4 pose masks, off-25m + 25m pickup, no-pickup — all identical");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: hardcoded flag / skipped pickup / wrong pose / dropped flip / wrong commit are CAUGHT", () => {
  const caps = captureDispatches(1, FRAMES);
  assert.ok(caps.length >= 1, "need a real capture for the teeth check");
  const seed = caps[0];

  // (a) hardcoded grounded flag — caught by a nonzero-flag entry at MARIO_AIRBORNE.
  const dA = contractDiffs(craft(seed, { a: 0x37, item: 0 }), brokenHardcodedAirborne);
  assert.ok(dA.length > 0, "hardcoded grounded flag escaped — the gate is worthless");
  assert.ok(dA[0].startsWith(`RAM@0x${MARIO_AIRBORNE.toString(16)}`), `expected MARIO_AIRBORNE diff, got ${dA[0]}`);

  // (b) skipped pickup commit — caught on a pickup entry at ITEM_COLLECTED.
  const dB = contractDiffs(craft(seed, { item: 1, board: 1 }), brokenSkipPickup);
  assert.ok(dB.length > 0, "skipped pickup commit escaped — worthless");
  assert.ok(dB[0].startsWith(`RAM@0x${ITEM_COLLECTED.toString(16)}`), `expected ITEM_COLLECTED diff, got ${dB[0]}`);

  // (c) wrong pose mask — caught at MARIO_SPRITE_CODE.
  const dC = contractDiffs(craft(seed, { spriteCode: 0x00, item: 0 }), brokenPoseMask);
  assert.ok(dC.length > 0, "wrong pose mask escaped — worthless");
  assert.ok(dC[0].startsWith(`RAM@0x${MARIO_SPRITE_CODE.toString(16)}`), `expected MARIO_SPRITE_CODE diff, got ${dC[0]}`);

  // (d) dropped MARIO_ACTIVE flip — caught at MARIO_ACTIVE (fatal-fall set -> 0 vs 1).
  const dD = contractDiffs(craft(seed, { fatalFall: 0x01, item: 0 }), brokenNoActiveFlip);
  assert.ok(dD.length > 0, "dropped MARIO_ACTIVE flip escaped — worthless");
  assert.ok(dD[0].startsWith(`RAM@0x${MARIO_ACTIVE.toString(16)}`), `expected MARIO_ACTIVE diff, got ${dD[0]}`);

  // (e) wrong commit value — caught on a nonzero-flag pickup at ITEM_COLLECTED (0 vs 0x37).
  const dE = contractDiffs(craft(seed, { a: 0x37, item: 1, board: 1 }), brokenCommitWrongValue);
  assert.ok(dE.length > 0, "wrong pickup-commit value escaped — worthless");
  assert.ok(dE[0].startsWith(`RAM@0x${ITEM_COLLECTED.toString(16)}`), `expected ITEM_COLLECTED diff, got ${dE[0]}`);

  console.log(
    `  TEETH: hardcoded-flag (${dA[0]}); skipped-pickup (${dB[0]}); wrong-pose (${dC[0]}); ` +
      `dropped-flip (${dD[0]}); wrong-commit (${dE[0]})`,
  );
});
