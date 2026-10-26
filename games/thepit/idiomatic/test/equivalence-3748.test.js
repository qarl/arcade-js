// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for advanceTwoSpriteActor (ROM 0x3748, The Pit) — the per-frame update
 * for the two-sprite actor: dispatch by spawn state (BOARD_END_PHASE) and animation phase
 * (PLAY_PHASE_COUNTER), and on the running phases march + walk-animate the actor inline
 * before staging its two sprite records.
 *
 * THE CONTRACT — OBSERVABLE RAM ONLY. Every arm is a TAIL JUMP: the oracle hands the
 * frame to a callee whose `ret` returns to advanceTwoSpriteActor's own caller. The idiomatic routine
 * dissolves each tail jump into a direct JS call to the already-decompiled callee
 * (spawnAltPhaseActor / advanceOrRebuildTwinActor / spawnTwinActor / stageActorSpriteRecords), which run
 * stack-free — they no longer march SP, set pc, or leave the oracle's residual value
 * registers. The steady mover at 0x3a13 is likewise the decompiled advanceActorMovers,
 * called directly and stack-free. So pc, SP and the value registers diverge from the
 * oracle BY CONSTRUCTION and are excluded — the gate compares the full RAM dump (work +
 * colour + video + attr/sprite), which is exactly what the display reads. The one arm
 * that pushes onto the Z80 stack (the alt-phase spawn's sound request) parks a few dead
 * bytes just below the entry SP that the stack-free idiomatic routine does not reproduce;
 * that window (top of work RAM, no named/observable cell lives there) is excluded too.
 *
 * REACHABILITY. In a 4000-frame attract run 0x3748 dispatches ~3700 times and 5 of its 6
 * arms occur naturally — the inline move (phases 0..2), the seed+move (3..5), the
 * rebuild-at-edge (6..8), the twin spawn (9), and the steady mover (10+). The sixth, the
 * alt-phase spawn (BOARD_END_PHASE != 0), is never reached in attract, and the one-shot seed
 * body (phases 3..5 with the actor not yet present) fires only twice — so both are also
 * exercised from CRAFTED entries: a real captured state with BOARD_END_PHASE / PLAY_PHASE_COUNTER /
 * PLAYER_ACTIVE poked identically on both sides.
 *
 * Checks:
 *   1. EQUAL (natural) — every captured attract dispatch, oracle vs idiomatic, full RAM
 *      identical; asserts all 5 natural arms were seen so none passes vacuously.
 *   2. EQUAL (crafted alt-phase spawn) — BOARD_END_PHASE poked to force the spawn body (and
 *      its sound-request stack push) and the already-active hand-off; RAM identical
 *      outside the dead stack window, plus a positive check the actor was marked live.
 *   3. EQUAL (crafted seed body) — PLAY_PHASE_COUNTER in 3..5 with PLAYER_ACTIVE cleared, so
 *      the one-shot seed runs; RAM identical, plus positive checks it seeded the step
 *      vector / presence flag / start cell.
 *   4. TEETH (bad march) — a twin that mis-places the twin sprite whenever a march
 *      actually happened is CAUGHT at the twin's X byte.
 *   5. TEETH (bad seed) — a twin that seeds the wrong start cell on the seed body is
 *      CAUGHT at PLAYER_Y.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-3748.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3748 as oracle } from "../../translated/loc_3748.js";
import { advanceTwoSpriteActor } from "../advanceTwoSpriteActor.js";
import { makeMachineFactory } from "../../machine.js";
import {
  ENEMY3_STEP_X, ENEMY3_X, PLAY_PHASE_COUNTER, PLAYER_Y, PLAYER_ACTIVE, BOARD_END_PHASE, ENEMY3_TWIN_X,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x3748;
// The alt-phase spawn arm's sound request pushes a handful of bytes just below the entry
// SP (always 0x83fd here) that the stack-free idiomatic routine does not reproduce. It is
// dead scratch at the top of work RAM — no named or display-visible cell lives there — so
// the RAM diff skips this window. Every other arm is push-free, so this excludes nothing
// real on them.
const STACK_WINDOW = 32;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The Pit's routine registry is async, so build the factory once and reuse it.
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/** Classify which dispatch arm a captured entry takes (from the two control bytes). */
function armOf(mm) {
  const sp = mm.mem.read8(BOARD_END_PHASE);
  const fc = mm.mem.read8(PLAY_PHASE_COUNTER);
  if (sp !== 0) return "altspawn";
  if (fc >= 10) return "steady";
  if (fc >= 9) return "twin";
  if (fc >= 6) return "rebuild";
  if (fc >= 3) return "seed";
  return "move";
}

/**
 * Capture a capped, strided spread of real attract dispatches of 0x3748, each tagged
 * with its arm. The wrapper runs the oracle so attract proceeds undisturbed.
 */
function captureEntries(maxFrames, stride, cap) {
  const entries = [];
  let seen = 0;
  const hook = new Map([[TARGET, (mm) => {
    if (seen % stride === 0 && entries.length < cap) {
      entries.push({ entry: mm.clone(), arm: armOf(mm) });
    }
    seen++;
    return oracle(mm);
  }]]);
  makeMachine(hook).runFrames(maxFrames);
  return entries;
}

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack-scratch window
 * [entrySP - STACK_WINDOW, entrySP). Null when otherwise identical. pc/SP/registers are
 * not compared — they diverge by construction on the tail-jump ladder.
 */
function observableDiff(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_WINDOW, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run oracle vs a candidate on independent clones of one entry; return the diff (or null). */
function diffAgainstOracle(entry, fn) {
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  fn(b);
  return observableDiff(a, b, sp);
}

// -- 1. EQUAL on the naturally-reached arms ----------------------------------

test("EQUAL (natural): advanceTwoSpriteActor == oracle on every captured attract dispatch (full RAM)", () => {
  const caps = captureEntries(4000, 3, 700);
  assert.ok(caps.length >= 100, `expected many captured dispatches, got ${caps.length}`);

  const armCounts = {};
  let firstDiff = null;
  for (let i = 0; i < caps.length; i++) {
    armCounts[caps[i].arm] = (armCounts[caps[i].arm] || 0) + 1;
    if (!firstDiff) {
      const diff = diffAgainstOracle(caps[i].entry, advanceTwoSpriteActor);
      if (diff) firstDiff = { i, arm: caps[i].arm, diff };
    }
  }

  assert.equal(
    firstDiff,
    null,
    firstDiff &&
      `RAM diff on capture #${firstDiff.i} (arm=${firstDiff.arm}) at ` +
        `${hx(firstDiff.diff.addr)} oracle=${firstDiff.diff.a} idiomatic=${firstDiff.diff.b}`,
  );

  for (const arm of ["move", "seed", "rebuild", "twin", "steady"]) {
    assert.ok(armCounts[arm] > 0, `expected the ${arm} arm to be exercised (got ${armCounts[arm] || 0})`);
  }
  console.log(`  EQUAL/natural: ${caps.length} dispatches identical (full RAM) — arms ${JSON.stringify(armCounts)}`);
});

// -- 2. EQUAL on the crafted alt-phase-spawn arm (attract never reaches it) ----

test("EQUAL (crafted alt-phase spawn): BOARD_END_PHASE-forced arm == oracle, incl. the sound-push window", () => {
  const seed = captureEntries(1500, 1, 1)[0];
  assert.ok(seed, "need a captured entry to craft the alt-phase-spawn arm from");

  // 2 -> first-frame spawn body (start row 22); 1 -> spawn body (start row 23); 255 ->
  // already-active hand-off to the per-frame animator.
  for (const phase of [1, 2, 255]) {
    const entry = seed.entry.clone();
    entry.mem.write8(BOARD_END_PHASE, phase);
    const diff = diffAgainstOracle(entry, advanceTwoSpriteActor);
    assert.equal(diff, null, diff && `BOARD_END_PHASE=${phase}: RAM diff at ${hx(diff.addr)} oracle=${diff.a} idiomatic=${diff.b}`);
  }

  // Positive check: forcing a spawn sub-phase marks the actor live (255).
  const spawnCase = seed.entry.clone();
  spawnCase.mem.write8(BOARD_END_PHASE, 2);
  advanceTwoSpriteActor(spawnCase);
  assert.equal(spawnCase.mem.read8(BOARD_END_PHASE), 255, "the spawn body should mark the actor live");
  console.log("  EQUAL/altspawn: spawn body (rows 22/23) + already-active hand-off identical outside the dead stack window");
});

// -- 3. EQUAL on the crafted seed body (fires only twice in attract) -----------

test("EQUAL (crafted seed body): the one-shot seed == oracle and seeds the expected cells", () => {
  const seed = captureEntries(1500, 1, 1)[0];
  assert.ok(seed, "need a captured entry to craft the seed body from");

  for (const fc of [3, 4, 5]) {
    const entry = seed.entry.clone();
    entry.mem.write8(BOARD_END_PHASE, 0); // stay on the phase-routed path
    entry.mem.write8(PLAY_PHASE_COUNTER, fc);
    entry.mem.write8(PLAYER_ACTIVE, 0); // not yet present -> the seed runs
    const diff = diffAgainstOracle(entry, advanceTwoSpriteActor);
    assert.equal(diff, null, diff && `PLAY_PHASE_COUNTER=${fc}: RAM diff at ${hx(diff.addr)} oracle=${diff.a} idiomatic=${diff.b}`);
  }

  // Positive checks: the seed marked the actor present, parked its start cell, and set
  // the march-left step vector.
  const entry = seed.entry.clone();
  entry.mem.write8(BOARD_END_PHASE, 0);
  entry.mem.write8(PLAY_PHASE_COUNTER, 4);
  entry.mem.write8(PLAYER_ACTIVE, 0);
  advanceTwoSpriteActor(entry);
  assert.equal(entry.mem.read8(PLAYER_ACTIVE), 255, "seed must mark the actor present");
  assert.equal(entry.mem.read8(PLAYER_Y), 45, "seed must park the start cell at 45");
  assert.equal(entry.mem.read8(ENEMY3_STEP_X), 255, "seed must set the step to march one cell left (255 == -1)");
  console.log("  EQUAL/seed: one-shot seed identical to the oracle and seeds PLAYER_ACTIVE/PLAYER_Y/ENEMY3_STEP_X");
});

// -- 4. TEETH: a mis-placed twin on a real march is CAUGHT ---------------------

/** Broken twin: the real routine, then — only when a march actually moved the body — the
 *  twin's X byte is bumped, the exact defect a wrong twin-lead offset would produce. */
function twinBadMarch(m) {
  const beforeX = m.mem.read8(ENEMY3_X);
  advanceTwoSpriteActor(m);
  if (m.mem.read8(ENEMY3_X) !== beforeX) {
    m.mem.write8(ENEMY3_TWIN_X, (m.mem.read8(ENEMY3_TWIN_X) + 1) & 0xff); // BUG: twin no longer leads the body correctly
  }
}

test("TEETH (bad march): a mis-placed twin whenever the body actually marched is CAUGHT at ENEMY3_TWIN_X", () => {
  const caps = captureEntries(4000, 3, 700);
  let caught = null;
  for (let i = 0; i < caps.length && !caught; i++) {
    const diff = diffAgainstOracle(caps[i].entry, twinBadMarch);
    if (diff) caught = { i, arm: caps[i].arm, diff };
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a mis-placed twin on a march — it proves nothing");
  assert.equal(
    caught.diff.addr,
    ENEMY3_TWIN_X,
    `bad-march teeth caught the wrong address ${hx(caught.diff.addr)} (expected ${hx(ENEMY3_TWIN_X)})`,
  );
  console.log(`  TEETH/march: mis-placed twin caught on capture #${caught.i} (arm=${caught.arm}) at ${hx(caught.diff.addr)}`);
});

// -- 5. TEETH: a wrong seed is CAUGHT at PLAYER_Y --------------------------------

/** Broken twin: the real routine, then the seeded start cell overwritten with a wrong
 *  value on the seed body. */
function twinBadSeed(m) {
  const willSeed = m.mem.read8(BOARD_END_PHASE) === 0 &&
    m.mem.read8(PLAY_PHASE_COUNTER) >= 3 && m.mem.read8(PLAY_PHASE_COUNTER) < 6 &&
    m.mem.read8(PLAYER_ACTIVE) === 0;
  advanceTwoSpriteActor(m);
  if (willSeed) m.mem.write8(PLAYER_Y, 46); // BUG: oracle parks the start cell at 45
}

test("TEETH (bad seed): a wrong seeded start cell is CAUGHT at PLAYER_Y", () => {
  const seed = captureEntries(1500, 1, 1)[0];
  assert.ok(seed, "need a captured entry to craft the seed teeth from");
  const entry = seed.entry.clone();
  entry.mem.write8(BOARD_END_PHASE, 0);
  entry.mem.write8(PLAY_PHASE_COUNTER, 4);
  entry.mem.write8(PLAYER_ACTIVE, 0);

  const diff = diffAgainstOracle(entry, twinBadSeed);
  assert.notEqual(diff, null, "the gate FAILED to catch a wrong seed — it proves nothing");
  assert.equal(diff.addr, PLAYER_Y, `bad-seed teeth caught the wrong address ${hx(diff.addr)} (expected ${hx(PLAYER_Y)})`);
  console.log(`  TEETH/seed: wrong start cell caught at ${hx(diff.addr)} (oracle=${diff.a} broken=${diff.b})`);
});
